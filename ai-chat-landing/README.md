# AGI Chat — AgenticRAG Chat UI

A Chatbot-UI-style chat frontend for the **AgenticRAG** Dify chatflow, built with Next.js 16, Tailwind CSS v4, and shadcn/ui on Base UI primitives (luma preset).

Questions typed here go to the Dify chatflow's Service API, and the AgenticRAG agent's answer streams back — markdown (headings, tables, images), a reasoning panel, and source badges rendered inline. The header's ⬇ button exports the whole conversation as a PDF (client-side render; `lib/pdf-export/`, spec 013 — remote images go through the same-origin `app/api/image-proxy` so they survive the CORS-mode rasterizer). The sidebar shows backend chat history grouped by recency — Today / Yesterday / Previous 7 days / Last month / Few months ago — with resume-on-click, Load more pagination, and first-message draft promotion (`lib/history/`, `app/api/conversations/`, spec 014; each row offers a "…" menu → Delete with inline confirmation — backend-real, survives reload (spec 015). At viewports ≥1280px the chat column and composer widen to `min(90%, 1400px)` of the content area — centered and capped for readability, with long user-message bubbles capped at 672px; below 1280px the layout is unchanged (spec 016). The sidebar's Search chats box filters the list live, case-insensitively — titles of every conversation plus the message text of opened ones — with × / Escape to clear and an explicit no-match state (`lib/history/search.ts`, spec 018). On phones the sidebar becomes an overlay drawer — open it from the panel toggle; a backdrop tap, Escape, or picking a conversation closes it (spec 019). Every fresh load opens on a fresh "New chat" draft — the "How can I help you today?" empty state with feature cards; the old demo fixtures are gone (spec 020). The empty state shows six feature cards (PowerPoint, Infographic, Chart Diagram, CorpIT Helpdesk, AI Chatbot, Agentic RAG DB) in a three-column desktop grid — clicking a card body sends its example prompt; each card's label links to its help page in a new tab (served from `public/example1.html` … `example6.html`, each with a green 16 px prompt-provenance strip — spec 021, pages landed 2026-10-30). While an answer generates, the send button morphs into a Stop control — clicking it halts the backend generation (`app/api/chat/stop`, additive `task` stream event), keeps the partial text and reasoning, shows a session-only "Stopped" caption, and returns the composer to ready in well under a second; switching conversations mid-generation never disturbs the turn (spec 027). Infographic notification links render with a 📌 and the same blue (`components/markdown.tsx`, spec 046). Finished answers render their trailing follow-up question (the "Want me to…?" paragraph) as blue text with a 💡 — a display-only renderer change (`lib/follow-up.ts`), including when the question sits immediately before an infographic link; both Agentic-Strategy prompts also require a final follow-up offer after the link and sources, so PDF export keeps the raw text.

## Quickstart

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Press `d` (or the sun/moon icon) to toggle Dark / Light / System.

## Dify configuration

Create an app API key — Dify UI → AgenticRAG app → **API Access** → Create Secret Key (format `app-…`) — and put it in `.env.local`:

```bash
DIFY_API_BASE_URL=http://localhost/v1
DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
```

`next dev` watches `.env.local` and reloads it automatically; `next start` reads it at boot. Without a key (or with Dify down) the UI silently falls back to canned demo replies.

## How it works

```
Browser ── POST /api/chat ──► Next.js route (app/api/chat/route.ts)
                               │  Bearer DIFY_API_KEY — key stays server-side
                               ▼
                     Dify POST /v1/chat-messages (response_mode: streaming)
                               │  SSE: message · reasoning_chunk · message_end · ping
                               ▼
                     proxy re-emits line-delimited JSON:
                     chunk · reasoning · replace · sources · ping · done
                               ▼
Browser appends chunks to the streaming bubble (throttled to 100 ms),
stores Dify's conversation_id per chat for multi-turn context.
```

- Every chat call derives the browser's origin server-side from the trusted `X-Forwarded-For` chain and forwards it as the `client_origin` input (spec 053) — never from the request body; the empty/unregistered origin keeps today's local-desktop behavior

