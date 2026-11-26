---

description: "Task list for Azure Entra ID SSO (Phase 1)"
---

# Tasks: Azure Entra ID SSO (Phase 1)

**Input**: Design documents from `/specs/050-azure-entra-oauth/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, test-plan.md
**Tests**: Explicitly requested (`test-plan.md`: U1–U24, I1–I17, E1–E9, H1–H15). Every behavior task is **test-first**: write the cited failing test, then the implementation, then `pnpm test` green before the task is complete (Constitution II).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no incomplete dependency)
- **[Story]**: US1 / US2 / US3 (story phases only)
- Every task names the exact file path

## Path Conventions

All application work happens in `ai-chat-landing/` (Next.js 16 App Router). Vitest covers `lib/**/*.test.ts` and `app/api/**/*.test.ts` (`ai-chat-landing/vitest.config.ts:9`). Browser behavior is proven by CDP scripts in `ai-chat-landing/scripts/`.

---

## Phase 1: Setup

- [X] T001 Add the `jose` dependency to `ai-chat-landing/package.json` (`cd ai-chat-landing && pnpm add jose`), confirm it adds no transitive runtime dependencies, and record the version in the plan's Complexity Tracking entry
- [X] T002 [P] Create the offline test scaffolding: `ai-chat-landing/tests/support/fake-idp.ts` (discovery, authorize, token, JWKS; failure switches from test-plan "Fixtures and helpers"), `ai-chat-landing/tests/support/tokens.ts` (RS256 ID-token builder with claim overrides), `ai-chat-landing/tests/support/clock.ts` (`setNow`), and `ai-chat-landing/lib/auth/testing/log-spy.ts`
- [X] T003 [P] Document the auth environment contract (`ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_REDIRECT_URI`, `AUTH_COOKIE_SECURE`, `ENTRA_E2E`) in `ai-chat-landing/README.md`; confirm `ai-chat-landing/.env.local` stays git-ignored and no secret is added to any tracked file

---

## Phase 2: Foundational (blocking for all stories)

- [X] T004 Write `ai-chat-landing/lib/auth/config.test.ts` (U19) and implement `ai-chat-landing/lib/auth/config.ts`: validate the six env values, derive `issuer = https://login.microsoftonline.com/<tenantId>/v2.0`, fixed scopes `openid profile email offline_access`, fail with `config_invalid` naming the key and never the value
- [X] T005 [P] Write `ai-chat-landing/lib/auth/errors.test.ts` (U20) and implement `ai-chat-landing/lib/auth/errors.ts`: `AuthError { code, httpStatus, userMessage, retryable }` with the exact E1–E14 mapping from plan.md
- [X] T006 [P] Write `ai-chat-landing/lib/auth/pkce.test.ts` (U1–U3) and implement `ai-chat-landing/lib/auth/pkce.ts`: S256 verifier (32 random bytes, 43-char base64url), state and nonce (32 bytes each), constant-time single-use compare
- [X] T007 Write `ai-chat-landing/lib/auth/jwks.ts` + `ai-chat-landing/lib/auth/discovery.ts` with tests in `ai-chat-landing/lib/auth/jwks.test.ts` (I15, I16): 24 h cache, 10 s timeout with exactly one retry for discovery/JWKS GETs, refresh once on unknown `kid`, then `token_invalid`
- [X] T008 Write `ai-chat-landing/lib/auth/claims.test.ts` (U4–U13) and implement `ai-chat-landing/lib/auth/claims.ts`: verify signature/issuer/audience/exp/nbf (5-minute skew)/nonce; require `oid`; `tid` must equal the configured tenant; email from `email` else `preferred_username`, both absent → `identity_incomplete`; blank strings treated as absent; populate `emailSource` and `displayName`
- [X] T009 Write `ai-chat-landing/lib/auth/session-store.test.ts` (U14–U17, U23) and implement `ai-chat-landing/lib/auth/session-store.ts`: `Map` stores with 60 s sweep; `absoluteExpiresAt = createdAt + 12 h` never extended; `idleExpiresAt = lastSeenAt + 8 h` capped by absolute; `lastSeenAt` debounced to 60 s; renewal failure counter ending the session on the second failure; 1,000-session cap evicting oldest `lastSeenAt`; `PreAuthTransaction` with 10-minute expiry, `usedAt` single use, `returnTo` restricted to same-origin relative paths (absolute and protocol-relative → `/`)
- [X] T010 Write `ai-chat-landing/lib/auth/session.test.ts` (U18) and implement `ai-chat-landing/lib/auth/session.ts`: opaque handle cookies `hermes_session` / `hermes_auth` (`__Host-` and `Secure` outside `NODE_ENV=development`), `HttpOnly; SameSite=Lax; Path=/`, set/clear helpers only
- [X] T011 Write `ai-chat-landing/lib/auth/guard.test.ts` (U21, I14) and implement `ai-chat-landing/lib/auth/guard.ts`: `getIdentity(request)` → identity or null; `requireIdentity(request)` → `{ ok: true, identity }` or `{ ok: false, status: 401, code: "signin_required" }`; expired/unknown handle → 401 with cookie cleared

