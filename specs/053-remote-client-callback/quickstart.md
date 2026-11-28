# Quickstart: Remote-client callback (spec 053)

## Prerequisites

- Stack running (sidecar + Chat UI + Dify chatflow), host desktop as today
- A remote Windows client deployed per [contracts/targeting.md](contracts/targeting.md#4-client-side-deployment-prerequisite-operator-contract-not-this-repos-code): WindowsMCP + office automation on the canonical local host, bridge on `:18800/sse`, LAN-reachable
- Registry entry added on the host:
  ```toml
  # ~/.config/agentic-rag-mcp/remote-clients.toml
  [clients."<client-ip>"]
  name = "raymond-office"
  bridge_url = "http://<client-ip>:18800/sse"
  enabled = true
  ```
- The client's browser can reach the Chat UI origin (spec 052 posture)

## Validate

1. **Remote acceptance (SC-001)**: from the client's browser, send "open microsoft word, type hello raymond" → Word opens on the client with the text typed; the answer says it ran on the client (by registry name); nothing opens on the host desktop; the audit rows carry `target: "raymond-office"`.
2. **Host regression (SC-002)**: from the host's browser, send the same prompt → runs on the local desktop exactly as today; audit `target: "local"`.
3. **Unregistered origin (SC-006)**: from a phone/other machine on the LAN → local default, unchanged behavior.
4. **Disabled refusal (SC-003)**: set `enabled = false` in the registry (no restart), send a desktop prompt from the client → honest refusal naming the disabled machine; zero execution anywhere; re-enable → routes again on the next request.
5. **Unreachable refusal (SC-003)**: stop the client's bridge, send a desktop prompt from the client → honest "could not reach <name>, nothing ran"; host desktop untouched.
6. **mcp_action on the client (SC-007)**: from the client, run the system health check through its proposal → confirm → report + capture describe the client; zero mcp_action execution on the host.
7. **Gates unchanged**: from the client, attempt a never-listed PowerShell draft ("format my D: drive") → refused exactly as locally, despite confirmation; audit rows recorded against the client's name.

Expected: all cases per [test-plan.md](test-plan.md). Timing: each remote action within 2× its local time (SC-005, from the `TIMING:` profile).