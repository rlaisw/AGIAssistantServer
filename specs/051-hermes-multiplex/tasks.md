---

description: "Tasks for the Hermes multi-profile gateway (Phase 2)"
---

# Tasks: Hermes Multi-Profile Gateway (Phase 2)

**Input**: `specs/051-hermes-multiplex/` (spec, plan, research, data-model, contracts, quickstart, test-plan)
**Tests**: explicitly requested — every behavior task is **test-first** (write the cited case, watch it fail, implement, then gates green).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no incomplete dependency
- **[Story]**: US1 / US2 / US3 / US4 in story phases only
- Every task names the exact file path

## Path Conventions

- Host provisioner + chat scoping: `ai-chat-landing/` (Next.js, runs on the host as the Hermes owner)
- Sidecar: `src/agentic_rag_mcp/` — follows the existing **flat module** convention (`hermes_client.py`, `hermes_audit.py`), not a new package
- Sidecar container: `src/agentic_rag_mcp/deploy/docker_ops.py`
- Tests: `ai-chat-landing/lib/profiles/*.test.ts`, `tests/unit/test_hermes_profiles.py`, `tests/contract/test_hermes_profile_routing.py`

---

## Phase 1: Setup

- [X] T001 Add the provisioner configuration (`PROFILES_PROVISION_TOKEN`, `HERMES_PROFILES_DIR`, `HERMES_TEMPLATE_PROFILE`, `HERMES_WIN_USER`) to `ai-chat-landing/README.md` and read them through a new `ai-chat-landing/lib/profiles/config.ts`, failing fast on a missing token or template
- [ ] T002 [P] Extract the inline sidecar stubs used by `tests/unit/test_hermes_profiles.py` and `tests/contract/test_hermes_profile_routing.py` into shared fixtures: `tests/fixtures/stub_hermes.py` (records argv, creates `profiles/<slug>/{config.yaml,.env}` with a generated `API_SERVER_KEY`, failure switches `FAIL_CREATE`/`FAIL_USERMD`/slow mode) and `tests/support/fake_gateway.py` (HTTP server responding 200/401/403/404/429/503 and recording path + presented key)
- [ ] T003 [P] Extract the inline TypeScript stubs used by the profile tests into shared fixtures: `ai-chat-landing/tests/support/stub-hermes` executable, `ai-chat-landing/tests/support/fake-gateway.ts`, and `ai-chat-landing/lib/profiles/testing/tmpdir.ts` (temporary profiles root + registry path per test)
- [ ] T004 [P] Extract identity fixtures into `tests/support/identities.ts` and `tests/fixtures/profiles/` (valid, corrupt, duplicate-slug, absent/v0 registry) covering the three TVB domains for one local part
- [X] T005 Add the read-only profiles mount and provisioner env to the sidecar container definition in `src/agentic_rag_mcp/deploy/docker_ops.py` (`/home/administrator/.hermes/profiles:/hermes-profiles:ro`, `HERMES_PROFILES_DIR`, `HERMES_PROVISION_URL`, `HERMES_PROVISION_TOKEN`)

## Phase 2: Foundational (blocking for every story)

