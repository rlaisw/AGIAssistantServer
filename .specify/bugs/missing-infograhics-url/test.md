# Bug Verification: Profiled infographic URLs 404 — `p/<slug>/` forwarded upstream

- **Slug**: missing-infograhics-url
- **Tested**: 2026-11-27T10:19:00+08:00
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

The fix is pinned by tests (forwarded upstream URL asserted free of the `p/<slug>/` segment) and no upstream 404s with the profiled prefix have occurred since the fix landed (last one 10:14, fix at ~10:18). The end-to-end owner-path reproduction — a signed-in session opening the profiled URL — has not yet been exercised live; honest verdict: partial pending that click.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix, upstream log) | `docker logs agentic-rag --since 10m` | pass | last `/infographics/p/…` 404 at 10:14:32 (pre-fix); none after the fix |
| Reproduction (post-fix, live anonymous) | curl profiled URL | pass (expected 403) | anonymous requests stop at the ownership gate — correct behavior, not the 404 path |
| New / updated tests | `pnpm vitest run app/infographics/[[...path]]/route.test.ts lib/infographic-link.test.ts` | pass | 17/17; fetch-stub asserts forwarded URL = `/infographics/<id>[/asset]`, no `/p/` |
| Regression suite | `pnpm test` | pass | 59 files, 330 tests |
| Lint / type-check | `pnpm typecheck` | pass | clean |
| Plain-form control | curl `/infographics/4cafe75efa03/` | pass | 200 through the proxy |

## Output Excerpts

- `Test Files 59 passed` / `Tests 330 passed`; upstream log final pre-fix hit: `GET /infographics/p/raymond-lai-tvb-com-hk/4cafe75efa03/ HTTP/1.1" 404 (10:14:32)`; post-fix: none.

## Residual Risks

- The owner-side live path (session passes ownership → proxy → upstream 200) is proven by mocked tests only; the real signed-in click is outstanding (same item as spec-052 T012).
- Trailing-slash interplay (Next 308 ↔ upstream 307) remains for no-slash requests; handled by requesting the directory form directly.

## Recommendation

Hold for one owner click — open `https://agia.tvb.com.hk/infographics/p/raymond-lai-tvb-com-hk/4cafe75efa03/` signed in; a 200 closes both this bug (to verified) and spec-052 T012. Everything else is verified.

## Addendum 2026-11-27 10:55 — result upgraded: partial → verified

Owner click-through exercised live: the signed-in user opened the profiled infographic link ("test ok"); upstream log shows the ownership gate passing and the stripped path serving 200 (`5c2e647cbb1b` ×2, `fc6790555920`). The one outstanding live path is now closed.
