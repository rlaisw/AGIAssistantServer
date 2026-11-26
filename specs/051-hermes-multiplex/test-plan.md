# Test Plan — Hermes Multi-Profile Gateway (Phase 2)

Companion to [plan.md](./plan.md) and [spec.md](./spec.md). Tests are written before their implementation (Constitution II). Two offline harnesses make everything deterministic: a **stub `hermes` executable** and a **fake gateway HTTP server**.

## Levels and commands

| Level | Tool | Command | Network | Deterministic |
|---|---|---|---|---|
| Unit (TS) | vitest | `cd ai-chat-landing && pnpm test` | none | yes (temp dirs, stub) |
| Unit (Python) | pytest | `.venv/bin/python -m pytest tests/unit/test_hermes_profiles.py -q` | none | yes |
| Integration | vitest + pytest + fake gateway | same commands; `tests/contract/test_hermes_profile_routing.py` | localhost only | yes |
| Live E2E | Hermes CLI + real gateway | `RUN_HERMES_E2E=1 node scripts/hermes-profile-check.mjs` | host | no (owner present) |
| Static gates | tsc/eslint | `pnpm typecheck && pnpm lint` | none | yes |

## Fixtures

| Helper | Purpose |
|---|---|
| `tests/support/stub-hermes` (JS) / `tests/fixtures/stub_hermes.py` | Records argv, creates a fake `profiles/<slug>/` with `config.yaml` + `.env`, or fails on demand (`FAIL_CREATE`, `FAIL_USERMD`, slow mode) |
| `tests/support/fake-gateway.ts` | Responds 200/401/403/404/429/503, records the path/key it saw (key compared to a known value, never logged) |
| `ai-chat-landing/lib/profiles/testing/tmpdir.ts` | Temp profiles root + index path per test |
| `tests/fixtures/profiles/*.json` | Valid, corrupt, duplicate-slug, v0-absent index fixtures |
| `tests/support/identities.ts` | Two members with distinct `oid`/email, including the three TVB domains |

## Unit tests (TypeScript)

| ID | Case | Asserts |
|---|---|---|
| U1 | `oidHash` | first 16 hex of SHA-256; stable; no raw oid stored |
| U2 | Slug validation | accepts `peter-chan-tvb-com-hk`; rejects uppercase, `/`, `..`, >64, empty |
| U3 | Registry load | valid JSON → entries; duplicate slug rejected; duplicate oidHash rejected |
| U4 | Registry atomic write | temp+rename; a simulated crash mid-write leaves the old file intact |
| U5 | Registry lock | second writer waits then succeeds; stale lock → `registry_unavailable` |
| U6 | Corrupt registry | refuse provisioning; routing read is unaffected |
| U7 | `validate` + `rebuild-from-profiles` | reports first structural error; rebuild adopts only homes with `USER.md` identity |
| U8 | Provision args | exact `profile create <slug> --clone-from <template>` invocation |
| U9 | USER.md | contains Display Name, Email, shared Windows user; no key |
| U10 | Idempotency | second ensure → 200 `created:false`; CLI called once |
| U11 | Rollback | create OK but USER.md write fails → profile home removed, no index entry |
| U12 | Lock timeout | concurrent ensure → 409 `provisioning_in_progress`, no duplicate |
| U13 | Warm timeout | no answer within bound → 503 `agent_unavailable`, entry remains `active` |
| U14 | No secrets in responses | ensure/status never include key, path, raw oid |
| U15 | Disable | index `disabled` **and** key replaced; old key value no longer present |
| U16 | Enable | fresh key + `active` |
| U17 | Rotate | new key differs; reconcile signalled; cache invalidated |
| U18 | History user | `u-<oidHash>` for signed-in; empty for anonymous |
| U19 | Chat inputs | identity inputs present only when signed in; browser-supplied identity ignored |
| U20 | Conversation filter | list call carries the per-identity user; legacy constant never used |
| U21 | Legacy guard | pre-cutover conversation id → 404 `legacy_conversation` |
| U22 | Audit sanitization | events contain code/slug/oidHash/correlation; never key/token/oid/email |

## Unit tests (Python)