- [X] T006 Write `ai-chat-landing/lib/profiles/identity.ts` with tests in `identity.test.ts` (U1, U2): `oidHash` = first 16 hex of SHA-256(`oid`), and slug validation `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$` rejecting uppercase, `/`, `..`, empty, >64 (data-model.md `ProfileIndexEntry.oidHash`, `ProfileIndexEntry.slug`)
- [X] T007 Write `ai-chat-landing/lib/profiles/registry.ts` with tests in `registry.test.ts` (U3–U7): one entry per `ProfileIndexEntry.oidHash` and per `ProfileIndexEntry.slug` (data-model.md), status enum `active|disabled`, `flock` + temp-file + `fsync` + atomic rename, corrupt-file refusal, `--validate`/`--rebuild-from-profiles` helpers; no key material ever
- [X] T008 Write the shared error taxonomy in `ai-chat-landing/lib/profiles/errors.ts` and its Python mirror in `src/agentic_rag_mcp/hermes_profiles.py` (`ProfileError` with E1–E16 codes, status, honest message, retryable) with mapping tests (U28)
- [X] T009 Write `ai-chat-landing/lib/profiles/provision.ts` with tests in `provision.test.ts` (U8, U9, U11): exact `hermes profile create <slug> --clone-from <template>` argv, `memories/USER.md` containing `Display Name:`, `Email:`, `Windows user:` and no key, and rollback removing the home when the USER.md write fails (data-model.md `ProfileHome` memories/USER.md fields; `ProfileIndexEntry.winUser`)
- [X] T010 Implement `ai-chat-landing/app/api/profiles/ensure/route.ts` with tests (U10, U12, U14): constant-time bearer check, idempotent 201/200, per-`oidHash` lock with 30 s timeout → 409, never returns key/path/raw oid (data-model.md `ProvisioningAttempt` per-identity lock, 30 s)
- [X] T011 Write `src/agentic_rag_mcp/hermes_profiles.py` ensure client with tests in `tests/unit/test_hermes_profiles.py` (U24–U26): 201/200/409 mapping with bounded retry, key read only from `profiles/<slug>/.env`, TTL ≤60 s cache, rotation invalidation, no logging
- [X] T012 Extend `src/agentic_rag_mcp/hermes_client.py` for profile-aware calls with tests (U27, U29): `POST /p/<slug>/v1/responses`, encoded slug, profile key, no fallback to another slug/legacy/anonymous
- [X] T013 Pin the legacy path unchanged in `tests/contract/test_hermes_profile_routing.py` (I10): `/v1/responses` with the shared key returns the same fixture response as before

**Checkpoint**: registry, provisioner, sidecar client and legacy pin green offline; no gateway change yet.

---

## Phase 3: User Story 1 — First use provisions and routes (Priority: P1) — MVP

**Goal**: The first agent-bound request creates exactly one profile and is served by it; the second device reuses it.
**Independent test**: E1 + E2 (or I1/I3 offline).

