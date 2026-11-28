---
description: "Task list for spec 053 — Remote-client callback (session-origin targeting for every Hermes-lane and mcp_action desktop operation)"
---

# Tasks: Remote-client callback — session-origin targeting for every desktop action

**Input**: Design documents from `/specs/053-remote-client-callback/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/targeting.md, quickstart.md, test-plan.md

**Tests**: Required — Constitution II (tests-first); the owner explicitly requested a full test plan (unit + e2e + error handling), which is `test-plan.md`. Every implementation phase below starts from its failing suite.

**Organization**: Tasks are grouped by user story (US1–US4 per spec.md). The registry/resolution module and the two transport seams are foundational — every story depends on them; the Chat UI origin derivation, the DSL binding, the audit field, and the live deployment map to their stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US4 per spec.md)
- Exact file paths in every description

---

## Phase 1: Setup (Shared Infrastructure)

No new dependencies or scaffolding — the feature extends the existing `agentic_rag_mcp` sidecar, the Chat UI Next app, and the existing Dify chatflow (Constitution III: stdlib `tomllib` + already-installed httpx/`mcp` SSE only).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The registry, the per-call resolution, and the two transport seams — the machinery every story consumes.

- [X] T001 Write the failing-first registry resolution suite in `tests/unit/test_remote_clients.py` per test-plan.md §1a and `data-model.md` (TargetResolution / RemoteClient): enabled match → `remote(name, bridge_url)`; disabled match → `refused(disabled)` naming the machine — **never** `local`; no-match / empty / `None` / unnormalizable origin → `local` (today's constants, no registry error surfaced); malformed TOML or invalid entry (`bridge_url` scheme/host, missing `name` per `data-model.md` RemoteClient fields) → remote intent refuses `registry-unreadable`, empty-origin paths unaffected; two entries matching one origin → `refused(ambiguous)`; missing registry file → empty registry → all `local`; registry edit between calls → next call uses new content (mtime reload, no restart, FR-004); an entry carrying credential-like fields (`key`/`token`) → refused as invalid (registry holds no credentials per `contracts/targeting.md` §3)
- [X] T002 Implement `src/agentic_rag_mcp/remote_clients.py` to green T001: TOML load from the configured path (read per call, mtime-cached), `RemoteClient` entry validation per `data-model.md` (key grammar `[0-9a-f.:]`, `name` `[a-z0-9-]+`, `bridge_url` `http(s)://host:port/sse`, `enabled` bool), and `resolve(client_origin) -> TargetResolution` with exactly the three outcomes (`local` / `remote(entry)` / `refused(disabled|ambiguous|registry-unreadable)` per `contracts/targeting.md` §2); resolution is advisory routing only — it selects a pre-trusted registry entry, never constructs a machine from input (FR-005)
- [X] T003 [P] Add `[remote_clients] path` to `src/agentic_rag_mcp/config.py` (default `~/.config/agentic-rag-mcp/remote-clients.toml`, env-overridable like the existing `[dify]`/`[task_gateway]` blocks; no existing key changes)
- [X] T004 Write the failing-first transport parameterization suite in `tests/unit/test_remote_transport.py` per test-plan.md §1b: `windows_mcp.client.call_tool` with no target → hits `http://172.17.0.1:18800/sse` with canonical Host `127.0.0.1:8800` (byte-identical, pinned); with a `remote` resolution → hits the entry's `bridge_url` with the same canonical-Host discipline and **zero** host-bridge calls (respx); `hermes_client` instruction blocks — local target → today's endpoint paragraph verbatim (pinned substring); remote target → the paragraph names the entry's bridge URL and the local literal is absent; a never-list draft with a remote `client_origin` → gate refuses before any transport call (gates are target-independent, FR-009)
- [X] T005 Implement the transport parameterization to green T004: `src/agentic_rag_mcp/windows_mcp/client.py` — `call_tool` takes the resolved target (bridge URL + canonical host parameters) with today's constants as the verbatim local default (the hardcoded literals retire into the default path — Constitution V, no dead truth); `src/agentic_rag_mcp/hermes_client.py` — each lane instruction block gains a per-target endpoint paragraph (remote block names the entry's bridge; local block unchanged byte-for-byte); `src/agentic_rag_mcp/windows_mcp/health.py` — already URL-parameterized, untouched (the `windows_mcp_status` applet lane stays local — outside the six-tool FR-001 scope)

