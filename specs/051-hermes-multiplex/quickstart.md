# Quickstart — Hermes Multi-Profile Gateway (Phase 2)

Operator + developer run guide. Profile content is Hermes-owned; this feature adds provisioning, the identity index, profile routing and chat scoping.

## 0. Prerequisites

- Phase 1 sign-in working (`https://agia.tvb.com.hk`, `ENTRA_*` configured).
- Hermes gateway running on the host (`http://172.17.0.1:8642`) and the sidecar container healthy.
- Write access to `~/.hermes/profiles` and `~/.config/agentic-rag-mcp/hermes-mcp` as the Hermes owner.
- One pilot test user (a member account).

## 1. Prepare the template profile

```bash
hermes profile list                      # confirm the current default profile name
hermes profile create template-pc --clone-from <current-default>
hermes profile show template-pc          # confirm model/tools match the default
# remove identity leftovers so clones start empty
rm -f ~/.hermes/profiles/template-pc/memories/USER.md
```

Confirm the template's `.env` contains **no** `API_SERVER_KEY` — every profile mints its own key at provisioning (FR-022).

## 2. Enable multiplexing (gateway-wide, legacy path preserved)

Enable the flag **before** any pilot call — `/p/<slug>/…` routes only exist in multiplexed mode:

```bash
# set gateway.multiplex_profiles: true in the gateway config, then:
hermes gateway status
hermes gateway restart
hermes gateway list
```

Verify the legacy `/v1/responses` path with the shared key still answers (FR-021) before moving on.

## 3. Pilot: prove the profile path

```bash
hermes profile create pilot-alice --clone-from template-pc
# the clone has no key (FR-022) — mint one for the pilot, or let ensure create the profile
KEY=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')
printf 'API_SERVER_KEY=%s\n' "$KEY" >> ~/.hermes/profiles/pilot-alice/.env
chmod 600 ~/.hermes/profiles/pilot-alice/.env
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"input":"reply with ok"}' \
  http://172.17.0.1:8642/p/pilot-alice/v1/responses
```

Expect `200`. A `404` now means the profile is unknown or has not reconciled yet — check `hermes gateway list` and wait ≤30 s.

## 4. Wire the app

`ai-chat-landing/.env.local`:

```bash
PROFILES_PROVISION_TOKEN=<random 32 bytes>
HERMES_PROFILES_DIR=/home/administrator/.hermes/profiles
HERMES_TEMPLATE_PROFILE=template-pc
HERMES_WIN_USER=PC12345
```

Sidecar environment/Compose: mount the profiles directory read-only and point at the provisioner:

```yaml
volumes:
  - /home/administrator/.hermes/profiles:/hermes-profiles:ro
environment:
  HERMES_PROFILES_DIR: /hermes-profiles
  HERMES_PROVISION_URL: http://172.21.0.1:3000/api/profiles/ensure
  HERMES_PROVISION_TOKEN: <same value>
```

Dify: `/api/chat` sends `inputs.hermes_slug`, `inputs.hermes_oid`, `inputs.hermes_email` from the session (server-side). The chatflow binds them into the Hermes tool calls. The sidecar calls ensure before the first gateway call and then `POST /p/<slug>/v1/responses` with the profile key.

**Redeploy the sidecar** so it receives the read-only profiles mount (the container predates it):

```bash
python -m agentic_rag_mcp.deploy redeploy
# verify inside the container before the pilot:
docker exec agentic-rag ls /hermes-profiles
```

## 5. History cutover

1. Export pre-cutover conversations (operator):
   ```bash
   cd ai-chat-landing && node scripts/legacy-conversations-export.mjs --out ~/legacy-conversations.json
   ```
2. Switch the Dify `user` to `u-<oidHash>` in `/api/chat` and `/api/conversations` (FR-025).
3. Confirm a user's sidebar is empty before their first new message and that legacy conversations do not appear.

## 6. Operator commands

| Action | Command | Effect |
|---|---|---|
| List | `node scripts/profiles-list.mjs` | slug, status, created, last seen — no secrets |
| Rotate key | `node scripts/profiles-rotate.mjs <slug>` | new key in profile `.env`, reconcile, old key dead |
| Disable | `node scripts/profiles-disable.mjs <slug>` | status `disabled` + key replaced (gateway refuses) |
| Enable | `node scripts/profiles-enable.mjs <slug>` | fresh key, status `active` |
| Validate index | `python -m agentic_rag_mcp.hermes.profiles --validate` | structural check |

Each writes an audit record; none require a gateway restart.

## 7. Rollback

- **A flag-only rollback does not work on this build** (verified 2026-11-26): with profile homes present, Hermes re-enables `multiplex_profiles` on restart. To stop serving profiles, remove or rename the profile homes with operator approval and restart the gateway; the legacy `/v1` shared-key path stays available throughout.
- Per-profile data stays on disk; the index remains valid; re-enabling is non-destructive.
- Chat history cutover rollback is not automated: the legacy constant is only a read-side export after cutover.

## 8. Build checklist (12 steps)

1. Index module + atomic write/lock, with tests.
2. Identity/slug validation shared by provisioner and sidecar.
3. Provisioner route with token auth, idempotency, rollback.
4. Stub-CLI tests for create/failure/concurrency.
5. Sidecar profile client: ensure call, key read from mount, `/p/<slug>/` path, audit.
6. Legacy `/v1` path pinned unchanged.
7. Dify variables from the session; browser never supplies them.
8. Per-identity Dify `user` for chat + listing.
9. Legacy conversation exclusion + operator export.
10. Template + pilot profile; prove path; enable flag.
11. Operator scripts (list/rotate/disable/enable) + status endpoint.
12. Acceptance run (two users, isolation, rotation, failure matrix) and docs update.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/p/<slug>/v1` 404 | flag off, profile not created, or not yet reconciled | check `hermes gateway list`; wait ≤30 s; re-run ensure |
| 401 on a valid-looking key | key from another profile or stale cache | re-read `.env`; wait for the 60 s cache; check rotation |
| Two profiles for one user | ensure ran outside the lock, or slug changed | inspect index duplicates; operator rebuild; never delete blindly |
| Sidebar empty after login | cutover working as designed | expected until the first new message; legacy export holds old rows |
| `registry_unavailable` | malformed JSON or lock stuck | `--validate`, restore from backup, check stale lock |