**Checkpoint**: `pnpm test` green for all auth units; no route exists yet.

---

## Phase 3: User Story 1 — Employee signs in (Priority: P1) — MVP

**Goal**: A member signs in from the header, lands back in the Chat UI with a server-side session, and every failure ends honestly with no session.
**Independent test**: E1 + E2 with the real tenant, or I1 with the fake IdP.

- [X] T012 [US1] Write `ai-chat-landing/app/api/auth/signin/route.test.ts` (I1 redirect parameters, I2, I15) and implement `ai-chat-landing/app/api/auth/signin/route.ts`: create the pre-auth transaction, set `hermes_auth`, 302 to the tenant authorize endpoint with `client_id`, exact `redirect_uri`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`; 503 `idp_unavailable`, 500 `config_invalid`
- [X] T013 [US1] Write `ai-chat-landing/app/api/auth/callback/entra/route.test.ts` (I1–I10 order and outcomes) and implement `ai-chat-landing/app/api/auth/callback/entra/route.ts`: constant-time state check, single-use redemption with client secret + verifier, token validation via T008, session creation, `hermes_auth` cleared, 302 to `returnTo`; every failure 302 to `/?auth_error=<code>` with no session
- [X] T014 [US1] Write `ai-chat-landing/app/api/auth/session/route.test.ts` and implement `ai-chat-landing/app/api/auth/session/route.ts`: `{authenticated:false}` or `{authenticated:true,user:{displayName,email},expiresAt}` — never `oid`/`tid`/tokens; `Cache-Control: no-store`; expired handle clears the cookie
- [X] T015 [US1] Write `ai-chat-landing/app/api/auth/signout/route.test.ts` (I11, I12, I17) and implement `ai-chat-landing/app/api/auth/signout/route.ts`: POST only, Origin check → 403 `invalid_request`, delete the session record and expire both cookies, return `{ok:true,endSessionUrl}`; local success even if the tenant end-session call fails
- [X] T016 [US1] Create `ai-chat-landing/lib/auth/error-messages.ts` mapping every `?auth_error` code to one honest sentence (H1–H15) with tests in `ai-chat-landing/lib/auth/error-messages.test.ts`, and render the message as a dismissible banner in `ai-chat-landing/app/page.tsx` when the query carries `auth_error` (no details, no codes in prose)
- [X] T017 [US1] Implement `ai-chat-landing/components/auth-control.tsx` (anonymous → "Sign in"; signed in → display name + "Sign out" from `/api/auth/session`, navigating to `/api/auth/signin?returnTo=/` and POSTing sign-out then the `endSessionUrl`) and mount it in the top `<header>` of `ai-chat-landing/app/page.tsx` (around L1100; also the mobile top bar if it renders separately)
- [X] T018 [US1] Write `ai-chat-landing/lib/auth/log.test.ts` (U24) and implement `ai-chat-landing/lib/auth/log.ts`: structured sign-in/failure/renewal events with `code`, `requestId`, `oidHash` (first 12 hex of SHA-256), never tokens/codes/secrets/raw oid/email; use it from T012–T015
- [ ] T019 [US1] (script implemented + syntax-checked; manual live sign-in/sign-out verified 2026-11-25, CDP assertions + HttpOnly/cancel checks still pending) Create `ai-chat-landing/scripts/entra-auth-check.mjs` (CDP, Chrome `:9240`) covering E1–E4: header sign-in and display name, `hermes_session` HttpOnly and absent from `document.cookie`, anonymous general chat unaffected, sign-out returns to anonymous, cancel shows the honest message; run owner-present with `RUN_ENTRA_E2E=1` and record results in `specs/050-azure-entra-oauth/test-plan.md` (E1–E4)

**Checkpoint**: US1 is demoable end to end on the real tenant; anonymous chat behavior is unchanged (I13 still green).

---

## Phase 4: User Story 2 — The same identity everywhere (Priority: P2)

**Goal**: The same person yields the same `oid`/email/display name from any browser, including after a mailbox alias change, and sessions renew silently.
**Independent test**: E6 (two browsers, equal `oidHash`) or the extended claim tests.

- [X] T020 [US2] Extend `ai-chat-landing/lib/auth/claims.test.ts` (identity stability): a token with a changed `email` but the same `oid` yields the same person key; `displayName` changes do not alter `oid`; a token whose only change is `preferred_username` still resolves to the same `oid`; record the assertions in test-plan U4–U9 notes
- [X] T021 [US2] Implement silent renewal in `ai-chat-landing/lib/auth/renew.ts` with tests in `ai-chat-landing/lib/auth/renew.test.ts`: refresh when the access token is within 5 minutes of expiry and a refresh token exists; single-flight per session; one failure tolerated, second ends the session with `reauthentication_required`; absolute expiry is never extended (U16)
- [ ] T022 [US2] (--two-browser implemented; live run still pending) Extend `ai-chat-landing/scripts/entra-auth-check.mjs` with a `--two-browser` mode (E6): two independent contexts sign in as the same member, both `/api/auth/session` responses show equal email/display name, and the structured logs show identical `oidHash`; run owner-present and record E6/E7 (session `expiresAt` ≤ 12 h) in `test-plan.md`

**Checkpoint**: identity is device-independent; renewal never bypasses the 12-hour cap.

---

## Phase 5: User Story 3 — Operator provisions and proves the setup (Priority: P3)

**Goal**: A fresh tenant can be provisioned from the runbook, and the nine-step flow is provable step by step without exposing secrets or tokens.
**Independent test**: E8 against a clean tenant.

- [X] T023 [US3] Create `ai-chat-landing/scripts/entra-flow-check.mjs`: loopback listener on `http://localhost:53682/callback`, authorization-code + S256 flow (no client secret), prints steps 1–9 PASS/FAIL and claim *presence* (`oid`, `email`/`preferred_username`, `tid`, `nonce`) plus lifetimes; unit-test its report formatter against `tests/support/fake-idp.ts` in `ai-chat-landing/lib/auth/flow-report.test.ts` (no token values in output)
- [ ] T024 [US3] Execute `specs/050-azure-entra-oauth/quickstart.md` §§1–5 on a clean test tenant (portal or `az`), capture the exact commands and results, and correct any drift between the runbook and the real Azure UI/CLI in `quickstart.md`
- [ ] T025 [US3] Perform the secret-rotation drill from `quickstart.md` §7 (create new secret → update env → verify sign-in → remove old) and record timings plus the zero-downtime result in `test-plan.md` under "Not covered live" (now covered)
- [ ] T026 [US3] Run E8 owner-present (`node ai-chat-landing/scripts/entra-flow-check.mjs`), confirm 9/9 PASS in < 15 minutes, and record the output summary in `test-plan.md`

