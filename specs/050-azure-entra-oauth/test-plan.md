# Test Plan — Azure Entra ID SSO (Phase 1)

Companion to [plan.md](./plan.md) and [spec.md](./spec.md). Tests are written **before** their implementation (Constitution II); every task in `tasks.md` cites the case that must pass first.

## Levels and commands

| Level | Tool | Command | Network | Deterministic |
|---|---|---|---|---|
| Unit | vitest | `cd ai-chat-landing && pnpm test` | none | yes (fake clock injected) |
| Integration | vitest + in-process fake IdP | same run (`lib/auth/*.test.ts`, `app/api/auth/**/route.test.ts`) | none | yes |
| Operator harness | node + real tenant | `node ai-chat-landing/scripts/entra-flow-check.mjs` | tenant | no (owner present) |
| Live E2E | CDP (Chrome `:9240`) + real tenant | `RUN_ENTRA_E2E=1 node ai-chat-landing/scripts/entra-auth-check.mjs` | tenant + app | no (owner present) |
| Static gates | tsc / eslint | `pnpm typecheck && pnpm lint` | none | yes |

`pnpm test` must stay fully offline: the fake IdP binds `127.0.0.1:0`, and no test reads `ENTRA_*` from the real environment (`tests/support/test-env.ts` sets deterministic values).

## Fixtures and helpers

| Helper | Purpose |
|---|---|
| `tests/support/fake-idp.ts` | Discovery, authorize redirect, token endpoint, JWKS; configurable: expired token, wrong issuer, wrong audience, bad signature, missing `oid`, missing/blank `email`, blank `preferred_username`, guest `tid`, rejected code, 5xx, slow response |
| `tests/support/tokens.ts` | Builds signed ID tokens (RS256, ephemeral key pair) with explicit claim overrides |
| `tests/support/clock.ts` | Injected clock (`setNow`) for session and token-expiry math |
| `lib/auth/testing/log-spy.ts` | Captures structured log calls to prove no token/secret/raw oid ever appears |

## Unit tests

| ID | Case | Asserts |
|---|---|---|
| U1 | PKCE S256 with the RFC 7636 example verifier | challenge matches the published vector exactly |
| U2 | Verifier/state/nonce generation | 32 random bytes, base64url, 43 chars, unique across 10k draws, no padding |
| U3 | Constant-time compare (state/nonce) | equal → true; one-bit difference → false; length mismatch → false without throwing |
| U4 | Identity with `email` claim | `email`, `emailSource="email"`, `displayName`, `oid`, `tid` present |
| U5 | No `email`, `preferred_username` present | `emailSource="preferred_username"`, same person fields |
| U6 | No email and no preferred_username | `identity_incomplete`; no identity returned |
| U7 | Blank-string email claim | treated as absent (falls through to U5/U6 logic) |
| U8 | Missing `oid` | `identity_incomplete` even when every other claim is present |
| U9 | `tid` ≠ configured tenant | `tenant_not_allowed` |
| U10 | Issuer ≠ `https://login.microsoftonline.com/<tid>/v2.0` | `token_invalid` |
| U11 | Audience ≠ configured client id | `token_invalid` |
| U12 | Nonce mismatch | `token_invalid` |
| U13 | `exp`/`nbf` boundary | +4 min future and −4 min past accepted (5 min skew); ±6 min rejected |
| U14 | Idle expiry math | activity at 7 h 59 m keeps the session; 8 h 01 m idle expires it |
| U15 | Absolute cap | renewal and activity at 11 h 59 m keep it; 12 h 01 m expires regardless of activity |
| U16 | Renewal failure once | session survives with `consecutiveFailures=1`; second failure expires and requires re-auth |
| U17 | Sweep | expired sessions removed within one sweep tick; active sessions untouched |
| U18 | Cookie flags | dev: no `Secure`, plain names; prod: `Secure`, `__Host-` names, `HttpOnly`, `SameSite=Lax`, `Path=/` |
| U19 | Config fail-fast | missing/blank key → `config_invalid` naming the key; the value never appears in the error |
| U20 | Error taxonomy mapping | every E1–E14 code maps to the documented status, message key, and `retryable` |
| U21 | `requireIdentity` | no cookie → 401 `signin_required`; valid session → identity; expired → 401 and cleared cookie |
| U22 | `returnTo` sanitization | `/`, `/chat?x=1` accepted; `//evil.example`, `https://evil.example`, `javascript:` → `/` |
| U23 | Store cap | 1,001st session evicts the least-recently-seen; evicted handle returns 401 (no crash) |
| U24 | Log hygiene | sign-in/callback/renewal/eviction/failure logs contain no ID token, access token, refresh token, code, secret, or raw oid; `renewal` and `session_evicted` events are emitted with hashed oid only |
| U25 | Slug derivation keeps the full FQDN | `peter.chan@tvb.com.hk` → `peter-chan-tvb-com-hk`, `@tvb.com.cn` → `peter-chan-tvb-com-cn`, `@tvb.com` → `peter-chan-tvb-com`; three distinct slugs; case/accents normalized; malformed addresses rejected; collision suffix is a stable 8-hex oid hash applied only on collision |

