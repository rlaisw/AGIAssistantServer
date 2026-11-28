# Bug Assessment: Remote-targeted agent lanes hang — Word never opens, answer churns until stopped

- **Slug**: `no-open-word-hangs-up`
- **Created**: 2026-11-28T01:10:00Z
- **Source**: pasted text (user report during spec-053 T020 acceptance battery) + live audit evidence
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> "typed open microsoft word, no open word, hangs up thinking"

Typed into AGI Chat from the registered remote client (a301-11120, 10.161.92.34) during the first SC-001 acceptance prompt. Word never opened on the client; the chat UI stayed in its generating/"thinking" state until the user pressed Stop, twice (01:00–01:04 UTC window).

## Symptom

From the remote client's browser, a desktop action ("open microsoft word") routes to the remote target correctly (audit `target: a301-11120`), but the gateway agent produces no verdict for minutes — it churns reasoning events (271 events/60.7 s, then 2087 events/117.3 s across two attempts) until the user stops the turn, which the sidecar then audits honestly as `error: the turn was cancelled`. Expected: Word opens on the client within the normal launch-lane latency, with an attested `TASK: COMPLETED` verdict.

## Reproduction

1. From a browser on the registered remote client (origin 10.161.92.34, via `agia.tvb.com.hk`), send `open microsoft word`.
2. Observe: no Word window on the client; the answer spins ("thinking") with no completion.
3. Press Stop — the answer finalizes as a cancelled error; audit row records `operation: launch-app`, `target: a301-11120`, reason "the turn was cancelled".
4. Repeat — same result on the second attempt (audit `f9b88946-…`, 117.3 s, cancelled).

Live evidence: two audit rows in `agentic-rag:/root/.config/agentic-rag-mcp/hermes-mcp/audit.jsonl` (2026-11-28 01:01:59 and 01:04:23 UTC), both `launch-app`, `target: a301-11120`, `decision: error`, cancelled; timing profiles show dense event streams with 24–33 s inter-output gaps (active reasoning, not deadlock).

## Suspected Code Paths

- `src/agentic_rag_mcp/hermes_client.py:314-346` — `targeted_instructions()` remote paragraph: instructs the Hermes agent to "open an SSE session to `<client bridge_url>` (browser tool…) read the 'event: endpoint' line … then send MCP JSON-RPC there (initialize, then tools/call)" while ALSO forbidding its registered `mcp__WindowsMCP__*`/OfficeMCP tools. **The prescribed interaction is not executable by the agent's toolset** — its browser tools navigate/read/click pages; they cannot hold an SSE stream open while POSTing JSON-RPC to `/messages/?session_id=…`, and no tool issues arbitrary JSON POSTs. With the local path forbidden and the remote path impossible, the agent reasons indefinitely — the observed hang.
- `specs/053-remote-client-callback/research.md` D3 — the design decision that chose instruction-rewriting (agent drives the remote bridge manually) over a second gateway/agent deployment; the rejected alternative is exactly what the mechanism needed.
- `specs/053-remote-client-callback/contracts/targeting.md` §2 — the contract line "agent-lane instruction blocks name the entry's bridge/automation endpoints" that this implementation satisfies to the letter while being unworkable in practice.
- Affect scope: **all four agent lanes** (`hermes_launch_app`, `hermes_office_task`, `hermes_run_command`, `hermes_run_powershell`) share the same remote paragraph — every remote-targeted agent turn hangs. Unaffected: `mcp_action` (sidecar-direct, verified working against the client bridge), file-task (refuses remote targets honestly), local-default sessions (byte-identical, battery green).

## Root Cause Hypothesis

The spec-053 agent-lane remote transport was designed as a pure prompt rewrite ("tell the agent to dial the remote bridge itself via its browser tool"), which shipped green offline because the unit suites pin the paragraph *text*, not the agent's *ability to execute it*. The Hermes agent has no primitive that can speak MCP-over-SSE to the client bridge, so a remote-targeted instruction set leaves it with zero legal paths to the target machine: it cannot use its local tools (forbidden, wrong machine) and cannot follow the bridge instructions (impossible with browser tools). It burns the turn reasoning/retrying until the user stops it. Confidence: **high** (audit timing profiles + instruction text + toolset inventory all agree; the two live cancelled attempts are consistent).

## Proposed Remediation

