# Feature Specification: Hermes desktop actions call back the remote Windows client

**Feature Branch**: `053-remote-client-callback`

**Created**: 2026-11-27

**Status**: Implemented (offline suites green, 2026-11-27) — live acceptance battery (T019/T020) pending an owner-present remote client

**Input**: User description: "i want to Hermes agent call-back remote client not my local windows desktop . i just tested in remote windows client that installed windows-mcp and officemcp , type this in prompt 'open microsoft word, type hello raymond', but AGI Chat open Microsoft Word on wsl of Windows desktop (not on my remote client windows desktop). do you know what i mean?"

**Intent confirmation**: Yes — today every Hermes-lane desktop action (open apps, type into documents, diagnostics, PowerShell) executes on the service host's own Windows desktop (the machine hosting WSL), because the execution path is hard-wired to the host desktop's MCP services. The requested feature: when a chat session originates from a remote Windows client that runs the same desktop MCP tools, the requested desktop actions execute on that remote client's desktop instead.

## Clarifications

### Session 2026-11-27

- Q: How should the system decide which Windows machine a chat session's desktop actions run on? → A: Automatic session-origin matching — the server-side observed origin of the request is matched against the operator's client registry; unmatched origins (phone, NAT) keep today's local-desktop behavior; no machine selector appears in the Chat UI (a picker remains a possible later addition).
- Q: Should a desktop action that will run on a remote client execute immediately, or should the answer first confirm the target machine with the user? → A: Immediately, with attribution — remote-targeted actions run without an extra blanket confirmation step, exactly like local actions today; the answer names the machine it ran on; the existing gates are the only confirmation surface.
- Q: Do the mcp_action automations (default printer, Word duplex, system health check) also need to run on the remote client, or do they stay on the service host? → A: Include mcp_action — the three reviewed mcp_action procedures also follow the session's target machine, with their existing proposal/confirm semantics, verified execution, Settings display checks, and capture all running against that machine.

## User Scenarios & Testing *(mandatory)*

*User journeys ordered by importance, each independently testable.*

### User Story 1 - Desktop actions follow the requesting machine (Priority: P1)

**As the** owner chatting in AGI Chat from a browser on my remote Windows client (the machine that runs the same windows-mcp and office-mcp desktop tools),
**I want** the desktop actions I request — open an app, type into a document, run a read-only diagnostic, run a confirmed PowerShell command, or a confirmed mcp_action procedure (default printer, Word duplex, system health check) — to execute on that machine,
**so that** "open microsoft word, type hello raymond" opens Word on the client desktop I am sitting at, not on the service host's desktop.

**Why this priority**: This is the reported defect. Today every desktop action lands on the host's Windows desktop no matter where the user chats from; until the action follows the requester's machine, remote use is wrong by default and the answer cannot be trusted.

**Independent Test**: From the remote client's browser, send "open microsoft word, type hello raymond"; Word opens on the remote client with the text typed, nothing opens on the host desktop, and the answer says the action ran on the remote client.

**Acceptance Scenarios**:

1. **Given** a registered, enabled remote client and a chat session originating from that machine, **When** the user requests a desktop action, **Then** the action executes on the remote client and the answer reports that machine as where it ran.
2. **Given** the same request sent from a session on the service host's own desktop, **When** it executes, **Then** it runs on the local desktop exactly as today (answers, gates, and audit unchanged).
3. **Given** a desktop action completes on the remote client, **When** the answer is written, **Then** every claim of what happened (app opened, text typed, command output) describes the remote client's desktop — never the host's.

---

### User Story 2 - The operator registers which machines may receive callbacks (Priority: P2)

**As the** operator,
**I want** to register a remote Windows client — which machine it is and where its desktop tools listen — and to disable or remove it later,
**so that** only machines I explicitly trust are ever targeted, and I can see in one place which machines exist.

**Why this priority**: Routing desktop actions to a network machine is a trust decision; the registry is what makes the feature safe and operable.

