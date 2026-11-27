# Bug Fix: Infographic link emitted with fabricated host (`infographics.local`)

- **Slug**: wrong-infographics-url
- **Fixed**: 2026-11-27T10:12:00+08:00
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The model composing the chat answer fabricated a hostname (`infographics.local`) when wrapping the sidecar tool's relative infographic URL in a markdown link. The renderer now rebuilds every infographic href from the `/infographics/` path inside the link, so the rendered href is always same-origin regardless of what host the answer text carried.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `ai-chat-landing/lib/infographic-link.ts` | modified | `infographicHref(href, slug)` now extracts the `/infographics/(p/<slug>/)?<id>` path from ANY href (fabricated host, loopback, or relative) and rebuilds it as a same-origin path; session slug (when known) wins over the URL's slug |
| `ai-chat-landing/lib/infographic-link.test.ts` | added 4 tests | fabricated-host stripping, plain form, session-slug precedence, asset-suffix preservation |

## Diff Highlights

```ts
const m = target.match(/\/infographics\/(?:p\/([a-z0-9-]+)\/)?([0-9a-f]{10,})([^?#]*)/)
if (!m) return rewriteLegacyInfographicUrl(target)
const owner = slug ?? m[1] ?? null
return owner ? `/infographics/p/${owner}/${id}${suffix}` : `/infographics/${id}${suffix}`
```

## Tests Added or Updated

- `lib/infographic-link.test.ts` — `https://infographics.local/infographics/p/<slug>/<id>/` → `/infographics/p/<slug>/<id>/` (the reported URL, exactly)
- fabricated host + plain form; session slug precedence; asset suffix preserved

## Local Verification

- Commands: `pnpm vitest run lib/infographic-link.test.ts` → 9 passed; full `pnpm test` → 328 passed (59 files); `pnpm typecheck` clean; `pnpm lint` 0 errors
- The dev server hot-reloads; no deployment needed (frontend-only change)

## Deviations from Assessment

The assessment preferred a sidecar/DSL-level link-lint; the deterministic renderer-level rebuild achieves the same guarantee with a smaller change surface (no republish, no DSL edit). The tool itself already emits a correct relative URL — only the model's narration was wrong, and the renderer is the last choke point before the user.

## Follow-ups

- Optional: a Dify prompt note telling the model to copy the tool URL verbatim (belt-and-braces; the renderer fix is the guarantee)
- Assessment's [NEEDS CLARIFICATION] on the raw answer text remains open; the fix is robust to any host the model invents
