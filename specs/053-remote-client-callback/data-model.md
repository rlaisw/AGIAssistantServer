# Data Model: Remote-client callback (spec 053)

One new persistent entity (the registry file) and one derived per-call value (the resolution). Everything else is an additive field on existing shapes.

## Entities

### RemoteClient (new — registry entry)

- **key**: normalized origin identifier the entry matches — IPv4/IPv6 literal, port-stripped, lowercased (e.g. `192.168.1.42`); charset `[0-9a-f.:]`, never a path or free text
- **name**: stable display name used in answers and audit (`raymond-office`); lowercase letters, digits, hyphens
- **bridge_url**: `http(s)://<lan-address>:18800/sse` — the client-side SSE bridge; scheme+host+port validated, no query/path beyond `/sse`
- **enabled**: boolean
- **created_at** (T025, US2/AC3): creation time — an explicit `created_at` string in the entry (validated non-string refused), else the registry file's mtime; never fabricated as now()
- Relationships: none between entries; one origin matches at most one entry (ambiguity refused)

### TargetResolution (new — derived per tool call, never persisted)

- **outcome**: exactly one of
  - `local` — empty/absent `client_origin`, or origin matching no registry entry (today's default; bridge URL and canonical host are today's constants verbatim)
  - `remote(RemoteClient)` — origin matches an enabled entry
  - `refused(reason: disabled | invalid-registry)` — matches a disabled entry, or a malformed/unreadable registry (ambiguity is unreachable by construction — exact-literal keys, see Validation rules); carries the intended machine's name
- Lifecycle: constructed at call time from the registry read + the `client_origin` argument; dies with the call. Not cacheable across registry edits beyond the mtime cache.

### SessionOrigin (derived — Chat UI side)

- The server-observed origin of the browser request: leftmost trusted `X-Forwarded-For` entry when a proxy chain is configured, else the socket remote address; port-stripped, normalized to the `RemoteClient.key` grammar before forwarding
- Constraint: never accepted from a browser-supplied body field (FR-005); the route treats any client-sent `client_origin` as absent

## Additive changes to existing shapes

- **AuditRow** (hermes lanes + `mcp_action`): + `target: "local" | <client name>` — emitted exactly when a resolution named a machine (a remote target, or its refusal); empty-`client_origin` local-default attempts keep today's byte-identical rows (FR-002 takes precedence; audit consumers read absence-of-field as local). Audit-exempt routes unchanged per spec 047/048's no-token rule.
- **Tool schemas** (`hermes_file_task`, `hermes_launch_app`, `hermes_office_task`, `hermes_run_command`, `hermes_run_powershell`, `mcp_action`): + optional `client_origin: str | None` — all existing args and contract snapshots unchanged (Constitution I)
- **Config**: + `[remote_clients] path` (default `~/.config/agentic-rag-mcp/remote-clients.toml`); no existing keys change
- **PowerShell pending draft** (spec 034 state): + the draft's bound `target_name` — a confirm resolved to a different machine is an unrelated response and never executes (mirrors the `mcp_action` proposal rule)

## Validation rules

- Registry file missing → registry is empty (local default for all origins); remote intent is impossible, no error surfaces on local paths
- Registry file present but unreadable/malformed → remote intent paths refuse honestly (`registry-unreadable`); empty-`client_origin` paths ignore the registry and run local
- Two entries whose keys would both match one origin → unreachable by construction (registry keys are exact normalized literals and duplicates are rejected at load), so `refused(ambiguous)` collapsed into `refused(invalid-registry)` in the implementation (2026-11-27); validation rejects keys that are not address literals
- `client_origin` present but not matching any entry → local default (FR-002), audited with `target: "local"` — matching an unregistered origin is not an error
- `bridge_url` failing scheme/host validation → the entry is refused (`registry-unreadable` class), never partially applied

## State transitions

None beyond the per-call resolution lifecycle above. The registry has no runtime state machine: `enabled` flips only by operator file edit, effective on the next call (FR-004); a mid-conversation disable changes the next tool call's resolution, which the answer reports honestly (spec edge case).