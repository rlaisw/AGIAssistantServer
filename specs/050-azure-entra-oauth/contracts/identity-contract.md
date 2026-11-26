# Contract — Identity for Phase 2

The only stable output of Phase 1 that Phase 2 may depend on. Phase 2 adds profile creation, slug derivation, and gateway routing; it MUST consume identity through this contract and MUST NOT re-derive identity from request parameters.

## Server-side identity object

Produced by `getIdentity(request)` / `requireIdentity(request)` after session validation. Never serialized to the browser.

| Field | Type | Guarantee |
|---|---|---|
| `oid` | string (GUID) | Present, stable for the person across devices and renames (FR-006/FR-007). Unique key for profile ownership. |
| `tid` | string (GUID) | Always the configured tenant (single-tenant, members only). |
| `email` | string | Present; from `email`, else `preferred_username`; current as of sign-in. May change over time — not an identity key. |
| `emailSource` | `"email" \| "preferred_username"` | Explains the provenance of `email`. |
| `displayName` | string | Present for display only; never a key. |
| `signedInAt` | ISO timestamp | When this session authenticated. |

Guarantees: no field is ever invented; a token without `oid` never produces an identity; a guest/other-tenant token never produces an identity; every value comes from a validated ID token, not from a header, query, or body supplied by the browser.

## Slug derivation

The deterministic helper ships in Phase 1 (`ai-chat-landing/lib/auth/slug.ts`, tests U25); Phase 2 creates and persists profiles. The slug keeps the **local part plus every DNS label of the domain, in order** — an email change between domains is a different identifier, never a rename:

| Email | Slug |
|---|---|
| `peter.chan@tvb.com.hk` | `peter-chan-tvb-com-hk` |
| `peter.chan@tvb.com.cn` | `peter-chan-tvb-com-cn` |
| `peter.chan@tvb.com` | `peter-chan-tvb-com` |
| `alice.chen@contoso.com` | `alice-chen-contoso-com` |

Normalization: lowercase, accent-stripped (NFKD), every non-alphanumeric run → `-`, leading/trailing `-` trimmed. The domain is **never** truncated, dropped, or reordered. Because `oid` is stable, the derived slug is stable across browsers and devices.

Collision handling is deterministic: `collisionSuffix(oid)` = first 8 hex of SHA-256(`oid`), appended only after the registry detects a taken slug (`slugWithCollision(email, oid)`). The same inputs always produce the same suffix; a counter or random suffix is forbidden.

Rules Phase 2 must honour:

1. Derive from the server-side identity, never from a client-supplied field.
2. Persist the mapping `oid → slug` on first creation so later email changes cannot silently move a user's profile.
3. Collision handling must be deterministic (same inputs → same slug, including the suffix).
4. Keep the full FQDN domain in the slug; never use the local part alone and never merge `tvb.com.hk` with `tvb.com`.

## Anonymous vs identity-bound

| Request | Phase 1 behavior | Phase 2 obligation |
|---|---|---|
| General web question, no session | Answered as today; Dify receives no identity fields | Must remain unchanged |
| Personal memory / Windows-PC (Hermes) action, no session | `401 signin_required`; nothing runs or queues | Must call `requireIdentity()` before any profile or gateway work |
| Personal memory / Windows-PC action, valid session | Identity available server-side | Pass `hermes_slug`, `user_email`, `user_oid` from the session, never from the browser |

## Dify variables (Phase 2 binding note)

When Phase 2 wires `hermes_slug`, `user_email`, and `user_oid` into the chatflow, they MUST be filled server-side from this identity object at request time. They MUST NOT be accepted from the browser, a query parameter, or a chat message. An anonymous request MUST leave them empty and MUST NOT reach the gateway; the gateway additionally refuses requests without a valid per-profile key.

## Session dependency

Identity is valid only while the session is active (8 h idle, 12 h absolute, tenant revocation). Phase 2 code must treat a `401 signin_required` as "ask the user to sign in", never as "fall back to an anonymous profile".
