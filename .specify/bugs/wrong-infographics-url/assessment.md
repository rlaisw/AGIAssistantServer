# Bug Assessment: Infographic answer link emitted with host `infographics.local`

- **Slug**: wrong-infographics-url
- **Created**: 2026-11-27T10:05:00+08:00
- **Source**: pasted text
- **Verdict**: likely valid, needs reproduction
- **Severity**: high

## Report (verbatim or summarized)

User pasted: `"wrong url : https://infographics.local/infographics/p/raymond-lai-tvb-com-hk/0ef874ea67fc/"`.

## Symptom

The chat answer presented an infographic link on the fictional host `infographics.local` instead of the chat origin; clicking it cannot open the infographic.

## Reproduction

1. Ask the chat for an infographic (infographic `0ef874ea67fc` exists and serves 200 upstream — the content is an iOS-upgrade roadmap).
2. Observe the answer's link host is `infographics.local` instead of the app origin.
3. [NEEDS CLARIFICATION: which answer/conversation produced this URL — capture the raw answer text to see the exact emitted string]

## Suspected Code Paths

- `src/agentic_rag_mcp/antv/infographic.py:97` — the tool emits a relative path (`/infographics/p/<slug>/<id>/`), verified live; the tool cannot have produced a host literal.
- Dify agent model — the model, not the tool, may have narrated/hallucinated a plausible-looking hostname when writing the markdown link around the relative URL.
- `ai-chat-landing/components/markdown.tsx` — link rendering path (renders what the model emits).
- The relative-URL design itself is behaving: a relative URL is resolved against the CURRENT PAGE'S host. If the answer is consumed in a non-app context (an MCP client test harness, the Dify backend, or an API response), `infographics.local` suggests a relative resolution against a synthetic Host header or a model-hallucinated host.

## Root Cause Hypothesis

The MCP tool returns `/infographics/p/raymond-lai-tvb-com-hk/0ef874ea67fc/` (relative). In the Dify agent answer the model wraps it as a markdown link. Two plausible causes: (a) the model fabricated the hostname `infographics.local` when composing the markdown link around the relative URL, or (b) some intermediate consumer resolved the relative URL against a synthetic host. The upstream id exists and serves; slug is correct; profiled path shape is correct — only the HOST is wrong. Confidence: medium.

## Proposed Remediation

**Preferred**: enforce absolute-URL emission at the boundary — make the sidecar emit an absolute same-origin-safe URL cannot work (the tool doesn't know the public host), so instead:
- Add a link-lint in the answer path (`honesty_check` or the finalizer): any markdown link whose host is not the app origin or a relative path gets normalized/flagged.
- Additionally consider emitting the URL with an explicit origin prefix configured server-side (`INFOGRAPHIC_PUBLIC_BASE=https://agia.tvb.com.hk`) so the model copies a complete URL verbatim.

**Files likely to change**:
- `src/agentic_rag_mcp/antv/infographic.py` (optional absolute-emission via config)
- possibly `src/agentic_rag_mcp/server.py` honesty_check/finalizer
- possibly the Dify prompt (link handling rule)

**Tests to add or update**:
- Contract test: tool output always a path; if absolute-emission added, that it matches the configured origin.
- A check in the answer pipeline flagging off-origin infographic hosts.

## Risks & Considerations

- Changing emission to absolute URLs requires knowing the public origin in sidecar config (env var through container env).
- Prompt hardening reduces but cannot fully prevent model-fabricated hosts; a code-level guarantee (relative path stays untouched) is preferable.

## Open Questions

- [NEEDS CLARIFICATION: exact raw answer text / where the link was clicked from]

## URL Trust Policy Record

No fetch was performed. The quoted link's host `infographics.local` is a fictional TLD; it is recorded as data, not fetched. Policy branch: `auto-refused: fictional/unresolvable host in quoted user content`.

## Unverified

(none — no URL fetch was attempted)
