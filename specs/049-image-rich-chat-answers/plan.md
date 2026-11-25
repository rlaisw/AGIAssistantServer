# Implementation Plan: Image-Rich Chat Answers

**Branch**: `049-image-rich-chat-answers` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/049-image-rich-chat-answers/spec.md`

## Summary

Visual questions answered from web research currently come back with one image or none. The capability exists end-to-end — `web_research` already scrapes ordered sections containing `img` blocks, `fetch_url` already returns an absolutized `images` list, and the chat UI renders markdown images and proxies them for PDF export — but the model under-uses it and the tool payloads do not expose a ready-to-inline image list with alt text.

The change is three small pieces:

1. **Server (additive)**: carry `alt` text on section image blocks and expose a flat per-hit `images` array (`url`, `alt`, `heading`) in `web_research`, deduped in document order. Existing fields stay unchanged (Constitution I).
2. **Prompt (binding)**: replace the "always try" wording in both `agentic_strategy` prompt copies with a binding rule plus a pre-answer self-check (count inlined images; visual topic with 0 → fetch more).
3. **No UI/PDF change**: markdown `![alt](url)` already renders and already survives the same-origin image proxy; native alt text covers the dead-URL case.

Error handling is explicit at every boundary: no images → text-only answer (never fabricated), blocked/failed scrape → honest fallback, dead image URL → alt text renders, >10 images → cap + relevance stop, non-visual topic → zero images.

## Technical Context

**Language/Version**: Python 3.11 (sidecar, `.venv`), TypeScript/Next.js 16 (chat UI), Dify chatflow DSL (YAML)

**Primary Dependencies**: `httpx`, `beautifulsoup4` + `lxml` (already installed), `mcp` server framework; no new dependency

**Storage**: None — stateless per request; no schema change

**Testing**: `pytest` (unit + contract), `vitest` (UI pure logic), CDP acceptance scripts in `ai-chat-landing/scripts/`

**Target Platform**: Linux sidecar (WSL host), Dify chatflow, Next.js chat UI

**Project Structure**: Existing monorepo — `src/agentic_rag_mcp/search/web/research.py`, `src/agentic_rag_mcp/server.py`, `dify/AGIAssistant/AGI_Assistant.yml`, `ai-chat-landing/`

**Performance**: No new network calls; the flat `images` array is derived from the already-parsed sections. Per-page image list bounded at 40 entries. Answer-level cap 10 images (FR-011).

**Constraints**: Backward-compatible tool contract (additive fields only); no fabrication; no new dependencies; prompt edits must be applied to BOTH strategy prompt copies (lines 347 and 1076) or the two lanes diverge

**Scale/Scope**: 2 Python files, 1 YAML (2 prompt blocks), 1 new unit test file, 1 contract test, 1 CDP script. No frontend code change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Contract Preservation (NON-NEGOTIABLE) | `ask` response field set and MCP tool schemas stay backward-compatible; new fields additive | ✅ PASS — `images` and `alt` are additive; no field removed or retyped; existing contract tests must pass unchanged |
| II. Tests-First | Runnable check per non-trivial behavior, full suite green | ✅ PASS — unit tests for alt/dedupe/cap/noise, contract test for the additive payload, CDP acceptance for the rendered answer; see [test-plan.md](./test-plan.md) |
| III. Minimal Dependencies | Reuse ladder; new services degrade gracefully | ✅ PASS — stdlib + already-installed bs4/lxml; zero new dependencies |
| IV. Honest Answers (NON-NEGOTIABLE) | No fabrication; no-evidence → honest empty; provenance preserved | ✅ PASS — no-images path returns an empty list and the prompt forbids inventing URLs; ANTI-FABRICATION LAW and `honesty_check` node untouched |
| V. Spec-Driven Replacement | Retire old design, no dead code | ✅ PASS — the old "always try" wording is replaced in place, not duplicated; no code path is retired |

**Post-Phase-1 re-check**: unchanged — the design adds one derived field and one prompt block; no violation introduced.

## Project Structure

### Documentation (this feature)

```text
specs/049-image-rich-chat-answers/
├── plan.md            # This file
├── spec.md            # Feature specification
├── research.md        # Phase 0 — decisions and alternatives
├── data-model.md      # Phase 1 — entities and validation
├── quickstart.md      # Phase 1 — runnable validation scenarios
├── test-plan.md       # Unit + E2E cases + error matrix
├── contracts/
│   └── web-research-images.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/agentic_rag_mcp/
├── search/web/research.py      # extract_sections: alt capture; images flattening helper
└── server.py                   # web_research handler: per-hit images array

