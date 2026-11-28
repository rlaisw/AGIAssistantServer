# Test Plan: Remote-client callback (spec 053)

Consolidates every test surface for the feature: unit suites, integration transport tests, contract extensions, live end-to-end cases, and the error-handling matrix. Created with the plan per the owner's request; the tasks in `tasks.md` implement exactly these cases, tests-first (Constitution II).

## 1. Unit tests

### 1a. Registry resolution suite — `tests/unit/test_remote_clients.py`

| Case class | Cases | Expected |
|------------|-------|----------|
| Match, enabled | `client_origin` equals an enabled entry's key | `remote(name, bridge_url)`; name used for answers/audit |
| Match, disabled | equals a disabled entry | `refused(disabled)` naming the machine — **never** `local` |
| No match | unknown origin literal; empty string; `None` | `local` — today's constants, zero registry error surfaced |
| Malformed origin | `"../../etc"`, hostname text, `"127.0.0.1:99999"` (unnormalizable) | `local` (cannot match an address-shaped key) |
| Malformed registry | unparsable TOML; entry with invalid `bridge_url`; entry with missing `name` | remote-intent calls refuse `registry-unreadable`; empty-origin calls unaffected (`local`) |
| Missing registry file | no file at path | empty registry → all origins `local` |
| Ambiguity | two entries whose keys both match one malformed origin | `refused(ambiguous)` |
| Registry reload | edit file between calls (mtime change) | next call uses the new content; no restart, no stale entry |
| No secrets | entry containing a `key`/`token` field | ignored + refused as invalid entry (registry holds no credentials) |

### 1b. Transport parameterization suite — `tests/unit/test_remote_transport.py`

| Case | Expected |
|------|----------|
| `call_tool` local default (no target) | hits `http://172.17.0.1:18800/sse` with canonical Host `127.0.0.1:8800` — byte-identical to today (pinned) |
| `call_tool` remote target | hits the entry's `bridge_url` with the same canonical-Host discipline; zero host-bridge calls (respx) |
| Instruction block, local | today's endpoint paragraph verbatim (pinned substring) |
| Instruction block, remote | paragraph names the entry's bridge URL; local literal absent |
| Tool wrapper threading | `hermes_run_command`/`hermes_run_powershell`/`hermes_launch_app`/`hermes_office_task`/`hermes_file_task`/`mcp_action` each resolve once per call and thread the target into the seam they use |
| Gates before transport | a never-list draft with a remote `client_origin` is refused by the gate with zero transport calls of any kind |
| Audit rows | execution/refusal/error rows carry `target` (`local` or the entry name); disabled-refusal rows name the machine |

### 1c. Existing suites — unchanged (regression scope)

Run-command allowlist, PowerShell never-list/two-phase, launch, office, `mcp_action` actions/concurrency/state, screenshots/reports routes, spec-047 Dify contract (`test_raw_query_with_newline_reaches_agent_without_tool_json_crash`), spec-051 profiles: all green without modification.

## 2. Contract tests

- `tests/contract/test_mcp_contract.py` (extended): `client_origin` present, optional, on exactly the six tools; existing schema snapshots unchanged.
- `tests/contract/test_mcp_action_dsl.py` (extended): `client_origin` bound as a `variable` selector — never a template constant; `conversation_id`/`dialogue_count`/`query` selectors untouched (spec-047 invariant).
- Chat UI route contract: derived `client_origin` = forwarded-chain/socket computation; a browser-supplied `client_origin` body field is ignored.

## 3. Integration — `tests/integration/test_remote_callback_transport.py`

| Case | Expected |
|------|----------|
| Remote-targeted `call_tool` against a respx-mocked remote bridge | request hits the remote URL with correct headers; response relayed honestly |
| Remote bridge 5xx / connection refused | honest `error` naming `<name>` unreachable + recovery hint; zero host-bridge fallback calls (assert none) |
| Disabled entry mid-conversation | first call executes remotely, registry flipped, next call refuses honestly |
| `mcp_action` remote attempt | verified read-back + capture flow all against the remote mock; lock/audit unchanged |

## 4. End-to-end cases (live, after publish)

| # | Scenario | Expected |
|---|----------|----------|
| E2E-1 | From the client: "open microsoft word, type hello raymond" | Word opens on the client with the text typed; answer attributes the client by name; host desktop untouched (SC-001) |
| E2E-2 | Same prompt from the host's browser | Local execution, byte-identical to today; audit `target: "local"` (SC-002) |
| E2E-3 | Same prompt from an unregistered machine (phone) | Local default, unchanged behavior (SC-006) |
| E2E-4 | Registry `enabled = false`, prompt from the client | Honest refusal naming the disabled machine; nothing executes anywhere (SC-003) |
| E2E-5 | Client bridge stopped, prompt from the client | Honest unreachable answer, nothing ran; host untouched (SC-003) |
| E2E-6 | From the client: system health check via `mcp_action` proposal → confirm | Report + capture describe the client; zero host execution (SC-007) |
| E2E-7 | From the client: "format my D: drive" + confirmation | Refused exactly as locally (never-list binds despite any target); audit rows against the client |
| E2E-8 | Stop mid-remote-execution | Honest cancelled verdict; partial work on the client disclosed; `conversation_id` carried throughout |
| E2E-9 | CDP acceptance: `node ai-chat-landing/scripts/remote-callback-check.mjs` | Wide-layout/scripted assertions: remote answer renders with target attribution; host-local path unchanged |

## 5. Error-handling matrix

| Failure mode | Layer | Expected behavior |
|--------------|-------|-------------------|
| Remote bridge unreachable / transport drop | Tool | Honest `error` naming `<name>` + recovery hint; zero execution on any machine; audit error row with `target` + timing |
| Remote bridge credential rejection (if the client enforces one) | Tool | Honest refusal naming the machine; never bypassed, never local-fallback |
| Entry disabled | Resolution | `refused(disabled)` naming the machine — never silent local (the defect this spec fixes) |
| Registry malformed/unreadable | Resolution | Remote intent refused `registry-unreadable`; local paths unaffected |
| Ambiguous match | Resolution | `refused(ambiguous)`; nothing executes |
| `client_origin` spoofed from the browser | Chat UI route | Ignored — the value is computed server-side, never read from the body |
| `client_origin` absent in the Dify call (old chatflow / non-chat path) | Tool schema | Defaults to `None` → local behavior, unchanged |
| Requested app/Office missing on the client | Tool | Real remote error relayed honestly; no fabricated success |
| Remote output > bound | Tool | Bounded with truncation named (unchanged discipline) |
| `USER_CONTROL` consent wait on the remote channel | Agent instructions | Same retry/attest protocol as the host channel; honest failure if it doesn't clear |
| Never-list / allowlist refusal with a remote target | Gate | Identical verdicts to local — gates are target-independent, run before transport |
| Mid-conversation registry disable/remove | Resolution | Next call follows the new state and says so honestly |
| Concurrent actions from two machines | Both seams | Each executes only on its own resolved target; no cross-target leakage |
| Stop mid-remote-execution | Cancel machinery | Honest cancelled verdict; `conversation_id` required throughout |
| Audit-redaction | Audit | No `bridge_url` credentials, tokens, or paths in rows; `target` carries the name only |

## 6. Regression scope

Full Python suite green (unit + contract); the five lane suites and all `mcp_action` suites unchanged; ruff clean on new/modified sources; Chat UI `pnpm test && pnpm typecheck && pnpm lint` green; deploy `redeploy` + publish by explicit app ID + `verify` per house rule (never name-based `deploy all`).