# Porting the image-rich answer feature to another AGIAssistant

Self-contained handoff for spec 049. Assumes the target has the same shape: a sidecar
whose web-research tools return ordered page sections, a Dify chatflow whose strategy
prompt controls answer formatting, and a markdown chat UI (plus a same-origin image
proxy if PDF export exists). If a step's prerequisite is missing, the step says so.

Full reference in this repo: `specs/049-image-rich-chat-answers/` (spec.md, plan.md,
contracts/web-research-images.md, test-plan.md).

## What the feature does

1. The research tool returns, per page, a flat `images` list (`url`, `alt`, `heading`)
   in document order — so the model does not have to parse HTML or depend on which tool
   it called.
2. The prompt requires every visual answer (how-to, overview, example, comparison,
   appearance) to inline multiple relevant images, grouped with the text they illustrate,
   max 10 per answer, never fabricated, alt text always.
3. Text-only topics stay text-only; a visual topic with no source images says so plainly.

The critical architectural precondition: extraction must already produce **one ordered
list of interleaved `p`/`img` blocks per page**. Images cannot be placed next to steps if
text and images are collected into separate buckets.

## Step 1 — tool payload (server)

If the target project already returns an ordered `sections` structure, port these three
pieces. If it does not, this is the design to add first.

```python
# shared noise filter, used by both fetch_url and flatten_images
IMG_SKIP = ("pixel", "tracker", "beacon", "spacer", "1x1", "blank.gif")
```

`alt` capture in the extraction loop (the `img`/`figure` branch):

```python
img = el if el.name == "img" else el.find("img")
if img is None or el.name == "img" and el.find_parent("figure") is not None:
    continue  # handled via its figure - don't double-count
src = img.get("src") or img.get("data-src")
if src and not src.startswith("data:"):
    current["blocks"].append({"type": "img", "src": urljoin(page_url, src),
                              "alt": (img.get("alt") or "").strip()})
```

Flat, deduped, ordered, capped list:

```python
def flatten_images(sections: list[dict], limit: int = 40) -> list[dict]:
    images, seen = [], set()
    for sec in sections:
        for b in sec["blocks"]:
            if b["type"] != "img":
                continue
            url = b["src"]
            if url in seen or any(bad in url.lower() for bad in IMG_SKIP):
                continue
            seen.add(url)
            images.append({"url": url, "alt": b.get("alt", ""), "heading": sec["heading"]})
            if len(images) >= limit:
                return images
    return images
```

Attach it to every hit of the search tool. Empty list for pages that did not scrape
cleanly — never `None`, never omitted, never invented:

```python
images = flatten_images(scrape["sections"]) if ok else []
out_hits.append({**h, "scrape": scrape, "content": content,
                 "render_html": render, "images": images})
```

Also give the page-fetch tool an `images` list of absolute URLs (no alt; keep it a
`list[str]` so the existing contract does not break). That tool is what the prompt tells
the model to call first when it only knows the topic.

Contract rules (keep these or the Dify tool JSON breaks):

- existing fields keep their exact name and type; `images`/`alt` are additive only;
- `images` is a projection of `sections` (one source of truth);
- `capture alt` from `<img alt>`; `""` when the source has none — never invent it
  server-side.

## Step 2 — chatflow prompt (the main behavior change)

Paste this block into **both** strategy prompt copies of the chatflow (the two lanes
diverge silently if you edit only one), immediately before `ANSWER FORMAT — CITATIONS:`,
and adapt tool names if the target's tools are named differently.

```text
ANSWER FORMAT — IMAGES (binding):
- BINDING: a visual question (how-to, troubleshooting, overview, example, appearance) MUST be illustrated with the source images. web_search returns NO images — never answer a visual question from snippets alone. When answering from web research,
  prefer web_research (its page scrapes return image URLs in document order)
  and INLINE the relevant images in your answer as markdown — ![what it shows](URL)
  — grouped with the text they belong to, in document order.
- web_research also returns a flat images array per hit with url, alt, and heading for every page image; use those URLs and their alt text. Never invent an image URL.
- To collect images for a how-to, call fetch_url on the guide/tutorial page FIRST
  (it needs no search engine and returns an images list with every image on the
  page as absolute URLs). If you only know the topic's main article, fetch it,
  then follow its tutorial links with fetch_url. Overview articles often carry
  only icons; the tutorial pages carry the step screenshots — INLINE those.
- Include as many relevant images as the source supports, not just one or two. Skip only logos, avatars,
  trackers, and decorative banners. CAP: an answer MUST NOT inline more than 10 images — stop at the 10th even when more are relevant, and stop earlier when additional images no longer illustrate the answer.
- Do NOT write image markdown or an image list inside your thinking — plan silently; image links in your reasoning never count. Put each screenshot directly under the step it shows.
- SELF-CHECK before finishing: count only the images in the final answer you show the user (never images mentioned in your thinking); if the topic is visual and the count is 0, or fewer than 3 when the source had more, fetch more images and inline them. If the source genuinely has no images, say so and keep the answer text-only — never fabricate.
- Reused research keeps its images: when the user repeats a question and you
  answer from earlier-turn research instead of fresh calls, still INLINE the
  images those sources provided (they are stable URLs) — never drop them.
- Generated visuals — pick the tool by output type: chart tools that return an image URL are ALWAYS inlined as ![title](image_url); tools that return an HTML page are given as a labeled markdown link and cannot be inlined with ![].
- Skip images only when the web tools returned none or the topic genuinely has
  no visual content.
```