dify/AGIAssistant/AGI_Assistant.yml   # ANSWER FORMAT — IMAGES block, both copies (347, 1076)

tests/
├── unit/test_research_images.py        # new
├── contract/test_web_research_contract.py  # additive assertions
└── fixtures/research/                  # extend ordered.html with alt attrs

ai-chat-landing/scripts/
└── image-rich-check.mjs                # new CDP acceptance
```

## Phase 0: Research — resolved decisions

All decisions are recorded in [research.md](./research.md); none remain open. Summary:

| # | Decision | Why |
|---|---|---|
| D1 | Derive a flat `images` array from `sections` instead of a second parse | Sections are already parsed; no extra cost, order preserved |
| D2 | Capture `alt` from `<img alt>` during extraction | Real alt text beats model-invented text; FR-012 |
| D3 | Dedupe by absolute URL, keep first occurrence | Same screenshot repeats across sections; first position is the document order |
| D4 | Skip noise by URL substring (`pixel`, `tracker`, `beacon`, `spacer`, `1x1`, `blank.gif`) — reuse `_IMG_SKIP` | Already proven in `_fetch_url`; one list, one behavior |
| D5 | Per-page image list capped at 40; answer-level cap stays 10 | Page cap protects the LLM payload; answer cap is a product decision (FR-011) |
| D6 | Prompt gets a binding rule + count self-check, replacing "always try" | "Always try" is satisfiable with one image; a count check is not |
| D7 | No UI/PDF change | Markdown image + native alt text already render; proxy already handles CORS |

## Phase 1: Design & Contracts

### Data model

See [data-model.md](./data-model.md). Entities: `SectionBlock` (gains `alt`), `PageImage` (`url`, `alt`, `heading`), `WebResearchHit` (gains `images`). No persistence, no state machine.

### Contracts

See [contracts/web-research-images.md](./contracts/web-research-images.md). The `web_research` response gains one additive field per hit; all existing fields keep their exact type and meaning.

### Quickstart

See [quickstart.md](./quickstart.md) — six runnable scenarios covering the visual, no-image, blocked, dead-URL, cap, and non-visual paths.

## Error Handling Design

| Boundary | Failure | Behavior | Signal |
|---|---|---|---|
| `research_page` | Fetch blocked by SSRF guard | `status=blocked`, `status_reason` kept; no images | existing |
| `research_page` | Timeout / HTTP ≥400 / no extractable content | `status=fallback`/`failed`; snippet used; no images | existing |
| `extract_sections` | `<img>` without `src`/`data-src`, or `data:` URI | Block skipped; other blocks unaffected | existing |
| `extract_sections` | `<img>` without `alt` | `alt` defaults to `""`; model writes descriptive alt from context | new |
| `images` flattening | Zero images on a page | `images: []` (never omitted, never fabricated) | new |
| `images` flattening | Duplicate URLs | First occurrence kept; later dropped | new |
| `images` flattening | More than 40 images | Truncated at 40 in document order; `truncated` flag on the page already reports text truncation | new |
| Chat answer | Dead/blocked image URL | Markdown `![alt](url)` renders the alt text; no broken layout | existing |
| Chat answer | Visual topic, no images available | Text-only answer that says so plainly; never a fabricated URL | prompt |
| Chat answer | More than 10 relevant images | Cap at 10; stop earlier when images stop illustrating | prompt |
| Chat answer | Non-visual topic | Zero images | prompt |
| PDF export | Remote image without CORS | Existing same-origin proxy (`app/api/image-proxy/route.ts`) | existing |

No new exception type, no new error code, no retry logic. Every failure already has an honest envelope; the change only adds the empty-list case.

## Complexity Tracking

No violations — no new service, dependency, abstraction, or config. The change is one additive field, one extraction attribute, and one prompt block.

## Test Plan

Full case list in [test-plan.md](./test-plan.md): 12 unit cases, 4 contract cases, 5 E2E/CDP cases, 9 error-path cases. Required gates before completion:

```bash
.venv/bin/python -m pytest tests/unit/test_research_images.py tests/unit/test_research_extraction.py tests/contract/test_web_research_contract.py -q
.venv/bin/python -m pytest tests/unit tests/contract -q
cd ai-chat-landing && pnpm test && pnpm typecheck && pnpm lint
```

## Deployment

After tests pass: `.venv/bin/python -m agentic_rag_mcp.deploy redeploy` (rebuilds sidecar + publishes the chatflow with the new prompt), then `.venv/bin/python -m agentic_rag_mcp.deploy verify`. The YAML edit must be applied to both strategy prompt copies before publishing, or the two lanes diverge.
