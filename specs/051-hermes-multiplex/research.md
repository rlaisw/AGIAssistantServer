# Research — Hermes Multi-Profile Gateway (Phase 2)

All decisions resolved; no NEEDS CLARIFICATION remain. Evidence was read from the installed Hermes tree (`~/.hermes/installs/…/workspace`) and the running stack.

## D1 — Native multiplexing, not a new gateway

**Decision**: enable `gateway.multiplex_profiles`; the gateway's shared listener serves `/p/<profile>/…` (including `/p/<profile>/v1/…` for the api_server adapter) from one process and one port.

**Rationale**: the installed Hermes already implements multiplexing, per-profile homes, and hot discovery (`run_profile_reconcile.py`: 30 s rescan + `rescan-profiles` control verb). `hermes gateway migrate` exists precisely to converge per-profile gateways onto the host gateway.

**Alternatives**: new router in front (duplicates routing); one worker per profile (more processes than needed); router over one single-profile agent (no memory isolation).

## D2 — Provisioning lives with the Next app (host-side)

**Decision**: `POST /api/profiles/ensure` in the Next app runs `hermes profile create <slug> --clone-from template-pc`, writes `memories/USER.md`, updates the index, then warms the profile.

**Rationale**: the sidecar container has **no** `~/.hermes` mount and no `hermes` binary (verified), while the Next server runs on the host as the Hermes owner and already holds the identity. The CLI is the canonical way to create a profile (config/.env/session layout).

**Alternatives**: sidecar writes profile folders directly (duplicates Hermes internals, bypasses `hermes profile create`); a new provisioning daemon (unjustified service).

## D3 — Profile-owned key, read through a read-only mount

**Decision**: each profile's `API_SERVER_KEY` lives in its own `.env`; the sidecar reads only `profiles/<slug>/.env` key from a read-only mount, caches it briefly, and sends it to `/p/<slug>/v1/…`.

**Rationale**: Q2/B and the gateway's native enforcement (“the shared listener authenticates with that profile's own `API_SERVER_KEY`”). The index never holds keys.

**Alternatives**: registry verifier (duplicate custody); sending keys through Dify (worse); sidecar storing copies (drift on rotation).

## D4 — Identity index is ours; keys are not

**Decision**: `~/.config/agentic-rag-mcp/hermes-mcp/profiles.json` stores `oidHash → slug, status, timestamps, winUser`; atomic replace + `flock`. Hermes remains the source of truth for profile content.

**Rationale**: Hermes does not know Entra identities; the mapping must survive with the sidecar. No key material keeps the index non-sensitive.

**Alternatives**: derive slug only from email each time (breaks on email change); store mappings in Dify (wrong layer); SQLite (dependency and migration for a tiny index).

## D5 — Lazy, idempotent ensure at the first agent-bound call

**Decision**: the sidecar receives `hermes_slug/oid/email` from the chatflow; before the first gateway call it calls ensure once, under a per-identity lock; repeated calls are cheap no-ops; positive results cache for 5 minutes.

**Rationale**: spec Q1/A; avoids empty profiles for sign-in/browsing; lock makes concurrent first requests safe (SC-005).

**Alternatives**: eager at callback (rejected by Q1); ensure on every call without cache (latency, lock churn).

## D6 — Dify chat scoping by hashed oid

**Decision**: replace the shared `ai-chat-ui-user` with `u-<first 16 hex of SHA-256(oid)>` for both chat and conversation listing; pre-cutover conversations (shared constant) are excluded and exported only by the operator.

**Rationale**: stable, non-reversible, no email/slug exposure in Dify; satisfies FR-025/FR-026, SC-010/SC-012.

**Alternatives**: slug as user (leaks domain in Dify admin views); email (PII); per-user Dify apps (heavy).

## D7 — Rollout: template → flag → pilot → lane migration

**Decision**: create `template-pc` from the current default profile; enable `multiplex_profiles` (legacy `/v1` preserved); create one pilot profile and prove `POST /p/<slug>/v1/responses` with its key; migrate lanes one at a time; retire the legacy shared key only in a separate change.

**Rationale**: the flag is gateway-wide and live lane calls share `:8642`; FR-021 requires the legacy path to keep working during migration.

**Alternatives**: big-bang enable (risk to production lanes); new port for pilot (contradicts one-port goal).

## D8 — Disable and rotate semantics

**Decision**: rotate = rewrite the profile `.env` key and signal reconciliation (watcher rescans `.env`), sidecar cache ≤60 s. Disable = set index status `disabled` **and** replace the profile key with a random unusable value so the gateway refuses even a leaked old key; re-enable restores a freshly minted key.

**Rationale**: index-only disable would leave the gateway accepting a valid key; key replacement makes the refusal real.

**Alternatives**: stop the gateway (affects everyone); delete the profile (destroys data; operator may want retention).

## D9 — Operator surface

**Decision**: three scripts using the CLI + index (`profiles-list`, `profiles-rotate`, `profiles-disable/enable`) and a legacy export (`conversations-export --legacy`). Each writes an audit record.

**Rationale**: SC-008 (under 2 minutes); no UI needed for Phase 2.

## D10 — Error taxonomy shared across layers

**Decision**: one code set E1–E16 (plan) mapped to honest messages; the sidecar refuses before calling the gateway where possible (missing/invalid/disabled), otherwise maps gateway status (401/403/404/503).

**Rationale**: honest answers (Constitution IV) and testable acceptance; no cross-profile fallback.

## D11 — Warm check without inventing an endpoint

**Decision**: after creation, poll the profile's existing API path with the profile key (a cheap request) until it answers (bounded ~10 s); on timeout return `agent_unavailable`, leaving the profile active for retry.

**Rationale**: reconcile is asynchronous; the user should not hit a cold profile; no new gateway API is created.

## D12 — Windows/OneDrive boundary is explicit

**Decision**: profiles isolate memory/files/chat/audit; Windows actions run under the single OS account; copy and tests state this, and no per-profile OneDrive work is in Phase 2.

**Rationale**: spec Q2/A and SC-011; per-user Windows sessions are impossible on one logged-in desktop.

## D13 — Testing strategy

**Decision**: deterministic offline tests via a **stub `hermes` executable** and a local fake gateway; owner-present E2E for the real CLI/gateway; no network in CI.

**Rationale**: same pattern as the Phase 1 fake IdP; reproducing gateway failures (401/403/404/503) requires a controllable server.
