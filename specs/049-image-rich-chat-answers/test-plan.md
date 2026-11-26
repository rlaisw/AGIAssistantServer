# Test Plan — Image-Rich Chat Answers

**Feature**: 049-image-rich-chat-answers | **Date**: 2026-11-24

Covers unit tests, contract tests, end-to-end acceptance, and the error-handling matrix. Tests-first (Constitution II): write the failing check, then the change.

## 1. Unit tests — `tests/unit/test_research_images.py` (new)

Fixtures: extend `tests/fixtures/research/ordered.html` with `alt` attributes; add `tests/fixtures/research/gallery.html` (12 images, two duplicates, one noise pixel) and `tests/fixtures/research/no-images.html`.

| # | Test | Asserts | Requirement |
|---|---|---|---|
| U1 | `test_img_block_carries_source_alt` | `blocks[1]["alt"] == "Pairing button on the mouse underside"` | FR-012 |
| U2 | `test_img_block_alt_defaults_empty` | `<img>` without alt → `alt == ""` | FR-012 |
| U3 | `test_images_flat_list_preserves_document_order` | Flat URLs equal the section img order | FR-002 |
| U4 | `test_images_flat_list_carries_heading` | Each image's `heading` matches its section | FR-002 |
| U5 | `test_images_absolute_urls` | Relative `src` and `data-src` become absolute | FR-001 |
| U6 | `test_data_uri_image_skipped` | `data:` URI absent from `images` | existing |
| U7 | `test_duplicate_image_kept_once` | Repeated URL appears once, at its first position | D3 |
| U8 | `test_noise_image_skipped` | `pixel.gif`, `tracker.png`, `spacer.png` excluded | FR-004 |
| U9 | `test_image_list_capped_at_40` | 50-image page → exactly 40, first 40 in order | D5 |
| U10 | `test_page_without_images_returns_empty_list` | `images == []` (not None, not omitted) | FR-005 |
| U11 | `test_fallback_page_has_no_images` | `status != "ok"` → `images == []` | C4 |
| U12 | `test_images_are_subset_of_sections` | Every flat URL exists in `sections` blocks | C3 |

## 2. Contract tests — extend `tests/contract/test_web_research_contract.py`

| # | Test | Asserts |
|---|---|---|
| C1 | `test_hit_exposes_images_field` | `images` present on every hit |
| C2 | `test_images_empty_for_fallback_hit` | Fallback hit → `images == []` |
| C3 | `test_existing_fields_unchanged` | `title/url/snippet/scrape/content/render_html` still present with same types |
| C4 | `test_images_shape` | Each entry has `url`, `alt`, `heading` as strings |

All existing assertions in the file must pass unmodified — that is the backward-compatibility gate.

## 3. End-to-end acceptance — `ai-chat-landing/scripts/image-rich-check.mjs` (new)

Follows the existing CDP script pattern (`wide-layout.mjs`, `stop-button-check.mjs`): connect to Chrome on `:9240`, send a prompt, wait for the answer to settle, inspect the answer bubble.

| # | Case | Prompt | Assertion |
|---|---|---|---|
| E1 | Visual how-to is image-rich | "How do I pair a Bluetooth mouse with Windows 11?" | `img` count ≥ 3; every `img` has non-empty `alt`; no empty `src` |
| E2 | Images sit with their steps | same prompt | Inlined `img` elements appear between text blocks, not only at the end |
| E3 | Non-visual stays text-only | "What is the capital of France?" | `img` count == 0 |
| E4 | No-image page stays honest | "Summarize the history of the semicolon" | `img` count ≤ 1; no fabricated URL |
| E5 | PDF export survives | export E1's answer | Export completes; no `img` with `src=""` or error placeholder |

Exit code 0 on pass; prints observed counts and alt texts. `--non-visual` flag runs E3/E4 only.

## 4. Error-handling matrix

| # | Failure | Trigger | Expected behavior | Where tested |
|---|---|---|---|---|
| H1 | SSRF-blocked page | `research_page` with `http://127.0.0.1/` | `status=blocked`, `images=[]`, no exception | U11 + existing |
| H2 | Fetch timeout | Mock provider raising `httpx.TimeoutException` | `status=fallback`, `images=[]` | U11 |
| H3 | HTTP 404 | Mock 404 response | `status=fallback`, `images=[]` | U11 |
| H4 | No extractable content | JS-only page fixture | `status=fallback`, `images=[]` | U10 |
| H5 | `<img>` without src | Malformed fixture | Block skipped; page still `ok` | U6 |
| H6 | Dead image URL in answer | CDP with a 404 image | Alt text renders; no layout break | E5 |
| H7 | More than 10 relevant images | Gallery page | ≤ 10 inlined; relevance stop | E1 variant |
| H8 | Duplicate image across sections | Guide page | Inlined once | U7 |
| H9 | Non-visual topic | "capital of France" | Zero images | E3 |

## 5. Prompt-level checks (manual, owner-present)

| # | Check | Expected |
|---|---|---|
| P1 | Both strategy prompt copies edited identically | `grep -c "count the \`!\[" dify/AGIAssistant/AGI_Assistant.yml` returns 2 |
| P2 | ANTI-FABRICATION LAW intact | `grep -c "ANTI-FABRICATION" ...` unchanged |
| P3 | Honesty check node present | `grep -c "honesty_check" ...` unchanged |
| P4 | No "always try" wording left | `grep -c "always try" ...` returns 0 |

## 6. Commands

```bash
.venv/bin/python -m pytest tests/unit/test_research_images.py tests/unit/test_research_extraction.py tests/contract/test_web_research_contract.py -q
.venv/bin/python -m pytest tests/unit tests/contract -q
cd ai-chat-landing && pnpm test && pnpm typecheck && pnpm lint
cd ai-chat-landing && node scripts/image-rich-check.mjs
```

## 7. Out of scope

- Vision captioning of images (no new dependency).
- `fetch_url` alt text (would break the contract; model writes alt).
- Knowledge-base documents and chat attachments (FR-013).
- A UI fallback component for dead images (alt text already covers it).

## 8. Results

**2026-11-26 — T029/T031/T032 unit (offline)**

- T029: `_img_srcs` accepts quoted, unquoted, and `srcset`/`data-srcset` (first candidate); `extract_sections` falls back to srcset. Cases: `test_srcset_only_lazy_image_extracted`, `test_fetch_srcs_accept_srcset_and_unquoted`.
- T031: leading section `heading` is `""` per `data-model.md` §PageImage. Case: `test_leading_section_heading_is_empty`.
- T032: `sections_to_text` omits `IMG_SKIP` URLs. Case: `test_text_markers_skip_noise_images`.
- Full suite: `.venv/bin/python -m pytest tests/unit tests/contract -q` → **1482 passed**.

**2026-11-26 — T030 default-mode placement (live CDP, headless Chrome 155, app on :3000)**

- E1 answer: 4 images, 0 missing alt, 0 empty src; text positions 459, 583, 865, 1337 of 2134 → not clustered at the end. **PASS**; throwaway conversation deleted.

**2026-11-26 — T028 PDF export (live CDP, same answer path, `--pdf`)**

- E1 answer: 8 images, 0 missing alt, 0 empty src; positions 647–1690 of 2621.
- Export downloaded `049-default-…-show-me-the-st.pdf`, 530,205 bytes; `pdfimages -list` reports 5 embedded image rows; `pdftotext` has no export-error text. **PASS**; throwaway conversation deleted.

