#!/usr/bin/env node
// T038 / SC-007: 25 profiles (verified capacity), 10 concurrent profile-scoped requests.
// Requires explicit approval. Creates throwaway profiles (registered via `hermes profile create`),
// then removes them (dirs + registry) unless --keep.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"

const COUNT = Number(process.env.HERMES_SCALE_PROFILES ?? 25)
const CONCURRENCY = Number(process.env.HERMES_SCALE_CONCURRENCY ?? 10)
const GATEWAY = process.env.HERMES_GATEWAY_URL ?? "http://172.17.0.1:8642"
const PROFILES = process.env.HERMES_PROFILES_DIR ?? join(homedir(), ".hermes", "profiles")
const TEMPLATE = process.env.HERMES_TEMPLATE_PROFILE ?? "template-pc"
const REGISTRY = process.env.HERMES_REGISTRY_PATH ?? join(homedir(), ".hermes", "profiles-index", "profiles.json")
const KEEP = process.argv.includes("--keep")

if (COUNT > 25) {
  console.warn(`warning: ${COUNT} profiles exceeds the verified capacity (25); 100 is an unverified design target whose bulk registration previously tripped the gateway watchdog (exit 75)`)
}

if (process.env.HERMES_SCALE_APPROVED !== "1") {
  console.error("scale smoke creates throwaway profiles; set HERMES_SCALE_APPROVED=1 to run")
  process.exit(2)
}
if (!existsSync(join(PROFILES, TEMPLATE))) { console.error(`template missing: ${join(PROFILES, TEMPLATE)}`); process.exit(1) }

const created = []
function deregister(slug) {
  // A plain directory delete is not enough: a gateway restart re-creates homes
  // it still remembers. `hermes profile delete` removes the registration.
  spawnSync("hermes", ["profile", "delete", slug], { input: `${slug}\n`, timeout: 60_000 })
  rmSync(join(PROFILES, slug), { recursive: true, force: true })
}

if (!KEEP) {
  for (const name of readdirSync(PROFILES)) {
    if (name.startsWith("scale-")) deregister(name)
  }
}
function make(i) {
  const slug = `scale-${String(i).padStart(3, "0")}`
  const home = join(PROFILES, slug)
  if (existsSync(home)) return slug
  // hermes profile create both materialises and REGISTERS the profile; a plain
  // directory copy is not discovered by a running gateway (verified 2026-11-26).
  const created_ = spawnSync("hermes", ["profile", "create", slug, "--clone-from", TEMPLATE], { timeout: 120_000 })
  if (created_.status !== 0 || !existsSync(home)) {
    throw new Error(`profile create failed for ${slug}: ${created_.stderr ?? ""}`)
  }
  const envPath = join(home, ".env")
  const kept = existsSync(envPath)
    ? readFileSync(envPath, "utf8").split("\n").filter((l) => !l.startsWith("API_SERVER_KEY=")).join("\n").trim()
    : ""
  const key = randomBytes(32).toString("base64url")
  writeFileSync(envPath, `${kept}\nAPI_SERVER_KEY=${key}\n`, { mode: 0o600 })
  created.push({ slug, key })
  return slug
}

const started = Date.now()
for (let i = 0; i < COUNT; i += 1) make(i)
const createMs = Date.now() - started
console.log(`created ${created.length} profiles in ${(createMs / 1000).toFixed(1)}s; waiting for reconcile…`)
await new Promise((r) => setTimeout(r, 45000))

async function probe(slug, key) {
  const t0 = performance.now()
  const res = await fetch(`${GATEWAY.replace(/\/+$/, "")}/p/${slug}/v1/models`, { headers: { authorization: `Bearer ${key}` } })
  return { ok: res.ok, status: res.status, ms: performance.now() - t0 }
}

if (created.length === 0) {
  console.error("no profiles were created (leftover scale-* dirs?)")
  process.exit(1)
}
const samples = created.slice(0, CONCURRENCY)
async function round() {
  const t0 = performance.now()
  const out = await Promise.all(samples.map((p) => probe(p.slug, p.key)))
  return { out, wall: performance.now() - t0 }
}
let { out: results, wall } = await round()
if (results.some((r) => !r.ok)) {
  console.log("first round had failures; waiting 20s for reconcile and retrying once")
  await new Promise((r) => setTimeout(r, 20000))
  ;({ out: results, wall } = await round())
}
const latencies = results.map((r) => r.ms).sort((a, b) => a - b)
const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0
console.log(`concurrency=${results.length} ok=${results.filter((r) => r.ok).length} wall=${wall.toFixed(0)}ms p95=${p95.toFixed(0)}ms`)

if (!KEEP) {
  for (const { slug } of created) deregister(slug)
  try {
    const reg = JSON.parse(readFileSync(REGISTRY, "utf8"))
    for (const k of Object.keys(reg.profiles)) if (reg.profiles[k].slug?.startsWith("scale-")) delete reg.profiles[k]
    writeFileSync(REGISTRY, JSON.stringify(reg, null, 2))
  } catch { /* registry optional here */ }
  console.log(`cleaned up ${created.length} profiles`)
  const leftovers = readdirSync(PROFILES).filter((name) => name.startsWith("scale-"))
  if (leftovers.length) {
    console.error(`cleanup FAILED: ${leftovers.length} scale profile(s) remain: ${leftovers.slice(0, 5).join(", ")}`)
    process.exit(1)
  }
  try {
    const reg = JSON.parse(readFileSync(REGISTRY, "utf8"))
    const stale = Object.values(reg.profiles).filter((p) => p.slug?.startsWith("scale-"))
    if (stale.length) {
      console.error(`cleanup FAILED: ${stale.length} scale registry entr(y/ies) remain`)
      process.exit(1)
    }
  } catch { /* registry absent is acceptable */ }
  console.log("cleanup verified: no scale profiles or registry entries remain")
}
const ok = results.every((r) => r.ok)
console.log(ok ? "scale smoke passed" : "scale smoke FAILED")
process.exit(ok ? 0 : 1)