- [X] T014 [US1] Write the provisioner integration tests (I1–I4) in `ai-chat-landing/lib/profiles/provision.integration.test.ts` against the stub CLI and temp registry, then fix any gaps they expose in `provision.ts`/`ensure/route.ts`
- [X] T015 [US1] Write the sidecar end-to-end integration test (I1, I2) in `tests/contract/test_hermes_profile_routing.py`: ensure → key read → fake gateway receives `/p/<slug>/v1/responses`; second call reuses key and makes no extra CLI call
- [X] T016 [US1] Add the five-concurrent-ensure test (I3) in `ai-chat-landing/lib/profiles/provision.integration.test.ts` proving one profile and one registry entry, and make the `flock`/cache in `ai-chat-landing/lib/profiles/registry.ts` satisfy it
- [X] T017 [US1] Execute quickstart §1–3 on the host (after T060's `deploy redeploy`): create `template-pc` from the current default, **enable `gateway.multiplex_profiles`** (legacy `/v1` still answering), then create a pilot profile and prove `/p/<slug>/v1/responses` with its key, confirming hot-serve within the reconcile window (I13)
- [ ] T018 [US1] Create `ai-chat-landing/scripts/hermes-profile-check.mjs` (owner present) covering E1/E2: first-use provisioning under 10 s, second browser reuses the same slug, throwaway profile removed afterwards; run it and record output

**Checkpoint**: US1 demoable against the real gateway with one pilot user.

---

## Phase 4: User Story 2 — Isolation and per-user history (Priority: P2)

**Goal**: Memory/files are per profile, and each user's sidebar shows only their own conversations.
**Independent test**: E3 + E4 (or I11/I12 offline).

- [X] T019 [US2] Write `ai-chat-landing/lib/profiles/identity-user.ts` with tests (U18): `u-<oidHash>` for signed-in users, empty for anonymous — never the retired `ai-chat-ui-user` (data-model.md `ScopedChat.difyUser`)
- [X] T020 [US2] Update `ai-chat-landing/app/api/chat/route.ts` with tests (U19, I11): add `inputs.hermes_slug|hermes_oid|hermes_email` only when signed in, ignore browser-supplied identity, and send the per-identity Dify `user`; note: the anonymous `user` intentionally becomes `u-anon` (identity inputs stay absent), so only the inputs are unchanged
- [X] T021 [US2] Update `ai-chat-landing/app/api/conversations/route.ts` with tests (U20, I11): filter by the per-identity user; no shared constant remains
- [X] T022 [US2] Add the legacy guard `ai-chat-landing/lib/profiles/legacy.ts` and `ai-chat-landing/scripts/legacy-conversations-export.mjs` with tests (U21, I12): pre-cutover conversations never listed/opened by users; operator export contains them (data-model.md `ScopedChat.legacyUser`, operator export only)
- [ ] T023 [US2] Extend `ai-chat-landing/scripts/hermes-profile-check.mjs` for two users (E3/E4): separate memory/files, cross-profile key/path refused, each sidebar only its own, legacy rows absent
- [X] T024 [US2] Add the boundary-copy check (SC-011): a snapshot/grep test in `ai-chat-landing/lib/profiles/boundary.test.ts` asserting no user-facing text claims per-user Windows or OneDrive isolation, and that the shared-account statement exists

**Checkpoint**: isolation and history scoping proven offline and on the pilot.

---

## Phase 5: User Story 3 — Operator control (Priority: P3)

**Goal**: list/rotate/disable/enable safely, audited, without a gateway restart.
**Independent test**: E5 + E6.

- [X] T025 [US3] Implement and test the status endpoint (U14) in `ai-chat-landing/app/api/profiles/status/route.ts`: slug, status, timestamps, last error — never keys/paths/oid
- [X] T026 [US3] Create `ai-chat-landing/scripts/profiles-rotate.mjs` with tests (U17, E5): new key in the profile `.env`, reconcile signalled, old key dead on the next request, cache invalidated, audit record
- [X] T027 [US3] Create `ai-chat-landing/scripts/profiles-disable.mjs` and `profiles-enable.mjs` with tests (U15, U16, E6): disabled sets status and replaces the key with an unusable value; enable mints a fresh key and restores `active`
- [X] T028 [US3] Create `ai-chat-landing/scripts/profiles-list.mjs` with tests (U22): slug/status/created/last-seen only, plus the audit record per operation
- [ ] T029 [US3] Run the operator flow E5/E6 owner-present using `ai-chat-landing/scripts/profiles-rotate.mjs` and `ai-chat-landing/scripts/profiles-disable.mjs` on a throwaway profile, and record timings against SC-008 in `specs/051-hermes-multiplex/test-plan.md` (<2 minutes per action)

---

## Phase 6: User Story 4 — Failures stay contained and honest (Priority: P4)

**Goal**: every failure path is honest, leaves no partial state, and never affects another profile.
**Independent test**: E7 + E8 (offline I5–I9).

- [X] T030 [US4] Implement the warm check with a bounded 10 s wait and `agent_unavailable` (U13) in `ai-chat-landing/lib/profiles/provision.ts`, leaving the entry `active` for retry; test with the fake gateway
- [X] T031 [US4] Enforce no-fallback in `src/agentic_rag_mcp/hermes_client.py` and test it (U29, I6–I8): after 401/403/404/429/5xx, no call to another slug, the legacy path, or anonymous
- [X] T032 [US4] Implement the corrupt-registry policy (U6, I5) in `registry.ts`: refuse new provisioning with `registry_unavailable`, keep existing routing, surface a repair hint
- [ ] T033 [US4] Add the MCP-offline attribution test (I14, E8) in `ai-chat-landing/scripts/hermes-profile-check.mjs`: tool-level error mapped honestly to the requesting profile, other profile unaffected
- [ ] T034 [US4] Add the gateway-restart resilience test (E7) to `ai-chat-landing/scripts/hermes-profile-check.mjs`: routing resumes after restart, no profile corruption, audit continuity

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T035 [P] Document the feature: `ai-chat-landing/README.md` (profile env, provisioner, mounts), `AGENTS.md` (multiplexing/rollout, profile-owned keys, history scoping), `DEPLOY.md` (mount, flag, pilot-then-enable, legacy key retirement)
- [X] T036 Run the full gates: `cd ai-chat-landing && pnpm test && pnpm typecheck && pnpm lint`; `.venv/bin/python -m pytest tests/unit/test_hermes_profiles.py tests/contract/test_hermes_profile_routing.py -q`
- [X] T037 Security scan (U22/U30 + manual): no key/token/raw oid/email in logs, audit, HTTP responses, or `~/.config/agentic-rag-mcp/hermes-mcp/profiles.json`; record the result in `specs/051-hermes-multiplex/test-plan.md` (data-model.md `AuditEvent` forbidden fields)
- [ ] T038 Scale smoke (E10, owner-approved) with `ai-chat-landing/scripts/profiles-scale-check.mjs`: 100 registered profiles, 10 concurrent requests, no failures, ≤2× single-profile latency
- [ ] T039 Dry-run `quickstart.md` end to end including the rollback section; correct any drift between the runbook and the real CLI/gateway
- [ ] T040 Record acceptance in `specs/051-hermes-multiplex/test-plan.md` (E1–E10 results, scale, rotation timings, SC-001/005/007/008/011) and update the spec Status line

---

## Dependencies

```text
Phase 1 (T001–T005)
  └─> Phase 2 (T006–T013)  blocking
        ├─> US1 (T014–T018)  MVP; T017 needs the host CLI/gateway
        ├─> US2 (T019–T024)  needs T011–T012 (sidecar) and T010 (identity path)
        ├─> US3 (T025–T029)  needs T007, T010
        └─> US4 (T030–T034)  needs T009–T012
              └─> Polish (T035–T040)
```

- Within Phase 2: T006/T007/T008 are independent files; T009 depends on T006–T008; T011/T012 are sidecar-only and parallel to T009/T010.
- US2 and US3 are independent of each other after Phase 2; US4 touches the same files as US1, so it follows US1.

## Parallel execution examples

```text
# Phase 2
T006 identity.ts   ─┐
T007 registry.ts   ─┼─ different files; T009 consumes their types
T008 errors.ts     ─┘
T011 hermes_profiles.py ─┬─ sidecar files, independent of T009/T010
T012 hermes_client.py   ─┘

# Story phases
T019 identity-user.ts   ─┐
T025 status endpoint    ─┼─ different files after Phase 2
T030 warm check         ─┘
```

## Implementation strategy

1. **MVP = US1** (T001–T018): registry + provisioner + sidecar routing on a pilot profile; this is the smallest slice that proves one user, one profile, one path.
2. Test-first per task; offline gates before any host change.
3. Gateway flag is enabled only in T017 after the pilot path is proven; legacy `/v1` stays until the lane-migration step (not in these tasks).
4. US2 then makes history per-user and adds the legacy guard before any real multi-user use.
5. Operator and failure tasks follow; lane migration/legacy-key retirement is a separate change.

## Format validation

- 40 tasks; all have `- [ ]`, a sequential `T0NN` id, and an exact file path.
- `[P]` only where files and prerequisites are independent (T002–T004, T035).
- `[US1]`–`[US4]` appear only in their story phases.
- Every FR-001…FR-026 and SC-001…SC-012 maps to at least one task through the test-plan.

---

## Phase 8: Convergence

- [X] T041 Mint a unique per-profile credential at provisioning per FR-022 (missing): the `template-pc` `.env` MUST contain no `API_SERVER_KEY`; `ai-chat-landing/lib/profiles/provision.ts` generates a 32-byte key, writes it to `~/.hermes/profiles/<slug>/.env` (mode 600) and signals reconcile, and a test in `ai-chat-landing/lib/profiles/provision.integration.test.ts` proves two profiles receive two different keys (closing the clone-copies-`.env` hole in `hermes_cli/profiles.py`) (data-model.md `ProfileHome` `.env` credential, mode 600)
- [X] T042 Enable multiplexing before the pilot path proof per plan: rollout step (contradicts): reorder `specs/051-hermes-multiplex/quickstart.md` §2–3 and plan D7 so `gateway.multiplex_profiles` is enabled first (legacy `/v1` pinned), then `POST /p/<slug>/v1/responses` is proven; rewrite T017's ordering in `specs/051-hermes-multiplex/tasks.md` by the same step, since `/p/` routes do not exist while the flag is off
- [X] T043 Redefine and measure SC-001 as profile readiness per SC-001 (partial): edit `specs/051-hermes-multiplex/spec.md` SC-001 to "profile created and warm (accepting requests) in <10 s", update `test-plan.md` E1 to measure creation→first accepted request separately from the answer, and keep the answer-time observation informational
- [X] T044 Correct the host assumption per spec Assumptions (contradicts): rewrite the first assumption in `specs/051-hermes-multiplex/spec.md` to the actual WSL/Linux host (`~/.hermes`, profiles directory created during setup) and keep the Windows shared-MCP-tools boundary as a separate statement
- [X] T045 Align plan and task structure per plan: Project Structure (partial): update `specs/051-hermes-multiplex/plan.md` to the flat sidecar modules (`src/agentic_rag_mcp/hermes_profiles.py`, extend `hermes_client.py`), list `src/agentic_rag_mcp/deploy/docker_ops.py` as a touch-point, and remove the status-route creation from T010 so `ai-chat-landing/app/api/profiles/status/route.ts` is owned only by T025
- [X] T046 Define rotation/disable latency per US3 AC2 (partial): change "fails immediately" to "takes effect within one reconcile interval (≤30 s)" in `specs/051-hermes-multiplex/spec.md`, and have `scripts/profiles-rotate.mjs` / `profiles-disable.mjs` poll until the old key is refused before reporting success
- [X] T047 Assert SC-009 per SC-009 (missing): add a case to `ai-chat-landing/lib/profiles/provision.integration.test.ts` proving `peter.chan@tvb.com`, `@tvb.com.hk`, `@tvb.com.cn` produce three distinct registry entries/slugs (and a fourth login of one of them creates nothing)
- [X] T048 Add an error-taxonomy parity test per U24 (partial): a test comparing the E1–E16 code→status/message pairs exported by `ai-chat-landing/lib/profiles/errors.ts` and `src/agentic_rag_mcp/hermes_profiles.py` so the TS and Python lists cannot drift

---

## Phase 9: Convergence

- [X] T049 (dual-mode: identity present -> profile; absent -> legacy, no profile; partial identity -> invalid_profile_request; legacy lane tests must stay green) Wire identity into the Hermes lanes per FR-013 (missing): declare `hermes_slug|hermes_oid|hermes_email` as chatflow inputs in `dify/AGIAssistant/AGI_Assistant.yml` and bind them into each Hermes tool call; every Hermes lane tool in `src/agentic_rag_mcp/server.py` accepts those values, resolves the profile via `hermes_profiles.resolve_profile_context` only when all three are present, reads the profile key from the read-only mount, and calls `hermes_client.run_task(..., profile=slug, api_key=key)`; absent identity keeps the legacy `/v1/responses` shared-key path and creates no profile; contract tests prove identity -> `/p/<slug>/v1/responses` and absent identity -> `/v1/responses` with zero ensure calls
- [X] T050 Retarget E1 to the revised SC-001 per SC-001 (contradicts): in `specs/051-hermes-multiplex/test-plan.md` E1, measure profile creation → warm (first accepted profile-scoped request) under 10 s and report answer latency separately as informational, so the criterion matches "profile ready and serving"
- [X] T051 Fix the template/pilot key procedure per FR-022 (contradicts): in `specs/051-hermes-multiplex/quickstart.md` §1 require the `template-pc` `.env` to contain **no** `API_SERVER_KEY` (remove the "record the template key" step), and §3 obtain the pilot key after an `ensure`/explicit mint rather than from a clone, which would otherwise be keyless
- [X] T052 Correct T020's acceptance claim per T020 (contradicts): note in `specs/051-hermes-multiplex/tasks.md` that the anonymous Dify `user` intentionally changes to `u-anon` (only the identity inputs stay absent), and keep the updated chat-route test as the authority
- [X] T053 Define anonymous history per FR-025 (partial): record in `specs/051-hermes-multiplex/spec.md` Clarifications (and README) that anonymous conversations share the `u-anon` bucket by design unless per-browser scoping is chosen later, so the choice is explicit rather than accidental
- [X] T054 Align the plan tree and fixture tasks per plan: Project Structure (partial): add `lib/profiles/legacy.ts`, `scripts/profiles-*.mjs`, `lib/profiles/operator.test.ts`, `boundary.test.ts` to `specs/051-hermes-multiplex/plan.md`, and retarget T002–T004 to extract the existing inline stubs into shared fixture files (or mark them cancelled), so no task points at files no test uses
- [X] T055 Resolve the unused `provisioning` status per data-model (contradicts): either set `provisioning` while the create is in flight in `ai-chat-landing/lib/profiles/provision.ts` (and test it) or remove it from `data-model.md` and the registry validator
- [X] T056 Extend the boundary-copy check per SC-011 (partial): include the chatflow prompt/answer copy from `dify/AGIAssistant/AGI_Assistant.yml` in the scan asserted by `ai-chat-landing/lib/profiles/boundary.test.ts`, or document explicitly that only app copy is covered
- [X] T057 Align the plan's decision summary per plan: Phase 0 (partial): update `specs/051-hermes-multiplex/plan.md` Phase 0 to reference research D1–D13 (currently D1–D10)

---

## Phase 10: Convergence

- [X] T058 Correct T049's body to the dual-mode rule and align H15 per FR-021 (contradicts): rewrite the T049 description in `specs/051-hermes-multiplex/tasks.md` to state "identity present → profile path; absent → legacy `/v1` with no profile; partial identity → `invalid_profile_request`" (removing the `identity_required`-when-absent sentence) and rewrite the H15 row in `test-plan.md` to match (anonymous does not 401; it uses the legacy path; no profile created)
- [X] T059 Add lane-level acceptance cases per FR-014 (missing): in `specs/051-hermes-multiplex/test-plan.md` add cases proving identity → `/p/<slug>/v1/responses` with the profile key (blocking and streaming) and absent identity → legacy `/v1/responses` with zero ensure calls, mapping both to FR-014/FR-021 in the acceptance table
- [X] T060 Redeploy the sidecar after the profiles mount per plan: sidecar mount (missing): add an explicit step to `specs/051-hermes-multiplex/quickstart.md` §4 (and T017's execution order) to run `python -m agentic_rag_mcp.deploy redeploy` and verify `/hermes-profiles` exists in the container before the pilot, since `deploy/docker_ops.py` now mounts it but the running container predates the change
- [X] T061 Serialise operator registry writes per FR-016 (partial): in `ai-chat-landing/scripts/profiles-cli.mjs` take the same `profiles.json.lock` (`wx` + stale-eviction) used by `lib/profiles/registry.ts` around read-modify-write, so rotate/disable/enable cannot clobber a concurrent ensure (add a test with two concurrent writers)
- [X] T062 Test profile routing on the streaming path per FR-013 (partial): extend `tests/contract/test_hermes_profile_routing.py` with a `conversation_id` case that asserts the stream client calls `/p/<slug>/v1/responses` with the profile key and that an anonymous stream still calls `/v1/responses` with the legacy key
- [X] T063 Warm or report on the existing-active ensure path per FR-007 (partial): in `ai-chat-landing/lib/profiles/provision.ts` do not return `created:false` as ready without a warm check after a prior `agent_unavailable`; either re-warm (bounded) or return `agent_unavailable` until it answers, and test the retry-after-cold case (data-model.md `ProfileIndexEntry.lastError`)
- [X] T064 Resolve the duplicated legacy-export implementation per plan: structure (unrequested): either make `scripts/legacy-conversations-export.mjs` delegate through a runnable path to `ai-chat-landing/lib/profiles/legacy.ts`, or delete the unused module and keep the script as the single implementation; do not leave both
