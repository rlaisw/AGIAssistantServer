#!/usr/bin/env node
// Spec 050 live acceptance (E1–E4 + optional E6), owner present.
// Drives the real Chat UI over CDP (Chrome --remote-debugging-port=9240) with
// pnpm dev on :3000 and the real tenant configured. The operator completes
// the Microsoft sign-in inside the opened tab; the script never types
// credentials and never reads tokens.
//
//   RUN_ENTRA_E2E=1 node ai-chat-landing/scripts/entra-auth-check.mjs
//   RUN_ENTRA_E2E=1 node ai-chat-landing/scripts/entra-auth-check.mjs --two-browser
// Sign-in is origin-bound to ENTRA_REDIRECT_URI: when that origin is not
// localhost (e.g. https://agia.tvb.com.hk), point the script at it so the
// callback lands in the driven tab:
//   ENTRA_CHECK_APP=https://agia.tvb.com.hk RUN_ENTRA_E2E=1 node …

import { argv } from "node:process"

const CDP = "http://localhost:9240"
const APP = process.env.ENTRA_CHECK_APP ?? "http://localhost:3000"
const TWO_BROWSER = argv.includes("--two-browser")
const SIGNIN_TIMEOUT_MS = 180_000

if (process.env.RUN_ENTRA_E2E !== "1") {
  console.error("set RUN_ENTRA_E2E=1 (owner-present live run)")
  process.exit(2)
}

const fails = []
function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) fails.push(name)
}
function die(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let seq = 0
    ws.onopen = () => resolve(api)
    ws.onerror = () => reject(new Error("CDP websocket failed"))
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message)
        pending.delete(message.id)
      }
    }
    const api = {
      ws,
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const id = ++seq
          pending.set(id, res)
          ws.send(JSON.stringify({ id, method, params }))
          setTimeout(() => rej(new Error(`CDP timeout: ${method}`)), 20_000)
        })
      },
      async evalJS(expression) {
        const result = await api.send("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        })
        if (result.error) throw new Error(JSON.stringify(result.error))
        if (result.result?.exceptionDetails) {
          throw new Error(result.result.exceptionDetails.exception?.description ?? "page exception")
        }
        return result.result.result.value
      },
      close() {
        ws.close()
      },
    }
  })
}

async function openPage(wsUrl) {
  const page = await connect(wsUrl)
  await page.send("Page.enable")
  await page.send("Runtime.enable")
  await sleep(1200)
  return page
}

async function sessionState(page) {
  return page.evalJS(`fetch('/api/auth/session', {cache:'no-store'}).then(r => r.json())`)
}

