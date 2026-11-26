#!/usr/bin/env node
// T038 / SC-007: 100 profiles, 10 concurrent profile-scoped requests.
// Requires explicit approval. Creates throwaway profiles by copying the template,
// then removes them (dirs + registry) unless --keep.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"

const COUNT = Number(process.env.HERMES_SCALE_PROFILES ?? 100)
const CONCURRENCY = Number(process.env.HERMES_SCALE_CONCURRENCY ?? 10)
const GATEWAY = process.env.HERMES_GATEWAY_URL ?? "http://172.17.0.1:8642"
const PROFILES = process.env.HERMES_PROFILES_DIR ?? join(homedir(), ".hermes", "profiles")
const TEMPLATE = process.env.HERMES_TEMPLATE_PROFILE ?? "template-pc"
const REGISTRY = process.env.HERMES_REGISTRY_PATH ?? join(homedir(), ".hermes", "profiles-index", "profiles.json")
const KEEP = process.argv.includes("--keep")

if (process.env.HERMES_SCALE_APPROVED !== "1") {
  console.error("scale smoke creates throwaway profiles; set HERMES_SCALE_APPROVED=1 to run")
  process.exit(2)
}
if (!existsSync(join(PROFILES, TEMPLATE))) { console.error(`template missing: ${join(PROFILES, TEMPLATE)}`); process.exit(1) }

const created = []
function make(i) {
  const slug = `scale-${String(i).padStart(3, "0")}`
  const home = join(PROFILES, slug)
  if (existsSync(home)) return slug
  cpSync(join(PROFILES, TEMPLATE), home, { recursive: true, dereference: false })
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
await new Promise((r) => setTimeout(r, 35000))

async function probe(slug, key) {
  const t0 = performance.now()
  const res = await fetch(`${GATEWAY.replace(/\/+$/, "")}/p/${slug}/v1/models`, { headers: { authorization: `Bearer ${key}` } })
  return { ok: res.ok, status: res.status, ms: performance.now() - t0 }
}

const samples = created.slice(0, CONCURRENCY)
const t0 = performance.now()
const results = await Promise.all(samples.map((p) => probe(p.slug, p.key)))
const wall = performance.now() - t0
const latencies = results.map((r) => r.ms).sort((a, b) => a - b)
const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)]
console.log(`concurrency=${results.length} ok=${results.filter((r) => r.ok).length} wall=${wall.toFixed(0)}ms p95=${p95.toFixed(0)}ms`)

if (!KEEP) {
  for (const { slug } of created) rmSync(join(PROFILES, slug), { recursive: true, force: true })
  try {
    const reg = JSON.parse(readFileSync(REGISTRY, "utf8"))
    for (const k of Object.keys(reg.profiles)) if (reg.profiles[k].slug?.startsWith("scale-")) delete reg.profiles[k]
    writeFileSync(REGISTRY, JSON.stringify(reg, null, 2))
  } catch { /* registry optional here */ }
  console.log(`cleaned up ${created.length} profiles`)
}
const ok = results.every((r) => r.ok)
console.log(ok ? "scale smoke passed" : "scale smoke FAILED")
process.exit(ok ? 0 : 1)
