# Contract: `web_research` image exposure (additive)

**Feature**: 049-image-rich-chat-answers | **Version**: 1.1 (additive to 1.0)

Constitution Principle I: the response stays backward-compatible. Existing fields keep their exact type and meaning; one field is added per hit.

## Response shape

```json
{
  "query": "how to pair a bluetooth mouse",
  "engines_used": ["searxng"],
  "elapsed_ms": 8123,
  "error": null,
  "hits": [
    {
      "title": "Pair a Bluetooth mouse",
      "url": "https://docs.example/pair-mouse",
      "snippet": "...",
      "scrape": {
        "url": "https://docs.example/pair-mouse",
        "status": "ok",
        "status_reason": null,
        "sections": [
          {
            "heading": "Turn on pairing mode",
            "blocks": [
              {"type": "p", "text": "Hold the pairing button..."},
              {"type": "img", "src": "https://docs.example/img/step1.png", "alt": "Pairing button on the mouse underside"}
            ]
          }
        ],
        "truncated": false
      },
      "content": "Turn on pairing mode\nHold the pairing button...\n[image: https://docs.example/img/step1.png]",
      "render_html": "<!DOCTYPE html>...",
      "images": [
        {
          "url": "https://docs.example/img/step1.png",
          "alt": "Pairing button on the mouse underside",
          "heading": "Turn on pairing mode"
        }
      ]
    }
  ]
}
```

## Guarantees

| # | Guarantee |
|---|---|
| C1 | `images` is always present on every hit; `[]` when the page yielded no usable images |
| C2 | Every `images[].url` is absolute and `http(s)` |
| C3 | Every `images[].url` appears in `scrape.sections` when `scrape.status == "ok"` |
| C4 | `images` is `[]` when `scrape.status != "ok"` |
| C5 | `images` preserves document order and is deduplicated by URL |
| C6 | `images` is capped at 40 per page |
| C7 | Noise URLs (`pixel`, `tracker`, `beacon`, `spacer`, `1x1`, `blank.gif`) are excluded |
| C8 | No existing field is removed, renamed, or retyped |

## Backward compatibility

| Consumer | Impact |
|---|---|
| Dify chatflow LLM | Sees one extra array; no prompt change required to keep working |
| Existing contract tests | Pass unchanged — assertions are on existing fields |
| MCP hosts | JSON stays a superset; unknown-field-tolerant clients unaffected |

## Non-goals

- `fetch_url` is unchanged. Its `images` stays `list[str]` (no alt text); the model writes alt text from the surrounding text. Changing it to objects would break Principle I.
- No new tool, no new parameter, no new endpoint.
