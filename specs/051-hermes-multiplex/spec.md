# Feature Specification: Hermes Multi-Profile Gateway (Phase 2)

**Feature Branch**: `051-hermes-multiplex`

**Created**: 2026-11-25

**Status**: Implemented — live acceptance recorded (T018/T023/T029/T033/T034/T038/T039); rollback requires profile removal, not the multiplex flag

**Input**: User description: "Setup hermes-multiplex — Phase 2 of the HERMES architecture: one host gateway, one port, routing by `/p/<slug>/`, per-profile API keys, one profile per user created on demand, driven by the Phase 1 Entra identity."

## Scope Boundary

Phase 2 turns the single shared Hermes agent into a **multi-profile service**: one process and one port serve every user, each user gets a private profile created on first sign-in, and exactly one profile is reachable per authenticated identity. Sign-in, identity, and the session that feeds this feature are Phase 1 (spec 050) and are complete; this feature consumes `oid`, `email`, and `display name` from that session and never re-implements authentication.

Out of scope: Entra registration and sign-in flow (Phase 1), the Dify chatflow's answer behaviour, and MCP tool semantics implemented by the existing lanes. The existing single-key Hermes path remains available for lane calls that have not yet been migrated.

## Clarifications

### Session 2026-11-25

- Q: How is the single multiplexing process organised? → A: Enable the Hermes gateway's native multiplexing: one process, one port, native `/p/<slug>/…` routing per request; no new router and no per-profile worker processes.
- Q: Who holds and checks each profile's credential? → A: Each profile owns its own API credential in its own profile configuration; the gateway enforces it on `/p/<slug>/…`. The registry stores no credential material.
- Q: Should chat history also be separated per user? → A: Yes — every chat and conversation-list call carries a per-identity user reference derived server-side from the signed-in identity, so a user's sidebar shows only that user's conversations.
- Q: When exactly should a user's profile be created? → A: Lazily, on the first request that is routed to the user's own agent; signing in, browsing, and general chat create nothing.
- Q: Which Windows and OneDrive identity should a profile act under? → A: Memory, files, chat, and audit are isolated per profile; Windows actions run under the single shared PC account. That boundary is documented and tested; per-profile OneDrive credentials are out of Phase 2.
- Q: What happens to conversations created before per-user history? → A: Preserve them, exclude them from every user's sidebar, and make them available only through an operator export.
- Q: What history do anonymous visitors see? → A: A shared `u-anon` bucket by design (no identity, no profile); per-browser anonymous scoping is a possible later change, not Phase 2.
- Q: How many profiles must be supported, and is bulk onboarding in scope? → A: Profiles are provisioned lazily one per user; bulk onboarding is out of scope. Capacity is measured at 25 registered profiles with 10 concurrent requests (SC-007); a 100-profile population remains a design target, not a verified requirement.
- Q: What happens when an agent-bound lane call has no identity? → A: During migration it uses the existing legacy single-key path and creates no profile (FR-021). A call carrying an identity always uses that profile's path and key; a partial identity is refused.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First sign-in provisions a private profile, everywhere (Priority: P1)

Alice signs in on her iPhone, asks the assistant to do something on her Windows PC, and it works. Later she signs in from Windows Chrome; the assistant already knows her, uses the same memory, and reaches the same Windows PC. Behind that, the system found no profile for her, created one atomically, and routed every request to it.

**Why this priority**: Without on-demand provisioning and stable routing there is no product — every later guarantee depends on the user getting exactly one profile.

**Independent Test**: Sign in as a fresh test user from two different browsers; confirm a profile appears exactly once in the registry and both sessions route to the same profile slug.

**Acceptance Scenarios**:

1. **Given** a signed-in user with no profile, **When** they send their first request that needs their own agent, **Then** a profile is created (folder, settings, per-user memory stub, per-profile key, registry entry) and the request is served by that profile.
2. **Given** the same user on a second device, **When** they make any request, **Then** no new profile is created and the same profile is used.
3. **Given** two first requests arrive at once for the same new user, **When** both are processed, **Then** exactly one profile exists and both requests succeed.
4. **Given** the profile is still warming up, **When** a request arrives, **Then** the user waits and is served once ready, or receives an honest "temporarily unavailable" message — never a silent fallback to another user's profile.
5. **Given** a user signed in but never used their own agent, **When** the registry is inspected, **Then** no profile exists for them and nothing was created at sign-in.

---

### User Story 2 - One user's data is invisible to another (Priority: P2)

Two employees use the same service from the same office. Each has their own memory, their own files, and their own connection to their own Windows PC. Neither can read, list, or act on the other's data, even by guessing a URL.

