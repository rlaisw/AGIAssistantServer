# Data Model — Azure Entra ID SSO (Phase 1)

All entities are server-side. Nothing here is serialized to the browser except two opaque handles.

## Identity

| Field | Type | Rules |
|---|---|---|
| `oid` | string | Required. Directory object id from the validated ID token. Stable across devices, renames, and email changes. Reject the sign-in if absent (FR-006). |
| `tid` | string | Required. Must equal `ENTRA_TENANT_ID` (Clarification 3: single tenant, members only). |
| `email` | string | Required. From `email`, else `preferred_username`; if neither is present, sign-in fails with `identity_incomplete`. Not re-derived from `name`. |
| `emailSource` | `"email" \| "preferred_username"` | Records which claim supplied the address so downstream features can explain the value. |
| `displayName` | string | `name`, falling back to `preferred_username`, then the email local part. Display only — never a key. |
| `signedInAt` | ISO timestamp | Set at session creation; also the start of the absolute session window. |

Invariants: (`oid`, `tid`) is the unique person key; `email` may change over time without changing the person (FR-007); no identity is synthesized from display name.

## AuthSession

| Field | Type | Rules |
|---|---|---|
| `handle` | string | 32 random bytes, base64url. Opaque; the only value in the session cookie. |
| `identity` | Identity | Snapshot at sign-in; refreshed only on renewal failure or re-authentication. |
| `createdAt` | ISO timestamp | First successful sign-in. |
| `lastSeenAt` | ISO timestamp | Updated on authenticated requests (at most once per 60 s to avoid write churn). |
| `absoluteExpiresAt` | ISO timestamp | `createdAt + 12 h`; never extended (FR-010). |
| `idleExpiresAt` | ISO timestamp | `lastSeenAt + 8 h`; recomputed on activity, capped by `absoluteExpiresAt`. |
| `tokens` | object | `idTokenExpiresAt`, `accessTokenExpiresAt`, `refreshPresent`, `refreshExpiresAt`. Token strings stay in this server-side record and are never logged. |
| `renewal` | object | `lastRenewalAt`, `consecutiveFailures` (0–1; a second renewal failure ends the session). |
| `status` | enum | `active` \| `expired` \| `ended`. |

State transitions:

```text
(no session)
   │ callback verified + identity complete
   ▼
 active ──idle > 8 h──────────────► expired ──► (handle deleted, cookie cleared)
   │ ──absolute > 12 h────────────► expired
   │ ──sign-out───────────────────► ended
   │ ──refresh revoked/CA─────────► expired (reauth required)
   └── activity (≤60 s debounce) ──► active (idle refreshed, never beyond absolute)
```

Validation rules: an expired or unknown handle is never resurrected; a session past `absoluteExpiresAt` is rejected even if `idleExpiresAt` is later; renewal never extends `absoluteExpiresAt`.

Storage: `Map<handle, AuthSession>` in-process; sweep every 60 s; hard cap 1,000 sessions with oldest-`lastSeenAt` eviction (scale guard, logged at `session_evicted`). Interface `SessionStore` so a persistent implementation can replace it.

## PreAuthTransaction

| Field | Type | Rules |
|---|---|---|
| `handle` | string | 32 random bytes, base64url; the only value in the pre-auth cookie. |
| `state` | string | 32 random bytes, base64url; must match the authorization response exactly (constant-time compare). Single use. |
| `nonce` | string | 32 random bytes, base64url; must match the ID token `nonce`. Single use. |
| `codeVerifier` | string | 32 random bytes, base64url; never leaves the server. |
| `returnTo` | string | Same-origin relative path only (`/` by default); reject absolute or protocol-relative values. |
| `createdAt` / `expiresAt` | ISO timestamps | 10-minute window (D11). |
| `usedAt` | ISO timestamp \| null | Set exactly once when the callback starts; a second use is `invalid_state`. |

Transitions: `created → consumed` (callback starts) or `expired` (10 min, or swept); consumed records are kept just long enough to answer a replay with `invalid_state`, then deleted.

## AppConfig

Validated once at module load; a missing or malformed value fails sign-in with `config_invalid` (E1) and names the offending key (never the value).

| Field | Source | Validation |
|---|---|---|
| `tenantId` | `ENTRA_TENANT_ID` | GUID format; tenant segment of the issuer |
| `clientId` | `ENTRA_CLIENT_ID` | GUID format |
| `clientSecret` | `ENTRA_CLIENT_SECRET` | non-empty; never logged |
| `redirectUri` | `ENTRA_REDIRECT_URI` | absolute `https://` in production, `http://localhost` allowed in development; must match the registration exactly |
| `scopes` | fixed | `openid profile email offline_access` |
| `issuer` | derived | `https://login.microsoftonline.com/<tenantId>/v2.0` |
| `cookieSecure` | `AUTH_COOKIE_SECURE` | defaults to secure outside `NODE_ENV=development` |

## AuthErrorEvent

Recorded for every failed sign-in attempt (structured log, not a store):

| Field | Rules |
|---|---|
| `code` | one of the E1–E14 codes from the plan |
| `requestId` | generated per callback; correlates the route log |
| `oidHash` | first 12 hex chars of SHA-256(`oid`) when the token yielded one; never the raw `oid` |
| `at` | timestamp |
| forbidden | tokens, authorization codes, client secret, raw `oid`, raw email |

## Cookies

| Cookie | Value | Flags | Lifetime |
|---|---|---|---|
| `hermes_session` (prod: `__Host-hermes_session`) | session handle | HttpOnly, SameSite=Lax, Path=/, Secure (non-dev) | Matches the session; cleared on expiry/sign-out |
| `hermes_auth` (prod: `__Host-hermes_auth`) | pre-auth handle | HttpOnly, SameSite=Lax, Path=/, Secure (non-dev) | 10 minutes; cleared on success, failure, or cancel |

Neither cookie contains claims; neither is readable by scripts; sign-out clears both.
