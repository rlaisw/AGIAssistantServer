# Feature Specification: Image-Rich Chat Answers

**Feature Branch**: `049-image-rich-chat-answers`

**Created**: 2026-11-24

**Status**: Implemented — FR-011 cap verified live on app `194e1edf` (`--cap` observed exactly 10 images; E1 = 6, E2 = 8, E3 = 0); FR-009/SC-006 PDF-export acceptance (T028) and T029–T032 remain open

**Input**: User description: "Improve chat answer itself to be image-rich — when answering from web search/fetch, get as many images as possible. Always illustrate the answer to the user's question with as many relevant images as possible."

## Clarifications

### Session 2026-11-24

- Q: How many images should a single visual answer be allowed to include at most? → A: 10 images.
- Q: Which sources should the image-rich behavior cover? → A: Web sources only.
- Q: Should every inlined image carry descriptive alt text? → A: Yes, always.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visual how-to answers carry the step screenshots (Priority: P1)

A user asks AGI Chat how to do a procedure (install a driver, pair a device, configure a setting). The assistant researches the topic and answers with numbered steps. Today the answer typically shows one image or none, even when the guide pages contain step screenshots. The user needs the answer to inline the actual step screenshots next to the steps they illustrate, so the procedure can be followed without opening the source pages.

**Why this priority**: How-to questions are the highest-volume visual request type and the most damaged by an image-poor answer — a text-only procedure is hard to follow and forces the user to click through sources.

**Independent Test**: Ask a how-to question whose sources contain several step screenshots; confirm the answer inlines multiple images grouped with the steps, in document order. Delivers a usable illustrated procedure on its own.

**Acceptance Scenarios**:

1. **Given** a how-to question whose retrieved sources contain 3+ relevant step screenshots, **When** the assistant answers, **Then** the answer inlines at least 3 of those images, each placed with the step or paragraph it illustrates.
2. **Given** a how-to question where the first source is an overview page with only icons and the tutorial pages carry the screenshots, **When** the assistant answers, **Then** the answer inlines the tutorial screenshots rather than the icons.
3. **Given** a how-to answer built from earlier-turn research reused without fresh calls, **When** the assistant answers, **Then** the images those sources provided are still inlined.

---

### User Story 2 - Overview and example answers are illustrated (Priority: P2)

A user asks for examples, comparisons, or an overview ("show me examples of X", "what does Y look like"). The assistant answers with prose and, at best, a single image. The user needs several illustrative images so the answer actually shows what it describes.

**Why this priority**: Overview/example questions are the second most common visual request and currently produce the weakest visual coverage, but they tolerate fewer images than a step-by-step procedure.

**Independent Test**: Ask an overview/example question whose sources contain multiple illustrative images; confirm the answer inlines several relevant images distributed across the sections they illustrate.

**Acceptance Scenarios**:

1. **Given** an overview question whose sources contain several relevant images, **When** the assistant answers, **Then** the answer inlines more than one image, distributed across the relevant sections.
2. **Given** a comparison question covering two options with images for each, **When** the assistant answers, **Then** each option's section shows its own images.

---

### User Story 3 - Non-visual answers stay honest and uncluttered (Priority: P3)

A user asks a text-only question (code, logs, diagnostics, arithmetic, a policy lookup). The assistant must not pad the answer with decorative or irrelevant images, and must not invent an image when none was retrieved.

**Why this priority**: Protects answer quality and trust; image-richness must never become image spam or fabrication.

**Independent Test**: Ask a text-only question and an unillustrated topic; confirm no images are added and no image URL is fabricated.

**Acceptance Scenarios**:

1. **Given** a text-only question, **When** the assistant answers, **Then** the answer contains no images (or at most one genuinely relevant one).
2. **Given** a visual question whose retrieved sources contain no images, **When** the assistant answers, **Then** the answer is text-only and states that no images were available — it does not invent an image URL.
3. **Given** a retrieved page whose images are only logos, avatars, trackers, or decorative banners, **When** the assistant answers, **Then** those images are excluded.

---

### Edge Cases