**Why this priority**: Isolation is the safety property that makes multi-user operation acceptable; a leak here is worse than no feature.

**Independent Test**: With two provisioned test users, attempt every access path with the wrong user's credential and confirm refusal and no side effects; confirm each profile contains only its own data.

**Acceptance Scenarios**:

1. **Given** two users with profiles, **When** one presents the other's profile path with their own key, **Then** the request is refused and nothing executes.
2. **Given** a request with no key or a made-up key, **When** it reaches the gateway, **Then** it is refused before any profile work happens.
3. **Given** a profile is disabled or removed, **When** its key is presented, **Then** the request is refused and the attempt is recorded.
4. **Given** a user's profile, **When** its memory, files, or audit records are inspected, **Then** only that user's data is present.
5. **Given** two users chatting on the same service, **When** either opens the conversation sidebar, **Then** only their own conversations are listed and another user's conversation cannot be opened by reference.

---

### User Story 3 - The operator can see and control every profile (Priority: P3)

An administrator can list profiles, inspect one, rotate its key, disable it when someone leaves, and read an append-only trail of every routing decision — without stopping the service or touching another user's data.

**Why this priority**: 100+ users cannot be operated by hand-editing folders; rotation and disable must be safe and fast.

**Independent Test**: List profiles, rotate one user's key (old key stops working, new key works), disable another (requests refused), and confirm both attempts are in the audit trail.

**Acceptance Scenarios**:

1. **Given** the service is running, **When** the operator lists profiles, **Then** each entry shows slug, identity reference, status, and creation time, with no secrets.
2. **Given** a key rotation, **When** it completes, **Then** the old key fails within one reconcile interval (≤30 s) and the new key works, with no service restart.
3. **Given** a disabled profile, **When** its user tries again, **Then** the request is refused with an honest message and the operator sees the attempt.
4. **Given** any routing or provisioning attempt, **When** the audit is read, **Then** it shows the outcome, reason, and a correlation id — and never a key, token, or identity secret.

---

### User Story 4 - Failures stay contained and honest (Priority: P4)

When the agent host is down, a profile folder is damaged, or the registry is mid-write, the user gets a clear message and other users are unaffected. A failed first-time creation leaves nothing half-built, and a retry succeeds.

**Why this priority**: At 100+ profiles, partial states and cross-user impact are inevitable unless explicitly prevented.

**Independent Test**: Simulate agent unavailability, a corrupt profile, a failed creation, and a registry write error; confirm honest errors, no partial profiles, and no impact on an unrelated user.

**Acceptance Scenarios**:

1. **Given** creation fails midway, **When** it aborts, **Then** no registry entry and no visible profile remain and a retry creates a clean one.
2. **Given** the agent host is unreachable, **When** a request arrives, **Then** the user gets an honest "temporarily unavailable" and no other profile is affected.
3. **Given** a profile's folder is missing or unreadable, **When** it is routed to, **Then** the request fails honestly, the failure is recorded against the profile (visible to the operator), and a retry after repair succeeds.
4. **Given** the registry is being updated, **When** a concurrent read occurs, **Then** it sees either the old or the new complete state — never a truncated entry.

---

### Edge Cases

