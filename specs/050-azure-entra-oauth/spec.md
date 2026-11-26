# Feature Specification: Azure Entra ID Single Sign-On (Phase 1)

**Feature Branch**: `050-azure-entra-oauth`

**Created**: 2026-11-25

**Status**: Implemented — offline suite green (261 vitest, typecheck + lint clean); live tenant acceptance E1–E9 pending owner-present

**Input**: User description: "Setup Azure Auth-2.0 base on the above chat conversation" — Phase 1 of the HERMES multi-profile architecture: Azure/Entra ID app registration and OIDC authorization-code + PKCE sign-in that yields a stable per-user identity for the later single-host gateway (Phase 2).

## Scope Boundary

Phase 1 covers identity end to end inside the product: tenant app registration, working sign-in and sign-out in the Chat UI backed by a server-side session, the identity contract handed to downstream features, and the operator runbook plus validation harness. Profile creation and provisioning, the profile registry and slug-based routing, the single-host gateway, Dify variable wiring, and MCP execution are Phase 2 and are explicitly out of scope here; Phase 1 ships only the deterministic slug derivation helper (`lib/auth/slug.ts`) and its tests. This feature must nevertheless produce the exact identity values Phase 2 depends on.

## Clarifications

### Session 2026-11-25

- Q: Does Phase 1 stop at Azure registration, or must it also deliver working sign-in in the Chat UI? → A: Phase 1 delivers the registration plus working Chat UI sign-in and sign-out (server-side session, identity available to the app); profile creation and provisioning stay in Phase 2.
- Q: Must every visitor sign in before chatting, or does anonymous chat remain? → A: Anonymous chat remains for general answers; sign-in is required for identity-bound features (personal memory, Hermes/Windows-PC lanes), with sign-in available from the header.
- Q: Which tenants may sign in? → A: Single-tenant, organizational members only; guest accounts from other organizations are rejected at sign-in.
- Q: How does the application authenticate itself when redeeming the code — client secret or certificate? → A: Client secret held server-side, rotated every 6 months; certificate-based authentication is documented as the future upgrade.
- Q: How long should a signed-in session last? → A: 8-hour sliding idle timeout with a 12-hour absolute maximum.
- Q: Must a derived per-user identifier include the email's full domain? → A: Yes — the local part and every DNS label are kept, so `peter.chan@tvb.com.hk` → `peter-chan-tvb-com-hk`, `peter.chan@tvb.com.cn` → `peter-chan-tvb-com-cn`, `peter.chan@tvb.com` → `peter-chan-tvb-com`; the oid-hash suffix is used only after a collision.
- Q: Is an unregistered return address the application's failure to report? → A: No — the organization's sign-in refuses it before any request reaches the application, so SC-007 covers only app-observable failures and the registration mismatch is an operator runbook check.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Employee signs in with their work account (Priority: P1)

An employee opens the Chat UI and chooses "Sign in with Microsoft". They authenticate with their organization account (including whatever MFA or Conditional Access the tenant enforces) and return to the Chat UI already signed in. They never create a password for this application, never see a SAML screen, and never type their email address into the app.

**Why this priority**: Without this journey nothing else can start; it establishes the verified identity every later feature consumes.

**Independent Test**: Complete the sign-in from a browser with a test tenant account and confirm the application holds a verified identity with an object id and an email address, and that no token is readable from browser storage.

**Acceptance Scenarios**:

1. **Given** a signed-out user with a valid tenant account, **When** they start sign-in, **Then** they are redirected to the organization's Microsoft sign-in, complete it, and return to the Chat UI showing their own display name.
2. **Given** the user completed sign-in, **When** the callback is processed, **Then** the application records object id, email, display name, and tenant id, and creates a server-side session.
3. **Given** a sign-in that used a replayed or altered callback (stale state, mismatched nonce, or reused authorization code), **When** it reaches the callback, **Then** no session is created and the user sees a plain error with a way to retry.
4. **Given** a user declines consent or cancels at the Microsoft screen, **When** they return, **Then** no session exists and the Chat UI explains that sign-in was not completed.
5. **Given** a visitor without a session, **When** they ask a general knowledge question, **Then** they receive the usual answer without being forced to sign in, and the header still offers sign-in.
6. **Given** a visitor without a session, **When** they request a feature that needs their identity (personal memory or a Windows-PC action), **Then** the application asks them to sign in first and does not attempt the identity-bound work.

