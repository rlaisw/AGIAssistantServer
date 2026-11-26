# Contract — Identity Registry Schema

Path: `~/.config/agentic-rag-mcp/hermes-mcp/profiles.json` (host and sidecar-visible through the existing config mount). Never contains keys.

```json
{
  "version": 1,
  "updatedAt": "2026-11-25T09:20:00.000Z",
  "profiles": {
    "3f9a1c2b7d4e5f60": {
      "oidHash": "3f9a1c2b7d4e5f60",
      "slug": "peter-chan-tvb-com-hk",
      "status": "active",
      "email": "peter.chan@tvb.com.hk",
      "displayName": "Peter Chan",
      "winUser": "PC12345",
      "createdAt": "2026-11-25T09:19:55.000Z",
      "updatedAt": "2026-11-25T09:19:55.000Z",
      "lastSeenAt": "2026-11-25T09:20:00.000Z",
      "lastError": null
    }
  }
}
```

Rules:
- `oidHash` = first 16 hex of SHA-256(`oid`); it is the map key and must equal the field.
- `slug` unique across the file; status ∈ `active | disabled` (transient failures live in `lastError`).
- Writes: serialise under `profiles.json.lock` (`flock`), write `profiles.json.tmp`, `fsync`, atomic `rename`; never partial.
- Reads tolerate a concurrent writer (rename is atomic). A malformed/unreadable file → `registry_unavailable` (E6); routing reads from Hermes keep working, new provisioning is refused until repaired.
- Repair procedure: `python -m agentic_rag_mcp.hermes.profiles --validate` prints the first structural error and suggests `--rebuild-from-profiles` (reconstructs entries from profile homes where `USER.md` carries the identity; entries without an identity are left for the operator).
- Migration from v0 (absent file): create on first ensure; existing profiles without an index entry are adopted only by the explicit operator rebuild, never silently.

Invariants:
- No key, token, raw `oid`, or absolute path is stored.
- An entry is never deleted by request handling; disable is a status change and key replacement.
- `lastSeenAt` updates are debounced (≤1 write/60 s per profile).
