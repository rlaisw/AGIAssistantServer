# Research: Remote-client callback (spec 053)

Eight design decisions for session-origin targeting. Each records the decision, the rationale, and the alternatives evaluated. No NEEDS CLARIFICATION remains.

## D1 — Where the session origin is derived

- **Decision**: the Chat UI Next server (`ai-chat-landing/app/api/chat/route.ts`) derives the client origin server-side — the leftmost forwarded-chain entry (`X-Forwarded-For`) when a trusted reverse proxy is in front, else the socket's remote address — normalizes it (strip port, lowercase IPv6), and forwards it into the Dify chat call as an input field. The browser never supplies it; the route ignores any browser-supplied `client_origin` in request bodies.
- **Rationale**: the Next server is the only hop that observes the browser's TCP origin (Dify only ever sees the Next server). FR-005 requires server-side observation; deriving at the proxy edge and ignoring client-sent values keeps it a trust decision, not a suggestion from the page.
- **Alternatives considered**: (a) sidecar reverse-lookup of the Dify→sidecar TCP peer — rejected: that address is always the Dify container; (b) registry keyed by Dify `conversation_id` — rejected: binds the conversation, not the machine, and breaks when the same conversation resumes from another device (spec edge case); (c) client-declared machine name in message text — rejected outright by FR-005 (prompt-injection surface).

## D2 — How the origin reaches the sidecar tool calls

- **Decision**: one new optional tool argument `client_origin` on every desktop-bound tool (`hermes_file_task`, `hermes_launch_app`, `hermes_office_task`, `hermes_run_command`, `hermes_run_powershell`, `mcp_action`), bound in the Dify DSL as an auto-bound `variable` selector over the chat input — the same mechanism `conversation_id`/`dialogue_count`/`query` already use. Absent/empty → local default (FR-002).
- **Rationale**: reuses the proven binding path; additive (Constitution I); and the spec-047 lesson applies verbatim — the tool list is serialized to JSON before substitution, so a template constant with the origin's slashes/colons would corrupt it. A `variable` selector is structurally safe.
- **Alternatives considered**: (a) a per-conversation sidecar state register ("first tool call binds the target") — rejected: state to replay, expires mid-conversation, and the origin is observable per request anyway; (b) a separate `set_client_target` tool the relay calls first — rejected: adds a turn and a prompt-injection handle; the input binding needs no relay cooperation.

## D3 — The two transport seams that must resolve the target

- **Decision**: all desktop work flows through exactly two seams, and both take the resolved target as a parameter:
  1. `windows_mcp/client.py::call_tool` — the sidecar-direct SSE bridge (used by `mcp_action`, the spec-041 applet lanes, settings reads, GUI flows, health probes): gains the bridge URL + canonical host as call parameters; the local default is today's `BRIDGE_SSE_URL`/`CANONICAL_HOST` verbatim.
  2. `hermes_client.py::run_task_stream` — the gateway-agent lanes: each instruction block gains a per-target endpoint paragraph naming the resolved machine's bridge URL (and, for office lanes, that machine's automation endpoint); the local block stays byte-for-byte as today.
- **Rationale**: one resolution point per seam means every consumer inherits targeting; nothing about the gates, attestation protocols, or output bounding changes — they are target-independent.
- **Alternatives considered**: (a) a second Hermes gateway *on the client* with its own agent, the sidecar routing `/p/<slug>/`-style per machine — rejected for Phase 1: a second gateway process contradicts FR-004's no-new-service spirit and roughly doubles the deployment; the agent-on-host can reach the client's WindowsMCP bridge over the LAN exactly like the sidecar can; (b) routing *chat* through per-client Hermes profiles — rejected: spec 051 profiles are identity-scoped, this feature is machine-scoped (spec edge case: same owner, two machines).

## D4 — The registry

- **Decision**: operator-managed TOML at `~/.config/agentic-rag-mcp/remote-clients.toml`, read per tool call (mtime-cached, no restart — FR-004). Entries keyed by normalized origin:
  ```toml
  [clients."192.168.1.42"]
  name = "raymond-office"
  bridge_url = "http://192.168.1.42:18800/sse"
  enabled = true
  ```
  The registry file holds no credentials; the bridge/WindowsMCP on the client sits in the deployment's LAN trust posture (spec 052).
