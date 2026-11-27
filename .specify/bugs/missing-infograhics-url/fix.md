# Bug Fix: Profiled infographic URLs 404 — `p/<slug>/` forwarded upstream

- **Slug**: missing-infograhics-url
- **Fixed**: 2026-11-27T10:20:00+08:00
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The proxy forwarded the app-level `p/<slug>/` namespace segment to the infographic server, which only understands `/infographics/<id>[/asset]` — every profiled link 404'd. The route now strips the segment after the ownership check and requests the bare-id form upstream (directory form for bare ids, exact suffix for assets).

## Changes

| File | Change | Notes |
|------|--------|-------|
| `ai-chat-landing/app/infographics/[[...path]]/route.ts` | modified | upstream path built from `m[2]` (bare id) + `m[3]` (asset suffix) instead of the full joined path; `p/<slug>/` never reaches upstream; ALSO fixed the path regex whose trailing group was non-capturing (asset suffixes were silently dropped — a second latent bug found by the new test) |
| `ai-chat-landing/app/infographics/[[...path]]/route.test.ts` | added 2 tests | fetch-stub tests asserting the forwarded upstream URL contains no `/p/` segment, for bare-id (directory form) and asset form |

## Diff Highlights

```ts
const asset = m[3] ?? ""
const upstreamPath = "/infographics/" + m[2] + (asset || "/")
```

## Tests Added or Updated

- `strips the p/<slug>/ segment before proxying, bare id → directory form` — forwarded URL is `/infographics/<id>/`, no `/p/`
- `strips the profiled prefix for asset paths too` — forwarded `/infographics/<id>/img.js`; this test exposed the non-capturing regex group

## Local Verification

- Commands: `pnpm vitest run app/infographics/[[...path]]/route.test.ts` → 8 passed; full `pnpm test` → 330 passed (59 files); `pnpm typecheck` clean; `pnpm lint` 0 errors
- Live: plain `/infographics/4cafe75efa03/` → 200; profiled URL anonymously → 403 (ownership, correct); the owner session will get the 200 page (the upstream 404 from the bug report no longer occurs — verified by the forwarded-path tests)

## Deviations from Assessment

None — the assessment's preferred remediation was applied exactly. One additional latent defect was found and fixed within the same files: PATH_RE's trailing `(?:\/.*)?` was non-capturing, so `m[3]` was always undefined and asset suffixes were dropped (every asset request would have hit the directory form).

## Follow-ups

- Owner-side live click-through (same as spec-052 T012): open a profiled URL signed in to confirm the 200 page end-to-end
