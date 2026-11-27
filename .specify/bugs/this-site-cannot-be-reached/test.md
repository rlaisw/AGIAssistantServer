# Bug Verification: Model-mangled infographic links — absolute URL emission

- **Slug**: this-site-cannot-be-reached
- **Tested**: 2026-11-27T10:52:00+08:00
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

A live chat turn now produces a complete, correct infographic URL in the answer (`https://agia.tvb.com.hk/infographics/27c45a7ec052/`), and that URL opens with HTTP 200 through the chat origin. The mangled-host family (fabricated `infographics`/`infographics.local`, dropped prefixes) is closed at the source.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix, live chat turn) | Dify chat turn asking for an infographic; regex the answer for links | pass | answer link = `https://agia.tvb.com.hk/infographics/27c45a7ec052/` — complete absolute URL, correct host, no fabricated paths (28 events, conv `a80d5521…`) |
| Reproduction (post-fix, link opens) | curl the answer's link through the origin | pass | HTTP 200 |
| Tool emission (live, direct) | `mcp_call antv_infographic` | pass | `https://agia.tvb.com.hk/infographics/p/raymond-lai-tvb-com-hk/9b6151978f6d/` (profiled) + plain form |
| New / updated tests | `pytest tests/unit -q` | pass | 1373 passed (incl. absolute-emission + origin-validation) |
| Regression suite | `pnpm test`, `pnpm typecheck` | pass | 330/330; clean |
| Old answer control | (none run) | skipped | old conversations keep their broken links by design — renderer rewrite covers only links that still contain `/infographics/` |

## Output Excerpts

- `links: ['https://agia.tvb.com.hk/infographics/27c45a7ec052/']`, `answer-link=200`, `1373 passed`, `Tests 330 passed`

## Residual Risks

- `deploy verify`'s `antv-infographic` scenario fetches `result["url"]` from this host; with absolute URLs it now hits the WSL mirrored-DNS quirk (`agia.tvb.com.hk` → LAN IP, unreachable from inside). The scenario should fetch `http://127.0.0.1:28080` + the URL's path. One-line battery follow-up; not a product bug.
- Model transcription of an absolute URL is now trivially copy-paste; if a model still mangles it, the renderer rebuild normalizes any href that retains the `/infographics/` substring.

## Recommendation

Close the bug — verified end-to-end with a live model turn: the emitted link is complete, correct, and opens. File the battery-scenario DNS follow-up separately.
