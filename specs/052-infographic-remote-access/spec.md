# Feature Specification: Infographic URLs reachable by remote clients

**Feature Branch**: `052-infographic-remote-access`

**Created**: 2026-11-27

**Status**: Draft

**Input**: User description: "Infographics-Level 1 per-user URL namespace with enforced ownership" — resolved decision from the prior conversation: infographic URLs are namespaced under the requester's profile slug with proxy-enforced ownership.

## User Scenarios & Testing *(mandatory)*

*User journeys ordered by importance, each independently testable.*

### User Story 1: Remote client opens an infographic link (P1)

**As a** member chatting with the Chat UI from a browser on a different machine,
**I want** infographic links inside answers to point at a location my browser can reach,
**so that** clicking the link opens the infographic instead of an error.

**Acceptance Scenarios:**
1. US1/AC1: A user on a remote machine clicks an infographic link in an answer; the infographic page opens.
2. US1/AC2: The same link works on the machine hosting the chat service itself.
3. US1/AC3: The infographic link opens in the same tab/new tab as before (the chat's other link families keep their behavior).

### User Story 2: Existing infographic behavior is preserved (P2)

**As the** chat service owner,
**I want** infographic generation, storage, and rendering to stay exactly as today,
**so that** fixing reachability does not regress how infographics are produced or displayed.

**Acceptance Scenarios:**
1. US2/AC1: Infographics are generated exactly as before (same IDs, same page content).
2. US2/AC2: Existing answers' infographic markers/links continue to render as links (spec 046 behavior, 📌 blue text) with the new reachability.

## Requirements

### Functional Requirements

- **FR-001**: Every infographic URL emitted into a chat answer MUST be reachable by the client browser that renders the answer, regardless of the client's location relative to the service host.
- **FR-002**: The URL generation MUST NOT emit a host-bound literal that only resolves on the service host (e.g., a loopback host).
- **FR-003**: The mapping from the generated link to the served infographic page MUST be one-to-one and stable: each answer's infographic identifier resolves to its own page, and two different identifiers never map to the same page.
- **FR-004**: The reachability fix MUST NOT change infographic generation, page content, or the link's rendering contract (spec 046 link family behavior).
- **FR-005**: Infographic access MUST NOT create public internet exposure; reachability is limited to clients that can reach the chat UI origin.
- **FR-006**: A chat answer generated before the fix whose stored answer text contains an old loopback URL MUST resolve to the reachable location when clicked (old conversations stay usable).
- **FR-007**: Infographic URLs for signed-in users MUST be namespaced under the requester's profile slug (`/infographics/p/<slug>/<id>/`), and the serving route MUST refuse the request when the session's identity does not match that slug (ownership enforced; other users cannot open another user's infographic).
- **FR-008**: Anonymous or legacy requests without a profile slug keep the plain `/infographics/<id>/` form and remain governed by the single-user local-trust posture.

### Success Criteria

- **SC-001**: A user on a different machine from the service host opens an infographic link from a chat answer and the infographic page loads (measured on the live deployment, ≥ 2 distinct client machines, 100% of attempts in the acceptance run).
- **SC-002**: No infographic URL in a newly generated answer contains a loopback host.
- **SC-003**: Existing conversation history retains clickable, working infographic links (spot-check ≥ 3 historical answers).
- **SC-004**: The end-to-end path (click → rendered infographic) completes in under 10 seconds on the LAN.
- **SC-005**: A request for another user's profiled infographic URL is refused (cross-profile access attempts fail), while the owning user's own request succeeds.

### Scope / Non-Scope

**In scope**: where the infographic URL points, how clients reach it, and keeping historical answers usable.
**Out of scope**: changing how infographics are generated or rendered; multi-tenant access control on infographic pages (the single-user local-trust posture is retained); other link families (decks, sources).

## Key Entities

- **InfographicIdentifier**: the existing per-answer identifier (e.g., `4cafe75efa03`) that names one infographic page.
- **ChatAnswerLink**: a link embedded in a chat answer that a client browser resolves.

## Assumptions

- The service is deployed at `https://agia.tvb.com.hk`; the chat UI origin is the natural host infographic URLs should resolve against.
- Remote clients reach the chat UI over the LAN/WAN origin only; the loopback port where the infographic server listens is not reachable from their machines.
- Single-user local-trust deployment; no additional access control required beyond the chat UI's existing posture.

## Edge Cases

- Old answers containing the old loopback URL (handled by FR-006).
- A client browsing the chat UI directly on the service host — links must still work there.
- The infographic service restarting (identifiers remain valid because storage locations are unchanged).