| ID | Case | Asserts |
|---|---|---|
| U23 | Slug regex | same rules as U2 (shared fixture list) |
| U24 | Ensure client | 201/200/409 mapping; 409 retried within a bound; 401/422 not retried |
| U25 | Key reader | reads only `profiles/<slug>/.env`; missing/empty → `profile_misconfigured`; permission error mapped, not leaked |
| U26 | Key cache | TTL ≤60 s; rotation invalidates; never logged |
| U27 | Gateway path | `/p/<slug>/v1/responses`; slug encoded; no path traversal |
| U28 | Status mapping | 401→`profile_auth_failed`, 403→`profile_disabled`, 404→ensure-once then `profile_missing`, 429→`agent_busy`, 5xx/timeout→`agent_unavailable` |
| U29 | No-fallback | after a profile failure, no call is made to another slug, the legacy path, or anonymous |
| U30 | Audit | one record per attempt, correct attribution, tokens absent |

## Integration tests

| ID | Case | Asserts |
|---|---|---|
| I1 | Ensure → sidecar call | ensure creates, key read, fake gateway receives `/p/<slug>/v1/responses` with the profile key |
| I2 | Second request | ensure not re-created; key cached; one CLI invocation total |
| I3 | Five concurrent ensures | one profile, one 201, four 200/409 then success; index single entry |
| I4 | Create failure | rollback leaves no home/entry; retry succeeds |
| I5 | Registry corrupt | ensure 503; an existing profile still routes |
| I6 | Wrong profile key | fake gateway 401 → `profile_auth_failed`, no retry storm |
| I7 | Other profile's key on a path | fake gateway 403 → refusal, no execution |
| I8 | Disabled profile | sidecar refuses before gateway; audit `refuse` |
| I9 | Unknown slug | one ensure attempt, then `profile_missing` (404) |
| I10 | Legacy path | `/v1/responses` with the shared key unchanged (response body identical fixture) |
| I11 | History scoping | `/api/chat` body carries `u-<oidHash>`; `/api/conversations` filters by it |
| I12 | Legacy history | shared-constant conversations absent from every user list; operator export contains them |
| I13 | Hot-serve | profile created after gateway start is served within the reconcile window (fake-clock/real wait bounded) |
| I14 | MCP offline | tool-level error attributed to the profile; turn honest; other profile unaffected |
| I15 | Identity → profile path | a lane call carrying all three identity values ensures once and calls `/p/<slug>/v1/responses` with the profile key (blocking **and** streaming) |
| I16 | Anonymous → legacy | a lane call with no identity values calls `/v1/responses` with the legacy key and makes zero ensure calls / creates no profile |

## Live end-to-end (owner present)

`RUN_HERMES_E2E=1 node ai-chat-landing/scripts/hermes-profile-check.mjs` — creates a throwaway pilot profile and cleans it up.

| ID | Scenario | Pass condition |
|---|---|---|
| E1 | First agent-bound request for a fresh user | profile created and warm (first accepted profile-scoped request) in <10 s (SC-001); answer latency reported separately as informational |
| E2 | Same user, second browser | same slug, no duplicate; memory retained |
| E3 | Two users | each profile has only its own memory/file; cross-profile key/path refused |
| E4 | Chat history | each sidebar lists only its own; legacy rows absent; export contains them |
| E5 | Rotation | old key fails immediately, new key serves, no gateway restart |
| E6 | Disable / enable | disabled refused + audited; enable restores service |
| E7 | Gateway restart | routing resumes; no profile corruption |
| E8 | Windows PC offline | tool reports unavailability; profile attribution correct; other user unaffected |
| E9 | Shared-OS boundary | two users' Windows actions attributed correctly in audit; no per-user Windows claim in UI copy (SC-011) |
| E10 | Scale smoke | 100 registered profiles, 10 concurrent requests: no failures, ≤2× single-profile latency (SC-007) |

## Error handling matrix

Each row asserts an honest message, the documented status, an audit record, and **no side effects** (no partial profile, no cross-profile retry).