Why each line matters (do not drop these three):

- **CAP + relevance stop** — without a number, "as many as possible" becomes a gallery.
- **"plan silently / reasoning never counts"** — this is the line that fixes the
  one-image answers: models otherwise satisfy the self-check by listing image URLs in
  their hidden thinking and inlining only one.
- **alt + "never invent a URL"** — keeps honesty and screen-reader output.

If the target also has an `ASK FIRST` (clarify-before-answering) rule, keep it: the first
turn will be a question with zero images, and the illustrated answer comes on the
follow-up turn. That is expected, not a failure.

## Step 3 — optional deterministic cap (only if the chatflow has an answer code node)

The prompt cap is model-enforced. If the target has a JS code node between the answer
LLM and the response (an honesty/answer finalizer), add this so hidden thinking can
never consume the image budget:

```js
var IMAGE_CAP = 10;
function capInlineImages(text) {
    var seen = 0, depth = 0;
    return String(text).replace(/<\/?think>|!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, function (match) {
      if (match === '<think>') { depth++; return match; }
      if (match === '</think>') { depth = Math.max(0, depth - 1); return match; }
      if (depth > 0 || match.indexOf('/mcp-action/screenshots/') !== -1) { return match; }
      seen++;
      return seen <= IMAGE_CAP ? match : '';
    }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }
// at the end of the node:
// return { result: capInlineImages(answer) };
```
```

Notes:

- It skips thought blocks (the chat UI hides that text), so reasoning images are neither counted nor stripped.
  hides that text, so it is not "inlined").
- Keep the screenshot exemption only if the target embeds captured screenshots; otherwise
  delete that clause.
- Skip the whole step if there is no code node — Step 2 alone works.

## Step 4 — verification (four live prompts)

Run each in a fresh conversation. Count **visible** images (strip `...` blocks if you
inspect the raw answer; the chat UI only renders the visible part).

| Case | Prompt | Follow-up (if the model asks a clarifying question) | Pass |
|---|---|---|---|
| How-to | `Show me the step-by-step instructions for pairing a standard Bluetooth mouse on Windows 11.` | `It's a generic Bluetooth mouse on Windows 11 — please show me the steps with the images from the source pages.` | >= 3 visible images, every one has non-empty alt, no empty `src`, images sit with their steps |
| Overview | `Show me examples of mechanical keyboards and what makes each one different.` | `Just give me the overview with example images from the sources.` | >= 2 images, not all clustered at the end |
| Cap | `Show me a big gallery of mechanical keyboard examples — as many as you can find, with images from the sources.` | `Just show me the gallery with images from the sources, no more questions.` | >= 1 and <= 10 images |
| Text-only | `What is the capital of France?` | — | 0 images |

A before/after sanity check on the how-to case should show the visible count rising from
0–1 to 3+. In this repo the same prompt went from 1 visible image to 9 after Step 2 + 3.

## Step 5 — deployment gotchas (this repo hit all of them)

1. **Rebuild the sidecar** if you changed the tool payload (`redeploy`), not just the
   chatflow — the `images` field lives in the running container.
2. **Publish by explicit app ID.** If two Dify apps share the name, name-based publish
   targets whichever the API lists first. Symptoms: "no difference before/after" while
   the prompt is clearly in the YAML. This repo's live lane is `194e1edf-2eba-442c-b10b-231bebb79c37`;
   the twin is `7863fbe2-47f8-48c9-b096-6f7da8536b08`. Verify after publishing:
   `select (graph::text like '%CAP: an answer MUST NOT inline more than 10 images%') from workflows where app_id='<id>' order by updated_at desc limit 1;`
3. **No chat-UI change is needed** if markdown images already render and PDF export
   already proxies remote images (`app/api/image-proxy/route.ts` here). Native alt text
   covers dead URLs.
4. **Do not add alt text to the fetch tool's `images`** (it is `list[str]`) — that is a
   contract break. The model writes alt from the surrounding text, or uses the search
   tool's `images[].alt`.

## Out of scope (keep it that way)

- Knowledge-base documents and chat attachments: unchanged, no images.
- Server-side vision captioning: no new dependency.
- A UI fallback for dead images: alt text already covers it.
- Enforcing the 10 cap in code only if a code node already exists; otherwise the prompt
  owns it.
