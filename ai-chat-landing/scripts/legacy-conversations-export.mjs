#!/usr/bin/env node
// FR-026: export pre-cutover Dify conversations (the retired shared user) for the operator.
// Users never see these rows after the per-identity cutover.
//   DIFY_API_KEY=... DIFY_API_BASE_URL=http://localhost/v1 \
//     node scripts/legacy-conversations-export.mjs --out ~/legacy-conversations.json
import { writeFileSync } from "node:fs"

import { exportLegacyConversations } from "../lib/profiles/legacy.mjs"

const BASE = (process.env.DIFY_API_BASE_URL ?? "http://localhost/v1").replace(/\/+$/, "")
const KEY = process.env.DIFY_API_KEY
const args = process.argv.slice(2)
const out = args[args.indexOf("--out") + 1]
if (!KEY || !args.includes("--out") || !out) {
  console.error("DIFY_API_KEY and --out <path> are required")
  process.exit(2)
}
const result = await exportLegacyConversations({ apiBase: BASE, apiKey: KEY })
writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), count: result.conversations.length, ...result }, null, 2))
console.log(`exported ${result.conversations.length} legacy conversation(s) → ${out}`)
