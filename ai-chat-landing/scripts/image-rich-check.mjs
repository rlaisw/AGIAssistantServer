#!/usr/bin/env node
// Spec 049 image-rich-answer acceptance script (tasks T012/T014/T016).
// Live CDP checks against pnpm dev on :3000 (Chrome --remote-debugging-port=9240):
//   E1 default   how-to answer inlines >=3 images, each with non-empty alt, no empty src
//   E2 --overview  overview answer inlines >=2 images, not all clustered at the end
//   E3 --non-visual  "capital of France" stays text-only (0 images)
//   E4 --cap  a gallery request inlines >=1 image and never more than 10 (FR-011)
// Usage: node image-rich-check.mjs [--overview|--non-visual|--cap]
// Every throwaway conversation is deleted at the end (spec-015 flow).

import { argv } from "node:process"

const CDP = "http://localhost:9240"
const APP = "http://localhost:3000"
const MODE = argv.includes("--overview") ? "overview"
  : argv.includes("--non-visual") ? "non-visual"
  : argv.includes("--cap") ? "cap" : "default"
const STAMP = Date.now()

const CASES = {
  default: {
    prompt: "Show me the step-by-step instructions for pairing a standard Bluetooth mouse on Windows 11.",
    followUp: "It's a generic Bluetooth mouse on Windows 11 — please show me the steps with the images from the source pages.",
    minImages: 3,
  },
  overview: {
    prompt: "Show me examples of mechanical keyboards and what makes each one different.",
    followUp: "Just give me the overview with example images from the sources.",
    minImages: 2,
  },
  "non-visual": {
    prompt: "What is the capital of France?",
    followUp: null,
    minImages: 0,
  },
  cap: {
    prompt: "Show me a big gallery of mechanical keyboard examples — as many as you can find, with images from the sources.",
    followUp: "Just show me the gallery with images from the sources, no more questions.",
    minImages: 1,
    maxImages: 10,
  },
}
const CASE = CASES[MODE]

function die(msg) { console.error(`✗ ${msg}`); process.exit(1) }
const fails = []
function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) fails.push(name)
}

const version = await fetch(`${CDP}/json/version`).then(r => r.json())
  .catch(() => die(`Chrome CDP ${CDP} unreachable — start Chrome with --remote-debugging-port=9240`))
const home = await fetch(APP).then(r => r.status).catch(() => die(`${APP} not serving — start pnpm dev in ai-chat-landing/`))
if (home !== 200) die(`${APP} returned HTTP ${home}`)
console.log(`CDP ok (${version.Browser}) · app ok · mode=${MODE}`)

const tab = await fetch(`${CDP}/json/new`, { method: "PUT" }).then(r => r.json())
const ws = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws failed")) })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => rej(new Error(`CDP timeout: ${method}`)), 20000)
  })
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function evalJS(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
  if (r.error) throw new Error(`Runtime.evaluate: ${JSON.stringify(r.error)}`)
  if (r.exceptionDetails) throw new Error(`page exception: ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)}`)
  return r.result.result.value
}

const SEL_COLUMN = `[class*="space-y-6"][class*="p-4"]`
async function navigate() {
  await send("Page.navigate", { url: APP })
  for (let i = 0; i < 40; i++) {
    try { if (await evalJS("document.readyState") === "complete") break } catch {}
    await sleep(500)
  }
  await sleep(800)
}
async function newChat() {
  await evalJS(`document.querySelector('aside button.w-full')?.click(); true`)
  await sleep(600)
}
async function typeAndSend(text) {
  const ok = await evalJS(`(() => {
    const ta = document.querySelector('textarea')
    if (!ta) return false
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    set.call(ta, ${JSON.stringify(text)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return true
  })()`)
  if (!ok) die("composer textarea not found")
}
// Last assistant answer: text, streaming flag, and image facts. Image "text
// position" is how much answer text precedes the image in document order, so
// "clustered at the end" is measurable without depending on layout/loading.
async function lastAnswer() {
  return await evalJS(`(() => {
    const col = document.querySelector('${SEL_COLUMN}')
    if (!col) return { missing: true }
    const blocks = [...col.children].filter(el => el.classList.contains('gap-3'))
    if (!blocks.length) return { count: 0 }
    const last = blocks[blocks.length - 1]
    const answer = last.querySelector('[data-answer-text]')
    if (!answer) return { count: blocks.length, len: 0, streaming: !!last.querySelector('[role="status"]'), imgs: [] }
    const total = answer.innerText.length
    const imgs = []
    let pos = 0
    const walker = document.createTreeWalker(answer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    let n = walker.nextNode()
    while (n) {
      if (n.nodeType === 3) pos += n.textContent.length
      else if (n.nodeName === 'IMG') {
        imgs.push({ src: n.getAttribute('src') || '', alt: n.getAttribute('alt') || '', textPos: pos })
      }
      n = walker.nextNode()
    }
    return { count: blocks.length, len: total, streaming: !!last.querySelector('[role="status"]'), imgs }
  })()`)
}
// Wait until the answer stops streaming and its length is stable for 2.5s.
async function waitSettled(timeoutMs) {
  const t0 = Date.now()
  let lastLen = -1, stable = 0
  for (;;) {
    const m = await lastAnswer().catch(() => ({ missing: true }))
    if (!m.missing && m.count > 0 && !m.streaming) {
      if (m.len === lastLen && m.len > 0) { stable += 400; if (stable >= 2500) return m }
      else { stable = 0; lastLen = m.len }
    }
    if (Date.now() - t0 > timeoutMs) return m
    await sleep(400)
  }
}
await navigate()