---

### User Story 2 - The same identity everywhere (Priority: P2)

The same person signs in from a phone browser and later from a desktop browser. Both sessions represent one identity: identical object id, identical email, identical display name. Downstream features can therefore attach memory and data to the person rather than to a device or browser.

**Why this priority**: The Phase 2 requirement "profile follows the user, not the device" fails if identity drifts between devices.

**Independent Test**: Sign in from two independent browser profiles and compare the recorded identity values; they must match exactly.

**Acceptance Scenarios**:

1. **Given** a user signed in on one browser, **When** they sign in on a second browser, **Then** the recorded object id and email are byte-identical.
2. **Given** the same user, **When** their display name or mailbox alias changes in the directory, **Then** the object id is unchanged and the identity record still resolves to the same person.

---

### User Story 3 - Operator provisions and proves the setup (Priority: P3)

An administrator sets up the organization's application registration from a written runbook, configures the permitted return addresses and the identity claims, stores the client credential outside the repository, and runs a validation harness that walks the whole sign-in sequence and reports each step. The same runbook works on a fresh test tenant.

**Why this priority**: A setup that cannot be reproduced or proven cannot be trusted in production, and the next phase depends on the contract being correct.

**Independent Test**: On a clean test tenant, follow only the runbook, then run the validation harness; every step passes and the report shows the required claims present with no secret values.

**Acceptance Scenarios**:

1. **Given** a fresh tenant and the runbook, **When** an administrator follows it, **Then** a working application registration exists with the documented return addresses and claims, using only server-side credentials.
2. **Given** the registration, **When** the validation harness runs, **Then** it reports the full sequence step by step and fails loudly on any missing claim or validation error.
3. **Given** the repository and its history, **When** searched for client secrets, **Then** no secret value is present.

---

### Edge Cases

- The user's directory entry has no email claim (or the claim is empty): the verified sign-in name is used instead; if neither exists, sign-in fails honestly rather than inventing an address.
- A guest account from another organization attempts sign-in: the attempt is rejected because only members of the deploying organization are accepted, and the message says so without revealing internal configuration.
- A visitor without a session requests an identity-bound feature: they are asked to sign in and the feature does not run; nothing is queued or half-started.
- Two different users share a display name, or two mailboxes share a local part across domains: identity keys on object id, never on display name; the later slug step must be able to disambiguate.
- Token expiry occurs mid-session, or the tenant revokes the session / requires re-authentication through Conditional Access: the user is asked to sign in again without losing unsent work.
- The user signs out: the local session is cleared and the organization sign-in session is ended so the next sign-in prompts rather than silently reusing the account.
- The callback arrives after the allowed window (slow network, suspended device), or the browser clock is skewed: the attempt fails cleanly and can be retried.
- Sign-in is attempted from a return address that is not registered: the organization sign-in refuses before the application is reached (operator runbook check, not an app-observable error); the app never fabricates a message for a request it did not receive.

## Auth Flow (binding sequence)

The sign-in MUST follow this order; each step has an observable acceptance check:

1. The user starts sign-in from the Chat UI; the application sends them to the organization's authorization endpoint with its client id, the registered return address, requested identity scopes, a one-time state value, a nonce, and a derived proof key challenge.
2. The organization's sign-in authenticates the user and applies tenant policy (MFA, Conditional Access) without the application seeing credentials.
3. The organization redirects back to the registered return address with a one-time authorization code and the state value.
4. The application verifies the state matches the browser session, then redeems the code together with the proof key at the organization's token endpoint, authenticating itself server-side.
5. The organization validates the request and returns the identity token, an access token, and (when offline access was requested) a refresh token.
6. The application validates the identity token: signature against the tenant's published keys, issuer, audience, validity window, and the nonce from step 1.
7. The application extracts object id, email, display name, and tenant id; a token missing the object id is rejected.
8. The application stores the identity in a server-side session and issues only an opaque session cookie to the browser.
9. The browser returns to the Chat UI signed in; subsequent renewals use the refresh token without another interactive prompt until tenant policy or expiry requires one.

