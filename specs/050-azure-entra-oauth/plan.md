# Implementation Plan: Azure Entra ID Single Sign-On (Phase 1)

**Branch**: `050-azure-entra-oauth` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/050-azure-entra-oauth/spec.md` with clarifications of 2026-11-25 (Chat UI sign-in in scope; anonymous chat retained; single-tenant members only; client secret rotated every 6 months; 8-hour idle / 12-hour absolute sessions).

## Summary

Add Microsoft Entra ID sign-in to the existing Next.js Chat UI (`ai-chat-landing/`) using the OIDC authorization-code flow with PKCE, a single-tenant app registration, and a server-side session. Anonymous general chat keeps working unchanged; the signed-in identity (`oid`, `email`, `display name`, `tid`) becomes available server-side for Phase 2's profile provisioning and gateway routing, and a tested `requireIdentity()` guard is the enforcement point those routes will call. No token ever reaches the browser: the browser holds only an opaque session handle.

Scope is Phase 1 only. Profile creation, slug derivation, the single-host gateway, Dify variable wiring, and MCP execution are Phase 2.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22 (Next.js 16 App Router, React 19)

**Primary Dependencies**: one new runtime dependency, `jose` (JOSE/JWT/JWKS, zero transitive runtime deps). Everything else uses the platform: `node:crypto` for PKCE/state/nonce and cookie signing, `fetch` for discovery/token/JWKS, Next route handlers for endpoints.

**Storage**: in-process session and pre-auth transaction stores (two `Map`s with TTL sweeps) inside the single Next.js server process. No database. Restart ends sessions (users sign in again) and multi-instance deployment is unsupported; upgrade path is a SQLite-backed store behind the same interface.

**Testing**: `pnpm test` (vitest) for unit + integration; integration uses an in-process fake OIDC provider (`ai-chat-landing/tests/support/fake-idp.ts`, `node:http`) so no network or tenant is required. Live owner-present acceptance uses a CDP script (Chrome on `:9240`) like the other instruments in `ai-chat-landing/scripts/`. No Playwright.

**Target Platform**: Linux host / Docker for the Next.js server; desktop and mobile browsers for users.

**Project Type**: web application (frontend + server route handlers in one Next project)

**Performance Goals**: callback completes in < 500 ms excluding the identity provider; discovery/JWKS cached (24 h, refreshed on unknown key id); sign-in interaction ≤ 3 clicks, < 30 s for an already-authenticated tenant user (SC-001).

**Constraints**: single-tenant issuer pinned to `https://login.microsoftonline.com/<tenant-id>/v2.0`; no access token used for data access; cookies `HttpOnly`, `SameSite=Lax`, `Secure` outside local development; 8 h idle / 12 h absolute session; 10 min pre-auth window; 5 min clock skew; no auth-related changes to `/api/chat` request or response.

**Scale/Scope**: 100+ organizational users, 5–10 concurrent, single server process; two environments (local development, production origin).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| **I. Contract Preservation (NON-NEGOTIABLE)** | PASS — four new `/api/auth/*` routes are additive; `/api/chat`, `/api/conversations`, `/api/attach`, `/api/models`, `/api/image-proxy` requests and responses are untouched. Identity is server-only context; no MCP tool or `ask` field changes. |
| **II. Tests-First** | PASS — every unit and route behavior below has a test in [test-plan.md](./test-plan.md) that is written before implementation; the fake-IdP integration suite is deterministic and offline. |
| **III. Minimal Dependencies** | PASS with one justified addition — see Complexity Tracking (`jose`). Ladder: stdlib lacks JWKS/JWT verification; hand-rolling it is a security risk; no installed dependency covers it. |
| **IV. Honest Answers (NON-NEGOTIABLE)** | PASS — identity is never fabricated: a token without `oid` is rejected, a missing email falls back only to the verified sign-in name, and every failure maps to a specific honest message (Error Handling below). No silent fallback identity. |
| **V. Spec-Driven Replacement** | PASS — no superseded behavior; anonymous chat is retained by design (Clarification 2), not deprecated. |

**Quality gates**: pytest suite is unaffected (no Python changes); `cd ai-chat-landing && pnpm test && pnpm typecheck && pnpm lint` must be green before any task is complete. Tests are deterministic (fake IdP, injected clock, no network in CI paths).

**Post-Phase-1 re-check**: PASS — the design adds only the four additive `/api/auth/*` routes and client-side header state; no MCP or `ask` contract changes, no Python changes, no new runtime service, and the single dependency is justified below. No gate violation requires the Complexity Tracking table beyond that entry.

### Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| One new dependency: `jose` | Production-grade JWT/JWKS verification, key-id-aware cache, algorithm allow-list, clock tolerance | Hand-rolled verification with `node:crypto` is ~200 lines of security-critical parsing (base64url, RS256, JWKS rotation, `kid` miss); a mistake is an auth bypass. `next-auth`/Auth.js pulls a large dependency tree and its own session/route model for four endpoints. |