- Two mailboxes with the same local part on different TVB domains (`@tvb.com`, `@tvb.com.hk`, `@tvb.com.cn`): three distinct profiles; the full domain is part of the slug.
- The user's email changes in the directory: the profile must not move (the identity key is the object id, and the mapping is persisted).
- A slug collides (same normalized email from different people): a deterministic object-id-derived suffix is appended; the same inputs always yield the same slug.
- Slug length or characters exceed a filesystem limit: the slug is bounded and charset-restricted, never containing path separators or traversal sequences.
- Guest or other-organization accounts never reach this feature (Phase 1 rejects them). A request with no identity uses the existing legacy single-key path and creates no profile (FR-021), with its history in the shared anonymous bucket; a partial identity is refused.
- Gateway restarts while a user is mid-turn: the turn fails honestly and is not attributed to another profile.
- A user is disabled in the directory but their key is still valid: directory-derived identity is no longer refreshed, so the session expires and the operator can disable the profile; the gateway must refuse a disabled profile immediately.
- The registry file is corrupt or unreadable: refuse new provisioning, keep existing routing if profiles are intact, and surface the condition to the operator.
- After the history cutover, the first signed-in user sees an empty sidebar; opening a pre-cutover conversation reference is refused rather than shown under their identity.
- Windows PC offline: the profile still routes and the tool reports unavailability honestly; no queued action is attributed to a different user.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All profiles MUST be served by one running process reachable on one port; a user MUST NOT require a new process, port, or installation.
- **FR-002**: Requests MUST be routed by a profile path of the form `/p/<slug>/…`; any other shape is refused.
- **FR-003**: The slug MUST contain only lowercase letters, digits, and hyphens, MUST NOT contain path separators, and MUST be treated as an opaque key — never as a filesystem path supplied by the caller.
- **FR-004**: Every profile-scoped request MUST carry that profile's own credential; missing, malformed, or foreign credentials MUST be refused before any profile work runs.
- **FR-005**: Credential comparison MUST not leak timing information, and credentials MUST NOT appear in URLs, response bodies, logs, or audit records.
- **FR-006**: Memory, files, working directory, audit records, and agent state MUST be isolated per profile; a request authorized for one profile MUST NOT read, list, or act on another. The Windows desktop session and its MCP tools run under the single shared PC account and are NOT isolated per profile — the product MUST state this boundary, attribute every action to the requesting profile in the audit, and MUST NOT claim OS-level isolation. Per-profile OneDrive credentials are out of scope for Phase 2.
- **FR-007**: Missing profiles MUST be created lazily at the first request routed to the user's own agent — never during sign-in or browsing. The flow is: registry lookup, then atomic creation (temporary location, then single rename), then warm check, then routing.
- **FR-008**: Creation MUST be idempotent per identity: concurrent first requests produce exactly one profile, and a repeated request after success reuses it.
- **FR-009**: A profile MUST contain its own folder, agent settings, a per-user memory file carrying display name, email, and the Windows user, a per-profile credential, and a registry entry that links the identity to the slug and records status and creation time.
- **FR-010**: On any creation failure, partial artifacts MUST be removed and no registry entry MUST remain; the next attempt starts clean.
- **FR-011**: The profile slug MUST be derived deterministically from the verified identity (object id plus the full email domain) with a deterministic object-id suffix only after a collision is detected; it MUST NOT be derived from device names or client-supplied values.
- **FR-012**: The identity-to-slug mapping MUST be persisted and MUST remain stable when the user's email or display name changes.
- **FR-013**: Identity MUST be taken only from the Phase 1 server-side session. Chatflow variables for slug, email, and object id MUST be filled server-side and MUST NOT be accepted from the browser or from message text.
- **FR-014**: A request without a signed-in identity MUST NOT create or route to any profile; anonymous general chat remains unaffected.
- **FR-015**: Every provisioning, routing, rotation, disable, and refusal event MUST append an audit record with outcome, reason, and a correlation id, excluding credentials and personal identifiers beyond a stable hash.
- **FR-016**: The operator MUST be able to list, inspect, rotate the credential of, and disable a profile without restarting the service; rotation takes effect on the next request.
- **FR-017**: A disabled profile MUST be refused with an honest message naming the state, without affecting other profiles; transient failures are reported honestly while the profile remains retryable.
- **FR-018**: The service MUST support at least 25 registered profiles and 5–10 concurrent requests with per-profile serialization of mutating work, without cross-profile blocking beyond queueing. A 100+ profile population remains a design target but is unverified, and bulk onboarding (many profiles created in one burst) is out of scope (Clarifications 2026-11-26).
- **FR-019**: A profile that is not warm yet MUST delay or honestly refuse the request; it MUST never be silently substituted with another profile or an anonymous context.
- **FR-020**: Unavailability of the agent host, the Windows PC, or the registry MUST map to a specific honest message and MUST not corrupt or partially mutate any profile.
- **FR-021**: Legacy calls that still use the existing single-key path MUST keep working until explicitly migrated; the migration itself is a separate, recorded step.
- **FR-022**: Each profile MUST own its own unique credential in its own profile configuration, enforced by the gateway on every `/p/<slug>/…` request; the provisioning step MUST generate a fresh credential per profile (never inherit the template's), the registry MUST store no credential material at all, and credentials MUST be recoverable only server-side.
- **FR-023**: A health/status surface MUST report, without secrets or personal data, whether the service is serving, how many profiles are active, and whether the agent host is reachable.
- **FR-024**: Multiplexing MUST use the gateway's native multi-profile mode: one process and one port, routing each request to its profile by the `/p/<slug>/…` prefix, with profiles discovered and served without a restart.
- **FR-025**: Chat history MUST be scoped per identity: every chat request and conversation-list request MUST carry a server-derived per-user reference, and the list MUST return only that user's conversations. A shared constant user reference is forbidden.
- **FR-026**: Conversations created under the former shared user reference MUST be preserved, MUST NOT appear in any user's sidebar, and MUST be reachable only through an operator export. Opening one by reference as a normal user MUST be refused, and the cutover MUST be recorded.

### Key Entities *(include if feature involves data)*

- **Profile**: the per-user agent workspace — slug, identity reference (object id hash), email and display name, the shared Windows user recorded for context, its own credential in its own configuration, status (active / disabled), creation time, and the location of its memory, files, and audit.
- **Registry**: the single source of truth linking identity to slug and status; supports atomic lookup and update; stores no credential material — each profile owns its credential.
- **Gateway Request**: one inbound call — profile path, presented credential, request id, outcome; never carries identity beyond the resolved profile.
- **Provisioning Attempt**: one creation run — identity, slug candidate, steps completed, outcome, rollback state.
- **Audit Record**: append-only event for provisioning, routing, rotation, disable, and refusal — outcome, reason, correlation id, hashed identity.
- **Profile Template**: the baseline content every new profile starts from (settings, empty memory, placeholders for display name, email, Window user).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user's profile is created and warm (accepting profile-scoped requests) in under 10 seconds in 95% of attempts, measured from the first authenticated agent-bound request; answer generation time is not part of this limit.
- **SC-002**: 100% of sign-ins from a second device resolve to the same profile; zero duplicate profiles in the registry for the same identity.
- **SC-003**: 100% of cross-profile access attempts (wrong credential, wrong path, disabled profile, invented slug) are refused with no side effects in the acceptance suite.
- **SC-004**: Zero credential values, session tokens, or raw object ids appear in logs or audit records (verified by scan of a full run).
- **SC-005**: Five simultaneous first requests for one new identity produce exactly one profile in 100% of trials.
- **SC-006**: 100% of simulated failure paths (agent host down, profile corrupt, creation failure, registry unreadable, Windows PC offline) end with an honest message, no partial profile, and no impact on an unrelated profile.
- **SC-007**: The service sustains 10 concurrent requests across 25 registered profiles without request failure and within 2× the single-profile latency (measured 2026-11-26: 10/10 OK, p95 82 ms versus ~80 ms for one profile).
- **SC-008**: An operator can list, rotate, and disable a profile in under 2 minutes using documented commands, with each action visible in the audit trail.
- **SC-009**: The three TVB mailboxes for one local part (`@tvb.com`, `@tvb.com.hk`, `@tvb.com.cn`) produce three distinct, stable profiles in a single test run.
- **SC-010**: In a two-user test, each user's conversation list contains 100% only their own conversations, and opening another user's conversation by reference is refused in 100% of attempts.
- **SC-011**: The acceptance record shows, for a two-user run, 100% profile attribution of Windows actions in the audit and an explicit statement of the shared-OS-account boundary; zero claims of per-user Windows or OneDrive isolation appear in user-facing text.
- **SC-012**: After cutover, 0 pre-cutover conversations appear in any user's sidebar in 100% of checks, the operator export contains them, and user attempts to open one are refused.

## Assumptions

- Hermes and its profiles live on the Linux/WSL host (`~/.hermes`, profiles root created during setup); only the MCP tools run on the Windows PC. The profile snippet in the source design (`hermes profile create`, `~/.hermes/profiles/<slug>`, `memories/USER.md`) is the model for creation.
- One process and one port serve all profiles; "no new gateway, no new port" applies per user, not to the single multiplexing process. The gateway's native multi-profile mode is the mechanism; no separate router is built.
- Credentials are profile-owned (each profile's configuration) and enforced by the gateway; the registry never holds them, so rotation is a profile-local update.
- Phase 1 identity is the only identity source; mechanisms to sign in again, refresh, or revoke are outside this feature.
- The Windows PC is a single logged-in desktop with one OS account; Windows/MCP actions therefore share that account. OneDrive isolation would require per-profile credentials and is deferred; until then no answer may promise per-user Windows or OneDrive isolation.
- Per-profile credentials are generated by the service (not typed by users), delivered only to the calling server component, and never to a browser.
- The existing single-key path stays in service until each lane is migrated; retirement happens in a later, explicit change.
- Profile creation happens at the first authenticated request that needs the user's own agent; browsing and anonymous chat create nothing.
- Email changes do not move a profile; the object id is the identity key and the mapping is persisted.

## Dependencies

- Phase 1 (`specs/050-azure-entra-oauth`): server-side identity (`oid`, `email`, `display name`) and the `requireIdentity()` guard. Completed and verified live.
- The existing Hermes agent and its MCP tool surface on the Windows host, including the shared gateway address used by the sidecar.
- The Dify chatflow's HTTP/tool wiring, which must pass the slug/email/object id from the server, never from the browser.
- The Chat UI's Dify client, which must send a per-identity user reference for chat and conversation listing (currently a shared constant), and the operator path used to export the pre-cutover conversations.
