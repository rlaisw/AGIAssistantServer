# Data Model — Image-Rich Chat Answers

**Feature**: 049-image-rich-chat-answers | **Date**: 2026-11-24

All entities are in-memory request-scoped values. No persistence, no schema, no migration.

## SectionBlock (existing — gains one field)

Emitted by `extract_sections(html, page_url, per_page_budget)` in `src/agentic_rag_mcp/search/web/research.py`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `"p"` \| `"img"` | yes | unchanged |
| `src` | `str` | img only | absolute URL via `urljoin(page_url, src)`; unchanged |
| `alt` | `str` | img only | **new**; source `<img alt>` value, `""` when absent |

**Validation**
- `src` must be absolute and `http(s)`; `data:` URIs are skipped (existing).
- `alt` is never fabricated server-side; empty means "source gave none".
- Document order is preserved: a paragraph or image appears in the order the HTML presents it.

## PageImage (new — derived)

Built by `flatten_images(sections, limit=40)` in the same module.

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | `str` | yes | absolute image URL, same value as the block's `src` |
| `alt` | `str` | yes | source alt text, `""` when absent |
| `heading` | `str` | yes | heading of the section the image belongs to; `""` for the leading section |

**Validation**
- Deduplicated by `url`, first occurrence kept (document order).
- Noise URLs skipped: substring match on `pixel`, `tracker`, `beacon`, `spacer`, `1x1`, `blank.gif` (same list as `_fetch_url`).
- Truncated at `limit` in document order; truncation is silent on the array (the page's own `truncated` flag already reports text truncation).
- Empty list when the page has no usable images — never `null`, never omitted.

## WebResearchHit (existing — gains one field)

Produced by the `web_research` tool in `src/agentic_rag_mcp/server.py`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `title`, `url`, `snippet` | `str` | yes | unchanged |
| `scrape` | `dict` | yes | unchanged: `status`, `status_reason`, `sections`, `truncated` |
| `content` | `str` | yes | unchanged: LLM-facing text with `[image: URL]` markers |
| `render_html` | `str` | yes | unchanged |
| `images` | `list[PageImage]` | yes | **new**; `[]` for fallback/blocked/failed pages |

**Validation**
- `images` is always present, even when empty.
- `images` never contains a URL that is not in `scrape.sections` (when `status == "ok"`).
- For `status != "ok"`, `images` is `[]` — the fallback snippet carries no images and the tool must not invent them.

## Answer image (product concept, not code)

An image URL the model inlines as `![alt](url)` in the answer. Not a server entity — no code stores it.

**Validation (prompt-enforced, not code-enforced)**
- URL must come from a tool result in this turn or an earlier turn's research (FR-003).
- At most 10 per answer (FR-011).
- Placed with the text it illustrates (FR-002).
- Alt text describes the image (FR-012).

## Relationships

```text
web_research hit
  └── scrape.sections[]           (document order)
        └── blocks[]              (p/img interleaved)
              └── img block ──(derive, dedupe, cap)──> images[] (flat, same order)
```

`images[]` is a projection of `sections[]`, not a second source of truth. A change to extraction is visible in both.

## State transitions

None. Every request is independent; no cache, no conversation state in the server.
