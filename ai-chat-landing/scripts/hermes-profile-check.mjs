#!/usr/bin/env node
// Spec 051 owner-present acceptance (T018/T023/T033/T034).
// Drives the real Chat UI over CDP with the operator's signed-in session.
//   RUN_HERMES_PROFILE_E2E=1 node ai-chat-landing/scripts/hermes-profile-check.mjs
//   ... --two-user      # second browser context, second account (T023)
//   ... --restart       # only prints the manual gateway-restart checklist (T034)
//   ... --mcp-offline   # only prints the manual Windows-offline checklist (T033)
import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const CDP = process.env.HERMES_E2E_CDP ?? "http://localhost:9240"
const APP = process.env.HERMES_E2E_APP ?? "http://localhost:3000"
const AUDIT_PATHS = (process.env.HERMES_AUDIT_PATH ?? [
  join(homedir(), ".hermes", "profiles-index", "audit.jsonl"),
  join(homedir(), ".config", "agentic-rag-mcp", "hermes-mcp", "audit.jsonl"),
].join(",")).split(",").map((x) => x.trim()).filter(Boolean)
const PROFILES = process.env.HERMES_PROFILES_DIR ?? join(homedir(), ".hermes", "profiles")
const GATEWAY = process.env.HERMES_GATEWAY_URL ?? "http://172.17.0.1:8642"
const PROMPT = process.env.HERMES_E2E_PROMPT ?? "Show my current IP address"
const args = process.argv.slice(2)

if (process.env.RUN_HERMES_PROFILE_E2E !== "1") {
  console.error("set RUN_HERMES_PROFILE_E2E=1 (owner-present live run)")
  process.exit(2)
}
if (args.includes("--restart")) {
  console.log("T034 checklist: hermes gateway restart -> wait for 'gateway list' to show every profile -> re-run this script without --restart")
  process.exit(0)
}
if (args.includes("--mcp-offline")) {
  console.log("T033 checklist: take the Windows PC offline, ask a Hermes lane question, expect an honest tool_unavailable attributed to your profile, then restore")
  process.exit(0)
}

const fails = []
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) fails.push(name)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function auditLines() {
  const out = []
  for (const file of AUDIT_PATHS) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, "utf8").trim().split("\n").filter(Boolean)) {
      try { out.push(JSON.parse(line)) } catch { /* skip */ }
    }
  }
  return out
}

async function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let seq = 0
    ws.onopen = () => resolve(api)
    ws.onerror = () => reject(new Error("CDP websocket failed"))
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    }
    const api = {
      ws,
      send: (method, params = {}) => new Promise((res) => {
        const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }))
      }),
      async evalJS(expression) {
        const r = await api.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
        if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
        return r.result?.result?.value
      },
      close: () => ws.close(),
    }
  })
}

async function openTab(browser, url, contextId) {
  const params = { url }
  if (contextId) params.browserContextId = contextId
  const t = await browser.send("Target.createTarget", params)
  await sleep(1500)
  const list = await fetch(`${CDP}/json/list`).then((r) => r.json())
  const entry = list.find((x) => x.id === t.result.targetId)
  const page = await connect(entry.webSocketDebuggerUrl)
  await page.send("Runtime.enable")
  await page.send("Page.enable")
  return { page, targetId: t.result.targetId }
}

async function waitForSession(page, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs
  let told = false
  while (Date.now() < deadline) {
    const state = await page.evalJS(`fetch('/api/auth/session',{cache:'no-store'}).then(r=>r.json())`).catch(() => null)
    if (state?.authenticated) return state
    if (!told) { console.log("Sign in in the opened Chrome tab; waiting up to 5 minutes…"); told = true }
    await sleep(3000)
  }
  return null
}

async function ask(page, prompt) {
  return page.evalJS(`(async () => {
    const res = await fetch('/api/chat', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ query: ${JSON.stringify(prompt)} }) })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text: text.slice(0, 4000) }
  })()`)
}

async function gatewayModels(slug) {
  const envPath = join(PROFILES, slug, ".env")
  if (!existsSync(envPath)) return { ok: false, detail: "profile env missing" }
  const key = readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith("API_SERVER_KEY="))?.slice("API_SERVER_KEY=".length).trim()
  if (!key) return { ok: false, detail: "profile key missing" }
  const res = await fetch(`${GATEWAY.replace(/\/+$/, "")}/p/${slug}/v1/models`, { headers: { authorization: `Bearer ${key}` } })
  return { ok: res.ok, detail: `HTTP ${res.status}` }
}

const version = await fetch(`${CDP}/json/version`).then((r) => r.json()).catch(() => null)
if (!version) { console.error(`Chrome CDP ${CDP} unreachable`); process.exit(1) }
if (process.env.HERMES_E2E_SKIP_PREFLIGHT !== "1") {
  // Node cannot reach the mirrored host IP from this WSL host; Chrome can (host mapping).
  const home = await fetch(APP).then((r) => r.status).catch(() => 0)
  if (home !== 200) { console.error(`${APP} not serving`); process.exit(1) }
}

const browser = await connect(version.webSocketDebuggerUrl)
const tabs = []
let contextId

try {
  const before = auditLines()
  const { page, targetId } = await openTab(browser, APP, contextId)
  tabs.push(targetId)
  const session = await waitForSession(page)
  check("E1 signed-in session", Boolean(session), session?.user?.email ?? "not signed in")
  if (session) {
    const sent = await ask(page, PROMPT)
    check("E1 chat accepted", sent.ok, `HTTP ${sent.status}`)
    await sleep(15000)
    const after = auditLines()
    const added = after.slice(before.length)
    const ensures = added.filter((e) => e.event === "ensure" && e.outcome === "created")
    const routes = added.filter((e) => e.event === "routing")
    check("E1 profile ensured", ensures.length === 1 || before.some((e) => e.event === "ensure" && e.outcome === "created"), `${ensures.length} new ensure`)
    check("E1 routed via profile", routes.length >= 1, `${routes.length} routing records`)
    const slug = [...routes].reverse()[0]?.slug ?? ensures[0]?.slug
    if (slug) {
      const models = await gatewayModels(slug)
      check("E1 gateway serves profile", models.ok, `${slug} ${models.detail}`)
    }
    if (args.includes("--two-user")) {
      const ctx = await browser.send("Target.createBrowserContext", { disposeOnDetach: false })
      contextId = ctx.result.browserContextId
      const second = await openTab(browser, APP, contextId)
      tabs.push(second.targetId)
      const s2 = await waitForSession(second.page)
      check("E6 second account signed in", Boolean(s2), s2?.user?.email ?? "not signed in")
      if (s2) {
        await ask(second.page, PROMPT)
        await sleep(15000)
        const added2 = auditLines().slice(before.length)
        const slugs = new Set(added2.filter((e) => e.event === "routing").map((e) => e.slug))
        check("E6 two distinct profiles", slugs.size >= 2, [...slugs].join(", "))
      }
      second.page.close()
      await browser.send("Target.disposeBrowserContext", { browserContextId: contextId })
    }
    console.log("\nNext: --restart checklist (T034), --mcp-offline (T033), operator E5/E6 (T029)")
  }
} catch (error) {
  check("live acceptance completed", false, error.message)
} finally {
  for (const id of tabs) await fetch(`${CDP}/json/close/${id}`).catch(() => {})
  browser.close()
}
console.log(fails.length ? `\n${fails.length} check(s) failed: ${fails.join(", ")}` : "\nall checks passed")
process.exit(fails.length ? 1 : 0)