**Checkpoint**: an operator with no prior context can provision and prove the setup from the docs alone.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T027 [P] Document the feature: auth section in `ai-chat-landing/README.md` (endpoints, cookies, env, in-memory session limitation, no dev bypass), auth entry in `AGENTS.md`, and the `ENTRA_*` variables + reverse-proxy HTTPS requirement in `DEPLOY.md`
- [X] T028 Run the full gates and record results: `cd ai-chat-landing && pnpm test && pnpm typecheck && pnpm lint`; confirm the Python suite is untouched (no Python files changed)
- [X] T029 Security spot-check: `git grep` for secret-shaped values and `oid`/token logging; verify no `ENTRA_CLIENT_SECRET` in tracked files, no token in any response body, cookies flagged per U18, `Cache-Control: no-store` on `/api/auth/session`; note results in `test-plan.md`
- [X] T030 Cross-check the implementation against `contracts/auth-http-api.md` and `contracts/identity-contract.md` (status codes, cookie names, payload keys, no `oid` to the browser); fix drift in code, not the contract, unless the contract is wrong — then update it and note why
- [X] T031 Record the Phase 2 handoff in `specs/050-azure-entra-oauth/test-plan.md`: `requireIdentity()` is the only entry point, identity fields available server-side, anonymous chat untouched, and no slug/profile code exists yet (so Phase 2 starts from a frozen contract)
- [X] T032 Update `specs/050-azure-entra-oauth/checklists/requirements.md` and the spec Status line with the final validation results (tests, live E1–E8, rotation drill)

