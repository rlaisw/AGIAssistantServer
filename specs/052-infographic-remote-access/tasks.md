---
description: "Task list: Infographic URLs reachable by remote clients"
---

# Tasks: Infographic URLs reachable by remote clients

**Input**: Design documents from `specs/052-infographic-remote-access/`

**Tests**: Included — test-plan.md defines unit and E2E cases (user asked for tests explicitly).

## Phase 1: Setup

- [X] T001 Add infographic URL builder + legacy-rewrite helpers in `ai-chat-landing/lib/infographic-link.ts` (extend existing module): profiled form `/infographics/p/<slug>/<id>/`, plain form `/infographics/<id>/`, and a rewrite for `http://localhost:28080/infographics/…` legacy URLs; unit tests in `lib/infographic-link.test.ts` for U1–U4 (cites data-model.md `ProfiledInfographicURL.slug` — grammar `[a-z0-9-]+`, must equal the session slug else 403)

## Phase 2: User Story 1 — Remote client opens an infographic link (P1) 🎯 MVP

**Goal**: infographic links emitted into answers are relative, same-origin, and open from any client.

**Independent test**: E1 — generate an infographic and open its link from a non-host machine.

- [X] T002 [US1] Change the `antv_infographic` tool result URL in `src/agentic_rag_mcp/` to emit a relative path (`/infographics/p/<slug>/<id>/` when the tool call carries `hermes_slug`, else `/infographics/<id>/`) with a contract test; no host literal (FR-002, FR-007/FR-008)
- [X] T003 [US1] Create `ai-chat-landing/app/infographics/[[...path]]/route.ts` proxying GET to the sidecar `http://127.0.0.1:28080/infographics/…` with status/content-type passthrough and streaming (no listing, no traversal) per `contracts/proxy-route.md` (cites data-model.md `ProfiledInfographicURL.slug` — grammar `[a-z0-9-]+`, must equal the session slug else 403)
- [X] T004 [US1] Route tests U5, U8, U9, H2, H3, H4 in `app/infographics/[[...path]]/route.test.ts` (plain passthrough, upstream-down honest 502, malformed slug/id, traversal rejection)

**Checkpoint**: infographic links reachable same-origin (SC-001, SC-002).

## Phase 3: User Story 1b — Enforced ownership (P1)

**Goal**: profiled URLs are private to the owning session.

**Independent test**: SC-005 — cross-profile request refused.

- [X] T005 [US1] Enforce ownership in the route: resolve session slug via `requestIdentity` (spec 050/051 chain), 403 on mismatch or anonymous access to a profiled URL (FR-007); tests U6, U7, H1, H5
- [X] T006 [US1] Update `components/markdown.tsx` to render the profiled/relative links and rewrite legacy `http://localhost:28080/…` URLs to same-origin (FR-006); renderer test U10, E4

**Checkpoint**: ownership enforced; legacy answers clickable (SC-003, SC-005).

## Phase 4: User Story 2 — Nothing regresses (P2)

**Independent test**: US2/AC1–AC2.

- [X] T007 [US2] Run the E2E acceptance: E1–E7 with the quickstart.md scenarios; record results in `specs/052-infographic-remote-access/test-plan.md` §5
- [X] T008 [US2] Verify infographic generation/content unchanged: `antv_infographic` unit tests + battery `antv-infographic` scenario pass; spec-046 renderer contract test passes

## Phase 5: Polish

- [X] T009 Update `specs/052-infographic-remote-access/test-plan.md` §5 with live results; AGENTS.md/README note if URL contract documented
- [X] T010 Full gates: `pnpm test/typecheck/lint`, Python suite; `deploy redeploy` for the sidecar URL change; graphify update; commit

## Dependencies

- T001 before T006; T002 independent of T003; T003 before T004; T003+T005 same file (sequential); T006 after T001; T007–T008 after all of Phase 2–3.

## MVP

Phase 1 + Phase 2 (T001–T004) delivers a remote-clickable infographic link; ownership (T005–T006) completes the user's chosen Level 1.

## Phase 6: Convergence

- [X] T011 Wire `hermes_slug` into the Dify `antv_infographic` tool node binding per FR-007 (partial): add the parameter to the tool's MCP schema in `dify/AGIAssistant/AGI_Assistant.yml` using the auto-bound variable selector (`auto: 0` plus nested `value: {type: variable, value: [sys, …]}` or the conversation's `hermes_slug` variable — never `{{#…#}}` template constants, per the Dify binding invariant), republish the Chat UI lane app by explicit ID `194e1edf-2eba-442c-b10b-231bebb79c37`, and verify a live answer's infographic URL is the profiled `/infographics/p/<slug>/<id>/` form
- [X] T012 Record the owner-present E2E per SC-001/SC-005 (partial): from a signed-in session (and a second machine if available), open your own profiled infographic URL (owner side passes), attempt another user's profiled URL (refused), and write the E1/E3/E6 results into `specs/052-infographic-remote-access/test-plan.md` §5