**Independent Test**: Register the remote client — a session from it routes desktop actions there. Disable it — the next desktop request from that machine is refused honestly and audited. Re-enable it — actions route there again.

**Acceptance Scenarios**:

1. **Given** the registry, **When** the operator adds a remote client entry, **Then** sessions originating from that machine are matched to it on their next request, with no service restart.
2. **Given** a registered but disabled remote client, **When** a matched session requests a desktop action, **Then** the request is refused with an honest message naming the disabled state, and nothing executes anywhere.
3. **Given** the operator lists the registry, **When** it is inspected, **Then** each entry shows the machine identity, its desktop-tool location, status, and creation time — with no secrets.

---

### User Story 3 - Unreachable or wrong targets are refused honestly, never silently re-targeted (Priority: P3)

**As the** owner,
**I want** an honest "that machine is not reachable / is disabled / is not registered for remote actions" answer when my client cannot be acted on,
**so that** no desktop action ever lands on the wrong machine without me being told.

**Why this priority**: A silent fallback to the host desktop would recreate the exact defect this feature fixes — files and apps appearing on the wrong desktop — which is a trust failure worse than refusing.

**Independent Test**: Stop the remote client's desktop tools (or block their endpoint); send a desktop request from that machine's session; the answer reports that the remote machine could not be acted on, and inspection of the host desktop shows nothing executed there.

**Acceptance Scenarios**:

1. **Given** a matched session whose remote client is unreachable, **When** a desktop action is requested, **Then** the answer honestly reports that the remote machine could not be reached and that nothing ran.
2. **Given** a session originating from a machine that is not registered (for example a phone on the LAN), **When** a desktop action is requested, **Then** it executes on the local desktop exactly as today.
3. **Given** any refused or failed remote attempt, **When** the audit is read, **Then** the attempt, its reason, and the intended target machine are recorded.

---

### User Story 4 - Every existing safety gate applies unchanged to remote targets (Priority: P4)

**As the** owner,
**I want** the existing protections — one launch target per request with a launch attestation, literal-only Office content with ask-backs, the read-only diagnostics allowlist, the PowerShell never-list and two-phase confirmation, and the mcp_action proposal's immediate-next-turn confirm and expiry rules — to apply exactly as today on the remote client,
**so that** remote execution gains no relaxations over local execution.

**Why this priority**: The gates are what make desktop automation acceptable at all; pointing them at a new machine must not weaken them.

**Independent Test**: From the remote client, attempt a never-listed PowerShell command and an ambiguous two-target launch; both are refused exactly as they would be locally, with the refusals audited against the remote machine.

**Acceptance Scenarios**:

1. **Given** a remote-targeted session, **When** a gate would refuse the request locally (never-list, allowlist, ask-back, one-target rule), **Then** it refuses identically on the remote client.
2. **Given** a confirmed two-phase PowerShell request from a remote-targeted session, **When** the confirm arrives, **Then** only the stored draft executes on the remote client — the confirm carries no command text, exactly as today.

---

### Edge Cases