- [X] T033 Implement the full-FQDN slug derivation helper in `ai-chat-landing/lib/auth/slug.ts` (`peter.chan@tvb.com.hk` → `peter-chan-tvb-com-hk`, `@tvb.com.cn` → `peter-chan-tvb-com-cn`, `@tvb.com` → `peter-chan-tvb-com`; oid-hash collision suffix applied only on collision) with tests in `ai-chat-landing/lib/auth/slug.test.ts` (U25) — follow-up requirement 2026-11-25

---

## Dependencies

```text
Phase 1 (T001–T003)
  └─> Phase 2 (T004–T011)  blocking for every story
        ├─> US1 (T012–T019)  MVP; T013 needs T006–T008; T018 feeds T012–T015 logs
        ├─> US2 (T020–T022)  needs T008, T009, T021; T022 needs T019's script
        └─> US3 (T023–T026)  needs T003, T019 (script harness patterns), tenant access
              └─> Phase 6 (T027–T032)
```

- T002 is independent of T001 (different files) and can run in parallel.
- Within Phase 2, T005/T006 are independent; T007/T008 depend on T004's config type; T009/T010 depend on the session types; T011 depends on T009/T010.
- US2 and US3 are independent of each other after Phase 2; US3 can start before US1 completes only for T023 (harness), not T024–T026 (needs a working redirect URI).

## Parallel execution examples

```text
# Phase 2 (after T004 types exist)
T005 errors.ts        ─┐
T006 pkce.ts          ─┼─ different files, no shared state
T007 jwks/discovery   ─┤
T008 claims.ts        ─┘

# US2 / US3 overlap
T020 claim-stability tests  ─┐
T023 harness script         ─┴─ different files; T022 still needs T019
```

## Implementation strategy

1. **MVP = US1** (T001–T019). It delivers the whole sign-in experience and every error path; US2 adds device-independence proof and renewal, US3 the operator proof.
2. Test-first per task: write the cited case, watch it fail, implement, then `pnpm test`.
3. Do not add profile/slug/gateway code — Phase 2 owns it; `requireIdentity()` is the seam.
4. Owner-present steps (T019, T022, T024–T026) are the only ones needing the real tenant; everything else runs offline.

## Format validation