- `message_end` retriever resources → source badges; `reasoning_chunk` and ` Mohammad...` blocks → the reasoning panel
- Dify keep-alive pings are forwarded; a 120 s silent-connection watchdog aborts and shows a note instead of hanging forever
- Conversation history sidebar, static "AGI Chat" badge (the chatflow's model is fixed server-side), theme dropdown; per-chat Dify `conversation_id` keeps agent memory across turns
- Deck links in answers render as an action bar (⬇ Download / 👁 Preview-Edit) opening the sidecar's completion page (`/decks/<project>/<stem>/`) with per-slide previews — URL recognition and derivation live in `lib/deck-url.ts`
- Visual answers inline their source images (spec 049): `web_research` hits carry a flat `images` array (`url`/`alt`/`heading`), both strategy prompts require 3+ images grouped under the steps they illustrate (alt always, hard cap 10, never an invented URL), and image links written inside `think` blocks never render or count toward the cap
- MCP-Action confirmations reuse the Markdown/follow-up renderers: the exact automatic-action offer is styled as a follow-up, and a captured verification screenshot is shown inline through the temporary `/mcp-action/screenshots/{token}` URL. Only the two reviewed actions (`windows_default_printer`, `word_printer_duplex`) can reach this path; the image proxy preserves upstream `no-store` so screenshot responses are not cached like ordinary remote images.

## Per-user profiles (spec 051, in progress)

Optional: when `PROFILES_PROVISION_TOKEN` is set, the app can provision a Hermes profile per signed-in identity.

- `PROFILES_PROVISION_TOKEN` — internal bearer for `POST /api/profiles/ensure` and `GET /api/profiles/status`.
- `HERMES_PROFILES_DIR` (default `~/.hermes/profiles`), `HERMES_TEMPLATE_PROFILE` (default `template-pc`), `HERMES_WIN_USER`, `HERMES_REGISTRY_PATH`.
- Profiles are created lazily on the first agent-bound request; each profile owns its own `API_SERVER_KEY` (never stored in the registry).
- Boundary: Windows and MCP actions run under the single shared Windows PC account. Profiles isolate memory, files, chat, and audit — not the Windows desktop session or its OneDrive account.
- Chat history is scoped per identity (`u-<oidHash>`); anonymous visitors share the `u-anon` bucket by design. Pre-cutover conversations are hidden and exported with `node scripts/legacy-conversations-export.mjs --out <file>`.
- Gateway multiplexing (`gateway.multiplex_profiles`) and the pilot rollout are operator steps — see `specs/051-hermes-multiplex/quickstart.md`.

## Remote-client targeting (spec 053)

The `client_origin` input routes desktop actions to the machine the chat comes from — the Chat UI only derives and forwards it; everything else is server-side:

- The route computes it from the trusted forwarded chain (a browser-supplied `client_origin` in the request body is ignored — `route.test.ts` pins this).
- Ten Dify tools bind it as a start-variable selector (`{{#1776072202913.client_origin#}}`, never a template constant — the spec-047 JSON invariant): the six desktop lanes plus the four office-v2 fast paths.
- A registered remote client (operator TOML registry on the server) makes "open microsoft word" open Word **on that machine**; from the host it stays local, unchanged.
- Spec: `specs/053-remote-client-callback/`; topology: `docs/NETWORK.md` ⑫⑬; deployment: `DEPLOY.md` spec-053 section.

## Sign-in (Entra ID, spec 050)

Optional organizational SSO; **anonymous chat is unchanged** and needs no account. With `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, and `ENTRA_REDIRECT_URI` configured, the header offers Sign in / Sign out and shows the signed-in display name.

- Flow: OIDC authorization code + PKCE (S256), single-tenant, members only; state and nonce validated; ID token verified against the tenant JWKS.
- Browser: only two opaque `HttpOnly; SameSite=Lax` handles (`hermes_session`, and `hermes_auth` during sign-in); `Secure` + `__Host-` outside local development. No token or claim ever reaches the page.
- Server identity: `oid`, `tid`, `email` (fallback `preferred_username`), `displayName` stay server-side (`lib/auth/`). `requireIdentity()` is the guard Phase 2 calls.
- Limits: 8-hour sliding idle, 12-hour absolute session; renewal uses the refresh token, one failure tolerated.
- Sessions are in-process: restarting the dev server or redeploying signs everyone out.
- No auth bypass switch exists, by design.

Validation: `node scripts/entra-flow-check.mjs` (real tenant, 9 steps, no secret) and `RUN_ENTRA_E2E=1 node scripts/entra-auth-check.mjs` (owner present, Chrome `:9240`). Offline proof: `pnpm test` covers the fake-IdP flow, error matrix, and session math.

## Attachments

The composer's paperclip attaches **one file per message** — PDF, Word
(.doc/.docx), Excel (.xls/.xlsx), PowerPoint (.ppt/.pptx), TXT, CSV, JSON, XML —
up to **20 MB**. One click opens the native file-open dialog (the File
Explorer-style dialog on Windows); the selected file shows as a chip in the
composer (filename + extracted character count) and can be removed before
sending.

```
Browser ── POST /api/attach (multipart) ──► app/api/attach/route.ts
             validate 20 MB · 8-format allowlist · magic sniff (%PDF- / PK)
             extract in memory: pdf-parse · mammoth (.docx) · word-extractor (.doc)
                                · SheetJS (.xlsx/.xls/CSV) · jszip slide text (.pptx)
                                · fast-xml-parser (XML)
             text family decoded BOM-aware: UTF-16LE/BE and UTF-8 BOM
                                (Windows RelMon/schtasks XML, legacy Notepad "Unicode")
             ──► { text, chars, note? }   (nothing is written to disk)
Browser ── POST /api/chat + attachments ──► the Dify query becomes a
             [Attached file: <name> (<type>, N chars)] preamble, content capped
             at 24,000 characters with the truncation named, then "User question: …"
```

Honest edges (all inline in the composer, typed text preserved):
- scanned/image-only PDFs → attaches with the note "no readable text (OCR is not enabled)"; the assistant says it could not read text, never fabricates a summary
- legacy `.ppt` → refused with the save-as-.pptx remedy (no pure-JS text extractor)
- corrupt archives, malformed JSON/XML, renamed files (content ≠ extension) → the specific honest reason
- over 20 MB or an unsupported type → refused naming the cap / the supported list
- BOM-less UTF-16 text (rare — every Windows export tool writes a BOM) still fails honestly with the encoding-shaped reason

Attachment messages are routed **deterministically** to the General lane by an
if-else gate before the intent classifiers (the file content is already inside
the message), so "what does this file contain?" never lands on the local-file
lane. Acceptance: `node scripts/attachment-check.mjs` (CDP; needs Chrome
`:9240`, `pnpm dev`, the Dify stack).

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS v4 · shadcn/ui (Base UI, luma preset) · react-markdown (GFM tables + images) · lucide-react icons

shadcn components installed: button, badge, card, accordion, avatar, table, separator, input, textarea, dropdown-menu. The shadcn agent skill lives in `.agents/skills/shadcn/`.

## Testing

`pnpm test` runs vitest (pure logic — deck-URL recognition/derivation, history grouping and delete state, sidebar search, the PDF-export pipeline incl. the image-proxy rewrite and upstream `no-store` preservation, the stop state machine, the chat route's `message_end`→`done` stream finalization and upstream-reader cancellation (`app/api/chat/route.test.ts`), and the follow-up prompt splitter, the attachment format gate + BOM-aware decode + preamble builder (`lib/attach/`), and infographic notification-link detection + pin sanitization (`lib/infographic-link.ts`); 188 tests). Browser-facing behavior is covered by the deploy battery's `chat-ui-liveness` and `chat-journey` scenarios (`python -m agentic_rag_mcp.deploy verify` from the repo root). Layout acceptance is measured live by the CDP scripts: `node scripts/wide-layout.mjs` (layout + `--smoke` behavioral — spec 016), `node scripts/landing-check.mjs` (New-chat landing — spec 020), `node scripts/welcome-cards.mjs` (welcome feature cards — spec 021), `node scripts/infographic-link-check.mjs` (📌 + blue infographic notification links and trailing follow-ups — spec 046), and `node scripts/mcp-action-check.mjs` (default-printer/Word confirmation, temporary screenshot loading and restoration — spec 047); image-rich answer acceptance is `node scripts/image-rich-check.mjs` (how-to ≥3 images with alt, `--overview` placement, `--non-visual` zero images, `--cap` 1–10 — spec 049); all need Chrome on `--remote-debugging-port=9240`.

## Notes

- `pnpm build` while `pnpm dev` is running clobbers the shared `.next/` directory and can kill in-flight streams — validate with `pnpm typecheck && pnpm lint` instead, or build in a separate checkout
- `next dev` prints "Port 3000 is in use / Another next dev server is already running" when a stale server holds the port — `kill <pid>` from the message and restart
- Remote access (phone/LAN): `next.config.ts` lists `allowedDevOrigins` (the host LAN IP) — without it, Next dev blocks cross-origin requests and the page renders but nothing is interactive; add any new access origin there and restart dev
- Restart `pnpm dev` after any dependency change (`pnpm add`/upgrade) — the running server loads `node_modules` at start and dies or misbehaves when the tree is swapped underneath it
