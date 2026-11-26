# Contract — Entra ID App Registration

What must exist in Azure for Phase 1. Values are exact; anything not listed is default and MUST NOT be changed without updating this contract.

## Registration

| Setting | Value |
|---|---|
| Name | `AGI Chat — Hermes SSO` (any clear name) |
| Supported account types | **Accounts in this organizational directory only (single tenant)** |
| Client type | Confidential web client (client secret), plus public-client flows enabled **only** for the operator harness redirect |
| Redirect URI (web) — local | `http://localhost:3000/api/auth/callback/entra` |
| Redirect URI (web) — production | `https://<chat-host>/api/auth/callback/entra` (exact; no wildcards) |
| Redirect URI (harness) | `http://localhost:53682/callback` — type **Mobile and desktop applications**, enables public-client flows |
| Front-channel logout / post-logout redirect | `https://<chat-host>/` (and `http://localhost:3000/` for dev) |
| Implicit grant (ID/access tokens) | **Disabled** |
| API permissions | Microsoft Graph → `openid`, `profile`, `email`, `offline_access` (delegated, no admin consent beyond these; **no** data scopes) |
| Token configuration → optional claims (ID token) | `email`, `preferred_username`, `sid` (recommended); `oid` and `tid` are always present |
| Expose an API | none |
| Client secret | one active secret, 6-month expiry; renew with a 30-day overlap (new secret created before the old expires), then remove the old one |

## What the application asserts about the registration

- Exactly one tenant is accepted: the issuer must be `https://login.microsoftonline.com/<tenant-id>/v2.0`, and the token's `tid` must equal `<tenant-id>` (Clarification 3). A token from another tenant — including a guest's home tenant — is rejected with `tenant_not_allowed`.
- The `oid` claim is present on every token. If it is absent the sign-in fails (`identity_incomplete`); the application never substitutes `sub`, `name`, or an email address as the person key.
- The `email` claim is configured; when a token nevertheless lacks it, `preferred_username` is the documented fallback, and both are absent → `identity_incomplete`.
- No Graph data access is requested, so no access token is used to read mail, files, or profiles in Phase 1.
- MFA and Conditional Access are tenant policy. The application must accept a mid-session re-challenge and never attempt to suppress or bypass it.
- The harness redirect URI is a **public client** entry: it is not used by the web app, holds no secret, and cannot mint tokens for the web client. Removing it disables `scripts/entra-flow-check.mjs` only.

## Rotation procedure (contract)

1. Create the new secret in the registration (do not delete the old one yet).
2. Update the server's `ENTRA_CLIENT_SECRET` and restart/redeploy.
3. Verify sign-in with `scripts/entra-flow-check.mjs` (harness uses no secret) **and** one interactive sign-in.
4. Remove the old secret after the overlap window (30 days).
5. Rotation must never require a code change (FR-014); a rollback is restoring the previous value within the overlap.

## Environment binding

| Environment | Redirect URI | Cookie `Secure` | Notes |
|---|---|---|---|
| local development | `http://localhost:3000/api/auth/callback/entra` | off (`AUTH_COOKIE_SECURE=0`) | plain HTTP allowed on localhost only |
| production | exact `https://<host>/…` | on | HTTPS end to end; `__Host-` cookie prefix |

Mismatch symptoms and their honest outcomes: an unregistered return address is refused by Entra before the application sees it (the application surfaces `signin_failed` with a configuration hint); a wrong client id or secret gives `signin_failed` at redemption; a wrong tenant id gives `token_invalid` at issuer validation.