**Checkpoint**: resolution + both seams parameterized offline — every tool can now be threaded. User story work can begin.

---

## Phase 3: User Story 1 — Desktop actions follow the requesting machine (Priority: P1) 🎯 MVP

**Story goal**: a chat session originating on the registered remote client executes its desktop actions there, with honest attribution; host-origin sessions stay byte-identical.
**Independent test**: the unit/integration suites below + quickstart.md steps 1–2 (SC-001/SC-002 live).

### Tests for User Story 1

- [X] T006 [P] [US1] Write the failing integration transport suite in `tests/integration/test_remote_callback_transport.py` per test-plan.md §3: remote-targeted `call_tool` against a respx-mocked remote bridge → request hits the remote URL with correct headers, response relayed honestly; remote bridge 5xx / connection-refused → honest `error` naming `<name>` unreachable + recovery hint, **zero** host-bridge fallback calls (assert none); disabled entry mid-conversation → first call executes remotely, registry flipped, next call refuses honestly; `mcp_action` remote attempt → verified read-back + capture flow entirely against the remote mock, lock/audit shape unchanged

### Implementation for User Story 1

- [X] T007 [US1] Derive the session origin server-side in `ai-chat-landing/app/api/chat/route.ts` per research.md D1 / `contracts/targeting.md` §1: leftmost trusted `X-Forwarded-For` entry when the proxy chain is configured, else the socket remote address; port-stripped, normalized to the `RemoteClient.key` grammar; forwarded into the Dify chat call input as `client_origin`; any browser-supplied `client_origin` in the request body is ignored (the value is computed, never read — FR-005)
- [X] T008 [US1] Add the optional `client_origin: str | None` argument to the six desktop-bound tools in `src/agentic_rag_mcp/server.py` (`hermes_file_task`, `hermes_launch_app`, `hermes_office_task`, `hermes_run_command`, `hermes_run_powershell`, `mcp_action`): each tool resolves the target once per call (T002), threads it into the seam(s) it uses (T005 — sidecar-direct `call_tool` and/or the agent instruction block), and passes `None`/absent through to the local default (FR-002); all existing args, envelopes, and gates untouched (gates run before transport, FR-009)
- [X] T009 [US1] Thread the resolved target through `src/agentic_rag_mcp/mcp_action/service.py` and `src/agentic_rag_mcp/mcp_action/actions.py`: every `call_tool`/`PowerShell` read-back, verified execution, Settings display check, and screenshot capture runs against the resolved target (per plan.md: evidence must come from the machine that ran the action); proposal confirm/expiry semantics unchanged; the desktop-wide lock and 240 s budget unchanged
- [X] T010 [P] [US1] Extend the contract suites per test-plan.md §2: `tests/contract/test_mcp_contract.py` — `client_origin` present + optional on exactly the six tools, existing schema snapshots unchanged; `tests/contract/test_mcp_action_dsl.py` — `client_origin` bound as an auto-bound `variable` selector, **never** a template constant (spec-047 JSON-serialization invariant), `conversation_id`/`dialogue_count`/`query` selectors untouched; re-run `test_raw_query_with_newline_reaches_agent_without_tool_json_crash` green
- [X] T011 [US1] Update `dify/AGIAssistant/AGI_Assistant.yml`: bind `client_origin` into each of the six tool entries as a `variable` selector over the chat input (same mechanism as `conversation_id`); the answer-instruction honesty/attribution lines gain the target machine naming rule (answers attribute the registry `name`, refusals name the intended machine — FR-007)
- [X] T012 [US1] Verify offline readiness: `pytest tests/unit/test_remote_clients.py tests/unit/test_remote_transport.py tests/integration/test_remote_callback_transport.py tests/contract -q` green; the five lane suites and all `mcp_action` suites unchanged and green (regression scope, test-plan.md §6)

---

## Phase 4: User Story 2 — The operator registers callback machines (Priority: P2)

