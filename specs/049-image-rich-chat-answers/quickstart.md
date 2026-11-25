# Quickstart — Image-Rich Chat Answers

**Feature**: 049-image-rich-chat-answers | **Date**: 2026-11-24

Runnable checks that prove the feature works. Run from the repository root unless stated.

## Prerequisites

```bash
.venv/bin/python -c "import httpx, bs4, lxml; print('deps ok')"
```

No new dependency. The chat UI path needs `pnpm` installed in `ai-chat-landing/`.

## S1 — Tool payload carries images (unit)

```bash
.venv/bin/python -m pytest tests/unit/test_research_images.py -q
```

**Expected**: 12 passed. Covers alt capture, absolute URLs, dedupe, document order, noise skip, 40 cap, empty list, and non-ok pages.

## S2 — Extraction unchanged for existing behavior (unit)

```bash
.venv/bin/python -m pytest tests/unit/test_research_extraction.py -q
```

**Expected**: all passed — the `alt` key is additive; existing assertions on `type`/`src` still hold.

## S3 — Contract additive (contract)

```bash
.venv/bin/python -m pytest tests/contract/test_web_research_contract.py -q
```

**Expected**: all passed; new assertions confirm `images` exists on every hit and is `[]` for fallback pages.

## S4 — Live tool call shows images (manual, needs network)

```bash
.venv/bin/python - <<'PY'
import asyncio, json
from agentic_rag_mcp.server import build_server
async def main():
    s = build_server()
    r = await s.call_tool("web_research", {"query": "how to pair a bluetooth mouse", "limit": 3})
    hits = [b["result"] for b in r if isinstance(b, dict) and "result" in b][0]
    for h in hits["hits"]:
        print(h["url"], len(h["images"]), [i["alt"] for i in h["images"]][:2])
asyncio.run(main())
PY
```

**Expected**: at least one hit with `len(images) > 0` and non-empty alt text for the guide page. A hit with `0` is acceptable only for a page that genuinely has no images.

## S5 — Chat answer is image-rich (CDP acceptance)

```bash
cd ai-chat-landing && node scripts/image-rich-check.mjs
```

**Expected**: asks a visual how-to question, waits for the answer, asserts:
- `img` count in the answer bubble ≥ 3 when the sources had 3+ images,
- every inlined `img` has a non-empty `alt`,
- no `img` with an empty/`src=""` attribute.

Prints the observed count and alt texts. Exit code 0 on pass.

## S6 — Non-visual answer stays text-only (CDP acceptance)

```bash
cd ai-chat-landing && node scripts/image-rich-check.mjs --non-visual
```

**Expected**: asks a text-only question ("what is the capital of France" or a code question); asserts `img` count == 0 in the answer.

## S7 — PDF export survives (manual, owner-present)

Export an image-bearing answer to PDF via the header ⬇ button. **Expected**: images appear in the PDF, no broken-image placeholders, no layout failure.

## S8 — Error paths behave honestly

| Scenario | How to trigger | Expected |
|---|---|---|
| No images on page | Ask about a text-only topic | Zero images; answer says so if the topic is visual |
| Blocked scrape | Tool unit test with a private-address URL | `status=blocked`, `images: []` |
| Dead image URL | Ask about a page whose image 404s | Alt text renders; no broken layout |
| More than 10 images | Ask about a gallery page | At most 10 inlined; relevance-gated |
| Duplicate image | Guide page repeating a screenshot | Image appears once |

## Deployment verification

```bash
.venv/bin/python -m agentic_rag_mcp.deploy redeploy
.venv/bin/python -m agentic_rag_mcp.deploy verify
```

**Expected**: sidecar rebuilds, chatflow publishes with the new prompt in both lanes, verification battery green. Then re-run S5 and S6 against the live chat.