- A source page has dozens of images: the answer must include the relevant ones without becoming a gallery that buries the text.
- An image URL is dead or blocked by the source: the answer still renders, with the image's description text intact and no broken layout.
- The same question is repeated and answered from earlier-turn research: the earlier images are retained, not dropped.
- A question mixes a visual part and a text-only part: only the visual part gets images.
- An image's URL is relative or lazy-loaded on the source page: the answer uses a usable absolute URL, never a raw relative path.
- The answer is long enough that the chat UI must lazy-load images: inline placement and order still hold.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the answer's topic is visual (how-to, overview, example, comparison, product/device appearance) and the retrieved sources contain relevant images, the assistant MUST inline multiple images — not a single image and not zero.
- **FR-002**: Each inlined image MUST be placed with the text, step, or section it illustrates, preserving the source document's order; images MUST NOT be collected into one undifferentiated block at the end.
- **FR-003**: Every inlined image URL MUST originate from a tool result for that answer; the assistant MUST NOT construct, guess, or synthesize image URLs.
- **FR-004**: The assistant MUST exclude images that are decorative or non-illustrative — logos, avatars, tracking pixels, spacers, and banners.
- **FR-005**: When the retrieved sources contain no relevant images, the assistant MUST answer text-only and MUST state honestly that no images were available; it MUST NOT fabricate an image or imply one exists.
- **FR-006**: When an answer reuses research from an earlier turn instead of making fresh retrieval calls, the assistant MUST retain and inline the images that earlier research provided.
- **FR-007**: For text-only topics (code, logs, diagnostics, arithmetic, policy text), the assistant MUST NOT add images that do not illustrate the answer.
- **FR-008**: The retrieval tools MUST expose, per retrieved page, the images available on that page in a form the assistant can inline, so that image availability is not limited to whichever tool the assistant happened to call.
- **FR-009**: Inlined images MUST remain renderable in the chat answer and MUST survive the answer's PDF export path without breaking the export.
- **FR-010**: The image-richness behavior MUST NOT weaken the existing honesty guarantees: no claim of action without a tool call, and no unsupported factual assertion.
- **FR-011**: A single answer MUST NOT inline more than 10 images; adding images MUST stop when additional images no longer illustrate the answer, even before the cap is reached.
- **FR-012**: Every inlined image MUST carry descriptive alt text that conveys what the image shows, so the answer remains usable to screen-reader users and degrades gracefully when an image fails to load.
- **FR-013**: Image-richness applies to web-retrieved sources only; knowledge-base documents and chat attachments are out of scope for this feature and keep their current behavior.

### Key Entities

- **Retrieved source page**: A page returned by search or fetch, carrying its text, its ordered sections, and the images found on it.
- **Answer image**: An image URL taken from a retrieved source, together with the text or step it illustrates and its position in the answer.
- **Visual topic**: A question whose answer benefits from illustration (how-to, overview, example, comparison, appearance).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For visual questions whose sources contain at least 3 relevant images, at least 90% of answers inline 3 or more images.
- **SC-002**: Across a sample of 50 answers, 0 fabricated or non-source image URLs appear.
- **SC-003**: For text-only topics, no more than 10% of answers contain an image, and none contain more than one.
- **SC-004**: In at least 90% of multi-image answers, images appear in the source document's order and are grouped with the text they illustrate.
- **SC-005**: Excluding network time spent fetching additional images, median answer latency increases by no more than 20% versus the current baseline.
- **SC-006**: 100% of image-bearing answers render in the chat UI and export to PDF without broken images or layout failures.
- **SC-007**: 100% of inlined images in a sample of 50 answers carry descriptive alt text.

## Assumptions

- "Image-rich" means several relevant inline images, not an image gallery or a wall of thumbnails.
- "As many as possible" is bounded by relevance, by the images the retrieved sources actually provide, and by a hard cap of 10 images per answer; it is not an unbounded count.
- The chat UI already renders markdown images and the PDF export already proxies remote images, so no renderer redesign is required.
- The retrieval lanes already return images for some sources; the gap is that answers under-use them and that some lanes return none.
- The Dify chatflow's answer strategy is the primary place the behavior is expressed; server-side tool payloads may need to expose images more consistently.
- A "visual topic" is judged by the assistant from the question, not by a hard-coded query classifier.
- The honesty guard and the anti-fabrication law remain in force and take precedence over image count.