- **Rationale**: TOML matches the existing `config.toml` house pattern; per-call read makes add/disable/remove take effect on the next request with zero restarts and every change auditable by the file's own history.
- **Alternatives considered**: (a) entries in `config.toml` itself — rejected: registry churn would touch the credential-bearing file, and `config.toml` is redacted in CLI output, so a separate file is safer; (b) a mutable admin endpoint for registry edits — rejected: YAGNI, the operator is the file's editor and FR-004 only demands no-restart effect, which per-call reads give.

## D5 — Refusal semantics (the honesty core)

- **Decision**: resolution has exactly three outcomes, and none falls back to another machine:
  - origin matches an **enabled** entry → remote target;
  - origin matches a **disabled** entry → refuse honestly, naming the machine and the disabled state (US2/AC2, FR-006) — *never* silently degrade to local, which would run the action on the host;
  - origin matches **nothing** (phone, NAT, proxy) → local default, byte-identical to today (FR-002).
  Ambiguous registrations (two entries matching one origin) and a malformed/unreadable registry file are refused with honest operator-facing errors for *remote* intent paths and fall back to local only for empty-`client_origin` paths; the local default itself never needs the registry.
- **Rationale**: the failure that motivated this spec (silent wrong-machine execution) must be structurally impossible in every failure mode; a disabled client degrading to local would resurrect it.
- **Alternatives considered**: (a) disabled → local fallback with a warning — rejected as dishonest-by-design (the action *runs*, on the wrong machine); (b) unreachable-after-match → local fallback — rejected for the same reason (FR-006); unreachable-after-match refuses.

## D6 — Gates stay target-independent

- **Decision**: every gate (run-command allowlist, PowerShell never-list, launch one-target rule, office literal/ask-back rules, skill-loop re-confirmation, `mcp_action` proposal confirm/expiry) runs exactly where it does today, before transport, with no target awareness. Gate refusals never mention a machine because no machine was selected for them.
- **Rationale**: FR-009 requires remote execution to gain *no relaxations*; gates evaluating before target selection makes that structural and keeps their unit suites untouched (Constitution I).
- **Alternatives considered**: per-target gate variants (e.g., a stricter remote never-list) — rejected: no requirement asks for it and it doubles the gate matrix.

## D7 — Audit and attribution

- **Decision**: every audit row a desktop attempt already writes gains one additive `target` field (`local` or the client's `name`); refusals for disabled/unreachable targets write their rows with the same field and reason. Answers attribute the machine by its registry name ("…on raymond-office"), never by raw IP.
- **Rationale**: FR-008 attribution; SC-004's acceptance audit check reads the field directly; names keep audit rows human-readable and free of address churn.
- **Alternatives considered**: full endpoint URLs in audit rows — rejected: FR-008 forbids credential-bearing or needlessly operational material; the name is the stable identifier.

## D8 — The client-side deployment contract (prerequisite, not this repo's code)

- **Decision**: a registered client runs the *same* stack the host does, documented in [contracts/targeting.md](contracts/targeting.md): WindowsMCP + office automation bound to the canonical local host, a bridge on `:18800/sse` reachable at the client's LAN address, and the deployment's existing trust posture (no new public exposure, FR-010). The client's bridge enforces the same canonical-Host header discipline the host bridge does.
- **Rationale**: reusing the identical bridge pattern means zero new code in this repo for the client side and the sidecar's existing header discipline carries over; the operator's job is deployment (bind/firewall), which the spec already declares out of scope.
- **Alternatives considered**: (a) the client's WindowsMCP binding `0.0.0.0:8800` directly — rejected: widens the service's exposure and still needs a Host-header story; the bridge keeps it uniform; (b) an SSH/WireGuard tunnel per client — rejected: new infra ops for a LAN deployment already inside the trust posture.

## Error handling (owner-requested addition)

The full error matrix — transport failures, refusal paths, spoofed/missing origin, mid-conversation registry changes, truncation, Stop mid-remote-execution — is consolidated in [test-plan.md](test-plan.md) §3 and validated per row by the unit/integration suites and the live e2e cases. Design-level invariants: every refusal names the intended machine; no failure path executes on any machine other than the resolved target (or, for empty origin, the local default); unreachable ≠ disabled ≠ unregistered are distinct honest messages.