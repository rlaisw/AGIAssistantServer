#!/usr/bin/env node
// Spec 051 operator surface: list / rotate / disable / enable a profile.
// Registry and profile .env only — no key is ever printed.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { randomBytes } from "node:crypto"

function fileEnv() {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local")
  const out = {}
  if (!existsSync(envPath)) return out
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^(HERMES_[A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  return out
}

export function paths(env = process.env) {
  const home = homedir()
  const state = join(home, ".config", "agentic-rag-mcp", "hermes-mcp")
  const fromFile = fileEnv()
  const get = (key) => env[key] ?? fromFile[key]
  return {
    registry: get("HERMES_REGISTRY_PATH") ?? join(state, "profiles.json"),
    profilesDir: get("HERMES_PROFILES_DIR") ?? join(home, ".hermes", "profiles"),
    audit: get("HERMES_AUDIT_PATH") ?? join(state, "audit.jsonl"),
  }
}

function readRegistry(p) {
  if (!existsSync(p.registry)) return { version: 1, updatedAt: new Date(0).toISOString(), profiles: {} }
  return JSON.parse(readFileSync(p.registry, "utf8"))
}

function writeRegistry(p, file) {
  mkdirSync(dirname(p.registry), { recursive: true })
  const tmp = `${p.registry}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ ...file, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
  renameSync(tmp, p.registry)
}

function audit(p, event) {
  try {
    mkdirSync(dirname(p.audit), { recursive: true })
    appendFileSync(p.audit, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
  } catch {
    /* ignore */
  }
}

function find(p, slug) {
  const file = readRegistry(p)
  const entry = Object.values(file.profiles).find((e) => e.slug === slug)
  if (!entry) throw new Error(`profile not found: ${slug}`)
  return { file, entry }
}

function setKey(p, slug, key) {
  const envPath = join(p.profilesDir, slug, ".env")
  if (!existsSync(envPath)) throw new Error(`profile env missing: ${slug}`)
  const kept = readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("API_SERVER_KEY="))
    .join("\n")
    .replace(/\n+$/, "")
  writeFileSync(envPath, `${kept}\nAPI_SERVER_KEY=${key}\n`, { mode: 0o600 })
}

function withRegistryLock(p, fn, timeoutMs = 5000) {
  const lock = `${p.registry}.lock`
  const start = Date.now()
  let fd = null
  while (fd === null) {
    try {
      mkdirSync(dirname(p.registry), { recursive: true })
      fd = openSync(lock, "wx", 0o600)
      writeSync(fd, String(process.pid))
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error("provisioning_in_progress")
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
  try {
    return fn()
  } finally {
    closeSync(fd)
    rmSync(lock, { force: true })
  }
}

export function listProfiles(p = paths()) {
  return Object.values(readRegistry(p).profiles).map((e) => ({
    slug: e.slug,
    status: e.status,
    createdAt: e.createdAt,
    lastSeenAt: e.lastSeenAt,
  }))
}

export function rotateProfile(slug, p = paths(), lockTimeoutMs = 5000) {
  return withRegistryLock(p, () => {
  const { file, entry } = find(p, slug)
  setKey(p, slug, randomBytes(32).toString("base64url"))
  entry.updatedAt = new Date().toISOString()
  entry.lastError = null
  writeRegistry(p, file)
  audit(p, { event: "rotate", slug, oidHash: entry.oidHash, outcome: "ok", code: "ok" })
  return { slug, status: entry.status }
  }, lockTimeoutMs)
}

export async function waitForOldKeyRejected(opts) {
  const { slug, oldKey, gatewayUrl, fetchImpl = fetch, timeoutMs = 30000, intervalMs = 500 } = opts
  const url = `${gatewayUrl.replace(/\/+$/, "")}/p/${slug}/v1/responses`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${oldKey}`, "content-type": "application/json" },
        body: JSON.stringify({ input: "rotation check", instructions: "" }),
      })
      if (res.status === 401 || res.status === 403) return true
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}

export function setProfileStatus(slug, status, p = paths(), lockTimeoutMs = 5000) {
  return withRegistryLock(p, () => {
  const { file, entry } = find(p, slug)
  if (status === "disabled") setKey(p, slug, randomBytes(32).toString("base64url"))
  else setKey(p, slug, randomBytes(32).toString("base64url"))
  entry.status = status
  entry.updatedAt = new Date().toISOString()
  writeRegistry(p, file)
  audit(p, { event: status === "disabled" ? "disable" : "enable", slug, oidHash: entry.oidHash, outcome: "ok", code: "ok" })
  return { slug, status }
  }, lockTimeoutMs)
}

export async function run(argv) {
  const [cmd, slug] = argv
  const p = paths()
  if (cmd === "list") {
    for (const row of listProfiles(p)) console.log(`${row.slug}\t${row.status}\t${row.createdAt}\t${row.lastSeenAt}`)
    return
  }
  if (cmd === "rotate") {
    const before = readFileSync(join(p.profilesDir, slug, ".env"), "utf8")
    const oldKey = (before.split("\n").find((l) => l.startsWith("API_SERVER_KEY=")) || "").slice("API_SERVER_KEY=".length).trim()
    const result = rotateProfile(slug, p)
    if (process.env.HERMES_GATEWAY_URL && oldKey) {
      const rejected = await waitForOldKeyRejected({ slug, oldKey, gatewayUrl: process.env.HERMES_GATEWAY_URL })
      console.log(JSON.stringify({ ...result, oldKeyRejected: rejected }))
      return
    }
    return console.log(JSON.stringify(result))
  }
  if (cmd === "disable") return console.log(JSON.stringify(setProfileStatus(slug, "disabled", p)))
  if (cmd === "enable") return console.log(JSON.stringify(setProfileStatus(slug, "active", p)))
  console.error("usage: profiles-cli.mjs <list|rotate|disable|enable> [slug]")
  process.exit(2)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
