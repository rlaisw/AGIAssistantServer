"""Spec 053 integration — the remote callback transport end to end.

Test-plan.md §3: a remote-targeted call dials (only) the matched machine's
bridge; transport failures against the remote machine refuse honestly and
never fall back to the host bridge; operator registry edits take effect
mid-conversation; an mcp_action draft validates against the target
machine. Respx stands in for the remote bridge (the SSE handshake itself is
pinned in the unit suites); the host bridge stays mocked with a zero-call
assertion.
"""

from __future__ import annotations

import asyncio
import json
import socket
import threading

import httpx
import respx

import agentic_rag_mcp.windows_mcp.client as cl
from agentic_rag_mcp.config import Config
from agentic_rag_mcp.remote_clients import resolve_target
from agentic_rag_mcp.server import build_server
from agentic_rag_mcp.windows_mcp import health

HERMES_BASE = "http://hermes.test:8642"
REMOTE_IP = "127.0.0.99"                      # respx-safe fake "LAN" address
REMOTE_BRIDGE = f"http://{REMOTE_IP}:18800/sse"
REMOTE_NAME = "raymond-office"
HOST_BRIDGE = cl.BRIDGE_SSE_URL


def _registry(tmp_path, enabled: bool = True) -> str:
    path = tmp_path / "remote-clients.toml"
    path.write_text(
        f'[clients."{REMOTE_IP}"]\nname = "{REMOTE_NAME}"\n'
        f'bridge_url = "{REMOTE_BRIDGE}"\n'
        f'enabled = {str(enabled).lower()}\n', encoding="utf-8")
    return str(path)


def _serve(callback) -> int:
    """A one-shot local TCP server for the probe case (the lane-test pattern)."""
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]

    def run():
        conn, _ = listener.accept()
        try:
            callback(conn)
        finally:
            conn.close()
            listener.close()

    threading.Thread(target=run, daemon=True).start()
    return port


def test_probe_measures_the_remote_bridge_and_reports_honestly():
    def answer(conn):
        conn.sendall(b"HTTP/1.1 200 OK\r\n"
                     b"Content-Type: text/event-stream\r\n\r\n"
                     b"event: endpoint\r\n"
                     b"data: /messages/?session_id=probe\r\n\r\n")
        conn.shutdown(socket.SHUT_WR)

    port = _serve(answer)
    out = health.probe_windows_mcp(
        url=f"http://127.0.0.1:{port}/sse", timeout_s=5)
    assert out["status"] == "ok"
    assert out["windows_mcp"]["reachable"] is True

    refused = health.probe_windows_mcp(
        url="http://127.0.0.1:1/sse", timeout_s=0.3)
    assert refused["status"] == "error"
    assert "windows-mcp-lane-unavailable" in refused["reason"]


def test_remote_transport_failure_never_falls_back_to_the_host_bridge():
    with respx.mock(assert_all_called=False) as router:
        remote_route = router.get(REMOTE_BRIDGE).mock(
            return_value=httpx.Response(500, text="remote bridge down"))
        host_route = router.get(HOST_BRIDGE).mock(
            return_value=httpx.Response(200))
        token = cl.bridge_target(REMOTE_BRIDGE)
        try:
            out = asyncio.run(cl.call_tool("Process", {"mode": "list"}, "c1"))
        finally:
            cl.bridge_reset(token)
    assert out["status"] == "error"
    assert REMOTE_BRIDGE in out["reason"]           # names the dialed machine
    assert remote_route.call_count >= 1            # dialed the remote bridge
    assert host_route.call_count == 0              # NEVER the host bridge


def test_disabled_mid_conversation_refuses_the_next_request(tmp_path):
    path = _registry(tmp_path, enabled=True)
    assert resolve_target(path, REMOTE_IP).status == "remote"
    (tmp_path / "remote-clients.toml").write_text(
        f'[clients."{REMOTE_IP}"]\nname = "{REMOTE_NAME}"\n'
        f'bridge_url = "{REMOTE_BRIDGE}"\nenabled = false\n', encoding="utf-8")
    resolution = resolve_target(path, REMOTE_IP)
    assert resolution.status == "refused"
    assert resolution.audit_name == REMOTE_NAME
    assert "disabled" in resolution.reason


def test_mcp_action_draft_validates_against_the_remote_bridge(
        tmp_path, monkeypatch):
    """SC-07 prelude: the reviewed validation dials the session's machine —
    a remote transport failure is an honest error, never a host call."""
    import agentic_rag_mcp.server as server_mod
    monkeypatch.setattr(server_mod, "build_providers", lambda cfg: [])
    monkeypatch.setattr(server_mod, "Embedder", lambda m, d: object())
    cfg = Config(state_db=tmp_path / "s.sqlite3", vector_dir=tmp_path / "v",
                 decider_enabled=False,
                 hermes_api_url=HERMES_BASE, hermes_api_key="k",
                 hermes_audit_path=tmp_path / "audit.jsonl",
                 remote_clients_path=_registry(tmp_path))
    srv = build_server(cfg)

    with respx.mock(assert_all_called=False) as router:
        router.get(REMOTE_BRIDGE).mock(return_value=httpx.Response(500))
        host_route = router.get(HOST_BRIDGE).mock(
            return_value=httpx.Response(200))

        async def draft():
            return await srv.call_tool("mcp_action", {
                "phase": "draft", "conversation_id": "c1",
                "dialogue_count": 2,
                "query": "set my default printer",
                "action_id": "windows_default_printer",
                "parameters": {"printer": "Microsoft Print to PDF"},
                "client_origin": REMOTE_IP})

        raw = asyncio.run(draft())
    out = json.loads("".join(getattr(b, "text", "")
                             for b in raw if getattr(b, "text", "")))
    assert out["status"] == "error"                   # honest validation error
    assert "validation failed" in out["reason"]
    assert host_route.call_count == 0                 # zero host-bridge calls
    rows = [json.loads(line) for line
            in (tmp_path / "audit.jsonl").read_text().splitlines()
            if line.strip()]
    assert rows[-1]["target"] == REMOTE_NAME          # audited to the client