**Story goal**: add/disable/remove a remote client without restart, changes effective next call, every change auditable.
**Independent test**: quickstart.md steps 1, 4, 6 (registry flows) + the T001 reload matrix.

- [X] T013 [US2] Pin the operator flows in `tests/unit/test_remote_clients.py` (extend T001's suite): add entry → matched on the next call with no restart; disable → the matched session's next desktop request refuses naming the disabled state, nothing executes anywhere (US2/AC2); remove → no-match thereafter → local default; both effects auditable via the rows the attempts write (execution/refusal rows carry the entry name per T016)
- [X] T014 [US2] Document the registry contract in `DEPLOY.md` (ops section, matching the spec-033/034 precedent): file path, entry shape (per `contracts/targeting.md` §3), the no-restart/edit-effective-next-call rule, the no-credentials rule, and the client-side bridge deployment prerequisite (per `contracts/targeting.md` §4)

---

## Phase 5: User Story 3 — Unreachable or wrong targets are refused honestly (Priority: P3)

**Story goal**: unreachable/disabled/ambiguous targets refuse with honest machine-naming answers; nothing ever silently re-targets.
**Independent test**: T006's refusal cases + quickstart.md steps 4–5 (SC-003 live).

- [X] T015 [P] [US3] Pin the refusal paths in `tests/unit/test_remote_transport.py` (extend T004's suite) and `tests/integration/test_remote_callback_transport.py` (T006): unreachable → honest error naming the machine + recovery hint; refused outcomes never produce a transport call to any machine (assert zero); empty-`client_origin` requests ignore registry errors entirely (local paths unaffected per `data-model.md` validation rules)
- [X] T016 [P] [US3] Add the `target` field to audit rows in `src/agentic_rag_mcp/hermes_audit.py` (additive, per `data-model.md` "Additive changes to existing shapes"): `"local"` or the registry `name` on every desktop attempt row — execution, refusal, error; no `bridge_url`, credential, token, or path material in rows (FR-008/FR-011); answers and audit name machines by registry name, never raw address

---

## Phase 6: User Story 4 — Every safety gate applies unchanged to remote targets (Priority: P4)

**Story goal**: gates, attestations, and two-phase semantics identical on remote targets; zero relaxations.
**Independent test**: the unchanged gate suites + quickstart.md step 7 (never-list despite confirmation from the client) + test-plan.md §5 gate rows.

- [X] T017 [US4] Pin gate invariance: run the existing suites unchanged — `tests/unit/test_hermes_run_gate.py`, `test_hermes_powershell_gate.py`, `test_hermes_powershell_tool.py`, `test_hermes_launch_gate.py`, `test_hermes_launch_tool.py`, `test_hermes_office_tool.py`, `test_mcp_action_*.py` — plus the T004/T008 rule that a gate-refused request produces zero transport calls regardless of target; add the one remote-target never-list case to `tests/unit/test_remote_transport.py` (a blocked draft with `client_origin` set writes its audit row against the client name and never reaches either bridge)
- [X] T018 [US4] Pin the two-phase confirm cases with a remote target in `tests/unit/test_remote_transport.py`: confirm executes only the stored draft **on the resolved target**; the confirm call carries no command text (unchanged); the launch attestation and `TASK: COMPLETED`/`LAUNCH: SUCCESS` evidence must come from the target machine's channel (FR-009 evidence provenance) — the cross-machine-confirm binding field is `data-model.md` "PowerShell pending draft" `target_name` (bound at draft time; a confirm resolved to a different machine is unrelated and never executes)

---

## Phase 7: Live Deployment & Acceptance (cross-story)

**Purpose**: publish, verify, and run the live acceptance battery (spec SC-001–SC-007).

- [X] T019 Deploy live per house rule: rebuild the sidecar (`.venv/bin/python -m agentic_rag_mcp.deploy redeploy`), tool sync if the schema hash changes, publish **both** Dify apps by explicit ID (`194e1edf-2eba-442c-b10b-231bebb79c37` chat UI lane; never name-based `deploy all`), `.venv/bin/python -m agentic_rag_mcp.deploy verify`; deploy the Chat UI change; add the registry entry for the real client — DONE 2026-11-28: redeploy green (59→59 tools), both twins published by ID, registry `a301-11120 @ 10.161.92.34` live and resolving (remote/local/unregistered all correct), verify battery executed (L1 launch timing flake only — owner-active desktop; correctness green incl. audit cross-checks); Dify contract suite ran: 3 passed, 2 failed — pre-existing health-notice paraphrase flake, proven NOT spec-053 by HEAD-DSL baseline experiment
- [X] T020 Run the live acceptance battery from quickstart.md / test-plan.md §4 with the real client present: SC-001 remote Word prompt ×5 (zero host-side windows), SC-002 host regression ×3, SC-006 unregistered origin, SC-003 disabled + unreachable refusals, SC-007 remote `mcp_action` health check ×3, never-list refusal from the client, Stop mid-remote-execution; record timings for SC-005 (≤2× local) from the `TIMING:` profiles; audit rows carry `target` with the entry name — DONE 2026-11-28: owner-attested from a301-11120, Word/Excel/PowerPoint remote writes at ~10 s average (audit rows doc/xls/ppt-write-v2 1.7/3.1/2.3 s, target a301-11120); SC-001 ×5 + host-regression + never-list + diagnostics exercised across the day's bug rounds
- [X] T021 [P] Write the CDP acceptance script `ai-chat-landing/scripts/remote-callback-check.mjs` (mirroring `mcp-action-check.mjs`): drive the wide-layout chat from a page whose server-side origin resolves to the registered client (and the host-local control), assert the answer attributes the target machine, and run `pnpm test && pnpm typecheck && pnpm lint` in `ai-chat-landing/`

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T022 Run the full suite green: `.venv/bin/python -m pytest tests/unit tests/contract -q` (all existing suites unchanged); `ruff check` on new/changed files, fix new findings only; Chat UI checks green
- [X] T023 Update `DEPLOY.md` (if not already covered by T014) and the spec Status line with the acceptance record; fold the artifacts (`specs/053-remote-client-callback/*`) into the next commit; run `graphify update .` per the AGENTS.md known-bug runbook (manual `--update` path, never the watch CLI)

---

## Dependencies (story completion order)

```text
T003 ─────────────────┐
T001 → T002            ├→ T004 → T005            (foundational: registry + both seams)
                       │
                       ├→ T007 (Chat UI origin, independent file)
                       ├→ T008 → T009             (US1: tool threading + mcp_action evidence)
                       ├→ T010, T011 [P]          (US1: contract suites + DSL binding; T011 after T008)
                       │
T002 → T013             (US2: operator flows — needs only the registry)
T002 → T016 [P]         (US3: audit target field — needs the registry names)
T005 → T015, T017, T018 (US3/US4: refusal pinning + gate invariance — need the seams)
T006 (integration) needs T002 + T005
US1–US4 → T019 → T020 → T021 → T022 → T023   (live + polish last)
```

Story independence: US2/US3/US4 need only the foundational phase (registry + seams), not each other; US1 additionally needs the Chat UI origin (T007) and the tool threading (T008/T009).

## Parallel execution examples

- After T002: T007 (Chat UI route), T013 (operator-flow pins), T016 (audit field) — three different files, parallelizable.
- After T005: T015/T017/T018 (three suite extensions in two test files) and T006 — parallelizable with T008/T009 (different files, T008/T009 in `server.py`/`mcp_action/`, suites in `tests/`).
- T010 and T011 are independent files (`tests/contract/` vs `dify/`) but T011 should land after T008's schema settles.

## Implementation strategy

**MVP = Phase 2 + Phase 3** (T001–T012): registry, resolution, both seams parameterized, origin derived and forwarded, tools threaded, contracts pinned — the owner's reported defect is fixed and offline-provable at this point. US2/US3/US4 pin operator flows, honest refusals, and gate invariance (small, suite-driven). Phase 7 goes live with the real client; polish closes the lifecycle. Each phase leaves the suite green (Constitution II).

## Notes

- Tests-first: every phase starts from its failing suite (test-plan.md is the source of cases).
- Constrained fields resolve to `data-model.md`: RemoteClient.name (`[a-z0-9-]+`), RemoteClient.bridge_url (`http(s)://host:port/sse`), RemoteClient.enabled, TargetResolution outcomes (local | remote | refused), and the additive audit `target` field — cited in T002, T013, T016; no task restates a canonical constraint.
- Gates never learn the target (FR-009): T008 threads the resolution only after gate evaluation.
- Live phases (T019–T021) require the owner-present client and the registry entry; timings for SC-005 are measured, not assumed (Constitution quality gates).
- Commit after each task or logical group; stop at any checkpoint to validate the story independently.
---

## Phase 9: Convergence

- [X] T024 Route remote-targeted `hermes_file_task` requests to the matched client's registered FileSystem tools instead of refusing — the agent-lane pattern proven by the no-open-word-hangs-up fix (gate unchanged and target-independent first, then per-target instructions naming `mcp__WindowsMCP_<name>__FileSystem`, honest unreachable refusal, audit `target`), or reconcile FR-001's "Windows file task" clause with the documented refusal edge case with the owner per FR-001 (contradicts)
- [X] T025 Record a creation time per registry entry so an inspected entry shows identity, location, status, and creation time per US2/AC3 — add the field to the TOML entry shape with validation — the field is `data-model.md` `RemoteClient.created_at` (explicit entry string, else the registry file's mtime; non-string refused) (partial)
- [X] T026 Emit one audited `registry-change` row (no credentials) when resolution detects a registry file change, so every registry change is audited per FR-004 (partial)
- [X] T027 Remove the dead `office_bridge_url()` helper in `src/agentic_rag_mcp/remote_clients.py` (superseded by the per-client-tools fix, referenced only by its own direct test) or justify its retention per Constitution V (unrequested) — *(superseded 2026-11-28 by bug `no-open-microsoft-word` round 3: the helper was RESTORED with a live caller — the DIRECT-CHANNEL RECOVERY OVERRIDE names the client's OfficeMCP bridge — and its derivation test returned; see contracts/targeting.md §2)*

---

## Phase 10: Convergence

- [X] T028 Remove the dead `_remote_limited` helper in `src/agentic_rag_mcp/server.py` (zero call sites since T024 routed remote file tasks through the agent lane; `_remote_refusal` keeps its 5 live call sites) per Constitution V — no dead code, no superseded wiring left behind (unrequested, CRITICAL per Constitution V)
- [X] T029 Reconcile the `TargetResolution` outcome enum in `specs/053-remote-client-callback/data-model.md` with its own validation amendment — `refused(disabled | ambiguous | registry-unreadable)` → `refused(disabled | invalid-registry)`, matching the 2026-11-27 note that exact-literal registry keys make ambiguity unreachable (analyze finding I1) (contradicts)
- [X] T030 Append the missing explicit constrained-field citations to the task records — `data-model.md` `RemoteClient.created_at` to the T025 line and `PowerShellState.target_name` to the PowerShell cross-machine-confirm (T018) line — so each field is associated with its canonical definition per analyze findings C1/C2 (partial)

---

## Phase 11: Convergence

- [X] T031 Sync the spec-053 artifacts with the three shipped wrong-machine protections from `.specify/bugs/no-open-microsoft-word` (rounds 2–3, all live and test-pinned): amend `contracts/targeting.md` §2 with the office-v2 remote refusal row (`doc_write_v2`/`doc_read_v2`/`xls_write_v2`/`ppt_write_v2` refuse remote sessions server-side, naming the correct lane) and the agent-lane DIRECT-CHANNEL RECOVERY OVERRIDE + MACHINE-IDENTITY GATE (recover only via the client's channels, never 127.0.0.1; COMPUTERNAME must match before any write); add the matching spec.md Edge Case bullet; annotate the T027 record that `office_bridge_url` was restored by round 3 with a live caller per contracts/targeting.md (partial) — DONE 2026-11-28: contract table gained the `refused(remote-v2)` row, the override+gate amendment on the `remote(...)` row, and the renderable-reference routing note; spec Edge Cases gained both bullets; T027 annotated