// ---- E1/E2/E3: single fresh conversation ----
await newChat()
const marker = `049-${MODE}-${STAMP}`
await typeAndSend(`${marker} ${CASE.prompt}`)
let ans = await waitSettled(180000)
if (CASE.followUp && ans && !ans.missing && ans.count > 0 && ans.imgs.length === 0 && ans.len < 1200) {
  console.log("  (ask-back detected, sending context follow-up)")
  await typeAndSend(`${marker} ${CASE.followUp}`)
  ans = await waitSettled(180000)
}
if (!ans || ans.missing || ans.count === 0) die("no assistant answer appeared")
const imgs = ans.imgs || []
const count = imgs.length
const emptyAlt = imgs.filter(i => !i.alt.trim()).length
const emptySrc = imgs.filter(i => !i.src.trim()).length
console.log(`  observed: ${count} image(s); alt missing ${emptyAlt}; src empty ${emptySrc}; answer len ${ans.len}`)
for (const [i, img] of imgs.entries()) console.log(`    [${i + 1}] alt="${img.alt}" src="${img.src.slice(0, 90)}"`)

if (MODE === "cap") {
  check("E4 cap answer inlines at least 1 image", count >= CASE.minImages, `count=${count}`)
  check("E4 cap answer inlines no more than 10 images", count <= CASE.maxImages, `count=${count}`)
} else if (MODE === "non-visual") {
  check("E3 non-visual answer has 0 images", count === 0, `count=${count}`)
} else {
  check(`E${MODE === "overview" ? "2" : "1"} image count >= ${CASE.minImages}`, count >= CASE.minImages, `count=${count}`)
  check(`E${MODE === "overview" ? "2" : "1"} every image has non-empty alt`, emptyAlt === 0, `missing alt=${emptyAlt}`)
  check(`E${MODE === "overview" ? "2" : "1"} no empty image src`, emptySrc === 0, `empty src=${emptySrc}`)
  if (MODE === "overview" && count > 0) {
    const clustered = imgs.every(i => i.textPos > ans.len * 0.7)
    check("E2 images are not all clustered at the end", !clustered,
      `text positions ${imgs.map(i => i.textPos).join(",")} of ${ans.len}`)
  }
}

// ---- cleanup: delete the throwaway conversation (spec-015 flow) ----
const step = await evalJS(`(async () => {
  const rows = [...document.querySelectorAll('aside button[aria-label="Conversation options"]')]
  const row = rows.map(btn => btn.closest('div')).find(d => d?.textContent.includes('${marker}'))
  if (!row) return 'row-not-found'
  row.querySelector('button[aria-label="Conversation options"]').click()
  await new Promise(r => setTimeout(r, 300))
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.includes('Delete'))
  if (!item) return 'menu-item-not-found'
  item.click()
  await new Promise(r => setTimeout(r, 300))
  const confirmBtn = row.querySelector('button[aria-label="Confirm delete"]')
  if (!confirmBtn) return 'confirm-not-found'
  confirmBtn.click()
  return 'confirmed'
})()`)
let gone = false
for (let i = 0; i < 30; i++) {
  gone = await evalJS(`!document.querySelector('aside')?.textContent.includes('${marker}')`)
  if (gone) break
  await sleep(500)
}
if (!gone) fails.push(`cleanup (${step})`)
console.log("cleanup: throwaway conversation removed")

ws.close()
if (fails.length) die(`${fails.length} FAILED: ${fails.join(", ")}`)
console.log(`\nAll spec 049 ${MODE} acceptance checks passed.`)
process.exit(0)
