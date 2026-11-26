import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

import type { ProfilesConfig } from "./config"
import { ProfileError } from "./errors"
import { baseSlugFor, assertSlug, collisionSlug, oidHash } from "./identity"
import { Registry, type ProfileEntry } from "./registry"

const execFileAsync = promisify(execFile)
const CLI_TIMEOUT_MS = 30_000
const WARM_TIMEOUT_MS = 10_000

export type EnsureInput = { slug: string; oid: string; email: string; displayName?: string }
export type EnsureResult = { slug: string; status: "active" | "disabled"; created: boolean }
export type ProvisionDeps = {
  runCli?: (args: string[]) => Promise<void>
  warm?: (slug: string, key: string) => Promise<boolean>
  now?: () => Date
  keyFor?: () => string
}

function defaultRunCli(args: string[]): Promise<void> {
  return execFileAsync("hermes", args, { timeout: CLI_TIMEOUT_MS }).then(() => undefined)
}

function readKey(envPath: string): string {
  if (!existsSync(envPath)) throw new ProfileError("profile_misconfigured", "env missing")
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith("API_SERVER_KEY="))
  const key = line?.slice("API_SERVER_KEY=".length).trim() ?? ""
  if (!key) throw new ProfileError("profile_misconfigured", "key missing")
  return key
}

function mintEnv(envPath: string, key: string): void {
  const kept = (existsSync(envPath) ? readFileSync(envPath, "utf8") : "")
    .split("\n")
    .filter((l) => !l.startsWith("API_SERVER_KEY="))
    .join("\n")
    .replace(/\n+$/, "")
  writeFileSync(envPath, `${kept}\nAPI_SERVER_KEY=${key}\n`, { mode: 0o600 })
  chmodSync(envPath, 0o600)
}

function writeUserMd(profileDir: string, input: EnsureInput, winUser: string): void {
  const dir = join(profileDir, "memories")
  mkdirSync(dir, { recursive: true })
  const name = input.displayName?.trim() || input.email.split("@")[0]
  writeFileSync(
    join(dir, "USER.md"),
    `Display Name: ${name}\nEmail: ${input.email}\nWindows user: ${winUser}\n`,
    { mode: 0o600 },
  )
}

function audit(cfg: ProfilesConfig, event: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(cfg.auditPath), { recursive: true })
    appendFileSync(cfg.auditPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
  } catch {
    /* audit must never break a request */
  }
}

async function defaultWarm(cfg: ProfilesConfig, slug: string, key: string): Promise<boolean> {
  // Cheap authenticated probe: /v1/models answers in ms and proves the profile
  // is served; a full /v1/responses turn can exceed the warm budget by itself.
  const deadline = Date.now() + WARM_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${cfg.gatewayUrl.replace(/\/+$/, "")}/p/${slug}/v1/models`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(2_000),
      })
      if (res.ok) return true
    } catch {
      /* retry until deadline */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

export async function ensureProfile(
  cfg: ProfilesConfig,
  input: EnsureInput,
  deps: ProvisionDeps = {},
): Promise<EnsureResult> {
  if (!input.oid?.trim()) throw new ProfileError("identity_required")
  if (!input.email?.includes("@")) throw new ProfileError("invalid_profile_request", "email")
  const base = baseSlugFor(input.email)
  if (input.slug && input.slug !== base && !input.slug.startsWith(`${base}-`)) {
    throw new ProfileError("invalid_profile_request", "slug mismatch")
  }
  const oid = oidHash(input.oid)
  const registry = new Registry(cfg.registryPath)
  const now = deps.now ?? (() => new Date())
  const keyFor = deps.keyFor ?? (() => randomBytes(32).toString("base64url"))
  const runCli = deps.runCli ?? defaultRunCli
  const warm = deps.warm ?? ((slug, key) => defaultWarm(cfg, slug, key))

  let canonical = base
  let key = ""
  let created = false
  let needsWarm = false

  await registry.withLock(async (file) => {
    const existing = file.profiles[oid]
    if (existing?.status === "disabled") throw new ProfileError("profile_disabled")
    if (existing && existsSync(join(cfg.profilesDir, existing.slug))) {
      canonical = existing.slug
      key = readKey(join(cfg.profilesDir, canonical, ".env"))
      needsWarm = existing.lastError?.code === "agent_unavailable"
      // data-model ProfileIndexEntry.lastSeenAt: debounced to one write per minute
      const seenAt = now()
      if (seenAt.getTime() - Date.parse(existing.lastSeenAt) >= 60_000) {
        existing.lastSeenAt = seenAt.toISOString()
      }
      return
    }
    if (existing && !existsSync(join(cfg.profilesDir, existing.slug))) {
      delete file.profiles[oid]
    }
    const taken = Object.values(file.profiles).find(
      (entry) => entry.slug === base && entry.oidHash !== oid,
    )
    canonical = taken ? collisionSlug(base, input.oid) : base
    assertSlug(canonical)

    const profileDir = join(cfg.profilesDir, canonical)
    try {
      await runCli(["profile", "create", canonical, "--clone-from", cfg.templateProfile])
      if (!existsSync(profileDir)) throw new Error("cli did not create the profile directory")
      writeUserMd(profileDir, input, cfg.winUser)
      key = keyFor()
      mintEnv(join(profileDir, ".env"), key)
      const at = now().toISOString()
      const entry: ProfileEntry = {
        oidHash: oid,
        slug: canonical,
        status: "active",
        email: input.email,
        displayName: input.displayName?.trim() || input.email.split("@")[0],
        winUser: cfg.winUser,
        createdAt: at,
        updatedAt: at,
        lastSeenAt: at,
        lastError: null,
      }
      file.profiles[oid] = entry
      created = true
      audit(cfg, { event: "ensure", slug: canonical, oidHash: oid, outcome: "created", code: "ok" })
    } catch (error) {
      rmSync(profileDir, { recursive: true, force: true })
      delete file.profiles[oid]
      const mapped = error instanceof ProfileError ? error : new ProfileError("provision_failed")
      audit(cfg, { event: "ensure", slug: canonical, oidHash: oid, outcome: "failed", code: mapped.code })
      throw mapped
    }
  })

  if (!created && !needsWarm) {
    return { slug: canonical, status: "active", created: false }
  }

  if (!created && needsWarm) {
    if (!(await warm(canonical, key))) {
      throw new ProfileError("agent_unavailable")
    }
    await registry.withLock((file) => {
      const entry = file.profiles[oid]
      if (entry) entry.lastError = null
    })
    return { slug: canonical, status: "active", created: false }
  }

  if (!(await warm(canonical, key))) {
    await registry.withLock((file) => {
      const entry = file.profiles[oid]
      if (entry) {
        entry.lastError = { code: "agent_unavailable", at: new Date().toISOString() }
        entry.status = "active"
      }
    })
    throw new ProfileError("agent_unavailable")
  }
  audit(cfg, { event: "ensure", slug: canonical, oidHash: oid, outcome: "warm", code: "ok" })
  return { slug: canonical, status: "active", created: true }
}
