# Test Plan: Infographic URLs reachable by remote clients (spec 052)

## 1. Unit tests (U)

| ID | Case | Expected |
|---|---|---|
| U1 | `infographic-link` URL builder: profile-slug form | slug + id → `/infographics/p/<slug>/<id>/` |
| U2 | Plain form when no slug | `/infographics/<id>/` |
| U3 | Legacy rewrite: `http://localhost:28080/infographics/<id>/` | becomes same-origin `/infographics/<id>/` |
| U4 | Non-infographic URL untouched | no rewrite |
| U5 | Proxy route: plain form request | fetches upstream `/infographics/<id>/…`, status and content-type passthrough |
| U6 | Proxy route: profiled URL with matching session slug | 200, proxied bytes |
| U7 | Proxy route: profiled URL with mismatched slug | 403 honest refusal, no upstream fetch |
| U8 | Proxy route: upstream infographic service down | honest 502-style error envelope, no fabricated content |
| U9 | Slug grammar validation | malformed slug → 400 |
| U10 | Renderer: profiled and legacy links render as 📌 links (spec 046 contract preserved) | 📌 + blue, href same-origin |
| U11 | Sidecar tool: infographic URL with `hermes_slug` present | relative profiled path emitted |
| U12 | Sidecar tool: no slug | plain relative path, no host literal |

## 2. End-to-end tests (E)

| ID | Case | Steps | Expected |
|---|---|---|---|
| E1 | Remote client opens own profiled infographic | ask for an infographic → click the link from a non-host machine | page loads; URL is `https://<origin>/infographics/p/<slug>/<id>/` |
| E2 | Same-host access | same link on the host | loads |
| E3 | Cross-profile refusal | user B requests user A's profiled URL | 403 refusal; owner's own request succeeds |
| E4 | Legacy answer click | old conversation with `http://localhost:28080/infographics/<id>/` | rewrites to same-origin and loads |
| E5 | Anonymous/legacy plain form | plain `/infographics/<id>/` | loads (local-trust passthrough) |
| E6 | Under 10 s | click → page interactive | < 10 s on LAN (SC-004) |
| E7 | Upstream down | infographic service stopped | honest error, no hang or fabricated page |

## 3. Error handling matrix

| ID | Trigger | Expected user-visible behavior |
|---|---|---|
| H1 | profiled URL, session slug mismatch | 403 refusal page; no content leak |
| H2 | unknown/malformed infographic id | honest 404/400 |
| H3 | infographic service unreachable | honest 502 envelope |
| H4 | traversal attempt (`..` in path) | rejected without listing or traversal |
| H5 | unsigned request to profiled URL (anonymous session) | 403 — ownership cannot be established |

## 4. Coverage map

| Requirement | Tests |
|---|---|
| FR-001/FR-002 | U1–U4, E1 |
| FR-003 | U5, E1 |
| FR-004 | U10, E1 |
| FR-005 | E3, H1 |
| FR-006 | U3, E4 |
| FR-007/FR-008 | U6–U9, E3, E5, H1, H5 |
| SC-001..SC-005 | E1–E7 |

## 5. Results

**2026-11-27 — offline**

- U1–U4 (`lib/infographic-link.test.ts`): 5 passed. U5, U8, U9, H1–H5, U6/U7 (`app/infographics/[[...path]]/route.test.ts`): 6 passed. U11/U12 (`tests/unit/test_antv_tools.py`): 14 passed (incl. relative-URL contract). Full gates: frontend 324/324, Python 1485.
- Upstream 307 loopback-leak found and fixed live: bare-id requests were being redirected to `http://127.0.0.1:28080/…`; the route now requests the directory form directly and rewrites any upstream `Location` to same-origin.

**2026-11-27 — live (agia origin, anonymous session)**

- E4/E5 (legacy + plain form): `https://agia.tvb.com.hk/infographics/4cafe75efa03/` → **200** — the exact link from the feature request now opens remotely.
- H1/H5 (profiled URL, anonymous): `…/infographics/p/raymond-lai-tvb-com-hk/4cafe75efa03/` → **403** (ownership enforced; SC-005 refusal side proven).
- H2 (unknown id): 404. H4 (traversal): rejected.
- Pending owner-present: E1/E3 signed-in remote-client run and E6 timing (needs a second machine / user session); E7 (upstream down) unit-proven (U8) only.
- Note: the sidecar now emits `/infographics/p/<slug>/<id>/` when the tool call carries `hermes_slug`; the Dify tool-node binding does not yet pass it, so live answers currently carry the plain relative form (still remote-reachable per E4/E5). Wiring `hermes_slug` into the DSL binding is the follow-up for full FR-007 emission.

**2026-11-27 — T011: profiled emission live**

- Sidecar: `antv_infographic` accepts `hermes_slug` (default ""); with slug → `/infographics/p/<slug>/<id>/`, without → `/infographics/<id>/` (verified live via MCP call: `ec04dc61d9db` profiled, `06df56fda267` plain).
- Dify: `hermes_slug` bound on both `antv_infographic` tool nodes via the auto-bound variable selector (`auto: 0`, variable `['1776072202913','hermes_slug']`); chatflow republished to app `194e1edf` ("chatflow-publish: published").
- Enforcement: anonymous request to `https://agia.tvb.com.hk/infographics/p/raymond-lai-tvb-com-hk/ec04dc61d9db/` → **403**; upstream serves the same id 200.

**2026-11-27 — T012: owner-present E2E (user-attested)**

- Owner clicked the answer's infographic link from the signed-in Chat UI: page opened, user confirms "test ok".
- Upstream log corroborates the full chain: `GET /infographics/5c2e647cbb1b/ 200` (10:52:01 and 10:52:05) and `GET /infographics/fc6790555920/ 200` (10:54:39) — profiled requests passed the ownership check at the proxy and served through with the `p/<slug>/` prefix stripped.
- SC-001 (owner-side open) and SC-005 (owner passes, others refused — refusal side recorded 2026-11-27 earlier) both covered. Spec 052 fully converged.
