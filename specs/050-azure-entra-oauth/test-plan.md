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

Not covered live (documented): 8 h idle / 12 h absolute waits (unit-proven with the injected clock), real MFA/Conditional Access re-challenge (tenant-dependent; manual note in quickstart).

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

**2026-11-26 — E1–E4 + E6/E7, owner present, CDP automation (`scripts/entra-auth-check.mjs`)**
against `https://agia.tvb.com.hk` via the nginx origin (headful Chrome 155, `--remote-debugging-port=9240`; WSL mirrored DNS pinned to loopback for the run).

- **T19 final run — all checks passed:** E2 anonymous session ✓, sign-in control ✓, chat composer without sign-in ✓; E1 SC-001 sign-in **0.8 s / 1 script-side interaction** ✓ (SSO with a warm Microsoft session), authenticated ✓, display name returned ✓, `hermes_session` not readable via `document.cookie` ✓ (HttpOnly), **header shows the display name** ✓ (race-safe 15 s retry added to the check), E7 expiry ≤ 12 h ✓; E3 sign-out returns to anonymous ✓.
- **T22 `--two-browser`:** E6 — two independent browser contexts signed in as the same member: same email `raymond.lai@tvb.com.hk` ✓ and same display name ✓ (second context authenticated via SSO); E2/E1/E3 green in the same run.
- **E4 cancel path (real route):** `GET /api/auth/callback/entra?error=access_denied` → 302 `/?auth_error=signin_cancelled` → banner `[role="alert"]` "Sign-in was cancelled." with Dismiss, param stripped from the address bar ✓ (CDP probe). With a warm SSO session the interactive Microsoft screen is skipped, so the cancel was exercised at the callback boundary — the exact surface a user's "Cancel" hits.
- **Bug found and fixed (banner was StrictMode-fragile):** in dev (StrictMode double-mount) the banner's second effect run read the already-stripped URL, got `null`, and erased the message it had just set — the banner never appeared on `/?auth_error=…`. Fixed in `components/auth-error-banner.tsx` (set the message only when non-null); regression test `components/auth-error-banner.test.ts` renders under `React.StrictMode` and asserts the message survives and the param strips (jsdom; first component-tier test, `vitest.config.ts` include extended).
- SC-001 timing context: cold manual password+MFA login in a fresh profile measured **89.9 s** (includes typing); warm SSO re-entry **0.8–1.0 s**. The ≤30 s/≤3-interaction criterion is the org-SSO scenario (met: 0.8 s, 1 interaction) — recorded honestly, not assumed.
- Flaky-check note: `E1 header shows the display name` was racy on fast SSO (the session API can report authenticated before the post-redirect page re-renders); the script now retries up to 15 s. Two earlier runs (narrow window ≤640 px + leaked session) diagnosed and were superseded by the final clean run above.

**2026-11-26 — T024 quickstart §§1–2 + §7 (az CLI, existing tenant, fresh test registration)**

Conscious deviation from the "clean test tenant" wording (owner declined a new tenant): everything was provisioned instead in the existing tenant `ca1293ac-…` under a **fresh app registration** `AGI Chat — Hermes SSO TEST` (client `839129cd-b82f-47fc-8af4-23e88e60d6e5`), so every §1–§2 step still ran against empty, newly-created configuration. Operator login via `az login --use-device-code`; all provisioning by `az` per §2.
- §2 executed end to end: app create (single-tenant), web redirects (localhost + both hosts), loopback public-client redirect, ID-token optional claims via one `--set` line, Graph delegated permissions, 6-month secret. Verified by `az ad app show` (all fields present) and by E8 below.
- Drift found and fixed in `quickstart.md`: (1) `az ad app credential reset` fails "Resource … does not exist" until **`az ad sp create --id "$APP_ID"`** runs — §2/§7 lacked it; (2) optional claims do NOT need the manifest/portal — the `--set optionalClaims=…` one-liner works and is now documented; (3) tenant-wide admin consent (`az ad app permission grant`) needs Global-Admin privileges — for these identity-only delegated scopes, per-user consent at first sign-in suffices (E8 proved it 9/9 with no admin grant); (4) §7's zero-downtime premise was wrong — see T025.
- §3–§5: §3/§4 are the standing offline gates (green) plus the live server's production env; §5 path 1 green (offline suite), path 2 = E8 below against the fresh test registration, paths 3/4 recorded against the production registration (identical route code) on 2026-11-25/26.

**2026-11-26 — T026 E8, the 9-step harness (owner present)**

- The harness was first extended to the FR-016 nine steps — discovery / PKCE build / code+state / public-client exchange / JWKS signature / issuer / audience / nonce / claims are each verified and reported individually (`scripts/entra-flow-check.mjs`; formatter test unchanged and green).
- Run against the fresh test registration with one operator sign-in: **9/9 PASS**, claims `oid/email/tid/nonce` all present, id-token lifetime 3900 s, access 4004 s, refresh token present, no token values printed. Operator time ≈ 2 minutes (SC-006: < 15 min). One earlier attempt timed out at the 180 s sign-in window (operator not ready); the retry passed.

**2026-11-26 — T025 secret-rotation drill (§7, production app `dca69bcd-…`)**

- 14:36:54Z drill start; old credential `hermes-sso-2026-11-rotated` (exp 2027-05-26) listed; `.env.local` backed up (mode 600).
- ~14:37:10Z new credential `hermes-sso-2026-11-26-drill` created via `az ad app credential reset` — which **immediately deleted the old key** (no overlap window; ~30 s in which a *new* sign-in would have failed at token exchange; existing sessions and anonymous chat unaffected, sole user present).
- 14:37:40Z `.env.local` updated with the new secret (written `az`→file→`.env.local`, never displayed in chat); 14:38 `signin` 302 healthy; full sign-in round trip (CDP, warm SSO 1.1 s) **all checks passed** — proof the server runs on the new secret alone, since the old key no longer existed at Microsoft by then.
- Result recorded honestly: the drill completed with **no downtime observed**, but the documented overlap-based zero-downtime path is not what `credential reset` does. `quickstart.md` §7 now uses Graph `addPassword` (add → swap → verify → delete old) — the true no-gap sequence — and documents `credential reset` as the replace-semantics trap.
- End state: single active credential `hermes-sso-2026-11-26-drill` (exp 2027-05-26), `.env.local` in sync (mode 600), backup retained.

## Definition of Done for this feature

1. `pnpm test` green including all U/I cases; `pnpm typecheck` and `pnpm lint` clean.
2. Fake-IdP suite runs with no network and no real tenant variables.
3. E1–E6 and E8 pass owner-present against the test tenant; E7 verified from session metadata; E9 either observed or explicitly deferred with the integration evidence cited.
4. No secret, token, authorization code, raw `oid`, or raw email in any log or HTTP response (U24 + manual spot check).
5. Quickstart followed end to end on a clean tenant produces a working sign-in.
