# Bug Fix: Remote-targeted agent lanes hang — Word never opens, answer churns until stopped

- **Slug**: `no-open-word-hangs-up`
- **Fixed**: 2026-11-28T01:30:00Z
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Replaced the unexecutable "agent drives the client bridge as a raw SSE MCP session via its browser tool" instruction with per-client **registered gateway MCP tools**: the client's bridges are now real `mcp_servers` entries on the Hermes gateway (main config + all profiles), and the sidecar's agent-lane remote paragraph directs the agent to those tools by name (`mcp__WindowsMCP_a301_11120__*` / `mcp__OfficeMCP_a301_11120__*`), forbidding the host-wired tools.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `~/.hermes/config.yaml` | modified | `mcp_servers` += `WindowsMCP-a301-11120` (:18800) + `OfficeMCP-a301-11120` (:18888), both with canonical `Host` headers, `enabled: true` |
| `~/.hermes/profiles/{billy-test-tvb-com-hk,raymond-lai-tvb-com-hk,template-pc}/config.yaml` | modified | same two entries per profile (chat lanes route by identity — anonymous legacy path uses the main config) |
| Hermes gateway process | restarted | was detached (parent 1); relaunched via `hermes --profile default gateway run --quiet`, persistent-managed, 8642 listening; agent confirmed to see the 22+12 per-client tools live |
| `src/agentic_rag_mcp/remote_clients.py` | modified | + `RemoteClient.mcp_tool_prefix(service)` — derives the gateway tool prefix (`mcp__<service>_<name>__`, hyphens→underscores) |
| `src/agentic_rag_mcp/hermes_client.py` | modified | `targeted_instructions()` remote paragraph rewritten: per-client registered tools named (App/Type/Click/PowerShell/Process examples), local tools forbidden, honest-unreachable failure line; the SSE-manual/canonical-rewrite text removed |
| `tests/unit/test_remote_clients.py` | modified | + `test_mcp_tool_prefix_underscores_the_gateway_server_name` (pins hyphen→underscore naming) |
| `tests/unit/test_remote_transport.py` | modified | paragraph pins updated: assert per-client tool prefixes + gateway server names present; assert `"open an SSE session"` / `"send MCP JSON-RPC"` / bridge-URL rewriting **absent** |
| `DEPLOY.md` | modified | spec-053 client runbook: new REQUIRED "Gateway registration" step (mcp_servers block, restart, verify) |
| `specs/053-remote-client-callback/contracts/targeting.md` | modified | resolution-table `remote(...)` row amended with the bug reference and new mechanism |
| sidecar | redeployed | image rebuilt, container recreated, healthy; new paragraph confirmed live in the container |
| leftover process | removed | killed the leaked `curl -sN …18800/sse` (pid 175777) the hung turns had spawned — evidence of the root cause |

## Diff Highlights

```python
# remote_clients.py — the gateway tool-prefix derivation
def mcp_tool_prefix(self, service: str) -> str:
    server = f"{service}-{self.name}"
    return f"mcp__{server.replace('-', '_')}__"
```

```text
# hermes_client.py remote paragraph (v2) — executable by the agent:
REMOTE TARGET (spec 053): the Windows computer for this task is the REMOTE
machine "a301-11120" — NOT the machine you are running on. Do NOT call your
local WindowsMCP/OfficeMCP tools … Use ONLY a301-11120's registered tools
instead: server WindowsMCP-a301-11120 (names mcp__WindowsMCP_a301_11120__*)
— e.g. mcp__WindowsMCP_a301_11120__App to launch/focus apps … If the
mcp__WindowsMCP_a301_11120__* tools error as unreachable, report TASK:
FAILED with that reason honestly and do nothing.
```

## Tests Added or Updated

- `tests/unit/test_remote_clients.py::test_mcp_tool_prefix_underscores_the_gateway_server_name` — pins `WindowsMCP` → `mcp__WindowsMCP_a301_11120__` (gateway hyphen→underscore naming)
- `tests/unit/test_remote_transport.py::test_remote_instructions_append_the_target_paragraph` — asserts per-client prefix + server name present, SSE-manual text **absent**, local-tool forbiddal present
- `tests/unit/test_remote_transport.py::test_office_remote_instructions_name_the_office_tools` — office lane names `OfficeMCP-a301-11120` tools; no bridge-URL rewriting
- `tests/unit/test_remote_transport.py::test_remote_run_command_posts_remote_target_instructions` / `::test_office_remote_posts_office_bridge` — live server call assertions updated to the new mechanism

## Local Verification

- Commands: `pytest tests/unit/test_remote_clients.py tests/unit/test_remote_transport.py tests/integration/test_remote_callback_transport.py tests/unit/test_hermes_{run,powershell,launch,office}_tool.py -q` → **132 passed**
- `ruff check` on the four touched repo files → clean
- Full MCP SDK handshake through the client bridge from the host (both services, canonical Host only, no auth) → initialize + 22 WindowsMCP / 12 OfficeMCP tools listed
- Gateway restarted → agent queried live: lists `mcp__WindowsMCP_a301_11120__App`, `…__Click`, `…__PowerShell`, … (22) — the exact prefix the new paragraph names
- Sidecar redeployed (`agentic-rag` healthy, image fresh); new paragraph confirmed live inside the container with the registry entry resolving to it
- DSL unchanged — no chatflow republish needed (instructions are built sidecar-side per call)

## Deviations from Assessment

- The assessment's step "register servers, e.g. `windows-mcp-a301-11120: url …`" landed as **`WindowsMCP-a301-11120`/`OfficeMCP-a301-11120`** (matching the existing `WindowsMCP`/`OfficeMCP` server-name style), and the profile-vs-main-config open question resolved as **both**: anonymous legacy lanes use the main config, identity-scoped lanes use `/p/<slug>/` profile configs, so all four configs carry the entries.
- Assessment's open question about MCP auth resolved by evidence: the client services accept the canonical-Host handshake with no Authorization (verified by full SDK initialize), so the `mcp_servers` entries need only the `Host` header.

## Follow-ups

- **T020 re-run** (owner, from a301-11120's browser): "open microsoft word, type hello raymond" — expect Word on the client with an attested verdict; then the full battery (host regression, diagnostics, never-list refusal, remote health check).
- Keepalive/session-TTL spot-check on the first live remote Office turn (gateway HTTP keepalive default 180 s vs WindowsMCP session TTL — assessment open question).
- Tool-count growth on the gateway (34 new tools) — watch tool-sync and prompt size; consider `lazy: true` on the per-client `mcp_servers` entries if it bites.
- Commit + `graphify update .` (manual runbook) on owner's go — spec-053 change set plus this fix.