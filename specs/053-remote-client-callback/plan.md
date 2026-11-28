# Implementation Plan: Remote-client callback — session-origin targeting for every desktop action

**Branch**: `053-remote-client-callback` | **Date**: 2026-11-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/053-remote-client-callback/spec.md`

## Summary

Every desktop action the sidecar performs today — the five Hermes lanes (program launch, office/file task, read-only diagnostics, two-phase PowerShell) and all three `mcp_action` procedures — is hard-wired to the service host's Windows desktop through exactly two transport seams: the sidecar-direct SSE bridge (`windows_mcp.call_tool` → `http://172.17.0.1:18800/sse`, canonical host `127.0.0.1:8800`) and the gateway-agent call (`hermes_client.run_task_stream` → `http://172.17.0.1:8642` with instruction blocks that name the host's WindowsMCP). This feature resolves the target machine **per session** at those two seams: the Chat UI derives the requesting browser's origin server-side and forwards it through Dify as a `client_origin` tool argument (additive, variable-selector bound, never accepted from the browser); the sidecar matches it against an operator-managed remote-client registry and swaps the transport endpoints — bridge URL and agent endpoint paragraph — to the matched client. Unmatched origins resolve byte-for-byte to today's local default (FR-002); registered-but-disabled or unreachable targets refuse honestly and never silently re-target (FR-006). Evidence, attestations, capture, and audit all run against the resolved target, and every audit attempt records the target machine (FR-007/FR-008).

## Technical Context

**Language/Version**: Python 3.12 (sidecar package `agentic_rag_mcp`), TypeScript/Next 16 (one additive Chat UI proxy field), YAML (Dify chatflow DSL)

**Primary Dependencies**: existing only — httpx, FastMCP, the `mcp` SSE client, the Hermes gateway + agent (`http://172.17.0.1:8642`, bearer key), the WindowsMCP bridge pattern (`:18800/sse` → canonical `127.0.0.1:8800`). The remote client runs the same bridge + WindowsMCP + office automation stack — a deployment prerequisite, not a new dependency of this repo.

**Storage**: registry TOML at `~/.config/agentic-rag-mcp/remote-clients.toml` (read per request — no restart, FR-004); the existing append-only audit JSONL rows gain one additive `target` field

**Testing**: pytest unit + contract suites (registry matrix, transport parameterization, gate invariance, DSL binding), integration against a respx-mocked remote bridge, live end-to-end cases per [test-plan.md](test-plan.md)

**Target Platform**: the sidecar container (`agentic-rag`, :28080), the Dify chatflow (publish + Postgres verify), the Chat UI Next server, and the registered Windows client over the LAN

**Project Type**: per-session target resolution inside the existing Python MCP service + one additive Chat UI proxy field + chatflow DSL update

**Performance Goals**: a remote action completes within 2× the same action's local time over the LAN (SC-005, measured from the existing per-action `TIMING:` profile); target resolution itself (registry read + match) stays under 100 ms per call

**Constraints**: existing tool schemas stay additive (`client_origin` optional everywhere; existing contract snapshots unchanged); the `mcp_action` Dify binding keeps auto-bound `variable` selectors — `client_origin` is bound as a variable selector, never a template constant (spec 047 JSON-serialization invariant); all gates run before transport and are target-independent; local-default sessions are byte-identical to today (SC-002)

**Scale/Scope**: one new module `remote_clients.py` (~150 lines: registry + resolution), parameterization of the two transport seams (`windows_mcp/client.py`, `hermes_client.py` instruction block), additive `client_origin` args on the existing tools, one contract file, two new test suites + integration extension, one CDP acceptance script

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Contract Preservation | PASS | Additive only: `client_origin` is a new optional arg on existing tools (schemas extend, snapshots unchanged); DSL binding uses `variable` selectors; the Chat UI forwards one new input field; `RemoteClient` registry is new config, existing `[dify]`/`[hermes]` semantics untouched |
| II. Tests-First | PASS | [test-plan.md](test-plan.md) is written with this plan (owner request) — unit matrix, e2e cases, and the error-handling matrix precede implementation; suites land with the code and the full battery must be green |
| III. Minimal Dependencies | PASS | stdlib (tomllib) + already-installed httpx/`mcp` SSE only; the remote bridge/WindowsMCP is the *same* software the host already runs, deployed on the client — no new runtime service in this repo |
| IV. Honest Answers | PASS (core) | Evidence must come from the resolved target: attestations, command output, verified read-back, display checks, and capture all run against the matched machine (FR-009); unreachable/disabled → honest refusal naming the intended machine, zero execution anywhere (FR-006); no silent local re-target |
| V. Spec-Driven Replacement | PASS | The hard-wired localhost constants (`BRIDGE_SSE_URL` / `CANONICAL_HOST` / endpoint literals in instructions) are *retired* into the resolved-default path and deleted as standalone truths — no dead code, no config left behind for removed wiring |