### Token artifacts

| Artifact | Purpose | How it is validated | Typical lifetime | Where it lives |
|---|---|---|---|---|
| Authorization code | One-time proof the user authenticated at step 3 | Single use, short window, bound to the proof key and return address | Minutes | Never stored; redeemed immediately |
| State value | Ties the callback to the browser that started sign-in | Exact match with the session value, single use | The sign-in window | Browser session only |
| Nonce | Binds the identity token to this sign-in | Exact match inside the identity token | The sign-in window | Browser session only |
| Proof key (verifier) | Proves the client that started sign-in is the one redeeming | Only its derived challenge travels to the organization; verifier stays server-side | The sign-in window | Server-side session |
| Identity token | Carries the verified identity claims | Signature, issuer, audience, validity window, nonce | Short | Server-side only |
| Access token | Authorizes calls to organization APIs | Bearer, expiry | Short | Server-side only |
| Refresh token | Renews the session without a prompt | Organization-issued, rotated where supported, revocable | Days, per tenant policy | Server-side only |
| Session cookie | Represents the signed-in state to the browser | Opaque, signed, secure transport, not readable by scripts | Hours to days, sliding | Browser |

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to authenticate exclusively through their organization's Microsoft identity provider; no local password, no SAML, and no separate account creation.
- **FR-002**: The sign-in MUST use the authorization-code flow with a proof key for code exchange; the verifier MUST never leave the server.
- **FR-003**: The application MUST generate and validate a one-time state value and a nonce on every sign-in, and MUST reject a callback whose state or nonce does not match.
- **FR-004**: The application MUST redeem the authorization code server-side, authenticating with a server-held client credential, and MUST NOT expose that credential or any token to the browser.
- **FR-005**: The application MUST validate the identity token's signature, issuer, audience, validity window, and nonce before trusting any claim, and MUST accept only the single configured organization's issuer — tokens issued for another organization, including a guest's home tenant, are rejected.
- **FR-006**: The application MUST record, for every successful sign-in, a stable object id, a verified email address (or verified sign-in name when email is absent), a display name, and the tenant id; a token without an object id MUST be rejected.
- **FR-007**: The recorded identity MUST be identical for the same person across browsers and devices, and MUST NOT change when the display name or mailbox alias changes.
- **FR-008**: The identity handed to downstream features MUST contain object id, email, and display name as separate values so a deterministic per-user identifier can be derived without another directory lookup.
- **FR-009**: Sessions MUST be server-side; the browser MUST receive only an opaque session cookie that is not readable by scripts and is sent over secure transport in non-local environments.
- **FR-010**: Sessions MUST renew without an interactive prompt while tenant policy permits, MUST expire after 8 hours without activity, and MUST end at 12 hours from first sign-in regardless of activity or when the tenant revokes access, whichever comes first.
- **FR-011**: Sign-out MUST clear the local session and end the organization sign-in session so the next sign-in prompts.
- **FR-012**: The application MUST present honest, non-technical messages for cancel, consent refusal, configuration mismatch, replayed callback, expired session, and revocation; no error path may create a partial session or reveal tokens.
- **FR-013**: The organization's application registration MUST be provisioned and documented per environment (local development and deployed), with separate or explicitly listed return addresses, and MUST register an exact-match return address for each.
- **FR-014**: The client credential MUST live only in server-side configuration that is excluded from the repository, MUST be absent from logs and error output, and MUST be a client secret rotated at least every 6 months with an overlap window so rotation needs no downtime; certificate-based authentication MUST be documented as the upgrade path.
- **FR-015**: The sign-in events (success and failure) MUST be recorded with the object id or its stable hash and a reason, and MUST NOT record tokens or raw client credentials.
- **FR-016**: A repeatable validation harness MUST walk all nine steps against a chosen tenant and report per-step pass/fail plus which required claims are present, without printing token contents or secrets.
- **FR-017**: The feature MUST be deliverable on a fresh test tenant using only the written runbook, with no undocumented manual steps.
- **FR-018**: The Chat UI MUST expose sign-in and sign-out controls and MUST show the signed-in user's display name; the sign-in entry point MUST be reachable without the application first demanding credentials of its own.
- **FR-019**: Visitors without a session MUST still be able to ask general questions; identity-bound features (personal memory, Hermes/Windows-PC lanes) MUST require a signed-in session and MUST NOT execute, or start profile work, without one.
- **FR-020**: A request for an identity-bound feature without a session MUST result in a clear sign-in prompt and no partial work; the same request MUST proceed normally once signed in.
- **FR-021**: A per-user identifier derived from the email address MUST contain the local part and every DNS label of the domain, in order, so `peter.chan@tvb.com.hk`, `peter.chan@tvb.com.cn`, and `peter.chan@tvb.com` yield three distinct identifiers (`peter-chan-tvb-com-hk`, `peter-chan-tvb-com-cn`, `peter-chan-tvb-com`); it MUST NOT truncate, drop, or reorder domain labels. Collision disambiguation MUST be a deterministic suffix derived from the object id.