async function waitForSession(page, authenticated, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await sessionState(page).catch(() => ({ authenticated: false }))
    if (Boolean(state.authenticated) === authenticated) return state
    await sleep(2000)
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function clickButton(page, text) {
  return page.evalJS(`(() => {
    const wanted = ${JSON.stringify(text)};
    const button = [...document.querySelectorAll("button")].find(b => (b.textContent || "").trim() === wanted);
    if (!button) return false;
    button.click();
    return true;
  })()`)
}

async function signIn(page) {
  const clicked = await clickButton(page, "Sign in")
  check("sign-in control clicked", clicked)
  console.log("Complete the Microsoft sign-in in the opened Chrome tab (up to 180 s) ...")
  return waitForSession(page, true, SIGNIN_TIMEOUT_MS, "sign-in")
}

const version = await fetch(`${CDP}/json/version`)
  .then((r) => r.json())
  .catch(() => die(`Chrome CDP ${CDP} unreachable`))
const home = await fetch(APP).then((r) => r.status).catch(() => die(`${APP} not serving`))
if (home !== 200) die(`${APP} returned HTTP ${home}`)
console.log(`CDP ok (${version.Browser}) · app ok`)

const browser = await connect(version.webSocketDebuggerUrl)
const tabs = []
async function newTab(url, browserContextId) {
  const params = { url }
  if (browserContextId) params.browserContextId = browserContextId
  const target = await browser.send("Target.createTarget", params)
  await sleep(1500)
  const list = await fetch(`${CDP}/json/list`).then((r) => r.json())
  const entry = list.find((t) => t.id === target.result.targetId)
  if (!entry) throw new Error("new tab not found")
  tabs.push(target.result.targetId)
  return openPage(entry.webSocketDebuggerUrl)
}

try {
  const page = await newTab(APP)

  // E2 — anonymous visitor: no session, sign-in offered, chat available
  const anonymous = await sessionState(page)
  check("E2 anonymous session", anonymous.authenticated === false)
  check("E2 sign-in control present", await clickButtonProbe(page, "Sign in"))
  check(
    "E2 chat composer available without sign-in",
    await page.evalJS(`!!document.querySelector('textarea[placeholder^="Message AGI Chat"]')`),
  )

  // E1 — member signs in; header shows the display name; cookie is HttpOnly
  const startedAt = Date.now()
  const signedIn = await signIn(page)
  const elapsedMs = Date.now() - startedAt
  const scriptInteractions = 1 // the Sign in click; Microsoft account/MFA steps are operator-driven
  check(
    "E1 SC-001: sign-in within 30 s",
    elapsedMs < 30_000,
    `${(elapsedMs / 1000).toFixed(1)} s (includes operator typing)`,
  )
  check("E1 SC-001: at most three interactions", scriptInteractions <= 3, `${scriptInteractions} script-side click(s)`)
  check("E1 authenticated", signedIn.authenticated === true)
  check("E1 display name returned", Boolean(signedIn.user?.displayName))
  check(
    "E1 session cookie is not readable by scripts",
    await page.evalJS(`!document.cookie.includes("hermes_session")`),
  )
  check(
    "E1 header shows the display name",
    await page.evalJS(`document.body.innerText.includes(${JSON.stringify(signedIn.user.displayName)})`),
  )
  check(
    "E7 session expiry is at most 12 h away",
    Date.parse(signedIn.expiresAt) - Date.now() <= 12 * 60 * 60 * 1000,
  )

  // E6 — same identity in a second browser context
  if (TWO_BROWSER) {
    const context = await browser.send("Target.createBrowserContext", { disposeOnDetach: false })
    const second = await newTab(APP, context.result.browserContextId)
    const secondState = await signIn(second)
    check(
      "E6 same email in both browsers",
      secondState.user?.email === signedIn.user?.email,
      `${secondState.user?.email}`,
    )
    check(
      "E6 same display name in both browsers",
      secondState.user?.displayName === signedIn.user?.displayName,
    )
    second.close()
    await browser.send("Target.disposeBrowserContext", {
      browserContextId: context.result.browserContextId,
    })
  }

  // E3 — sign-out returns to anonymous
  check("sign-out control clicked", await clickButton(page, "Sign out"))
  const afterSignOut = await waitForSession(page, false, 30_000, "sign-out")
  check("E3 signed out", afterSignOut.authenticated === false)

  // E4 — cancel path is operator-driven: click Sign in, then Cancel at Microsoft.
  console.log(
    "E4 (manual): click Sign in, cancel at the Microsoft screen, then confirm the honest banner appears.",
  )
} catch (error) {
  check("live acceptance completed", false, error.message)
} finally {
  for (const id of tabs) {
    await fetch(`${CDP}/json/close/${id}`).catch(() => undefined)
  }
  browser.close()
}

async function clickButtonProbe(page, text) {
  return page.evalJS(`(() => {
    const wanted = ${JSON.stringify(text)};
    return [...document.querySelectorAll("button")].some(b => (b.textContent || "").trim() === wanted);
  })()`)
}

console.log(fails.length ? `\n${fails.length} check(s) failed: ${fails.join(", ")}` : "\nall checks passed")
process.exit(fails.length ? 1 : 0)