Post-Phase-1 re-check: no violations introduced; the design *strengthens* Principle IV by making wrong-machine execution structurally impossible (transport endpoints are derived only from the registry match, and an unmatched or refused origin never reaches any Windows machine).

## Project Structure

### Documentation (this feature)

```text
specs/053-remote-client-callback/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── targeting.md     # Phase 1 output — client_origin arg + registry + resolution contract
├── test-plan.md         # Owner-requested addition — unit + e2e + error-handling matrix
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/agentic_rag_mcp/
├── remote_clients.py            # NEW — RemoteClientRegistry: TOML load, origin match, TargetResolution
│                                #       (local | remote(name, bridge) | refused(disabled)); read per call
├── config.py                    # MODIFIED — [remote_clients] path (default ~/.config/agentic-rag-mcp/remote-clients.toml)
├── windows_mcp/
│   └── client.py                # MODIFIED — call_tool takes the resolved target (bridge URL + canonical host);
│                                #   local default = today's constants verbatim; all windows_mcp lanes inherit
├── hermes_client.py             # MODIFIED — each lane instruction block gains a per-target endpoint paragraph
│                                #   (remote block names the client's bridge; local block unchanged byte-for-byte)
├── server.py                    # MODIFIED — hermes_* + mcp_action tools gain optional client_origin arg,
│                                #   resolve the target per call and thread it into both seams
│                                #   (windows_mcp/health.py's probe was already URL-parameterized; the
│                                #   applet-lane tools stay local — out of the six-tool FR-001 scope)
├── mcp_action/
│   ├── service.py              # MODIFIED (additive) — verification/display/capture run against the resolved target
│   └── actions.py              # MODIFIED (additive) — PowerShell read-backs against the resolved target
├── hermes_audit.py              # MODIFIED — audit rows carry the additive target field
└── hermes_gate.py, hermes_powershell_gate.py, hermes_run_gate.py,
    hermes_launch_gate.py, office_gate.py          # UNTOUCHED — gates are target-independent

dify/AGIAssistant/AGI_Assistant.yml               # MODIFIED — client_origin bound (variable selector) into tool args

ai-chat-landing/
├── app/api/chat/route.ts       # MODIFIED — derive origin server-side (forwarded chain / socket), send as input
└── scripts/remote-callback-check.mjs             # NEW — CDP acceptance (remote-client + host-local cases)

tests/unit/test_remote_clients.py                  # NEW — registry matrix: match/disabled/unmatched/ambiguity/malformed
tests/unit/test_remote_transport.py                # NEW — call_tool parameterization + instruction block injection
tests/contract/test_mcp_contract.py               # EXTENDED — client_origin additive; existing snapshots unchanged
tests/contract/test_mcp_action_dsl.py              # EXTENDED — variable-selector binding (no template constants)
tests/integration/test_remote_callback_transport.py # NEW — respx remote bridge: executes there, zero host-bridge calls
```

**Structure Decision**: exact mirror of the proven lane layout (a gate/stateless resolution module + a parameterized shared client + tool-wrapper threading + per-surface test files, cf. spec 034): resolution lives in **one** new module consumed by the **two** shared transport seams, so every lane — including the spec-041 applet lanes that call `windows_mcp.call_tool` directly — inherits correct targeting without per-lane edits.

## Complexity Tracking

No Constitution violations to justify. The one new mechanism is small and structural: transport endpoints are *derived* from the registry match instead of hardcoded, which makes wrong-machine execution (the defect this feature fixes) impossible rather than detected.

## Phases

- **Phase 0 — [research.md](research.md)**: eight design decisions — the origin derivation point (Chat UI server-side, forwarded chain), the transport through Dify (input + `variable` selector, honoring the spec-047 invariant), the two transport seams and what each needs, the registry shape (TOML, read per call), refusal semantics (disabled → refuse; unregistered → local default), gate invariance (gates run before transport), the audit target field, and the client-side bridge deployment contract. No NEEDS CLARIFICATION remains.
- **Phase 1 — design artifacts**: [data-model.md](data-model.md) (RemoteClient, TargetResolution, origin derivation, audit extension), [contracts/targeting.md](contracts/targeting.md) (the `client_origin` arg contract, registry schema, resolution outcomes, bridge deployment prerequisite), [quickstart.md](quickstart.md) (registry setup + remote acceptance + host-regression runs), and — per the owner's request — [test-plan.md](test-plan.md) consolidating the unit matrix, end-to-end cases, and the error-handling matrix.
- **Next**: `/speckit.tasks` decomposes this plan into the implementation task list.