**Preferred**: give the Hermes gateway *real* tools against the remote client, then make the remote paragraph name them. The gateway already supports HTTP MCP servers natively (`~/.hermes/config.yaml` `mcp_servers:` — "HTTP servers (connect to a URL): url"), and the client's bridges are live, reachable SSE MCP endpoints:

1. Register per-client servers on the Hermes gateway, e.g. `windows-mcp-a301-11120: url: http://10.161.92.34:18800/sse` and `office-mcp-a301-11120: url: http://10.161.92.34:18888/sse` (client runs the same WindowsMCP/OfficeMCP stack, so the agent gets the identical tool surface it already knows, namespaced per machine).
2. Rewrite `targeted_instructions()`'s remote paragraph from the impossible "drive SSE manually via browser tool" to: "this task's machine is a301-11120 — its tools are registered as `mcp__windows-mcp-a301-11120__*` (and `mcp__office-mcp-a301-11120__*` for Office); use ONLY those tools for this task; the local WindowsMCP/OfficeMCP tools act on a different machine and are refused." Attestation/consent/output-bounding language unchanged.
3. Deployment doc: the client-bridge section in DEPLOY.md gains the gateway `mcp_servers` entry as a standard part of registering a client.

**Alternatives**:

- Deploy a second Hermes gateway+agent ON the client (research.md D3's rejected option): cleanest isolation, instructions completely unchanged — but doubles the per-client deployment (gateway, model access, key management) and was explicitly rejected for that cost.
- **Short-term mitigation** (recommended until the fix ships): set `enabled = false` in `remote-clients.toml` for the client — FR-006 then refuses remote requests honestly ("a301-11120 is disabled…") instead of letting them hang, and local behavior stays byte-identical.

**Files likely to change**:

- `src/agentic_rag_mcp/hermes_client.py` (remote paragraph)
- `DEPLOY.md` (client registration runbook: gateway `mcp_servers` entries)
- `specs/053-remote-client-callback/{contracts/targeting.md,plan.md,research.md}` (D3 amendment + the contract's agent-lane row)
- `~/.hermes/config.yaml` (or the profile's config) — the per-client MCP server entries (deployment, not repo)

**Tests to add or update**:

- `tests/unit/test_remote_transport.py`: replace/augment the pinned-paragraph assertions — the remote paragraph must name the per-client registered tool prefixes and must NOT contain "open an SSE session" / "send MCP JSON-RPC there" (the impossible instruction is now a forbidden string).
- An integration/live case: a remote-targeted agent-lane turn produces a verdict within budget (not an unbounded churn) — e.g. battery scenario extension asserting a terminal audit decision (`executed`/`error` with a real reason, not only user-cancelled) for a remote launch.
- Contract note: `windows_mcp` applet lanes and the office-lane OfficeMCP path need their per-client counterparts named consistently if they later join remote scope (decision ⑦).

## Risks & Considerations

- The per-client gateway servers add tool surface to the agent (a full WindowsMCP+OfficeMCP set per registered client) — tool-count growth may affect the plugin tool-sync and prompt size; consider `lazy: true` on those `mcp_servers` entries.
- Bridge availability becomes load-bearing for chat turns (not just probes): if the client's bridge is down, remote agent turns fail with the existing honest unreachable envelope — acceptable, but the DEPLOY runbook should tie the scheduled task to the registry entry.
- Session/keepalive: `mcp_servers` HTTP default keepalive is 180 s; WindowsMCP session TTL should be confirmed above that (config comment warns about expired-session reconnects) — verify on the first live run.
- Multi-client scaling: one `mcp_servers` pair per registered client; machine registry changes need matching gateway config changes (the TOML registry alone no longer fully controls routing for agent lanes).
- The office lane's OfficeMCP flow (COM drive) should be smoke-tested on the client before declaring SC-001 done — this bug masked it (same paragraph, same hang).

## Open Questions

- [NEEDS CLARIFICATION: where the production Hermes gateway actually loads its `mcp_servers` (profile config vs `~/.hermes/config.yaml`) — the file inspected shows the section commented as template/examples, while the agent demonstrably has `mcp__WindowsMCP__*` tools; the fix's step 1 must target the real registration location.]
- [NEEDS CLARIFICATION: WindowsMCP-side session TTL vs the gateway's 180 s default keepalive — confirm no expired-session reconnect latency on the client path.]