| ID | Code | Trigger | Status | Session/profile |
|---|---|---|---|---|
| H1 | `unauthorized` | ensure without/with wrong token | 401 | none |
| H2 | `invalid_profile_request` | bad slug/oid/email | 422 | none |
| H3 | `provisioning_in_progress` | concurrent create | 409 | none (retry) |
| H4 | `provision_failed` | CLI or USER.md failure after create | 500 | rolled back |
| H5 | `registry_unavailable` | corrupt/locked index | 503 | routing unaffected |
| H6 | `profile_misconfigured` | key missing/empty | 500 | existing profile, operator action |
| H7 | `profile_auth_failed` | gateway 401 | 401 | none executed |
| H8 | `profile_disabled` | disabled status/key replaced | 403 | none executed |
| H9 | `profile_missing` | unknown slug after one ensure | 404 | none |
| H10 | `agent_busy` | gateway 429 | 429 | none queued cross-profile |
| H11 | `agent_unavailable` | 5xx/timeout/not warm | 503 | profile retained; retry allowed |
| H12 | `tool_unavailable` | MCP/Windows offline | tool error | turn honest |
| H13 | `history_scope_failed` | scoping derivation error | 500 | turn refused (never shared history) |
| H14 | `legacy_conversation` | pre-cutover id requested | 404 | operator export only |
| H15 | legacy (no error) | agent-bound lane call without identity | 200 legacy | nothing created; the existing legacy `/v1` path serves it (FR-021) |
| H16 | `slug_collision` | deterministic suffix applied | 200/201 | distinct slug; audit notes collision |

## Acceptance mapping

| Requirement | Cases |
|---|---|
| FR-001–FR-005 (routing, slug, key) | U1, U2, U8, U27, I1, I6, I7, E1 |
| FR-006 (isolation boundary) | U9, E3, E8, E9 |
| FR-007–FR-010 (lazy atomic provisioning) | U8–U13, I3–I4, E1 |
| FR-011–FR-012 (slug derivation/stability) | U1, U2, U16, E2, SC-009 |
| FR-013–FR-014 (identity source) | U18, U19, I11, I15, I16, H15 |
| FR-015 (audit) | U22, U30, E5–E9 |
| FR-016–FR-017 (operator control) | U15–U17, E5–E6 |
| FR-018 (scale) | E10 |
| FR-019–FR-020 (warm/failure honesty) | U13, U28, I8–I9, E7–E8 |
| FR-021 (legacy path) | I10, quickstart §3 |
| FR-022 (profile-owned keys) | U14, U25–U26, I6 |
| FR-023 (status surface) | U14, quickstart §6 |
| FR-024 (native multiplexing) | I13, quickstart §2–3 |
| FR-025–FR-026 (history scope/cutover) | U18–U21, I11–I12, E4 |
| SC-001…SC-012 | E1–E10, U-cases as above |

## Results

**2026-11-26 — T023/T033/T038/T039 live (owner present)**

- T023 passed with two accounts: `raymond.lai@tvb.com.hk` → `raymond-lai-tvb-com-hk`, `billy.test@tvb.com.hk` → `billy-test-tvb-com-hk`; both routed independently and the gateway served both under `/p/`.
- T033: with the WindowsMCP process stopped (task terminated, port 8800 down), a launch turn returned an honest **no-verdict** ("the tool call was cut off… nothing is confirmed") instead of claiming success, and the routing audit still attributed the turn to `raymond-lai-tvb-com-hk`. WindowsMCP was restored immediately after.
- T038 passed: 100 template-cloned profiles created in 8.7 s; after reconcile, **10 concurrent** `/p/<slug>/v1/models` requests → **10/10 OK**, wall 377 ms, p95 276 ms; all throwaway profiles and 99 leftover dirs removed (one earlier cleanup gap fixed by deleting the remaining `scale-*` set).
- T039: the rollback drill found a real behavior — flipping `multiplex_profiles` to false is reverted by the gateway on restart while profiles exist. `quickstart.md` §7 was corrected: rollback means removing/renaming profile homes (operator-approved), not the flag.



- T018 passed on the signed-in lane (`raymond.lai@tvb.com.hk`): chat accepted, profile `raymond-lai-tvb-com-hk` ensured once, one `routing` record, `/p/<slug>/v1/models` 200, and the lane executed `ipconfig` (38.2 s, attributed to the profile).
- T034 passed: `hermes gateway restart -y --detach`, all four profiles back on one PID, legacy `/v1` 200 and profile `/v1/models` 200, then the same acceptance run passed again.
- T029 passed live: rotate 187 ms (old key 401, new key 200), disable 225 ms (key refused, status disabled), enable 129 ms (new key 200, status active) — all far under SC-008's 2 minutes.
- Fixes found during live runs: identity parameters are now **bound in the DSL** to the start-node variables (the model cannot be trusted to echo `{{#...#}}` placeholders); the operator CLI now reads `.env.local` and its `homedir` import was corrected; the harness reads both audit files (index dir and sidecar config dir).