## Project Structure

### Documentation (this feature)

```text
specs/050-azure-entra-oauth/
├── plan.md                 # this file
├── research.md             # Phase 0 decisions D1–D12
├── data-model.md           # Phase 1 entities and state
├── quickstart.md           # operator + developer validation runbook
├── test-plan.md            # unit, integration, live E2E, error matrix
├── contracts/
│   ├── entra-app-registration.md   # Azure-side settings contract
│   ├── auth-http-api.md            # routes, cookies, status codes, error codes
│   └── identity-contract.md        # identity shape Phase 2 consumes
├── checklists/requirements.md
├── spec.md
└── tasks.md                # created by /speckit.tasks
```

### Source Code (repository root)

```text
ai-chat-landing/
├── lib/auth/
│   ├── config.ts           # env → tenant/client/redirect/scopes; fail-fast config errors
│   ├── discovery.ts        # OIDC metadata fetch + cache
│   ├── jwks.ts             # JWKS fetch/cache + unknown-kid refresh
│   ├── pkce.ts             # S256 verifier/challenge, state, nonce (node:crypto)
│   ├── claims.ts           # identity extraction, email fallback, issuer/aud/nonce checks
│   ├── session-store.ts    # sessions + pre-auth transactions (TTL sweep, injected clock)
│   ├── session.ts          # opaque cookie set/clear, idle/absolute expiry, renewal
│   ├── guard.ts            # requireIdentity() → 401 signin_required contract
│   ├── renew.ts            # refresh within 5 min of access-token expiry, single-flight
│   ├── log.ts              # structured auth events, hashed oid, never tokens
│   ├── error-messages.ts   # client-safe ?auth_error=<code> → sentence
│   ├── slug.ts             # full-FQDN slug derivation + oid collision suffix
│   ├── control-state.ts    # pure session payload → header control state
│   └── errors.ts           # error taxonomy → honest message + HTTP status
├── app/api/auth/
│   ├── signin/route.ts     # step 1: state/nonce/PKCE, set pre-auth cookie, 302 to Entra
│   ├── callback/entra/route.ts  # steps 3–8: validate, exchange, verify, create session
│   ├── signout/route.ts    # clear local session, end Entra session
│   └── session/route.ts    # signed-in identity or anonymous
├── components/auth-control.tsx  # header sign-in/sign-out + display name
├── tests/support/
│   ├── fake-idp.ts         # in-process OIDC provider (discovery/token/JWKS, failure switches)
│   ├── tokens.ts           # RS256 ID-token builder for tests
│   └── flow.ts             # route-level sign-in/callback/session helpers
├── scripts/entra-auth-check.mjs # live CDP acceptance (owner present)
└── scripts/entra-flow-check.mjs # operator 9-step harness (loopback public client)
```

**Structure Decision**: single web application. Auth is a self-contained module under `lib/auth/` plus four route handlers, mirroring the existing pattern where each API concern lives in `app/api/<name>/route.ts` with colocated tests. The fake IdP lives under `tests/support/` so production bundles never import it. No middleware is added — each route checks its own session, keeping the diff small and testable.

## Phase 0 — Research (summary; details in research.md)

Twelve decisions were resolved offline. The ones that shape the design:

- D1 hand-rolled OIDC on `jose` rather than an auth framework (Constitution III).
- D2 in-memory session store with an interface, not a database.
- D3 opaque session cookie plus a separate short-lived pre-auth handle cookie.
- D5 claim mapping: `oid` required; email from `email`, else verified `preferred_username`, else fail; issuer pinned to the single tenant.
- D6 operator harness registered as a loopback public client (no secret on the operator's laptop), separate from the web client's redirect URI.
- D8 test strategy: fake IdP in vitest for full-flow determinism; CDP for the real tenant.
- D12 no development auth bypass — anonymous chat already covers local work, so no "skip auth" switch can leak into production.

## Phase 1 — Design (artifacts)

- [data-model.md](./data-model.md) — `Identity`, `AuthSession`, `PreAuthTransaction`, `AppConfig`, `AuthErrorEvent`; validation rules and state transitions.
- [contracts/entra-app-registration.md](./contracts/entra-app-registration.md) — account type, redirect URIs, scopes, claim configuration, credential and rotation, public-client harness exception.
- [contracts/auth-http-api.md](./contracts/auth-http-api.md) — endpoints, cookie names/flags, success and error envelopes.
- [contracts/identity-contract.md](./contracts/identity-contract.md) — the identity Phase 2 consumes and the anonymous/identity-bound gating rules.
- [quickstart.md](./quickstart.md) — Azure setup (portal + `az`), local run, four validation paths.
- [test-plan.md](./test-plan.md) — U1–U22 unit, I1–I10 integration, E1–E8 live E2E, H1–H14 error matrix, commands, acceptance mapping.

## Error Handling

Every failure is classified, mapped to an honest user-facing message, logged with a stable code plus an identity hash (never a token), and leaves no partial session. A single `AuthError` type carries `code`, `httpStatus`, `userMessage`, `retryable`.

| ID | Condition | Behavior | HTTP |
|---|---|---|---|
| E1 | Configuration missing/invalid (tenant, client id, secret, redirect) | Refuse to start sign-in; log `config_invalid` naming the missing key; message points to the operator | 500 |
| E2 | Discovery/JWKS fetch fails or times out (10 s, one retry) | `idp_unavailable`; offer retry; no pre-auth cookie left behind | 503 |
| E3 | User cancels or denies consent (`error=access_denied`) | Clear pre-auth cookie; `signin_cancelled`; retry available | 400 |
| E4 | `state` missing/mismatched/expired or pre-auth record absent | Clear cookies; `invalid_state`; no code redemption attempted | 400 |
| E5 | Code redemption rejected (invalid/expired/reused code, wrong redirect) | `signin_failed`; clear pre-auth; token endpoint error code logged sanitized | 400 |
| E6 | ID token signature/issuer/audience/expiry invalid | `token_invalid`; no session; log reason code only | 400 |
| E7 | Nonce mismatch | `token_invalid` (nonce); no session | 400 |
| E8 | Token lacks `oid`, or both email and sign-in name absent | `identity_incomplete`; no session; message says the organization did not provide a usable identity | 400 |
| E9 | Guest / other-tenant account | `tenant_not_allowed`; message names the organization; no session (single-tenant audience) | 403 |
| E10 | Session expired (idle 8 h / absolute 12 h) or unknown handle | 401 `session_expired`; cookie cleared; UI shows signed-out state | 401 |
| E11 | Silent renewal fails (refresh revoked, Conditional Access re-challenge required) | End session, `reauthentication_required`; user signs in again; no retry loop | 401 |
| E12 | Identity-bound request without a session | 401 `signin_required`; nothing is queued or executed | 401 |
| E13 | Cookie tampering or cross-site POST | Reject; `invalid_request`; no session mutation | 400/403 |
| E14 | Unexpected exception | `internal_error`; generic message; stack to server log only; cookies cleared only if half-created | 500 |

Rules: no partial session is ever stored; every failed callback clears the pre-auth transaction exactly once; retries are permitted only for E2 and are explicitly bounded; the user message never contains tenant ids, client ids, token fragments, or stack traces; sign-out succeeds locally even if the tenant end-session call fails (logged, not surfaced as an error).

## Testing Strategy

Detailed cases in [test-plan.md](./test-plan.md). Summary:

- **Unit (vitest)**: PKCE S256 vector, state/nonce entropy, claim mapping (email/preferred_username/neither), issuer/audience/nonce/expiry rejection, clock skew, session idle/absolute math with an injected clock, cookie flags per environment, error taxonomy mapping, `requireIdentity()` contract, config fail-fast.
- **Integration (fake IdP)**: full 9-step flow, replayed/forged state, code reuse, wrong tenant (`tid`/issuer), missing `oid`, guest rejection, renewal, sign-out (both local and end-session), anonymous chat unaffected.
- **Live E2E (owner present)**: real tenant sign-in, header display name, two-browser identity equality, refresh after access-token expiry, sign-out, guest account rejected, anonymous chat still answered, the operator's 9-step harness.
- **Test-first order**: each unit/route test lands in the same task before its implementation; the suite must be green before a task is ticked (Constitution II).

## Implementation Strategy

1. Foundations: config, errors, PKCE/state, claim validation, session store — with unit tests.
2. Routes: signin → callback → session → signout, each with fake-IdP integration tests.
3. UI: header control and session-aware state; no change to chat rendering.
4. Guard: `requireIdentity()` plus its 401 contract test (consumed by Phase 2).
5. Operator path: `az` runbook in quickstart, loopback harness, live CDP script.
6. Docs: `ai-chat-landing/README.md`, `AGENTS.md` (auth section), `.env.example`, DEPLOY env steps.

## Risks & Mitigations

- **In-memory sessions die on restart** — accepted for a single-process deployment; documented in README and quickstart; upgrade path is the store interface.
- **Public-client loopback exception on the app registration** — it enables the operator harness; it does not affect the confidential web client, and no secret is involved. Documented in the registration contract.
- **Tenant Conditional Access stricter than 12 h** — the app accepts an earlier re-challenge; session limits are upper bounds only.
- **Clock skew on operator laptops** — 5-minute tolerance; failures are honest (`token_invalid`), not retried blindly.

## Out of Scope (Phase 2)

Profile creation/registry, slug derivation and collision suffix, per-profile key custody, `/p/<slug>/` routing, Dify variables `hermes_slug`/`user_email`/`user_oid`, gateway isolation, MCP execution, and the 12-step build checklist.