### Key Entities *(include if feature involves data)*

- **User Identity**: the person as the organization asserts them — stable object id, verified email, display name, tenant id. One identity may back many sessions and devices.
- **Auth Session**: a server-side record binding a browser to a User Identity, with creation time, expiry, renewal state, and the transient sign-in values (state, nonce, proof verifier) that only exist during a sign-in.
- **Application Registration**: the organization-side configuration for this application — client id, permitted return and sign-out addresses, requested identity scopes, and a reference to the server-held credential (never the credential itself).
- **Token Artifact**: any short-lived value produced by the flow (see table above); only the session identity is durable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An employee already signed in to their organization account completes sign-in and lands back in the Chat UI in under 30 seconds and no more than three interactions.
- **SC-002**: 100% of successful sign-ins yield both an object id and an email (or verified sign-in name); 0% of sign-ins create a session without them.
- **SC-003**: The same person signing in from two independent browsers produces identical identity values in 100% of attempts.
- **SC-004**: No client credential or token value is discoverable in the repository, its history, application logs, or browser storage (verified by inspection and a history search).
- **SC-005**: A signed-in user actively using the application is not prompted to sign in again within 8 hours, a session with no activity for 8 hours requires a fresh sign-in, and no session survives beyond 12 hours from first sign-in.
- **SC-006**: The validation harness reports all nine steps passing and the required claims present on a fresh tenant in under 15 minutes of operator time.
- **SC-007**: 100% of the app-observable failure paths (cancel, consent refusal, stale callback, absent object id, guest/other-organization account, missing or invalid server configuration, sign-in service unavailable) end with an honest message and no session. An unregistered return address is refused by the organization before the application runs and is covered by the operator runbook, not this criterion.

## Assumptions

- Single-organization (single-tenant) registration, members only: users are members of the deploying organization. Guest (B2B) accounts and other organizations are rejected at sign-in; supporting either would change issuer validation and is out of scope.
- The Chat UI runs on one HTTPS origin in production and on a local development origin; both return addresses are registered explicitly. Production use requires secure transport end to end.
- The identity token is configured to include the object id, email, and preferred sign-in name claims; no organization API permissions beyond basic identity are requested, so no access token is used for data access in this phase.
- MFA and Conditional Access are enforced by tenant policy, not by this application; the application must simply survive a re-challenge.
- Client authentication uses a server-held client secret, rotated at least every 6 months with an overlap window; certificate-based authentication is documented as the future upgrade, not built in Phase 1.
- The per-user schedule/profile identifier is derived by Phase 2 from the identity values defined here; Phase 1 guarantees their presence, stability, and uniqueness, and ships the tested derivation helper. The slug keeps the full email FQDN (`tvb.com.hk` ≠ `tvb.com.cn` ≠ `tvb.com`); Phase 2 persists the `oid → slug` mapping on first creation so later email changes cannot move a profile.
- Session policy is owned by the application: 8-hour sliding idle expiry and a 12-hour absolute maximum (tenant policy may be stricter and always wins); the application must never extend a token or session beyond these limits.
- The validation harness runs against a test tenant with at least two accounts: a member (end-to-end sign-in) and a guest, used to prove the guest is rejected.