## Integration tests (fake IdP)

| ID | Case | Asserts |
|---|---|---|
| I1 | Full happy path | signin 302 carries `client_id`, exact `redirect_uri`, `state`, `nonce`, `code_challenge`, `S256`; callback creates session; `hermes_auth` cleared; `hermes_session` set; `/api/auth/session` returns the user; `returnTo` honored |
| I2 | Missing / mismatched / expired state | 302 `?auth_error=invalid_state`; no session; pre-auth cookie cleared |
| I3 | Callback replay (same state+code twice) | first succeeds; second `invalid_state`; token endpoint called exactly once |
| I4 | Code rejected by the IdP | `signin_failed`; no session; sanitized provider error logged |
| I5 | Nonce mismatch in the token | `token_invalid`; no session |
| I6 | Guest token (foreign `tid`/issuer) | `tenant_not_allowed`; no session |
| I7 | Token without `oid` | `identity_incomplete`; no session |
| I8 | Token without `email` but with `preferred_username` | session created; `email` = username; `emailSource="preferred_username"` |
| I9 | Token with neither email claim | `identity_incomplete` |
| I10 | Expired / bad-signature ID token | `token_invalid`; no session |
| I11 | Sign-out | 200 with `endSessionUrl`; session record deleted; both cookies expired; second sign-out still 200 |
| I12 | Tenant end-session failure during sign-out | local sign-out still succeeds; failure logged; no user-facing error |
| I13 | Anonymous chat unchanged | `POST /api/chat` without a session streams a normal answer; upstream Dify body contains no identity fields; response shape identical to the pre-change contract test |
| I14 | Guarded route | without session → 401 `signin_required` and downstream handler not invoked; with session → identity passed |
| I15 | Discovery unreachable / slow | `GET /api/auth/signin` → 503 `idp_unavailable`, no cookie; one retry attempted, not more |
| I16 | Unknown JWKS `kid` | cache refreshed once; a matching key succeeds; a still-unknown key → `token_invalid` |
| I17 | Cross-site POST sign-out (`Origin` mismatch) | 403 `invalid_request`; session untouched |

## Live end-to-end (owner present)

Requires a test tenant, the two accounts, and `RUN_ENTRA_E2E=1`. The script drives the real UI with CDP; it cleans up (signs out) even on failure.

| ID | Scenario | Pass condition |
|---|---|---|
| E1 | Member signs in from the header | lands signed in; header shows the member's display name; cookies: `hermes_session` present, `HttpOnly`, not readable via `document.cookie` |
| E2 | Anonymous visitor asks a general question | answer streams with the same UI as before; no sign-in prompt |
| E3 | Sign-out | returns to anonymous header; a subsequent chat works; re-sign-in prompts at Microsoft |
| E4 | Cancel at the Microsoft screen | returns with an honest "sign-in was not completed" message; still anonymous |
| E5 | Guest account | rejected with the members-only message; no session |
| E6 | Two browsers, same member | both sessions report the same email and display name; structured logs show identical `oidHash` |
| E7 | Session expiry metadata | `expiresAt` in `/api/auth/session` is ≤ 12 h from sign-in; cookie has no persistent max-age beyond the session record |
| E8 | Operator harness | `entra-flow-check.mjs` prints 9/9 PASS with `oid`, `email`, `tid`, `nonce` present and no token values |
| E9 | Token renewal | after the access token's lifetime, a request succeeds without a prompt and one renewal log line appears (may be deferred to a 1-hour observation; integration I-tests already prove the logic) |

Not covered live (documented): 8 h idle / 12 h absolute waits (unit-proven with the injected clock), real MFA/Conditional Access re-challenge (tenant-dependent; manual note in quickstart), secret rotation (operator runbook step, verified by one sign-in after rotation).

## Error handling matrix

Each row asserts: honest message shown, no session created, no token/secret in the response or logs, cookies in the expected state.

