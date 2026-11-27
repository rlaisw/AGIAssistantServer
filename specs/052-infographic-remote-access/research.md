# Research: Infographic remote reachability (spec 052)

## R1 — Where the infographic URL is built

**Decision**: change at the source — the sidecar tool returns a relative path; the renderer resolves it against the page origin.

**Rationale**: `src/agentic_rag_mcp/config.py` exposes `exports_url_base = "http://localhost:28080/exports"` and the `antv_infographic` tool builds the answer link as an absolute loopback URL. A relative path (`/infographics/p/<slug>/<id>/`) removes the host literal entirely and works on any origin that fronts the app, which is exactly FR-002.

**Alternatives**: (a) rewrite in the Chat UI only — leaves the tool emitting loopback URLs for other consumers; rejected: the tool itself violates FR-002. (b) absolute URL with the deployed host — reintroduces a host literal; rejected per FR-002.

## R2 — How clients reach the pages

**Decision**: same-origin proxy route in the Chat UI.

**Rationale**: the sidecar port (28080) is host-only; remote browsers cannot reach it. The image-proxy and deck/export URL families already prove the proxy pattern. The proxy maps `/infographics/…` 1:1 onto the sidecar's `/infographics/…` (FR-003).

**Alternatives**: exposing 28080 externally — rejected (FR-005).

## R3 — Ownership enforcement point

**Decision**: in the proxy route: `/infographics/p/<slug>/…` resolves the session's slug from the spec-050/051 identity chain (`requestIdentity` → oidHash → registry lookup) and returns 403 on mismatch; plain `/infographics/<id>/…` passes through (FR-007/FR-008).

**Alternatives**: enforcement in the sidecar — rejected: the sidecar has no session context; enforcement belongs where identity is known.

## R4 — Legacy answers

**Decision**: rewrite at render time in `lib/infographic-link.ts` — any `http://localhost:28080/infographics/…` in answer text becomes the same-origin form. No data migration.

**Rationale**: FR-006; Dify history cannot be rewritten safely in place.

## R5 — Slug availability at generation time

**Decision**: the tool call carries `hermes_slug` (spec 051 variable set); when absent (anonymous/legacy lane) the plain `/infographics/<id>/` form is emitted (FR-008).
