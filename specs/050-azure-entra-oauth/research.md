# Research — Azure Entra ID SSO (Phase 1)

All decisions below were resolved during planning; there are no NEEDS CLARIFICATION items. Each entry: decision, rationale, alternatives considered.

## D1 — Protocol implementation: hand-rolled OIDC on `jose`

**Decision**: implement the authorization-code + PKCE flow directly in `lib/auth/` with `jose` for JWT/JWKS work and `node:crypto` for PKCE/state/nonce.

**Rationale**: four endpoints and one identity shape do not justify an auth framework. `jose` is zero-transitive-dependency, actively maintained, key-id aware, and enforces algorithms explicitly; hand-rolling RS256 verification is the kind of code where a small mistake is an auth bypass. Constitution III allows one justified dependency.

**Alternatives**: Auth.js/next-auth (large tree, own session model and routes, version churn against Next 16); `openid-client` (solid but Node-oriented, more surface than needed); no dependency with `node:crypto` (rejected: security-critical parsing/verification, `kid` rotation and clock tolerance all hand-written).

## D2 — Session storage: in-process store behind an interface

**Decision**: two in-memory stores (sessions, pre-auth transactions) with TTL sweeps and an injected clock; a `SessionStore` interface so a SQLite implementation can replace it without touching routes.

**Rationale**: one Next.js server process, 100+ users, 5–10 concurrent (spec scale). A database adds a dependency, migrations, and backup concerns for zero Phase 1 value. Restart-signs-out is acceptable and documented.

