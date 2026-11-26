# Data Model — Hermes Multi-Profile Gateway (Phase 2)

Hermes owns profile content; this feature owns only the identity index, the scoped chat identity, and audit records. No keys anywhere in our stores.

## ProfileIndexEntry

| Field | Type | Rules |
|---|---|---|
| `oidHash` | string | First 16 hex of SHA-256(`oid`). Primary key. Never the raw `oid`. |
| `slug` | string | `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`; unique; derived once, then immutable (full FQDN email; collision suffix from `oid`). |
| `status` | enum | `active` \| `disabled` (creation is atomic before the entry is written; transient failures surface in `lastError` while the profile stays active for retry). |
| `email` | string | Snapshot at creation (display/audit only; not a key). |
| `displayName` | string | Snapshot at creation. |
| `winUser` | string | The shared Windows account recorded for context (not an isolation boundary). |
| `createdAt` / `updatedAt` / `lastSeenAt` | ISO timestamps | `lastSeenAt` debounced to 60 s. |
| `lastError` | `{ code, at }` \| null | Last provisioning/routing failure for operators; no messages with secrets. |

Transitions:

```text
(absent) --ensure (create offline)--> active
                        │ failure (rollback, entry removed)
active --gateway 401/404 or corrupt home--> active (lastError set) --operator fix--> active
active --operator disable (key replaced)--> disabled --operator enable (new key)--> active
```

Invariants: one entry per `oidHash`; one entry per `slug`; `disabled` means the profile key is unusable; entries are never deleted by routing code.

## ProfileHome (Hermes-owned)

| Item | Rules |
|---|---|
| Path | `~/.hermes/profiles/<slug>/` — created only by `hermes profile create <slug> --clone-from template-pc`. |
| `config.yaml`, `.env` | Template copy; `.env` holds `API_SERVER_KEY` (profile-owned; never read by the index/browser). |
| `memories/USER.md` | Written once at creation: `Display Name:`, `Email:`, `Windows user:` (shared account). |
| Sessions/history | Hermes-owned; per profile by construction (Q1/A). |

## ProvisioningAttempt

| Field | Rules |
|---|---|
| `attemptId` | UUID; also the audit correlation id. |
| `oidHash`, `slug` | From the index; slug validated before any filesystem work. |
| `steps` | `lock → create → user-md → index → warm`; record completed steps for rollback. |
| `outcome` | `created` \| `exists` \| `failed`; failures remove the home and any half-written index entry. |

Lock key: `oidHash` (per-identity `flock`); timeout 30 s → `provisioning_in_progress`.

## ScopedChat

| Field | Rules |
|---|---|
| `difyUser` | `u-<oidHash>`; derived server-side per request; empty for anonymous (never sent). |
| `conversationId` | Owned by Dify; listing filtered by `difyUser`. |
| `legacyUser` | The retired constant `ai-chat-ui-user`; may be read only by the operator export (FR-026). |

## AuditEvent (append-only JSONL)

| Field | Rules |
|---|---|
| `event` | `ensure` \| `routing` \| `rotate` \| `disable` \| `enable` \| `refuse` \| `export`. |
| `slug`, `oidHash`, `correlationId`, `outcome`, `code`, `at` | Required; `code` from E1–E16 or `ok`. |
| Forbidden | API keys, bearer tokens, raw `oid`, email, absolute profile paths, conversation text. |

## Template

`template-pc` — a Hermes profile cloned from the current default: same model, tools and MCP wiring; no sessions, no `USER.md` identity, empty memory. It is the only profile creation source; it is never routed to.
