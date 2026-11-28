# Contract: session-origin targeting (`client_origin`)

The client-facing surface this feature adds: one tool argument, its binding rule, the resolution outcomes, and the client-side deployment prerequisite. All existing tool schemas and audit shapes are additive-extended only — existing contract snapshots pass unchanged (Constitution I).

## 1. The `client_origin` tool argument

- **Shape**: `client_origin: str | None` (optional) on `hermes_file_task`, `hermes_launch_app`, `hermes_office_task`, `hermes_run_command`, `hermes_run_powershell`, and `mcp_action`
- **Provenance**: the Chat UI server derives it from the browser request's trusted forwarded chain (or socket address), normalizes it (port-stripped address literal), and forwards it as a chat input; the Dify DSL binds it into each tool call as an auto-bound `variable` selector over that input — **never a template constant** (the spec-047 JSON-serialization invariant: the tool list is serialized before substitution, and address literals contain `.`/`:` that would corrupt it)
- **Trust rule**: the sidecar treats `client_origin` as advisory routing metadata, not authority — it only ever *selects a registry entry the operator already trusted*; it can never name a machine, only match one (FR-005)
- **Browser rule**: the Chat UI route ignores any browser-supplied `client_origin` in request bodies; the value it forwards is computed, not read

## 2. Resolution outcomes (per tool call)

| Outcome | Trigger | Effect |
|---|---|---|
| `local` | `client_origin` absent/empty, or matches no registry entry | Today's behavior byte-for-byte: host bridge (`http://172.17.0.1:18800/sse`, canonical host `127.0.0.1:8800`) and today's agent instructions |
| `remote(<name>)` | Matches an enabled entry | Sidecar-direct calls use the entry's `bridge_url`; **agent-lane instruction blocks point the agent at its per-client registered gateway MCP tools** (gateway `mcp_servers` entries `WindowsMCP-<name>`/`OfficeMCP-<name>`, tool names `mcp__<service>_<name>__*` — hyphens as underscores; registration is part of the client runbook in DEPLOY.md); answers and audit name `<name>` *(amended 2026-11-28 by bug `no-open-word-hangs-up`: the original "agent drives the bridge manually via its browser tool" wording was unexecutable by the agent and hung remote turns)*. The remote paragraph carries a **DIRECT-CHANNEL RECOVERY OVERRIDE** (recover only via `<name>`'s channels — OfficeMCP `<office_url>`, WindowsMCP `<bridge_url>` — never `127.0.0.1`, which is the service host) and a **MACHINE-IDENTITY GATE** (probe `COMPUTERNAME` before any write; it must equal `<name>` case-insensitively; on mismatch → honest `TASK: FAILED` with the observed name — never proceed, never claim the remote target) *(amended 2026-11-28 by bug `no-open-microsoft-word` rounds 2–3)* |
| `refused(disabled)` | Matches a disabled entry | Honest refusal naming the machine and the disabled state; zero execution on any machine (never a local fallback) |
| `remote-v2` (supersedes round-2's refusal) | A remote session calls an office-v2 fast-path tool | The SAME fixed template executes against the requesting machine's OfficeMCP bridge as ONE deterministic sidecar call (`call_at`, one-shot session) with the identity gate armed in the payload; audit carries the target — simple remote writes are seconds, no inner agent *(round 4, 2026-11-28, bugs `no-open-microsoft-word` + `very-long-long-time-to-answer-back`)* |
| `refused(invalid-registry)` | Malformed/unreadable registry (implementation: exact-literal keys make ambiguity unreachable) | Honest operator-facing refusal on remote-intent paths; local paths unaffected |

Routing condition (Dify): the office-v2 fast-path routing rule applies only when the **rendered** start-variable `{{#1776072202913.client_origin#}}` is empty — bare `{{#client_origin#}}` is unsubstitutable by Dify's template parser and must never appear in a routing condition *(round 2)*.

Refusal answers always name the intended target machine by registry name; no path executes on machine B when machine A was requested (FR-006/FR-007).

## 3. Registry file contract

```toml
# ~/.config/agentic-rag-mcp/remote-clients.toml — operator-managed, read per call, no restart
[clients."192.168.1.42"]
name = "raymond-office"        # [a-z0-9-]+ — used in answers + audit target field
bridge_url = "http://192.168.1.42:18800/sse"   # http(s)://host:port/sse
enabled = true
```

- Keys: normalized address literals only; entries hold **no credentials** (the bridge/WindowsMCP sit in the deployment's LAN trust posture); optional `created_at` string per entry (else the file's mtime — T025)
- Edits (add/disable/remove) take effect on the next tool call (FR-004); every change is auditable via the file's own history AND emits one `registry-change` audit row on the first resolution after the change (T026); the audit `target` field records which entry each attempt used
- Absent file = empty registry (all-local); malformed file = remote intent refused, local paths unaffected

## 4. Client-side deployment prerequisite (operator contract, not this repo's code)

A registered Windows client runs the same stack the host does:

- WindowsMCP (and the office automation service) on the canonical local host, unchanged from the host deployment
- a bridge on `:18800/sse` forwarding to it, reachable at the client's LAN address, enforcing the same canonical-Host header discipline as the host bridge
- the deployment's existing trust posture: LAN-only reachability, no new public-internet exposure (FR-010), consistent with spec 052's remote-client posture

## 5. What this contract does NOT change

- Tool schemas, envelope shapes, gate verdicts, attestation protocols, output bounding, capture semantics, and the audit's no-token/no-path rules — additive `target` field and optional `client_origin` arg only
- The `mcp_action` Dify binding invariant: `conversation_id`/`dialogue_count`/`query` keep their auto-bound variable selectors (regression test `test_raw_query_with_newline_reaches_agent_without_tool_json_crash` must stay green)
- Local-default behavior for host-origin and unregistered sessions: byte-identical (SC-002/SC-006)