**2026-11-26 — live pilot (owner present)**

- `template-pc` created from `default` with **no** `API_SERVER_KEY`; `pilot-alice` cloned and given its own minted key. `gateway.multiplex_profiles` was already `true`; `hermes gateway list` serves default, template-pc, pilot-alice from one PID.
- `POST /p/pilot-alice/v1/responses` → **200**; legacy `POST /v1/responses` with the shared key → **200**; the legacy key on the pilot path → **401**.
- Lazy provisioning end to end: `POST /api/profiles/ensure` (identity `test.two@tvb.com.hk`) → **201**, profile cloned from the template, unique key minted, `USER.md` written, `POST /p/test-two-tvb-com-hk/v1/responses` → **200** on the first attempt; idempotent re-ensure → **200 created:false**; throwaway profiles deleted afterwards.
- Fixes found and applied during the pilot: warm check now probes `/p/<slug>/v1/models` (a full `/v1/responses` turn exceeded the 10 s warm budget); the identity index moved to the writable `~/.hermes/profiles-index/` because `~/.config/agentic-rag-mcp/hermes-mcp` is root-owned; the registry lock now fails fast on permission errors instead of reporting a false `provisioning_in_progress`.
- Known harness behaviour: re-using a slug immediately after deleting it returns `503 runtime_draining` until the gateway finishes draining the old runtime; a fresh slug is served immediately.

**2026-11-25 — offline implementation slice**

- Full Python gate: `.venv/bin/python -m pytest tests/unit tests/contract -q` → **1478 passed**.
- `cd ai-chat-landing && pnpm test` → **313 tests, 55 files, all passing** (new: identity U1/U2, registry U3–U7, provisioner I1–I4 + T041 unique-key + SC-009/T047 three domains + T016 concurrency, identity-user U18/U19, ensure/status-route auth/validation; operator CLI rotate/disable/enable/list; warm-failure honesty; by-reference message scoping; FR-026 legacy export module; SC-011 boundary-copy check; T046 rotation polling; T049 dual-mode lane wiring; single shared legacy-export module; H1 conversation-delete scoping; H2 cancel-turn profile ownership; M1 lastSeenAt debounce; M3 routing audit).
- `.venv/bin/python -m pytest tests/unit/test_hermes_profiles.py tests/contract/test_hermes_profile_routing.py -q` → **18 passed** (adds T049: identity → ensure → `/p/<slug>/` with the profile key, and no identity → legacy `/v1` with no profile created) (adds T015: ensure → key read → `/p/<slug>/v1/responses` against fake servers; T013 legacy path unchanged; traversal refused before any request; T048 TS↔Python taxonomy parity).
- `pnpm typecheck` clean; `pnpm lint` 0 errors (1 pre-existing warning in `scripts/stop-button-check.mjs`).
- Not yet implemented (tracked, open tasks): gateway rollout/pilot (T017), sidecar integration into `hermes_client.py` (T012, T015), legacy path pin (T013), operator scripts (T026–T029), legacy history export (T022), live E2E (T018, T023, T029, T033–T034, T038–T040).
- C1 remediation is in place and tested: the provisioner replaces the cloned `API_SERVER_KEY` with a freshly minted one, and two profiles get different keys (T041).

## Definition of Done

1. `pnpm test`, `pnpm typecheck`, `pnpm lint` green; `pytest tests/unit/test_hermes_profiles.py tests/contract/test_hermes_profile_routing.py -q` green.
2. Offline fixtures only in CI; no real CLI/gateway/network.
3. E1–E10 recorded owner-present against the real gateway on a pilot profile; throwaway profiles removed afterwards.
4. No key, token, raw oid, or email in logs/audit/HTTP responses (U22/U30 + manual scan).
5. Legacy path still pinned unchanged until the lane-migration step.
6. Quickstart followed end to end, including rollback.