- 43 tasks (33 original + 10 convergence); all have `- [ ]`/`- [X]`, a sequential `T0NN` id, and an exact file path.
- `[P]` used only where files and prerequisites are independent (T002, T003, T005, T006, T027).
- `[US1]`/`[US2]`/`[US3]` labels appear only in their story phases; Setup, Foundational, and Polish carry none.
- Every functional requirement FR-001…FR-020 and SC-001…SC-007 is covered by at least one task through the test-plan mapping.

---

## Phase 7: Convergence

- [X] T034 Route sign-in start failures to the honest UI banner per FR-012 (partial): in `ai-chat-landing/app/api/auth/signin/route.ts` redirect `config_invalid` and `idp_unavailable` to `/?auth_error=<code>` (keeping a JSON mode only if a caller asks for it), update the status table in `specs/050-azure-entra-oauth/contracts/auth-http-api.md`, and extend `ai-chat-landing/app/api/auth/signin/route.test.ts` (H1, I15) so the banner path is asserted
- [X] T035 Amend SC-007 to app-observable failure paths per SC-007 (contradicts): remove "unregistered return address" from the app-deliverable list in `specs/050-azure-entra-oauth/spec.md` (Entra refuses it before the app runs; quickstart §6 already documents it), align the H-matrix row wording in `test-plan.md`, and note the boundary in the edge-case list
- [X] T036 Make session renewal reachable from active use per FR-010 (partial): trigger `maybeRenew` from a 10-minute visible-tab poll of `/api/auth/session` in `ai-chat-landing/components/auth-control.tsx` (or make `requireIdentity` async and renew there), and add a test proving a session past access-token expiry renews without a prompt and never extends the 12-hour absolute cap
- [X] T037 Update the plan's source tree per plan: Project Structure (partial): add `lib/auth/renew.ts`, `lib/auth/log.ts`, `lib/auth/error-messages.ts`, `lib/auth/slug.ts`, `lib/auth/control-state.ts`, and `tests/support/` to `specs/050-azure-entra-oauth/plan.md` so the documented layout matches the shipped files
- [X] T038 Pass `prompt=select_account` on the first sign-in after an explicit sign-out per FR-011 (partial): extract a sign-in URL builder (e.g. `ai-chat-landing/lib/auth/signin-url.ts`), set a session flag in `components/auth-control.tsx` on sign-out, consume it on the next sign-in, and unit-test the builder so a failed tenant end-session cannot silently reuse the account

---

## Phase 8: Convergence

- [X] T039 Measure and assert SC-001 in the live check per SC-001 (partial): in `ai-chat-landing/scripts/entra-auth-check.mjs` record the elapsed time from clicking Sign in to the authenticated state and count the interactions the script performs, assert under 30 s and no more than three, and print both values in the E1 result line
- [X] T040 Log renewal and session eviction per FR-010 / test-plan U24 (partial): call `logAuthEvent` from `ai-chat-landing/lib/auth/renew.ts` (renewal success/failure, hashed oid only) and from `ai-chat-landing/lib/auth/session-store.ts` when the 1,000-session cap evicts (`session_evicted`), then extend `ai-chat-landing/lib/auth/log.test.ts` and U24 so both events are asserted token-free
- [X] T041 Derive the session handle as 32 random base64url bytes per data-model: AuthSession `handle` (contradicts): replace the two-UUID concatenation in `ai-chat-landing/lib/auth/session-store.ts` with `randomBytes(32).toString("base64url")`, keep the opacity/uniqueness assertions, and note the format in `data-model.md`
- [X] T042 Send callback configuration failures to the honest banner per FR-012 (partial): in `ai-chat-landing/app/api/auth/callback/entra/route.ts` redirect `config_invalid` to `/?auth_error=config_invalid` instead of returning JSON, and update `app/api/auth/callback/entra/route.test.ts` plus the status table in `contracts/auth-http-api.md`
- [X] T043 Remove the unused `asVerifyKey` export from `ai-chat-landing/lib/auth/jwks.ts` per house style (unrequested): delete it after confirming no callers (grep) so the module exposes only `createJwks` and `clearJwksCache`
