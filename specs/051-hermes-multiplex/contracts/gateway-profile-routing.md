# Contract — Gateway Profile Routing

The Hermes gateway runs with `gateway.multiplex_profiles: true`: **one process, one port**, profile selected by path. No new router.

## Paths

| Path | Auth | Behaviour |
|---|---|---|
| `POST /p/<slug>/v1/responses` | `Authorization: Bearer <profile API_SERVER_KEY>` | Routed to that profile's agent (memory, sessions, tools). |
| `POST /p/<slug>/<api_server route>` | same | Mirrored api_server surface for that profile. |
| `POST /v1/responses` (no prefix) | legacy shared key | Existing behaviour for not-yet-migrated lanes (FR-021). Removed only by a later migration step. |

Rules:
- `<slug>` matches `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`; the caller never passes a filesystem path.
- The key is the **profile's own** `API_SERVER_KEY`; a key valid for profile A MUST NOT authorize profile B (the gateway enforces this; our tests pin it).
- New profiles are served without a gateway restart (native reconcile, ≤30 s).

## Status semantics (what the sidecar maps)

| Gateway response | Meaning | Sidecar code / user message |
|---|---|---|
| `200` | served | — |
| `401` | key missing/invalid for this profile | `profile_auth_failed` — "Your assistant access is not valid. Contact the administrator." |
| `403` | profile disabled/forbidden | `profile_disabled` — "Your assistant profile is disabled." |
| `404` | unknown slug (not created or removed) | `profile_missing` — "Your assistant profile was not found; trying to create it…" (one ensure attempt, then honest failure) |
| `429` | concurrency cap | `agent_busy` — retry guidance, no queueing across profiles |
| `5xx` / timeout | not warmed, crash, host down | `agent_unavailable` — one bounded retry, then honest failure |

## Body and contract preservation

- The request/response **body is unchanged** from the existing `/v1/responses` contract; only the path and the key differ.
- The profile must be warm before the caller sends a user-visible request; the warm check uses the same path with a cheap request and a 10 s bound.
- No fallback: a profile failure never retries against another profile, the legacy path, or an anonymous context.

## Legacy migration

1. Create `template-pc` and one pilot profile; prove `/p/<slug>/v1/responses` with the pilot key.
2. Enable `multiplex_profiles`; keep `/v1/responses` and the shared key working.
3. Move lanes one at a time (each lane's tests must pass against the profile path).
4. Retire the shared key only after the last lane — separate change, spec update.
