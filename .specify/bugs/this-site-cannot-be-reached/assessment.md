# Bug Assessment: Infographic link loses its path — fabricated host `infographics` with no `/infographics/` segment

- **Slug**: this-site-cannot-be-reached
- **Created**: 2026-11-27T10:27:00+08:00
- **Source**: pasted text (includes a quoted URL)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

User pasted: `"https://infographics/raymond-lai-tvb-com-hk/10300ee11010/  this site cannot be reached"`.

## Symptom

Clicking the infographic link in the answer opens nothing — the browser tries to resolve the host `infographics`, which does not exist. The infographic itself is fine: id `10300ee11010` exists upstream and serves 200.

## Reproduction

1. The answer's link is `https://infographics/raymond-lai-tvb-com-hk/10300ee11010/` — host `infographics`, path `<slug>/<id>` with **no `/infographics/` segment at all**.
2. Browser DNS for host `infographics` fails → "this site cannot be reached".
3. Upstream check: `curl http://127.0.0.1:28080/infographics/10300ee11010/` → 200 — the target infographic exists; only the link text is wrong.

## Suspected Code Paths

- Dify agent model narration — third instance of the same family: the tool returned `/infographics/p/raymond-lai-tvb-com-hk/10300ee11010/` (relative) and the model mangled it when composing the markdown link: fabricated host `infographics` AND dropped the `/infographics/p/` prefix.
- `ai-chat-landing/lib/infographic-link.ts` — the fabricated-host fix (bug wrong-infographics-url) only rewrites hrefs **containing `/infographics/`**; this URL has no such substring, so `isInfographicLink` is false and the link passes through untouched.
- `src/agentic_rag_mcp/antv/infographic.py:97` — the tool emits a relative URL; the model repeatedly fails to transcribe relative URLs faithfully.

## Root Cause Hypothesis

Model narration around relative URLs: given `/infographics/p/<slug>/<id>/`, the model has twice invented hosts (`infographics.local`, now `infographics`) and this time also dropped the path prefix. The renderer hardening can't catch shapes that no longer contain `/infographics/`. The deterministic fix is at the source: emit a fully-qualified absolute URL from the tool so the model copies it verbatim. Confidence: high (third instance of the family; both prior variants fixed at renderer level only).

## Proposed Remediation

**Preferred**: configure a public origin for infographic URLs in the sidecar (env var, e.g. `INFOGRAPHIC_PUBLIC_ORIGIN=https://agia.tvb.com.hk`, plumbed through deploy config and container env) and emit `f"{origin}/infographics/p/<slug>/<id>/"` from `create_infographic` when set, falling back to today's relative form when unset. The model then transcribes a complete URL; the renderer's existing rebuild normalizes anything it still mangles (hosts are stripped for any href containing `/infographics/`).

**Alternatives**:
- Extend the renderer to catch `/<slug>/<10-hex-id>` shaped links — rejected: pattern-matching prose-shaped links is fragile and can false-positive on unrelated links.
- Prompt hardening ("copy the URL verbatim") — belt-and-braces only; no deterministic guarantee.

**Files likely to change**:
- `src/agentic_rag_mcp/config.py` (new setting)
- `src/agentic_rag_mcp/antv/infographic.py` (absolute emission)
- `dify/docker` compose env / deploy config for the container variable
- `tests/unit/test_antv_tools.py` (emission tests with/without origin)

**Tests to add or update**:
- Tool emits `{origin}/infographics/p/<slug>/<id>/` when origin set; relative when unset.
- Renderer test: absolute-origin profiled URL still rebuilds to same-origin href (existing behavior pinned).

## Risks & Considerations

- The origin must match the deployed host; wrong value would break links — validate at config load (must be an `https?://` origin with no path).
- Existing renderer normalization keeps working regardless.

## Open Questions

- [NEEDS CLARIFICATION: none — the infographic id exists upstream; the link text alone is wrong]

## URL Trust Policy Record

- Verbatim URL: `https://infographics/raymond-lai-tvb-com-hk/10300ee11010/`
- Parsed host: `infographics` (fictional, unresolvable)
- Policy branch: `auto-refused: fictional/unresolvable host in quoted user content` — not fetched.