**Alternatives**: signed stateless JWT cookie (violates FR-009's opaque cookie and makes revocation impossible); SQLite now (premature; the interface keeps the door open); Redis (new service, Constitution III last resort).

## D3 — Cookies: opaque session handle + separate pre-auth handle

**Decision**: `hermes_session` = random 32-byte base64url handle → server session (HttpOnly, SameSite=Lax, Secure outside local dev, Path=/). `hermes_auth` = separate 10-minute handle → pre-auth transaction holding state, nonce, code verifier, and return path. Both are opaque; neither carries claims.

**Rationale**: keeps tokens and claims server-side; separates a half-finished sign-in from a session; clearing one on failure cannot damage the other.

**Alternatives**: one cookie for both phases (mixing lifetimes); storing state/verifier in the browser (verifier must stay server-side); `__Host-` prefix everywhere (Secure is not valid on plain-HTTP local origins in every browser, so the prefix is applied only in production).

## D4 — PKCE, state, nonce

**Decision**: PKCE `S256`; verifier = 32 random bytes base64url; state and nonce = 32 random bytes base64url each; all single-use, recorded in the pre-auth transaction, compared in constant time.

**Rationale**: OAuth 2.1 / current Entra guidance; S256 always available; 256-bit entropy removes guessability concerns.

**Alternatives**: `plain` PKCE (legacy, rejected); state derived from a hash of session data (no benefit, harder to audit).

## D5 — Claim mapping and issuer pinning

**Decision**: require `oid`; tenant `tid` must equal the configured tenant; issuer must equal `https://login.microsoftonline.com/<tenant-id>/v2.0`; email = `email` if present, else `preferred_username` (recorded as `email_source`), else fail `identity_incomplete`. Display name = `name`, falling back to `preferred_username`.

**Rationale**: `oid` is the only stable per-user key (spec FR-006/FR-007); email claims vary by tenant claim configuration, so the documented fallback is explicit rather than silent. Single-tenant pinning (Clarification 3) makes issuer validation exact.

**Alternatives**: `sub` as key (pairwise per app, not usable across features); accepting any Microsoft issuer (multi-tenant, rejected); deriving email from `upn` (not present in v2 tokens).

## D6 — Operator validation harness

**Decision**: `scripts/entra-flow-check.mjs` performs the real code flow as a **loopback public client** on `http://localhost:53682/callback` (redirect URI registered on the same app, public-client flows enabled), printing per-step pass/fail and claim *presence* (never values or tokens).

**Rationale**: proves the registration and the flow independently of the Next app; no client secret on the operator's machine; the URI is separate from the web client's redirect so the app's security posture is unchanged.

**Alternatives**: driving the Next app through CDP only (cannot report internal step results); shipping a CLI with the client secret (secret sprawl); skipping the harness (violates FR-016/SC-006).

## D7 — Anonymous chat stays; guard is a primitive

**Decision**: `/api/chat` and its Dify call are untouched. `lib/auth/guard.ts` exports `requireIdentity(request)` returning either the identity or a `401 signin_required` envelope; Phase 1 ships and tests it, Phase 2 calls it from identity-bound paths.

**Rationale**: Clarification 2 keeps general chat frictionless and preserves the existing CDP instruments that chat anonymously. Gating code exists and is tested before there is anything to gate.

**Alternatives**: gating all chat (breaks existing scripts and the landing experience); client-side-only checks (unenforceable).

## D8 — Test strategy: fake IdP + CDP, no Playwright

**Decision**: a `node:http` fake OIDC provider under `tests/support/fake-idp.ts` (discovery, authorize redirect, token endpoint, JWKS, configurable failure and claim mutations) drives integration tests; live acceptance is a CDP script like the existing instruments.

**Rationale**: deterministic, offline, and able to produce tokens the real tenant will not (missing `oid`, wrong issuer, replayed state). CDP already exists in this repo with a documented Chrome-on-`:9240` workflow; adding Playwright would be a new dependency and a second browser harness (Constitution III).

**Alternatives**: mocking `jose`/fetch per test (does not exercise the flow); contract tests against the real tenant in CI (needs credentials and network).

## D9 — Error taxonomy and logging

**Decision**: one `AuthError` with `code`, `httpStatus`, `userMessage`, `retryable`, mapped in `lib/auth/errors.ts`; log `code`, request id, and a truncated SHA-256 of `oid` when known — never tokens, codes, or client ids.

**Rationale**: honest, specific user messages (Constitution IV) and a stable test surface; hashed identity keeps logs useful without storing personal identifiers.

**Alternatives**: generic 500s (dishonest); logging claim values (privacy regression).

## D10 — UI surface

**Decision**: one header control (`components/auth-control.tsx`): anonymous → "Sign in"; signed in → display name + "Sign out". No route protection, no modal, no change to message rendering. Session state comes from `/api/auth/session` on mount and after sign-out.

**Rationale**: smallest surface that satisfies FR-018 and SC-001/SC-003; keeps the landing page unchanged for anonymous users.

**Alternatives**: full-page sign-in screen (rejected by Clarification 2); client-side token handling (forbidden).

## D11 — Timings, timeouts, clock skew

**Decision**: discovery/JWKS cached 24 h and refreshed once on unknown `kid`; HTTP timeout 10 s with one retry for idempotent GETs (discovery/JWKS), no retry for the token POST; 5-minute clock tolerance on `exp`/`nbf`/`iat`; pre-auth window 10 min; idle 8 h, absolute 12 h; sweep interval 60 s.

**Rationale**: matches SC-005 and the spec's failure-path expectations; bounded retries avoid hammering a failing IdP.

**Alternatives**: no cache (latency and rate limits); long retries (sign-in hangs); 15-minute pre-auth (longer replay window).

## D12 — No development auth bypass

**Decision**: no `AUTH_DISABLED` switch. Local work uses anonymous chat; if a developer needs a signed-in session they use the real tenant or the fake IdP test path.

**Rationale**: a bypass flag is one misconfiguration away from production exposure; anonymous chat already covers the no-credential workflow.

**Alternatives**: env bypass in development (rejected on security grounds); mock user seeded in development (same risk, more code).

## D13 — Slug derivation keeps the full FQDN domain

**Decision**: `deriveSlug(email)` joins the local part and every domain label (`peter.chan@tvb.com.hk` → `peter-chan-tvb-com-hk`), lowercasing and accent-stripping; the oid-hash suffix is applied only on collision.

**Rationale**: the same person may hold `peter.chan@tvb.com.hk`, `@tvb.com.cn`, and `@tvb.com`; treating them as one slug would merge distinct mailboxes and profiles. The earlier `alice-chen-contoso` example is superseded — `alice.chen@contoso.com` must become `alice-chen-contoso-com`.

**Alternatives**: local-part only (merges domains, rejected); strip the public suffix `.com`/`.hk` (still merges `tvb.com` with `tvb.com.hk` after normalization, rejected); hash the email (loses human readability and cannot be explained to a user).

## Environment contract

| Variable | Purpose | Required |
|---|---|---|
| `ENTRA_TENANT_ID` | single tenant; also builds issuer | yes |
| `ENTRA_CLIENT_ID` | application (client) id | yes |
| `ENTRA_CLIENT_SECRET` | server-only credential; 6-month rotation with overlap | yes |
| `ENTRA_REDIRECT_URI` | exact registered callback (`https://<host>/api/auth/callback/entra`) | yes (defaults to localhost in dev) |
| `AUTH_COOKIE_SECURE` | force Secure cookies off on plain-HTTP dev only | no (default: secure outside `NODE_ENV=development`) |
| `ENTRA_E2E` | enables the owner-present live script | no |

`DIFY_API_KEY` and the rest of the existing environment are unchanged. Secrets live in `.env.local` (git-ignored) and are never logged.

## Entra endpoints (v2.0, single tenant)

- Authorize: `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize`
- Token: `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`
- Discovery: `https://login.microsoftonline.com/<tenant>/v2.0/.well-known/openid-configuration`
- End session: `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/logout`
- Scopes: `openid profile email offline_access` (no Graph data scopes)