| ID | Code | Trigger in tests | User sees | Session |
|---|---|---|---|---|
| H1 | `config_invalid` | unset `ENTRA_CLIENT_ID` | "Sign-in is not configured on this server." | none |
| H2 | `idp_unavailable` | fake IdP closed / discovery 503 | "The organization's sign-in service is unavailable. Try again." | none |
| H3 | `signin_cancelled` | `?error=access_denied` | "Sign-in was cancelled." | none |
| H4 | `invalid_state` | no/mismatched/replayed state | "That sign-in attempt expired. Please try again." | none |
| H5 | `signin_failed` | token endpoint 400 invalid_grant | "Sign-in could not be completed." | none |
| H6 | `token_invalid` (signature/aud/iss/exp) | forged/expired token | "Sign-in could not be verified." | none |
| H7 | `token_invalid` (nonce) | nonce mismatch | same as H6 | none |
| H8 | `identity_incomplete` (no oid) | token without `oid` | "Your organization did not provide a usable identity." | none |
| H9 | `identity_incomplete` (no email) | no email/username | same as H8 | none |
| H10 | `tenant_not_allowed` | guest/foreign tenant | "Use your organization account to sign in." | none |
| H11 | `session_expired` | idle/absolute exceeded, unknown handle | header returns to "Sign in" | cleared |
| H12 | `reauthentication_required` | refresh revoked | "Please sign in again." once; no loop | cleared |
| H13 | `signin_required` | guarded route anonymous | UI prompt to sign in; nothing runs | n/a |
| H14 | `invalid_request` | cross-site POST | generic rejection | unchanged |
| H15 | `internal_error` | injected exception | "Something went wrong. Please try again." (no stack) | none unless half-created |

### App-observable boundary

An unregistered return address is rejected by the organization's sign-in before the application receives a request, so it has no H-row: it is an operator runbook check (quickstart §6), not an app failure path (SC-007, Clarifications 2026-11-25).

## Acceptance mapping

| Requirement | Cases |
|---|---|
| FR-001–FR-005 | I1, I2, I4, I6, I10, U1, U3, U10–U13 |
| FR-006–FR-008 | U4–U9, I7–I9, E1, E6 |
| FR-009–FR-011 | U14–U17, U18, I11, I12, E1, E3, E7 |
| FR-012 | H1–H15 |
| FR-013–FR-014 | Quickstart steps 1–2 and 7; U19; U24 |
| FR-015 | U24 |
| FR-016 | E8 |
| FR-017 | Quickstart on a fresh tenant (operator sign-off) |
| FR-018–FR-020 | I13, I14, E1–E3, U21 |
| SC-001 | E1 (timed interaction count) |
| SC-002 | U4–U9, I1, I7–I9 |
| SC-003 | E6 |
| SC-004 | U18, U24, repository secret scan |
| SC-005 | U14–U16, E7 |
| SC-006 | E8 (9/9 in < 15 min) |
| SC-007 | H1–H15, E4, E5 |

## Results

**2026-11-25 — live tenant, manual browser run (owner present)**

- Real sign-in against tenant `ca1293ac-…` on `https://agia.tvb.com.hk` succeeded: `GET /api/auth/signin` 302 → `signin_success` (oidHash only) → `GET /api/auth/callback/entra` 302 → authenticated session; chat worked signed-in; `POST /api/auth/signout` 200 with `signout` event and the UI returned to anonymous. E1 (basic), E2, E3 (partial) observed.
- Still unproven live: HttpOnly/no-`document.cookie` inspection, cancel-at-Microsoft path, two-browser identity equality (E6), the 9-step harness (E8), secret rotation (T025), and the automated CDP assertions (T019/T022). The CDP scripts have not been executed.
- Observation: Next's dev access log prints the callback query string, including the authorization code. Codes are single-use and short-lived, but production logging should omit query strings for `/api/auth/*`.

**2026-11-25 — offline implementation run**

- `cd ai-chat-landing && pnpm test` → **274 tests, 43 files, all passing** (86 new auth tests: U1–U25, I1–I17, the I13 chat-contract pin, the sign-out→account-picker URL builder, plus handle-format/eviction-logging and callback-config-banner cases). Convergence T034–T043 applied: sign-in and callback configuration failures render the honest banner, SC-007 is app-observable only, renewal is reachable from a visible tab, renewal/eviction are logged without tokens, session handles are 32 random base64url bytes, and dead exports are gone.
- `pnpm typecheck` → clean. `pnpm lint` → 0 errors (2 pre-existing warnings outside this feature).
- Not run yet (owner present, real tenant): E1–E9, the `--two-browser` mode, and the fresh-tenant runbook steps T024–T026. The scripts exist and pass `node --check`; no result is claimed for them.
- Secret scan: no `ENTRA_CLIENT_SECRET` or token-shaped value in tracked files; only documentation placeholders (`DIFY_API_KEY=app-your-key-here`).

## Definition of Done for this feature

1. `pnpm test` green including all U/I cases; `pnpm typecheck` and `pnpm lint` clean.
2. Fake-IdP suite runs with no network and no real tenant variables.
3. E1–E6 and E8 pass owner-present against the test tenant; E7 verified from session metadata; E9 either observed or explicitly deferred with the integration evidence cited.
4. No secret, token, authorization code, raw `oid`, or raw email in any log or HTTP response (U24 + manual spot check).
5. Quickstart followed end to end on a clean tenant produces a working sign-in.
