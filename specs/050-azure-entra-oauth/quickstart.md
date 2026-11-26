# Quickstart — Azure Entra ID SSO (Phase 1)

Two audiences: the operator who provisions Azure, and the developer who runs and validates the app.

## 0. Prerequisites

- Azure access to create an app registration in the target tenant (Application Administrator or equivalent), and permission to grant the delegated identity scopes.
- The tenant id and a decision on the production host (`https://<chat-host>`).
- Local: Node.js 22, `pnpm`, Chrome for the CDP checks.
- Two test accounts in the tenant: one member, one guest from another organization (the guest proves rejection; no membership change needed).

## 1. Provision the registration (portal path)

Follow `contracts/entra-app-registration.md` exactly. Short form:

1. Entra admin center → **App registrations** → **New registration**.
2. Name `AGI Chat — Hermes SSO`; account type **single tenant**; add the web redirect URIs for local and production.
3. **Authentication** → add `http://localhost:53682/callback` as a **Mobile and desktop** redirect (harness public client); leave implicit grant off.
4. **Token configuration** → ID token optional claims: `email`, `preferred_username`, `sid`.
5. **Certificates & secrets** → new client secret, 6-month expiry; copy the value once into the server environment.
6. **API permissions** → Microsoft Graph delegated `openid`, `profile`, `email`, `offline_access`; grant admin consent if the tenant requires it.
7. **Logout URL** (Front-channel logout / post-logout): the production and local Chat UI origins.

## 2. Provision with Azure CLI (equivalent, idempotent)

Requires `az login` in the target tenant. Ids are captured for the environment file.

```bash
TENANT_ID=$(az account show --query tenantId -o tsv)
APP_ID=$(az ad app create --display-name "AGI Chat — Hermes SSO" \
  --sign-in-audience AzureADMyOrg --query appId -o tsv)
OBJECT_ID=$(az ad app show --id "$APP_ID" --query id -o tsv)

# the app needs a service principal before credential/consent operations
# (az ad app credential reset fails with "Resource ... does not exist" without it)
az ad sp create --id "$APP_ID"

# web redirect URIs (dev + prod) and the loopback harness URI (public client)
az ad app update --id "$APP_ID" --web-redirect-uris \
  "http://localhost:3000/api/auth/callback/entra" "https://<chat-host>/api/auth/callback/entra"
az ad app update --id "$APP_ID" --public-client-redirect-uris "http://localhost:53682/callback"

# delegated identity scopes only (no Graph data scopes). Tenant-wide admin
# consent (az ad app permission grant) needs Global-Admin privileges; for these
# identity-only delegated scopes, per-user consent at first sign-in suffices
# (verified live 2026-11-26: the E8 harness runs 9/9 without an admin grant).
az ad app permission add --id "$APP_ID" --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope \
                    37f7f235-527c-4136-accd-4a02d197296e=Scope \
                    64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0=Scope \
                    7427e0e9-2fba-42fe-b0c0-848c9e6a8182=Scope

# ID-token optional claims in one CLI line (no manifest edit needed; verified live 2026-11-26)
az ad app update --id "$APP_ID" --set optionalClaims='{"idToken": [{"essential": false, "name": "email"}, {"essential": false, "name": "preferred_username"}, {"essential": false, "name": "sid"}]}'

# secret with a 6-month window; capture once, never commit (needs the service principal above)
SECRET=$(az ad app credential reset --id "$APP_ID" --display-name "hermes-sso" \
  --years 0 --end-date "$(date -u -d '+6 months' +%Y-%m-%d)" --query password -o tsv)
```

## 3. Configure the app

`ai-chat-landing/.env.local` (git-ignored):

```bash
ENTRA_TENANT_ID=<tenant-guid>
ENTRA_CLIENT_ID=<app-guid>
ENTRA_CLIENT_SECRET=<secret-value>
ENTRA_REDIRECT_URI=http://localhost:3000/api/auth/callback/entra
AUTH_COOKIE_SECURE=0          # local HTTP only; never in production
```

The existing `DIFY_API_BASE_URL` / `DIFY_API_KEY` are unchanged.

## 4. Run

```bash
cd ai-chat-landing
pnpm typecheck && pnpm lint
pnpm test          # unit + fake-IdP integration, offline and deterministic
pnpm dev           # http://localhost:3000
```

Anonymous visit: the landing page works exactly as before, with a **Sign in** control in the header.

## 5. Validate (four paths, in order)

| # | Path | Command | Expected |
|---|---|---|---|
| 1 | Unit + integration (no tenant) | `pnpm test` | all auth suites green, no network |
| 2 | Registration + flow, operator only | `node scripts/entra-flow-check.mjs` | steps 1–9 each PASS; claims `oid`, `email`, `tid`, `nonce` present; no token values printed |
| 3 | Live UI acceptance (owner present) | `RUN_ENTRA_E2E=1 node scripts/entra-auth-check.mjs` | header shows the display name; session cookie is HttpOnly; sign-out returns to anonymous; anonymous chat still answers |
| 4 | Two-device identity | manual (phone + desktop browser) or path 3 twice | same display name and email; structured log shows the same `oidHash` |

The harness (path 2) uses the loopback public client and therefore needs no secret; it proves the registration, issuer, claims, and PKCE. Path 3 proves the Next.js routes and the UI.

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `AADSTS50011` on the Microsoft screen | return address not registered or not exact | add the exact URI in **Authentication** |
| `signin_failed` after returning | wrong client secret (expired/rotated) | update `ENTRA_CLIENT_SECRET`; check the overlap window |
| `token_invalid` | wrong `ENTRA_TENANT_ID` or clock skew > 5 min | correct the tenant id; fix the clock |
| `tenant_not_allowed` | signed in with a guest/other-org account | expected for members-only; use a member account |
| `identity_incomplete` | tenant omits `email` and `preferred_username` | enable the ID-token optional claims |
| Sign-in works, immediately signed out | cookies not `Secure` in production, or the two cookie names mismatched | check `AUTH_COOKIE_SECURE` and the `__Host-` names |
| Everyone signed out after a deploy | in-memory sessions reset with the process | expected; documented limitation of the single-process store |

## 7. Rotate the secret (no downtime)

```bash
# list credentials to find the old key id and its expiry
az ad app credential list --id "$APP_ID" --query "[].{keyId: keyId, name: displayName, expires: endDateTime}" -o table

# ADD the new secret via Graph addPassword — both secrets stay valid during the
# overlap window (true zero downtime). Do NOT use `az ad app credential reset`
# here: despite the drill's §7 assumption, reset REPLACES the credential set
# (verified live 2026-11-26: the old key vanished the moment reset returned,
# leaving ~30 s where new sign-ins would fail at token exchange).
OBJECT_ID=$(az ad app show --id "$APP_ID" --query id -o tsv)
NEW_SECRET=$(az rest --method POST \
  --url "https://graph.microsoft.com/v1.0/applications/$OBJECT_ID/addPassword" \
  --headers "Content-Type=application/json" \
  --body '{"passwordCredential": {"displayName": "hermes-sso-next", "endDateTime": "'"$(date -u -d '+6 months' +%Y-%m-%dT%H:%M:%SZ)"'"}}' \
  --query "secretText" -o tsv)

# update ENTRA_CLIENT_SECRET, redeploy, verify sign-in, then remove the old credential
az ad app credential delete --id "$APP_ID" --key-id <old-key-id>
```

## 8. Remove (rollback)

Delete the app registration (or its secret) and remove the four env values. The Chat UI returns to anonymous-only behavior with no code change — auth routes answer `config_invalid` until configured, and `/api/chat` is untouched.
