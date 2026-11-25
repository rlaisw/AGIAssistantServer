# Phase 0 Research — Image-Rich Chat Answers

**Feature**: 049-image-rich-chat-answers | **Date**: 2026-11-24

All unknowns from the Technical Context are resolved below. No `NEEDS CLARIFICATION` remains.

## D1 — Where does the image list come from?

**Decision**: Derive a flat per-hit `images` array from the already-parsed `sections` in `web_research`; do not re-parse the HTML.

**Rationale**: `extract_sections` already walks the document in order and emits `{"type": "img", "src": ...}` blocks. Re-parsing would double the BeautifulSoup cost and could disagree with the section order. Deriving from sections guarantees the flat list and the section blocks tell the same story.

**Alternatives considered**:
- *Re-run `_IMG_SRC_RE` over the raw HTML* (as `_fetch_url` does): cheaper to write, but loses document order relative to headings and cannot supply `alt` without a second regex. Rejected.
- *Return only `render_html` and let the model parse it*: the model cannot reliably parse HTML for image URLs, and the payload is already large. Rejected.

## D2 — Where does alt text come from?

**Decision**: Capture `<img alt="...">` during `extract_sections` and store it on the block as `alt` (default `""`).

**Rationale**: Source alt text is the only truthful description available at server time; the model can improve it when it writes the markdown, but it must not invent a description of an image it cannot see. FR-012 requires descriptive alt text; empty source alt is a signal for the model to write one from the surrounding heading and paragraph.

**Alternatives considered**:
- *Model-generated alt only*: fails FR-012 when the model writes "image" or "screenshot". Rejected as the sole source.
- *Vision captioning of each image*: new dependency, new network calls, new latency. Rejected under Constitution III.

## D3 — Duplicate images across sections

**Decision**: Dedupe by absolute URL, keep the first occurrence in document order.

**Rationale**: Guide pages repeat the same screenshot in an intro and a step. Inlining it twice looks broken and wastes the 10-image budget. First occurrence is the position the document intends.

**Alternatives considered**: Keep all duplicates and let the prompt dedupe — the model does this unreliably and it costs tokens. Rejected.

## D4 — Noise filtering

**Decision**: Reuse `_IMG_SKIP` (`pixel`, `tracker`, `beacon`, `spacer`, `1x1`, `blank.gif`) for section images, matching `_fetch_url`.

**Rationale**: Two different noise rules for the same concept is a bug waiting to happen. The substring list is already proven and already applied on the `fetch_url` path.

**Alternatives considered**: Filter by rendered size (needs image decoding — rejected), filter by CSS class (fragile — rejected).

## D5 — Caps

**Decision**: Per-page flat image list capped at 40 in document order; the answer-level cap stays 10 (FR-011).

**Rationale**: A page cap protects the LLM payload from a gallery page; the answer cap is the product decision from the clarification session. 40 leaves room for a long illustrated guide while staying well under the tool-result budget.

**Alternatives considered**: No page cap (payload risk), page cap of 10 (drops legitimate step images before the model ever sees them). Rejected.

## D6 — Prompt wording

**Decision**: Replace the "always try" instruction in both strategy prompt copies with a binding rule plus a count self-check:

- "For a visual question, `web_search` alone is never enough — it returns no images. Use `web_research` or `fetch_url` and inline every relevant image."
- "Before you finish: count the `![` in your answer. If the topic is visual and the count is 0, or fewer than 3 while the source had more, fetch more images and inline them."

**Rationale**: "Always try" is satisfiable with one image or zero — the model reads it as permission, not obligation. A count check is falsifiable and makes the gap visible to the model at the moment it can still fix it.

**Alternatives considered**:
- *Raise the count in the prompt only* ("include as many as possible"): unbounded, invites fabrication and gallery spam. Rejected.
- *Post-process the answer server-side to append images*: cannot know which image belongs where; would violate the honesty principle. Rejected.

## D7 — UI and PDF path

**Decision**: No change to `components/markdown.tsx`, `app/api/image-proxy/route.ts`, or `lib/pdf-export/`.

**Rationale**: Verified in code — markdown images render, the PDF path proxies remote images same-origin for the html2canvas CORS raster, and a dead URL renders its alt text natively. Adding a fallback component would be new code for a case the browser already handles.

**Alternatives considered**: Custom `<img>` with an error placeholder in the markdown renderer — new component, new tests, no acceptance criterion it satisfies beyond what alt text already does. Rejected.

## D8 — Which lanes get the prompt change?

**Decision**: Both `agentic_strategy` prompt copies in `dify/AGIAssistant/AGI_Assistant.yml` (lines 347 and 1076), edited identically.

**Rationale**: The file carries two strategy prompts (general and local lanes). Editing one leaves the other lane image-poor — the exact bug this feature fixes.

**Alternatives considered**: Extract the shared block into a Dify variable — larger DSL change, more risk, not required by the spec. Rejected.
