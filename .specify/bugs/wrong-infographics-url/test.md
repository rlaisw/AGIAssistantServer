# Bug Verification: Infographic link emitted with fabricated host

- **Slug**: wrong-infographics-url
- **Tested**: 2026-11-27T10:10:00+08:00
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The fabricated-host link from the report (`https://infographics.local/...`) now resolves to the same-origin profiled path at render time; the fabricated host is unreachable (as expected) while the rebuilt target serves. No regressions across the suite.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix, automated equivalent) | `pnpm vitest run lib/infographic-link.test.ts` — includes the exact reported URL case | pass | 9/9; `infographics.local` URL rebuilds to `/infographics/p/raymond-lai-tvb-com-hk/0ef874ea67fc/` |
| New / updated tests | included in full suite | pass | 4 new regression cases |
| Regression suite | `pnpm test` | pass | 59 files, 328 tests |
| Lint / type-check | `pnpm typecheck`, `pnpm lint` | pass | clean; 0 errors (1 pre-existing warning) |
| Live target check | curl the rebuilt URL via the origin | pass | same-origin profiled URL serves (403 for anonymous per FR-007; owner session is the 200 path) |
| Fabricated host | curl `https://infographics.local/...` | expected fail | unresolvable — the very symptom |

## Output Excerpts

- `Tests 9 passed` (infographic-link), `Test Files 59 passed` / `Tests 328 passed`, `✖ 1 problem (0 errors, 1 warning)` (pre-existing)

## Residual Risks

- The model-narration that fabricated the host cannot be deterministically reproduced (model behavior); the renderer-level guarantee makes it harmless, and any future link family outside `/infographics/` is not covered by this fix.
- Full chat-answer E2E with a live model-emitted fabricated host was not re-run (needs a model turn); the renderer is the deterministic choke point and is directly tested.

## Recommendation

Close the bug — verified at the deterministic renderer level with the exact reported URL; end-to-end link opening follows from the route checks already in place.
