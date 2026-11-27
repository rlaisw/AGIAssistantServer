# Bug Assessment: Profiled infographic URLs 404 — proxy forwards the `p/<slug>/` segment upstream

- **Slug**: missing-infograhics-url
- **Created**: 2026-11-27T10:16:00+08:00
- **Source**: pasted text
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

User pasted: `"missing infograhics url"`. Sidecar access logs show the failing click attempts: `GET /infographics/p/raymond-lai-tvb-com-hk/4cafe75efa03 HTTP/1.1" 404` (10:06, 10:08).

## Symptom

Clicking a profiled infographic link (`/infographics/p/<slug>/<id>/`) returns 404 — the infographic page never opens, appearing as if the URL is missing/broken. Plain-form links (`/infographics/<id>/`) still work.

## Reproduction

1. Open `https://agia.tvb.com.hk/infographics/p/raymond-lai-tvb-com-hk/4cafe75efa03/` (any profiled URL).
2. The proxy forwards the request to the sidecar as `/infographics/p/<slug>/<id>` — confirmed live: `curl http://127.0.0.1:28080/infographics/p/raymond-lai-tvb-com-hk/4cafe75efa03/` → **404**, while `/infographics/4cafe75efa03/` → **200**.
3. The 404 page is what the user sees.

## Suspected Code Paths

- `ai-chat-landing/app/infographics/[[...path]]/route.ts:27` — `upstreamPath = "/infographics/" + joined` builds the upstream path from the FULL request path including the `p/<slug>/` namespace segment; the infographic server only understands `/infographics/<id>/…` and 404s anything else.
- The earlier bare-id 307 fix masks the plain form but never addressed the profiled form (U6's mocked test never reached the upstream call — the ownership-check tests short-circuit before proxying).

## Root Cause Hypothesis

The proxy route rewrites ownership but not the path: the `p/<slug>/` prefix is an application-level namespace (spec 052 FR-007) that must be **stripped** before proxying; the upstream serves only `/infographics/<id>[/asset]`. Live evidence confirms: profiled path → upstream 404; plain path → 200. Confidence: high.

## Proposed Remediation

**Preferred**: in the route, after the ownership check, drop the `p/<slug>/` segment when constructing the upstream path: `upstreamPath = "/infographics/" + (asset part of joined after the id) prefixed by the bare id`, e.g. `joined = "p/slug/<id>/x.js"` → upstream `/infographics/<id>/x.js`. Always request the directory form for bare ids (existing behavior). Update the U6 mock test to exercise the full proxy path with a stubbed upstream, asserting the forwarded URL has no `p/` segment.

**Files likely to change**:
- `ai-chat-landing/app/infographics/[[...path]]/route.ts`
- `ai-chat-landing/app/infographics/[[...path]]/route.test.ts`

**Tests to add or update**:
- U6-extended: stub `fetch` (upstream) and assert the forwarded URL is `/infographics/<id>/…` with the profiled prefix removed, for bare-id and asset forms.

## Risks & Considerations

- The trailing-slash interplay (Next 308 strip ↔ upstream 307 add) still exists for no-slash profiled requests; requesting the directory form directly for bare profiled ids avoids the loop.

## Open Questions

- [NEEDS CLARIFICATION: none — the failure is fully reproduced and understood]
