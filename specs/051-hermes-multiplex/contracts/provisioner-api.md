# Contract — Provisioner API (host-side ensure)

Internal endpoint in the Chat UI host app; consumed only by the sidecar. Not browser-reachable in practice (bearer token), and never returns key material.

## `POST /api/profiles/ensure`

Headers: `Authorization: Bearer <PROFILES_PROVISION_TOKEN>` (server env), `Content-Type: application/json`.

Body:

```json
{ "slug": "peter-chan-tvb-com-hk",
  "oid": "<entra object id>",
  "email": "peter.chan@tvb.com.hk",
  "displayName": "Peter Chan" }
```

Validation: token exact (constant-time); slug charset/length; `oid` non-empty; email contains `@`; display name optional (falls back to email local part).

Responses:

| Situation | Status | Body |
|---|---|---|
| created | 201 | `{ "slug": "...", "status": "active", "created": true }` |
| already active | 200 | `{ "slug": "...", "status": "active", "created": false }` |
| same identity, concurrent create in progress | 409 | `{ "error": "provisioning_in_progress" }` (retry after a short wait) |
| invalid input | 422 | `{ "error": "invalid_profile_request" }` |
| auth failure | 401 | `{ "error": "unauthorized" }` |
| CLI/create failure (after rollback) | 500 | `{ "error": "provision_failed" }` |
| index corrupt/unreadable | 503 | `{ "error": "registry_unavailable" }` |
| warm check timeout | 503 | `{ "error": "agent_unavailable" }` (profile remains `active`; retry allowed) |

Guarantees:
- **Idempotent** per `oidHash` under a per-identity lock (`flock`), timeout 30 s.
- On any failure after creation starts: remove the created home, revert the index, return the error.
- Response never contains `API_SERVER_KEY`, profile paths, or the raw `oid`.
- Every call appends an audit record with `correlationId = attemptId`.

## `GET /api/profiles/status?slug=<slug>` (operator/health, read-only)

Returns `{ slug, status, createdAt, lastSeenAt, lastError }` — never keys. Requires the same bearer token. Used by quickstart verification and by the operator scripts.

## Environment

| Variable | Purpose |
|---|---|
| `PROFILES_PROVISION_TOKEN` | Bearer for both endpoints; generated once, stored in `.env.local` and the sidecar config. |
| `HERMES_PROFILES_DIR` | Host profiles root (default `~/.hermes/profiles`). |
| `HERMES_TEMPLATE_PROFILE` | Clone source (default `template-pc`). |
| `HERMES_WIN_USER` | Recorded shared Windows account for `USER.md` (e.g. `PC12345`). |

Rotation and disable are **not** part of this API; they are operator scripts (see quickstart) so they cannot be triggered by a chat request.
