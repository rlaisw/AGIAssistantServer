"""Remote-client port bridge (spec 053) — the a301-11120 deployment.

The WindowsMCP (:8800) and OfficeMCP (:8888) services on this machine bind
127.0.0.1 ONLY (correct — zero direct LAN exposure). The AGI Assistant
sidecar and its gateway agent run on a DIFFERENT machine (the WSL host,
10.161.141.94) and need to reach them, so this bridge exposes them on the
LAN at :18800 / :18888 as a dumb TCP pump — bytes pass through untouched,
including headers, so the canonical-Host discipline the sidecar sends
(Host: 127.0.0.1:8800) is preserved end-to-end.

Deployment (one-time, as administrator — full runbook in DEPLOY.md
"Remote Windows clients (spec 053)"):
  py C:\\ProgramData\\agentic-rag\\bridge\\bridge.py     # run now
  schtasks /create /tn "agentic-rag-port-bridge" ...
  New-NetFirewallRule ... -LocalPort 18800 -RemoteAddress 10.161.141.94 ...
  New-NetFirewallRule ... -LocalPort 18888 -RemoteAddress 10.161.141.94 ...

shortcut: 0.0.0.0 binds every NIC incl. Tailscale/VMware adapters — the
firewall rules are the actual boundary; if the machine roams onto untrusted
networks, re-scope or disable the rules.
"""

from __future__ import annotations

import asyncio
import sys

# Bind all interfaces (firewall rules scope who may connect); forward to the
# loopback-only services. Ports mirror the WSL-host bridge numbering.
FORWARDS = [
    ("0.0.0.0", 18800, "127.0.0.1", 8800),  # windows-mcp (desktop lanes)
    ("0.0.0.0", 18888, "127.0.0.1", 8888),  # officemcp (office lane)
]


async def _pump(reader: asyncio.StreamReader,
                writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            chunk = await reader.read(65536)
            if not chunk:
                break
            writer.write(chunk)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        try:
            writer.close()
        except Exception:  # noqa: BLE001 — best-effort close on teardown
            pass


async def _handle(down_reader: asyncio.StreamReader,
                  down_writer: asyncio.StreamWriter,
                  up_host: str, up_port: int) -> None:
    try:
        up_reader, up_writer = await asyncio.open_connection(up_host, up_port)
    except (ConnectionError, OSError):
        # upstream (WindowsMCP/OfficeMCP) down: close the caller's side so it
        # sees EOF instead of hanging
        down_writer.close()
        return
    await asyncio.gather(_pump(down_reader, up_writer),
                         _pump(up_reader, down_writer))


async def serve(bind_host: str, bind_port: int, up_host: str, up_port: int):
    async def handler(r, w):
        await _handle(r, w, up_host, up_port)

    server = await asyncio.start_server(handler, bind_host, bind_port)
    async with server:
        await server.serve_forever()


async def main() -> None:
    await asyncio.gather(*(serve(b, bp, u, up)
                           for b, bp, u, up in FORWARDS))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)