- The remote client's browser session works but its desktop tools are not reachable (port, firewall, service down): the desktop action is refused honestly; the chat itself is unaffected.
- The session origin cannot be matched to any registered client (NAT, proxy, phone): the local-desktop default applies — exactly today's behavior.
- The remote client's network location changes (DHCP, reinstall): the operator updates the registry entry; an ambiguous registration that would match one origin to two machines is refused.
- A registry entry is disabled or removed mid-conversation: the next desktop request from that session follows the new registry state and says so honestly.
- Concurrent desktop actions from two different machines: each executes on its own target; one machine's action never runs on another's.
- The same owner signs in (spec 051 profile) from the remote client: the profile is unchanged; targeting is per machine, and the audit attributes both the requesting profile and the target machine.
- The remote client runs a different Windows account than the host: actions execute under the remote client's own logged-in account, and answers describe that machine's actual state.
- ~~The Windows file lane cannot follow a remote target~~ (superseded by T024, 2026-11-28): the file lane now routes remote-targeted tasks to the matched client via the agent's per-client FileSystem tools — the launch-lane pattern (gates first, then per-target instructions); local host-mounted paths keep the blocking JSON path byte-for-byte. The interim refusal (documented when only `/mnt/c` mounting existed) is retired.
- The office-v2 fast paths (`doc_write_v2`/`xls_write_v2`/`ppt_write_v2`/`doc_read_v2`) are local-only: a remote session's v2 call is refused server-side (audited, naming the machine and the correct lane), and the Dify routing condition renders the actual origin — never an unsubstitutable placeholder (bug `no-open-microsoft-word` rounds 1–2, 2026-11-28).
- On a degraded gateway channel, a remote agent turn recovers ONLY via the matched client's direct channels (never the host's `127.0.0.1` recovery paths) and gates every write on a `COMPUTERNAME` identity match — a mismatch is an honest `TASK: FAILED`, never a wrong-machine write or a fabricated identity confirmation (bug `no-open-microsoft-word` round 3, 2026-11-28 — the 05:17 turn wrote on the host while claiming the remote target).
- Word/Office or a requested app is missing on the remote client: the action fails honestly with the remote machine's real error; no fabricated success.
- The remote client is a second machine of the same owner, not a new user: no new sign-in, profile, or sharing surface is created by this feature.
- A mcp_action proposal drafted from a remote-targeted session is confirmed from a session whose target machine differs (or the reverse): the confirm is treated as an unrelated response and never executes — the proposal's target machine is bound at draft time, and its verified execution, display checks, and capture all run against that machine.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every Hermes-lane desktop operation (program launch, Office document control, Windows file task, read-only diagnostic, two-phase PowerShell execution) and every `mcp_action` procedure (default printer, Word duplex, system health check) MUST execute on the Windows machine the chat session originates from when that machine is a registered, enabled remote desktop client.
- **FR-002**: Sessions whose origin is not a registered remote client MUST keep exactly today's behavior: execution on the service host's local desktop, with unchanged answers, gates, and audit.
- **FR-003**: The system MUST keep an operator-managed registry of remote desktop clients (stable machine identity, the network location of that machine's desktop tools, status) and MUST NOT route desktop operations to any machine absent from it.
- **FR-004**: The operator MUST be able to add, disable, and remove a remote client without a service restart; changes take effect on the next request, and every registry change is audited.
- **FR-005**: The targeting decision MUST be made server-side from the session's observed origin; it MUST NOT be taken from message text, browser-supplied values, or client-declared machine names.
- **FR-006**: When the matched remote client cannot execute (unreachable, disabled, credential rejected, or its tools return an error), the answer MUST honestly state what failed and that nothing ran, and the system MUST NOT execute the operation on any other machine — silently or otherwise.
- **FR-007**: Answers for remote-targeted actions MUST attribute the remote machine as the machine that ran them, and MUST NOT claim or imply execution on a machine they did not act on; refusals and failures MUST name the intended target machine.
- **FR-008**: The append-only audit MUST record, for every desktop action attempt, the target machine and the outcome; no credentials or secrets appear in audit records.
- **FR-009**: All existing lane gates MUST apply unchanged to remote targets — launch attestation and one-target rules, Office literal-content and ask-back rules, the read-only diagnostics allowlist, and the PowerShell never-list with two-phase confirmation — and the evidence behind an answer (attestations, command output) MUST come from the target machine. A remote-targeted action MUST NOT introduce an additional blanket confirmation step: it runs immediately, with the answer attributing the machine it ran on (Clarifications 2026-11-27).
- **FR-010**: Remote callbacks MUST be limited to registered machines over the deployment's existing network trust posture; no new public-internet exposure may be introduced.
- **FR-011**: Credentials used to reach a remote client's desktop tools MUST be held server-side only and MUST NOT appear in answers, links, or audit records.

### Key Entities *(include if feature involves data)*

- **Remote Desktop Client**: a registered Windows machine that runs the desktop MCP tools — stable machine identity, network location of its desktop tools, status (enabled / disabled), registration time.
- **Client Registry**: the operator-managed source of truth listing the remote desktop clients; maps a session's origin to a client and refuses ambiguity.
- **Targeting Decision**: one routing outcome per desktop request — session origin → target machine (a remote client, or the local-desktop default) — recorded with the audit entry.
- **Session Origin**: the server-side observed origin of a chat request, used for matching; never taken from user input.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the remote client, the acceptance prompt "open microsoft word, type hello raymond" opens Word with the text typed on the remote client's desktop in 100% of ≥ 5 acceptance attempts, with zero windows or processes opened on the host desktop.
- **SC-002**: Host-origin sessions behave identically to today for ≥ 3 spot-checked desktop operations (same answers, same gates, same audit shape).
- **SC-003**: 100% of attempts against an unreachable or disabled remote client produce an honest unavailability answer with zero execution on any other machine.
- **SC-004**: 100% of desktop actions in the acceptance run are attributed in the audit to the machine that actually executed them; zero wrong-machine executions.
- **SC-005**: A remote desktop action over the LAN completes within 2× the time the same action takes on the local desktop, measured on the live deployment from the existing per-action timing profile.
- **SC-006**: A session from an unregistered machine (for example a phone on the LAN) keeps today's local-desktop behavior in 100% of spot checks.
- **SC-007**: A confirmed mcp_action proposal (system health check) offered from a session on the remote client executes on the remote client in 100% of ≥ 3 acceptance attempts, with its report and capture describing that machine and zero mcp_action execution on the host desktop.

## Scope / Non-Scope

**In scope**: which Windows machine a Hermes-lane desktop action or `mcp_action` procedure executes on (session-origin targeting via an operator-managed client registry), honest attribution and refusal when the target cannot act, re-targeting the `mcp_action` verified-execution/display/capture stack along with the lanes, and keeping host-origin sessions byte-for-byte unchanged.

**Out of scope**: an explicit "choose the machine" selector in the Chat UI; changes to any lane or mcp_action gate, attestation, or audit schema beyond adding the target machine; new sign-in, profiles, or multi-user sharing surfaces (spec 051 is untouched); and remote-client software installation/updates (an operator deployment prerequisite).

## Assumptions

- The remote client runs the same Windows-side desktop MCP services as the host (windows-mcp and office-mcp), and its desktop tools are reachable from the service over the LAN; exposing them (bind address, firewall) is an operator deployment prerequisite.
- A chat session's observed origin identifies the machine it comes from (direct LAN browsing; no proxy/NAT ambiguity); when the origin cannot be matched, the local-desktop default applies.
- The deployment stays single-owner local-trust (the spec 052 posture): registry entries are operator-trusted machines, and no new user-facing authentication is introduced.
- Targeting is automatic by session origin; an explicit "choose the machine" selector in the Chat UI is out of scope as a possible later addition.
- `mcp_action` (specs 047–048) follows the session target: default printer, Word duplex, and the system health check act on the machine the chat session originates from, with their proposal/confirm, verified-execution, Settings display, and capture semantics unchanged (Clarifications 2026-11-27).
- Actions on the remote client run under that client's own logged-in account; answers describe the target machine's state, never the host's.
- The existing Hermes lane wiring (gateway bearer call, automation-service fallback) and spec 051 profiles are unchanged; this feature adds target selection ahead of them.

## Dependencies

- The existing Hermes desktop lanes and their gates (specs 029, 030/031, 033, 034, 041) — unchanged, re-targeted per session.
- The `mcp_action` execution/verification stack (specs 047–048): proposal/confirm flow, before/after read-back, Settings display checks, screenshot capture, and the pinned health-check script — re-targeted per session.
- The server-side execution path the sidecar uses to reach the host desktop's MCP services today; this feature points that path at a per-session machine.
- Spec 051 profiles — orthogonal: identity attribution is unchanged, targeting is per machine.
- The deployment network (spec 052): remote clients reach the Chat UI origin over the LAN, and the service can reach back to registered clients.