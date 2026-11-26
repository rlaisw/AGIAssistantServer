# Implementation Plan: Hermes Multi-Profile Gateway (Phase 2)

**Branch**: `051-hermes-multiplex` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/051-hermes-multiplex/spec.md` (clarifications of 2026-11-25: lazy provisioning, profile-owned credentials, native Hermes multiplexing, per-identity chat history, shared-Windows boundary, pre-cutover history preserved/hidden).

## Summary

Turn the single shared Hermes agent into a per-user service without writing a new gateway: enable the gateway's native multi-profile mode (`gateway.multiplex_profiles`) so one process serves `/p/<slug>/v1/…`, add a host-side provisioner that creates a profile lazily on the first agent-bound request, keep an identity index (object id → slug, status — **no keys**), and make the sidecar call each profile's own path with that profile's own `API_SERVER_KEY` read from a read-only profiles mount. Chat history becomes per identity by replacing the shared Dify user constant with a server-derived value.

## Technical Context

**Language/Version**: TypeScript 5.x / Node 22 (Next.js 16 provisioner) + Python 3.13 (sidecar) + Hermes gateway (existing)

**Primary Dependencies**: none new. Node `child_process` + `fs`; Python stdlib (`fcntl` locks, `json`, `httpx` already used); Hermes CLI (`hermes profile create`) and gateway (`multiplex_profiles`) as installed.

**Storage**: host profiles at `~/.hermes/profiles/<slug>/` (Hermes-owned, source of truth for keys/config/sessions); identity index at `~/.config/agentic-rag-mcp/hermes-mcp/profiles.json` (atomic JSON + lock, no keys); audit at the existing `audit.jsonl`.

**Testing**: `pytest` (sidecar/profile client, registry, provisioner helpers), `vitest` (Next registry/provision/history scoping), a **stub `hermes` executable** on `PATH` for deterministic provisioning tests, a local fake gateway for HTTP error matrices; owner-present E2E against the real gateway and one pilot profile.

**Target Platform**: Linux host (Next + Hermes in WSL), sidecar Docker container, existing HTTPS reverse proxy for the Chat UI.

**Project Type**: web application + MCP sidecar integration.

**Performance Goals**: first-use provisioning p95 < 10 s (SC-001); gateway hot-serve of a new profile within 30 s (native reconcile); per-request overhead < 100 ms excluding model/MCP; 10 concurrent requests at 25 registered profiles with ≤2× latency (SC-007, measured 2026-11-26); 100 profiles is an unverified design target, not a requirement.

**Constraints**: one gateway process and one port; profiles hot-discovered without restart; no key material in the registry, logs, or browser; legacy single-key lane calls stay working until migrated (FR-021); Dify history scoping is additive.

**Scale/Scope**: 25 registered profiles verified at 10 concurrent requests (SC-007); 100+ profiles is an unverified design target and bulk onboarding is out of scope; profile homes are small; index rewrite is O(n) but bounded (single JSON, atomic replace).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| **I. Contract Preservation (NON-NEGOTIABLE)** | PASS — MCP tool schemas gain only optional profile inputs; `/p/<slug>/v1` is additive; the existing `/v1/responses` path and its key remain functional for unmigrated lanes (FR-021). Tests pin both. |
| **II. Tests-First** | PASS — every behavior in the test plan has a case written before implementation; provisioning tests use a stub CLI and a fake gateway, so they are deterministic and offline. |
| **III. Minimal Dependencies** | PASS — no new package; provisioning uses the installed Hermes CLI, the sidecar reuses `httpx`/stdlib. `flock`+atomic rename instead of a database. |
| **IV. Honest Answers (NON-NEGOTIABLE)** | PASS — bounded error taxonomy E1–E16; the shared-Windows-account boundary is stated in user-facing copy (SC-011); an identified request never falls back to another profile or an unprofiled context; an anonymous lane call keeps the legacy path by design (FR-021). |
| **V. Spec-Driven Replacement** | PASS — no dead paths: the shared Dify user constant is replaced, not shadowed; the legacy gateway key remains only until lane migration, with removal tracked as its own step. |

**Quality gates**: pytest suite green (sidecar additions), `cd ai-chat-landing && pnpm test && pnpm typecheck && pnpm lint`, owner-present E2E recorded. Zero network in CI paths.

**Post-Phase-1 re-check**: PASS — design adds one host-side route, one Python module group, a mount, a gateway flag, and Dify variables; no breaking tool or `ask` contract change and no new runtime service.

### Complexity Tracking

| Entry | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Host-side provisioner inside Next | Profiles must be created with the installed `hermes` CLI on the host; the sidecar container has neither the CLI nor the host home. The Next server already holds the identity and runs on the host. | Sidecar writing profile folders directly duplicates Hermes profile semantics (config/.env/session layout) and would bypass `hermes profile create`. |
| Read-only `~/.hermes/profiles` mount into the sidecar | Profile-owned keys (Q2/B) mean the caller must read the target profile's key; the sidecar is the caller. | Sending keys through Dify/HTTP or storing them in a registry duplicates custody and widens exposure. The sidecar is a trusted server component; keys are never logged. |

## Project Structure

### Documentation (this feature)

```text
specs/051-hermes-multiplex/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── test-plan.md
├── contracts/
│   ├── gateway-profile-routing.md   # /p/<slug>/ contract + key expectations
│   ├── provisioner-api.md           # host ensure endpoint (internal)
│   └── registry-schema.md           # identity index JSON schema
└── checklists/requirements.md
```

### Source Code (repository root)

```text
ai-chat-landing/
├── app/api/profiles/ensure/route.ts      # host provisioner (internal bearer)
├── lib/profiles/
│   ├── config.ts            # env → provision token, profiles dir, template, win user, registry path
│   ├── registry.ts                       # atomic JSON index, flock, status transitions
│   ├── provision.ts                      # hermes profile create + USER.md + rollback
│   ├── identity-user.ts                  # Dify user scoping (oidHash) + legacy guard
│   └── errors.ts                          # profile error taxonomy
├── app/api/chat/route.ts                 # + identity inputs, per-identity Dify user
├── app/api/conversations/route.ts        # per-identity user filter
├── lib/profiles/*.test.ts
├── scripts/profiles-cli.mjs        # list/rotate/disable/enable (operator)
├── scripts/profiles-*.mjs          # thin wrappers
└── scripts/legacy-conversations-export.mjs

src/agentic_rag_mcp/
├── hermes_profiles.py                    # ensure() call, key read, slug validation, cache
├── hermes_client.py                      # + profile-aware /p/<slug>/ URL and key
├── hermes_audit.py                       # + profile events
└── deploy/docker_ops.py                  # read-only profiles mount + provisioner env
tests/unit/test_hermes_profiles.py
tests/contract/test_hermes_profile_routing.py

dify/AGIAssistant/AGI_Assistant.yml        # variables hermes_slug/oid/email + HTTP/tool wiring
```

**Structure Decision**: provisioner and index live with the Next app because it owns identity and runs on the host with the Hermes CLI; the sidecar gains a narrow `hermes/` module group; the gateway is configuration, not code.

## Phase 0 — Research (summary; details in research.md)

- D1 native multiplexing is the mechanism (`multiplex_profiles`, `/p/<profile>/`, 30 s reconcile) — no router.
- D2 provisioning host-side via `hermes profile create … --clone-from template-pc`, filesystem template fallback, rollback.
- D3 sidecar reads `API_SERVER_KEY` from a read-only profiles mount, per slug, short cache.
- D4 identity index stores oid hash → slug/status; no keys; atomic write + flock; corrupt index refuses provisioning but keeps routing.
- D5 lazy trigger at the sidecar's first agent-bound call, idempotent ensure with a per-identity lock.
- D6 Dify `user` = first 16 hex of SHA-256(oid); legacy constant retired; pre-cutover rows hidden.
- D7 migration: create `template-pc`, enable `multiplex_profiles` (legacy key path preserved), then create the pilot profile and verify `/p/<slug>/v1`; retire the legacy key only after each lane migrates.
- D8 error taxonomy and honest messages; no cross-profile fallback.
- D9 operator commands (list/rotate/disable/export) as scripts using Hermes CLI + index update.
- D10 observability: per-request correlation id, slug, outcome; no keys/oid.
- D11–D13: warm check, shared-OS boundary, and the fake-gateway/stub-CLI test strategy (see research.md).

## Phase 1 — Design (artifacts)

- [data-model.md](./data-model.md) — ProfileIndexEntry, ProfileHome, ProvisioningAttempt, ScopedChat; validation and state transitions.
- [contracts/gateway-profile-routing.md](./contracts/gateway-profile-routing.md) — path shape, per-profile key, status codes, legacy path.
- [contracts/provisioner-api.md](./contracts/provisioner-api.md) — request/response, idempotency, locks, rollback, internal auth.
- [contracts/registry-schema.md](./contracts/registry-schema.md) — JSON schema, atomicity, corruption policy.
- [quickstart.md](./quickstart.md) — enable multiplexing safely, create the template, pilot, wire Dify, operator commands, 12-step checklist.
- [test-plan.md](./test-plan.md) — unit U1–U30, integration I1–I14, E2E E1–E10, error matrix H1–H14, mapping to FR/SC.

## Error Handling

One `ProfileError` type (`code`, `httpStatus`, `userMessage`, `retryable`) shared by provisioner and sidecar; every failure leaves no partial profile and never falls back to another profile or anonymous context.

| ID | Condition | Behaviour | Status |
|---|---|---|---|
| E1 | Identity missing/invalid on ensure | Refuse; no profile work | 401/400 |
| E2 | Slug fails charset/length validation | Refuse; log hashed identity | 400 |
| E3 | Provisioning lock timeout (concurrent create) | Wait bounded, then `provisioning_in_progress` | 409 |
| E4 | `hermes profile create` fails | Remove temp dir; `provision_failed` | 500 |
| E5 | USER.md / template write fails | Roll back the created home; `provision_failed` | 500 |
| E6 | Registry corrupt/unreadable | Refuse new provisioning; keep routing; `registry_unavailable` | 503 |
| E7 | Registry write fails | Roll back profile; `provision_failed` | 500 |
| E8 | Profile missing at gateway call | Ensure once, then `profile_missing` | 404 |
| E9 | Profile key absent/empty | `profile_misconfigured`; operator action | 500 |
| E10 | Gateway rejects key (`401`) | `profile_auth_failed`; audit; no retry storm | 401 |
| E11 | Wrong profile path with a valid other key | Refuse (`403`), no execution | 403 |
| E12 | Profile disabled | Refuse before gateway; `profile_disabled` | 403 |
| E13 | Gateway unreachable / not warmed | One bounded retry; `agent_unavailable` | 503 |
| E14 | MCP/Windows PC offline | Honest tool result, attributed to the profile | 200 tool-error |
| E15 | Dify user scoping failure | Refuse the chat turn rather than write shared history | 500 |
| E16 | Pre-cutover conversation requested | Refuse; operator export only | 404 |

Rules: one ensure per request maximum after a positive cache hit; no raw oid, key, token, or path in messages/logs; audit every refusal with correlation id.

## Testing Strategy (details in test-plan.md)

- **Unit**: slug validation, registry atomic/lock behaviour, provision idempotency/rollback with the stub CLI, key read/cache, gateway URL/headers, Dify user derivation, legacy-history refusal.
- **Integration**: ensure endpoint (fresh/repeat/concurrent/rollback/corrupt index), sidecar ensure→key→`/p/<slug>/v1` flow, fake gateway 401/403/404/503 matrix, legacy path unchanged.
- **E2E (owner present)**: template + pilot profile, first-use provisioning, two-user memory isolation, chat history isolation, disable/rotate, gateway restart resilience, legacy conversations hidden/exported.
- **Test-first order** and the gates above.

## Implementation Strategy

1. Config + registry + provisioning with stub-CLI tests (no gateway change).
2. Sidecar profile client + mount + audit; legacy path pinned.
3. Dify variables + per-identity user scoping + legacy guard.
4. Pilot: `template-pc`, one profile, explicit `/p/<slug>/v1` proof, then enable `multiplex_profiles`.
5. Migrate lanes lane-by-lane; retire the shared key only after the last lane (separate step).
6. Operator scripts + documentation + acceptance record.

## Risks & Mitigations

- **Enabling multiplexing touches live lane calls** — pilot profile + explicit `/p/<slug>/v1` proof before the flag; legacy `/v1` kept (FR-021).
- **Profile hot-serve delay (30 s)** — first-use wait is bounded and honest; pre-warm after creation before returning (warm check).
- **Sidecar can read all profile keys via the mount** — trusted-component boundary, documented; keys never logged; mount is read-only and only the target file is read.
- **Dify history cutover** — legacy rows hidden, operator export prepared first; SC-012.
- **Shared Windows desktop** — no OS isolation; copy must not claim it (SC-011).

## Out of Scope

Per-profile OneDrive credentials, per-user Windows sessions, SAML, new gateway code, profile-level model routing, and migration of unmigrated lanes beyond their own step.
