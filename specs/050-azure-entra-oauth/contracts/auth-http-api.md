# Contract — Auth HTTP API

Four additive routes under `/api/auth/`. The existing `/api/chat`, `/api/conversations`, `/api/attach`, `/api/models`, and `/api/image-proxy` routes are unchanged (Constitution I).

All browser-facing responses are same-origin. Every state-changing route accepts `POST` only except the two `GET` flow endpoints, and every route rejects a request whose `Origin`/`Sec-Fetch-Site` indicates a cross-site caller (E13).

## Cookies

| Cookie | Value | Flags | Lifetime |
|---|---|---|---|
| `hermes_session` (`__Host-hermes_session` in production) | opaque session handle | `HttpOnly; SameSite=Lax; Path=/; Secure` (non-dev) | matches the server session |
| `hermes_auth` (`__Host-hermes_auth` in production) | opaque pre-auth handle | `HttpOnly; SameSite=Lax; Path=/; Secure` (non-dev) | 10 minutes |

No cookie carries claims, tokens, or user ids.

## `GET /api/auth/signin`

Starts sign-in. Query: `returnTo` (optional, same-origin relative path, default `/`; anything else is ignored and `/` is used).

1. Create a pre-auth transaction (state, nonce, S256 verifier, `returnTo`, 10-minute expiry), set `hermes_auth`.
2. `302` to the tenant authorize endpoint with `client_id`, exact `redirect_uri`, `response_type=code`, `scope=openid profile email offline_access`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`, `prompt=select_account` when the client asks for it — the UI sends it on the first sign-in after an explicit sign-out (session flag, consumed once).

Failures: `302` to `/?auth_error=idp_unavailable` when discovery cannot be fetched (E2) or `/?auth_error=config_invalid` on configuration errors (E1); neither sets a cookie, and the banner renders the honest sentence.

## `GET /api/auth/callback/entra`

Handles the authorization response. Query: `code`, `state`, or `error`/`error_description`.

Success: redeem the code server-side (client id + secret + verifier), validate the ID token (signature via tenant JWKS, `iss`, `aud`, `exp`/`nbf` with 5-minute skew, `nonce`, `tid`), extract the identity, create the session, set `hermes_session`, clear `hermes_auth`, then `302` to `returnTo`.

Failure: clear `hermes_auth`, create no session, and `302` to `/?auth_error=<code>` where `<code>` is one of the E1–E14 codes below. The UI maps the code to a short sentence; the query never contains details.

| Query | Meaning | Session |
|---|---|---|
| `access_denied` (from Entra) | user cancelled or consent refused (E3) | none |
| `invalid_state` | state missing/mismatched/expired/replayed, or no pre-auth record (E4) | none |
| `idp_unavailable` | discovery/JWKS unreachable (E2) | none |
| `signin_failed` | code redemption rejected (E5) | none |
| `token_invalid` | signature/issuer/audience/expiry/nonce failed (E6/E7) | none |
| `identity_incomplete` | no `oid`, or no email and no sign-in name (E8) | none |
| `tenant_not_allowed` | guest or wrong tenant (E9) | none |
| `internal_error` | unexpected exception (E14) | none |

Replay: a consumed pre-auth handle is rejected with `invalid_state` and the callback never redeems a second code.

## `GET /api/auth/session`

Never throws.

```json
{ "authenticated": false }
```

```json
{ "authenticated": true,
  "user": { "displayName": "Alice Chen", "email": "alice.chen@contoso.com" },
  "expiresAt": "2026-11-25T17:00:00.000Z" }
```

Rules: no `oid`, `tid`, token, or internal id in this payload; an expired or unknown handle returns `authenticated:false` and clears the cookie (`Set-Cookie` with an expired value); the response is `Cache-Control: no-store`.

## `POST /api/auth/signout`

Clears the local session (delete the store record, expire both cookies) even if the tenant end-session call fails.

```json
{ "ok": true, "endSessionUrl": "https://login.microsoftonline.com/<tid>/oauth2/v2.0/logout?post_logout_redirect_uri=..." }
```

The client navigates to `endSessionUrl`; the URL contains no tokens. Idempotent: signing out without a session returns `200 {"ok":true}`.

## Error envelope (server-side consumers)

Route handlers that protect identity-bound work use `requireIdentity(request)`:

```ts
type GuardResult =
  | { ok: true; identity: Identity }        // never serialized to the browser
  | { ok: false; status: 401; code: "signin_required" };
```

A guarded request without a valid session gets `401` and body `{"error":"signin_required"}`; nothing downstream runs and nothing is queued (FR-020). This is the only contract Phase 2 needs to call.

## Status code summary

| Situation | Status | Body |
|---|---|---|
| signin started | 302 | `Location: <entra authorize>` + `Set-Cookie: hermes_auth` |
| callback success | 302 | `Location: <returnTo>` + `Set-Cookie: hermes_session` |
| callback failure | 302 | `Location: /?auth_error=<code>` |
| signin start: config error | 302 | `Location: /?auth_error=config_invalid` |
| signin start: IdP unreachable | 302 | `Location: /?auth_error=idp_unavailable` |
| callback: config error | 302 | `Location: /?auth_error=config_invalid` |
| session info | 200 | `{authenticated, user?, expiresAt?}` |
| sign-out | 200 | `{ok, endSessionUrl?}` |
| guarded, unsigned | 401 | `{"error":"signin_required"}` |
| cross-site mutation | 403 | `{"error":"invalid_request"}` |
