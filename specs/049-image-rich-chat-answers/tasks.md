# Tasks: Image-Rich Chat Answers

**Input**: Design documents from `specs/049-image-rich-chat-answers/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, test-plan.md

**Tests**: Explicitly requested — unit tests and end-to-end cases are included (Constitution II: tests-first).

**Organization**: Grouped by user story; US1 is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no incomplete dependency)
- **[Story]**: US1 / US2 / US3
- Every task names its exact file path

## Path Conventions

Single repo: `src/agentic_rag_mcp/`, `tests/`, `dify/`, `ai-chat-landing/scripts/`.

---

## Phase 1: Setup

- [X] T001 Add `alt` attributes to the image tags in `tests/fixtures/research/ordered.html` (leave existing src values untouched)
- [X] T002 [P] Create `tests/fixtures/research/gallery.html` — 12 images in 3 sections, one duplicate URL, one `pixel.gif` noise image, one `<img>` without alt
- [X] T003 [P] Create `tests/fixtures/research/no-images.html` — substantive text only, no `<img>`

---

## Phase 2: Foundational (blocking — every story needs this)

- [X] T004 Write failing unit tests in `tests/unit/test_research_images.py` covering U1–U12 from `test-plan.md` §1
- [X] T005 Add `alt` capture to the `img`/`figure` branch of `extract_sections` in `src/agentic_rag_mcp/search/web/research.py` — `alt` is the source `<img alt>` value, `""` when absent (`data-model.md` §SectionBlock)
- [X] T006 Implement `flatten_images(sections, limit=40)` in `src/agentic_rag_mcp/search/web/research.py` — returns `[{url, alt, heading}]`, dedupe by URL keeping first occurrence, skip `pixel`/`tracker`/`beacon`/`spacer`/`1x1`/`blank.gif`, cap at 40 in document order (`data-model.md` §PageImage)
- [X] T007 Add `images: flatten_images(scrape["sections"])` to each hit in the `web_research` handler in `src/agentic_rag_mcp/server.py`; `[]` when `scrape["status"] != "ok"` (`contracts/web-research-images.md` C1–C4)
- [X] T008 Extend `tests/contract/test_web_research_contract.py` with C1–C4 from `test-plan.md` §2; confirm all pre-existing assertions still pass unchanged
- [X] T009 Run `.venv/bin/python -m pytest tests/unit/test_research_images.py tests/unit/test_research_extraction.py tests/contract/test_web_research_contract.py -q` and get green

**Checkpoint**: tool payload carries images + alt text, contract additive, suite green.

---

## Phase 3: User Story 1 — Visual how-to answers carry the step screenshots (P1) 🎯 MVP

**Goal**: A how-to question answered from web research inlines 3+ step screenshots, each next to the step it illustrates.

**Independent test**: Ask "How do I pair a Bluetooth mouse with Windows 11?" — answer shows ≥3 images with alt text, placed between steps.

- [X] T010 [US1] Rewrite the `ANSWER FORMAT — IMAGES` block in the first `agentic_strategy` prompt in `dify/AGIAssistant/AGI_Assistant.yml` (line ~347): binding rule "web_search never returns images — for a visual question call web_research or fetch_url and inline every relevant image", plus the self-check "before finishing, count `![` — if the topic is visual and you have 0, or fewer than 3 when the source had more, fetch more and inline"
- [X] T011 [US1] Apply the identical rewrite to the second `agentic_strategy` prompt copy in the same file (line ~1076); `grep -c "count the \`!\[" dify/AGIAssistant/AGI_Assistant.yml` must return 2
- [X] T012 [US1] Create `ai-chat-landing/scripts/image-rich-check.mjs` following the `stop-button-check.mjs` CDP pattern — send the how-to prompt, wait for the answer to settle, assert `img` count ≥ 3, every `img` has non-empty `alt`, no empty `src`; print observed counts and alt texts; exit 0 on pass
- [X] T013 [US1] Run `node ai-chat-landing/scripts/image-rich-check.mjs` against the live chat and confirm E1 passes

**Checkpoint**: US1 works end-to-end on its own.

---

## Phase 4: User Story 2 — Overview and example answers are illustrated (P2)

**Goal**: Overview/comparison questions inline multiple illustrative images, placed with what they illustrate.

**Independent test**: Ask "show me examples of mechanical keyboards" — ≥2 images inlined, distributed across the answer.

- [X] T014 [US2] Extend `ai-chat-landing/scripts/image-rich-check.mjs` with an `--overview` case: send an overview prompt, assert `img` count ≥ 2 and that images are not all clustered at the end of the answer
- [X] T015 [US2] Run the `--overview` case against the live chat and confirm E2 passes

**Checkpoint**: US2 adds no server change — the prompt rule from T010/T011 covers it.

---

## Phase 5: User Story 3 — Non-visual answers stay honest (P3)

**Goal**: Text-only topics stay text-only; a visual topic with no source images says so instead of fabricating.

**Independent test**: Ask "What is the capital of France?" — zero images. Ask a visual topic whose sources have no images — no fabricated URL.

- [X] T016 [US3] Extend `ai-chat-landing/scripts/image-rich-check.mjs` with a `--non-visual` case: send "What is the capital of France?" and assert `img` count == 0
- [X] T017 [US3] Add the honesty clause to the `ANSWER FORMAT — IMAGES` block in both prompt copies in `dify/AGIAssistant/AGI_Assistant.yml`: "when the topic is visual and the sources have no images, say so plainly — never invent an image URL"
- [X] T018 [US3] Run the `--non-visual` case and confirm E3/E4 pass
- [X] T019 [US3] Confirm `grep -c "ANTI-FABRICATION" dify/AGIAssistant/AGI_Assistant.yml` and `grep -c "honesty_check"` are unchanged from HEAD

**Checkpoint**: all three stories independently verified.

---

## Phase 6: Polish & Cross-Cutting

- [X] T020 [P] Run the full backend suite: `.venv/bin/python -m pytest tests/unit tests/contract -q` — 100% green
- [X] T021 [P] Run the frontend suite in `ai-chat-landing/`: `pnpm test && pnpm typecheck && pnpm lint`
- [X] T022 [P] Execute the S8 error-path table from `quickstart.md` (blocked scrape, dead image URL, >10 images, duplicate) and record results
- [X] T023 Deploy: `.venv/bin/python -m agentic_rag_mcp.deploy redeploy` then `.venv/bin/python -m agentic_rag_mcp.deploy verify`
- [X] T024 Re-run E1–E4 against the deployed chat and confirm all pass
- [X] T025 Update `specs/049-image-rich-chat-answers/spec.md` Status to `Implemented` and tick completed tasks in this file

---

## Phase 7: Convergence

- [X] T026 Add the FR-011 answer-level 10-image cap to both IMAGES prompt blocks in `dify/AGIAssistant/AGI_Assistant.yml` (lines ~347 and ~1076): an answer MUST NOT inline more than 10 images and MUST stop at relevance before the cap; verify with a >10-image fixture that the answer stops at 10, and if the model still exceeds 10, enforce deterministic truncation in the answer finalizer per FR-011 (contradicts) — cap was already present in both copies; verified live via `--cap` (exactly 10). No answer-finalizer truncation added: `data-model.md` keeps FR-011 prompt-enforced and `plan.md` forbids the server change.

---

## Dependencies

```text
Phase 1 (T001–T003)
  └─> Phase 2 (T004–T009)  blocking for all stories
        ├─> US1 (T010–T013)
        ├─> US2 (T014–T015)   needs T012's script file
        └─> US3 (T016–T019)   needs T012's script file
              └─> Phase 6 (T020–T025)
```

- US2 and US3 both extend the script created in T012, so T014/T016 run after T012 — not in parallel with each other.
- T010 and T011 touch the same YAML file — sequential.
- T020/T021/T022 are different trees — parallel.

## Parallel execution examples

```text
# Setup
T002 gallery.html  ‖  T003 no-images.html

# Polish
T020 pytest  ‖  T021 pnpm  ‖  T022 error-path runs
```

## Implementation strategy

MVP = Phase 1 + Phase 2 + US1 (T001–T013). That alone fixes the reported symptom: a how-to answer that showed one image or none now inlines the step screenshots. US2 adds only a script case; US3 adds the honesty clause and a negative case. Ship the MVP, verify live, then layer US2/US3.

## Validation

Every task names a file path. Tests precede implementation in Phase 2. Constitution gates: contract additive (T008), no new dependency (none added), full suite green (T020–T021).

---

## Phase 8: Convergence

- [X] T027 Run `node ai-chat-landing/scripts/image-rich-check.mjs --cap` against the live chat and record the observed image count (≥1 and ≤10); the cap sentence is already present in both `agentic_strategy` prompt blocks (verified 2× at lines ~347 and ~1076), so do not re-add prompt text and do not add answer-finalizer truncation — that would contradict `plan.md` ("no server change", 2 Python files) and `data-model.md` ("prompt-enforced, not code-enforced") and requires a plan amendment first per FR-011 (partial) — observed exactly 10. Same session: the anti-thinking-image rule was added to both prompt copies and `capInlineImages` now skips think blocks (published to `194e1edf`; E1 6 / E2 8 / E3 0).
- [ ] T028 [FR-009] Add a `--pdf` case to `ai-chat-landing/scripts/image-rich-check.mjs` that reuses the E1 answer, clicks the header ⬇ PDF export, waits for it to finish, and asserts the export completed with no empty-`src` or error-placeholder image; run it owner-present, inspect the exported PDF for the inlined images, and record the result per FR-009/SC-006 (missing)
- [ ] T029 [FR-008] Extend image extraction to accept `srcset`/`data-srcset` (first candidate URL) and unquoted attribute values in `_IMG_SRC_RE` in `src/agentic_rag_mcp/server.py` and in the `src` lookup of `extract_sections` in `src/agentic_rag_mcp/search/web/research.py`, keeping the existing absolutize/dedupe/noise behavior, and add a unit case to `tests/unit/test_research_images.py` for a srcset-only lazy image per FR-008 and the spec's lazy-loaded edge case (partial)
- [ ] T030 [FR-002] Add the E2 placement assertion to the default/how-to mode of `ai-chat-landing/scripts/image-rich-check.mjs` (images must not all appear after the answer's trailing text region), then run it and record the result per FR-002/SC-004 (partial)
- [ ] T031 Emit `""` as the leading section's `heading` in `extract_sections` (`src/agentic_rag_mcp/search/web/research.py`) so `images[].heading` matches `data-model.md` §PageImage, or record the h1-text deviation in `data-model.md`; add/adjust the U4 assertion accordingly (contradicts)
- [ ] T032 Skip `IMG_SKIP` URLs when rendering `[image: …]` markers in `sections_to_text` (`src/agentic_rag_mcp/search/web/research.py`) so the LLM-facing text no longer advertises tracker/pixel URLs that `images[]` already excludes, per FR-004 (partial)
