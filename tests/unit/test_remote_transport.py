"""Spec 053 unit suite — the two transport seams and the gate/refusal rules.

Test-plan.md §1b/§3 + the US3/US4 pins: the sidecar-direct seam
(``windows_mcp.client.call_tool``) hits the resolved machine's bridge; the
agent-lane seam (the instructions posted to the gateway) carries the
remote-target paragraph for remote sessions and stays byte-identical for
local ones; gates run before transport and refuse identically on remote
targets; refusals and remote executions audit the target machine.
"""

from __future__ import annotations

import asyncio
import json
import tomllib  # noqa: F401 — docs say so; the registry is TOML
from pathlib import Path

import respx

import agentic_rag_mcp.windows_mcp.client as cl
from agentic_rag_mcp.config import Config
from agentic_rag_mcp.hermes_client import (
    LAUNCH_INSTRUCTIONS,
    OFFICE_INSTRUCTIONS,
    RUN_COMMAND_INSTRUCTIONS,
    targeted_instructions,
)
from agentic_rag_mcp.remote_clients import RemoteClient, TargetResolution, resolve_target
from agentic_rag_mcp.server import build_server

HERMES_BASE = "http://hermes.test:8642"
BRIDGE = "http://172.17.0.1:18800/sse"
REMOTE_BRIDGE = "http://192.168.1.42:18800/sse"
REMOTE_NAME = "raymond-office"
REMOTE_IP = "192.168.1.42"

REMOTE_CLIENT = RemoteClient(origin=REMOTE_IP, name=REMOTE_NAME,
                              bridge_url=REMOTE_BRIDGE, enabled=True)
REMOTE = TargetResolution(status="remote", client=REMOTE_CLIENT)
LOCAL = TargetResolution(status="local")


def _registry(tmp_path: Path, enabled: bool = True) -> Path:
    path = tmp_path / "remote-clients.toml"
    path.write_text(
        f'[clients."{REMOTE_IP}"]\nname = "{REMOTE_NAME}"\n'
        f'bridge_url = "{REMOTE_BRIDGE}"\nenabled = {str(enabled).lower()}\n',
        encoding="utf-8")
    return path


# ------------------------------------------------- seam 1: the sidecar-direct


class _Capture:
    """Fake SSE transport recording the URL every call actually dialed."""

    url: str | None = None
    headers: dict | None = None

    class _Item:
        def __init__(self, text: str) -> None:
            self.text = text

    class _Res:
        def __init__(self) -> None:
            self.content = []
            self.isError = False

    class _Session:
        calls = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def initialize(self) -> None:
            pass

        async def call_tool(self, tool, args):
            type(self).calls += 1
            res = _Capture._Res()
            res.content = [_Capture._Item("ok")]
            res.isError = False
            return res

    @classmethod
    def install(cls, monkeypatch) -> None:
        import base64
        import contextlib

        # a well-formed marked payload so mcp_action validation parses it
        payload = json.dumps({
            "matches": ["Microsoft Print to PDF"],
            "before": "Old Printer",
            "managed": {"status": "absent", "value": 0},
            "read_error": None,
        })
        marked = ("MCP_ACTION_JSON:"
                  + base64.b64encode(payload.encode()).decode())

        cls.url = None
        cls.headers = None

        class _Item:
            def __init__(self, text: str) -> None:
                self.text = text

        class _Res:
            def __init__(self) -> None:
                self.content = []
                self.isError = False

        class _Session:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def initialize(self) -> None:
                pass

            async def call_tool(self, tool, args):
                res = _Res()
                res.content = [_Item(marked)]
                res.isError = False
                return res

        @contextlib.asynccontextmanager
        async def _sse(url, headers=None):
            cls.url = url
            cls.headers = headers or {}
            yield "read", "write"

        monkeypatch.setattr(cl, "sse_client", _sse)
        monkeypatch.setattr(cl, "ClientSession", lambda r, w: _Session())


def test_call_tool_default_dials_the_host_bridge_byte_identical(monkeypatch):
    _Capture.install(monkeypatch)
    out = asyncio.run(cl.call_tool("Process", {"mode": "list"}, "c1"))
    assert out["status"] == "ok"
    assert _Capture.url == cl.BRIDGE_SSE_URL
    assert _Capture.headers["Host"] == cl.CANONICAL_HOST


def test_call_tool_context_target_dials_the_remote_bridge(monkeypatch):
    _Capture.install(monkeypatch)
    token = cl.bridge_target(REMOTE_BRIDGE)
    try:
        out = asyncio.run(cl.call_tool("Process", {"mode": "list"}, "c1"))
        assert out["status"] == "ok"
        assert _Capture.url == REMOTE_BRIDGE          # the remote machine
        assert _Capture.headers["Host"] == cl.CANONICAL_HOST
    finally:
        cl.bridge_reset(token)
    asyncio.run(cl.call_tool("Process", {"mode": "list"}, "c2"))
    assert _Capture.url == cl.BRIDGE_SSE_URL          # reset -> local default


def test_call_tool_kwarg_overrides_the_context(monkeypatch):
    _Capture.install(monkeypatch)
    token = cl.bridge_target(REMOTE_BRIDGE)
    try:
        asyncio.run(cl.call_tool("Process", {"mode": "list"}, "c1",
                                 bridge_url="http://192.168.9.9:18800/sse"))
        assert _Capture.url == "http://192.168.9.9:18800/sse"
    finally:
        cl.bridge_reset(token)


def test_unavailable_error_names_the_dialed_machine():
    err = cl._unavailable(RuntimeError("boom"), REMOTE_BRIDGE)
    assert REMOTE_BRIDGE in err
    assert "error:windows-mcp-lane-unavailable" in err


# ------------------------------------------------- seam 2: the agent lanes


def test_local_instructions_are_byte_identical():
    assert targeted_instructions(RUN_COMMAND_INSTRUCTIONS, LOCAL) \
        == RUN_COMMAND_INSTRUCTIONS
    assert targeted_instructions(LAUNCH_INSTRUCTIONS, None) \
        == LAUNCH_INSTRUCTIONS       # legacy callers without a resolution


def test_remote_instructions_append_the_target_paragraph():
    out = targeted_instructions(RUN_COMMAND_INSTRUCTIONS, REMOTE)
    assert out.startswith(RUN_COMMAND_INSTRUCTIONS)   # base first
    assert "REMOTE TARGET (spec 053)" in out
    assert f'"{REMOTE_NAME}"' in out
    win_prefix = REMOTE_CLIENT.mcp_tool_prefix("WindowsMCP")
    assert win_prefix in out                          # the per-client tool prefix
    assert f"WindowsMCP-{REMOTE_NAME}" in out         # the gateway server name
    # the impossible manual-SSE instruction is gone (no-open-word-hangs-up)
    assert "open an SSE session" not in out
    assert "send MCP JSON-RPC" not in out
    # the local tools are explicitly forbidden
    assert "mcp__WindowsMCP__*" in out


def test_remote_instructions_override_the_direct_channel_recovery():
    """Round 3 (2026-11-28, 05:17 turn): the base instructions' direct-channel
    recovery names 127.0.0.1 — the SERVICE HOST's loopback. A degraded gateway
    channel made the agent recover there and write on the host while claiming
    the remote target. The remote paragraph must override the recovery path
    AND gate every write on a machine-identity match."""
    out = targeted_instructions(RUN_COMMAND_INSTRUCTIONS, REMOTE)
    assert "DIRECT-CHANNEL RECOVERY OVERRIDE" in out
    assert REMOTE_BRIDGE in out                        # the client's WindowsMCP
    assert "NEVER via 127.0.0.1" in out                 # the host loopback banned
    assert "MACHINE-IDENTITY GATE" in out
    assert "COMPUTERNAME" in out
    assert f'equal "{REMOTE_NAME}"' in out
    office_out = targeted_instructions(
        OFFICE_INSTRUCTIONS, REMOTE, office=True)
    assert "http://192.168.1.42:18888/sse" in office_out   # the client's OfficeMCP


def test_office_remote_instructions_name_the_office_tools():
    out = targeted_instructions(OFFICE_INSTRUCTIONS, REMOTE, office=True)
    assert f"OfficeMCP-{REMOTE_NAME}" in out
    assert REMOTE_CLIENT.mcp_tool_prefix("OfficeMCP") in out
    # no bridge URL rewriting (the retired v1 mechanism)
    assert "Every reference to http://127.0.0.1" not in out


def test_office_remote_instructions_mandate_the_single_payload_fast_path():
    """very-long-long-time-to-answer-back: the remote Office protocol walked
    4–6 separate tool-call round-trips (median ~70 s, worst 308 s); the one
    turn that combined everything into a single payload finished in 56 s.
    The instructions must MANDATE the combined payload for simple literal
    writes — identity gate first line + attach + type + save + disk
    read-back in ONE call — with canaries only when arguments arrive
    stripped."""
    out = targeted_instructions(OFFICE_INSTRUCTIONS, REMOTE, office=True)
    assert "SINGLE-PAYLOAD FAST PATH" in out
    assert "ONE combined payload" in out
    assert "do NOT walk the write as separate tool calls" in out
    # the identity gate rides inside the payload (first sub-stage)
    assert "first line asserts the machine identity" in out
    assert "COMPUTERNAME" in out
    # the read-back rides inside too (honesty gates coalesced, not removed)
    assert "re-open the saved file FROM DISK" in out
    # one message, all STEP markers
    assert "report every sub-stage in one message" in out
    # canaries only when args stripped — not a standing pre-step
    assert "ONLY if a call arrives with its arguments stripped" in out


def test_run_command_remote_has_no_office_fast_path():
    """The fast path binds only the Office lane (simple literal writes);
    the run-command lane keeps its own instructions unchanged."""
    out = targeted_instructions(RUN_COMMAND_INSTRUCTIONS, REMOTE)
    assert "SINGLE-PAYLOAD FAST PATH" not in out
    assert "REMOTE TARGET (spec 053)" in out


# ---------------------------------------- server tools: routing, gates, audit


def call(server, name, args):
    raw = asyncio.run(server.call_tool(name, args))
    texts = [getattr(b, "text", "") for b in raw if getattr(b, "text", "")]
    joined = "".join(texts).strip()
    return json.loads(joined) if joined else None


def _server(tmp_path, monkeypatch, enabled=True):
    import agentic_rag_mcp.server as server_mod
    monkeypatch.setattr(server_mod, "build_providers", lambda cfg: [])
    monkeypatch.setattr(server_mod, "Embedder", lambda model, device: object())
    cfg = Config(state_db=tmp_path / "s.sqlite3", vector_dir=tmp_path / "v",
                 decider_enabled=False,
                 hermes_api_url=HERMES_BASE, hermes_api_key="test-key",
                 hermes_timeout_s=30.0,
                 hermes_audit_path=tmp_path / "audit.jsonl",
                 remote_clients_path=_registry(tmp_path, enabled))
    return build_server(cfg), cfg


def _audit_rows(tmp_path):
    lines = (tmp_path / "audit.jsonl").read_text().splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def _sse_ok(output: str) -> str:
    return ("data: " + json.dumps(
        {"type": "response.completed",
         "response": {"output_text": output}}) + "\ndata: [DONE]")


def _ok_hostname() -> str:
    return ("COMMAND: hostname\nOUTPUT:\nMY-PC\nTASK: COMPLETED")


def test_remote_run_command_posts_remote_target_instructions(tmp_path, monkeypatch):
    """US1: the agent lane must act on the session's machine — the posted
    instructions name that machine's per-client tools, never the host's."""
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        route = router.post("/v1/responses").respond(
            200, content=_sse_ok(_ok_hostname()).encode())
        srv, _cfg = _server(tmp_path, monkeypatch)
        out = call(srv, "hermes_run_command",
                   {"task": "run hostname",
                    "conversation_id": "c1",
                    "client_origin": REMOTE_IP})
    assert out["status"] == "ok"
    body = json.loads(route.calls.last.request.content)
    assert REMOTE_CLIENT.mcp_tool_prefix("WindowsMCP") in body["instructions"]
    assert f'"{REMOTE_NAME}"' in body["instructions"]
    assert "open an SSE session" not in body["instructions"]   # retired v1
    assert _audit_rows(tmp_path)[-1]["target"] == REMOTE_NAME


def test_local_run_command_stays_byte_identical_no_target(tmp_path, monkeypatch):
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        route = router.post("/v1/responses").respond(
            200, content=_sse_ok(_ok_hostname()).encode())
        srv, _cfg = _server(tmp_path, monkeypatch)
        out = call(srv, "hermes_run_command",
                   {"task": "run hostname", "conversation_id": "c1"})
    assert out["status"] == "ok"
    body = json.loads(route.calls.last.request.content)
    assert "REMOTE TARGET" not in body["instructions"]
    row = _audit_rows(tmp_path)[-1]
    assert "target" not in row                      # FR-002: unchanged audit


def test_unregistered_origin_stays_local(tmp_path, monkeypatch):
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        router.post("/v1/responses").respond(
            200, content=_sse_ok(_ok_hostname()).encode())
        srv, _cfg = _server(tmp_path, monkeypatch)
        out = call(srv, "hermes_run_command",
                   {"task": "run hostname",
                    "conversation_id": "c1",
                    "client_origin": "192.168.5.5"})
    assert out["status"] == "ok"


def test_disabled_origin_refuses_honestly_never_local(tmp_path, monkeypatch):
    """US2/AC2 + FR-006: disabled -> refuse, never silently local."""
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        router.post("/v1/responses")
        srv, _cfg = _server(tmp_path, monkeypatch, enabled=False)
        out = call(srv, "hermes_run_command",
                   {"task": "run hostname",
                    "conversation_id": "c1",
                    "client_origin": REMOTE_IP})
    assert out["status"] == "blocked"
    assert "disabled" in out["reason"]
    assert REMOTE_NAME in out["reason"]
    assert router.calls == []                      # nothing reached the agent
    rows = _audit_rows(tmp_path)
    assert rows[-1]["decision"] == "blocked"
    assert rows[-1]["target"] == REMOTE_NAME


def test_neverlist_refuses_on_remote_target_before_transport(tmp_path, monkeypatch):
    """US4: the gate refuses identically on a remote target — zero gateway
    calls, audited against the client's name."""
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        router.post("/v1/responses")
        srv, _cfg = _server(tmp_path, monkeypatch)
        out = call(srv, "hermes_run_powershell",
                   {"task": "format D:",
                    "conversation_id": "c1",
                    "draft": "format-volume -DriveLetter D",
                    "client_origin": REMOTE_IP})
    assert out["status"] == "blocked"
    assert router.calls == []


def _json_ok(output: str) -> dict:
    """Non-streaming /v1/responses body (the blocking JSON path — local
    file tasks; _sse_ok is the streaming agent-lane path)."""
    return {"output": [{"type": "message", "role": "assistant",
                        "content": [{"type": "output_text",
                                     "text": output}]}]}


def test_file_task_routes_remote_target_to_the_agent_filesystem_tools(tmp_path, monkeypatch):
    """T024 (FR-001, amended 2026-11-28): a remote-targeted file task runs on
    the matched machine via the agent's per-client FileSystem tools — the
    launch-lane pattern (gate first, then per-target instructions), not a
    refusal (the refusal predated the per-client registration)."""
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        route = router.post("/v1/responses").respond(
            200, json=_json_ok(
                "COMMAND: mkdir reports\nOUTPUT:\ncreated\n"
                "TASK: COMPLETED"))
        srv, _cfg = _server(tmp_path, monkeypatch)
        out = call(srv, "hermes_file_task",
                   {"task": "create folder reports under C:/temp",
                    "client_origin": REMOTE_IP})
    assert out["status"] == "ok"
    body = json.loads(route.calls.last.request.content)
    assert REMOTE_CLIENT.mcp_tool_prefix("WindowsMCP") in body["instructions"]
    assert f'"{REMOTE_NAME}"' in body["instructions"]
    assert "open an SSE session" not in body["instructions"]
    assert _audit_rows(tmp_path)[-1]["target"] == REMOTE_NAME


def test_file_task_local_stays_byte_identical(tmp_path, monkeypatch):
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        route = router.post("/v1/responses").respond(
            200, json=_json_ok(
                "COMMAND: mkdir reports\nOUTPUT:\ncreated\n"
                "TASK: COMPLETED"))
        srv, _cfg = _server(tmp_path, monkeypatch)
        out = call(srv, "hermes_file_task",
                   {"task": "create folder reports under C:/temp"})
    assert out["status"] == "ok"
    body = json.loads(route.calls.last.request.content)
    assert "REMOTE TARGET" not in body["instructions"]
    row = _audit_rows(tmp_path)[-1]
    assert "target" not in row                    # FR-002: unchanged local rows


def test_powershell_cross_machine_confirm_never_executes(tmp_path, monkeypatch):
    """US4/spec edge: the draft's target machine is bound at draft time; a
    confirm from a different machine is unrelated and never executes."""
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        router.post("/v1/responses")
        srv, _cfg = _server(tmp_path, monkeypatch)
        draft = call(srv, "hermes_run_powershell",
                     {"task": "run get-date",
                      "conversation_id": "c1",
                      "draft": "Get-Date",
                      "client_origin": REMOTE_IP})
        assert draft["status"] == "pending-confirmation"
        confirm = call(srv, "hermes_run_powershell",
                       {"task": "yes", "conversation_id": "c1",
                        "confirm": True, "client_origin": ""})
    assert confirm["status"] == "blocked"
    assert "did not come from the machine" in confirm["reason"]
    assert router.calls == []                      # confirm never transported


def test_mcp_action_draft_validates_on_the_target_machine(tmp_path, monkeypatch):
    """US1/SC-07: an mcp_action draft validates against the session's
    machine — the validation call dials the client's bridge, not the
    host's."""
    _Capture.install(monkeypatch)
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        router.post("/v1/responses")
        srv, _cfg = _server(tmp_path, monkeypatch)
        out = call(srv, "mcp_action",
                   {"phase": "draft", "conversation_id": "c1",
                    "dialogue_count": 2, "query": "set my default printer",
                    "action_id": "windows_default_printer",
                    "parameters": {"printer": "Microsoft Print to PDF"},
                    "client_origin": REMOTE_IP})
    assert out["status"] == "pending-confirmation"
    assert _Capture.url == REMOTE_BRIDGE          # validated on the client


def test_mcp_action_disabled_target_refuses_never_local(tmp_path, monkeypatch):
    _Capture.install(monkeypatch)
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        router.post("/v1/responses")
        srv, _cfg = _server(tmp_path, monkeypatch, enabled=False)
        out = call(srv, "mcp_action",
                   {"phase": "draft", "conversation_id": "c1",
                    "dialogue_count": 2, "query": "set my default printer",
                    "action_id": "windows_default_printer",
                    "parameters": {"printer": "Microsoft Print to PDF"},
                    "client_origin": REMOTE_IP})
    assert out["status"] == "blocked"
    assert "disabled" in out["reason"]
    assert _Capture.url is None                   # nothing dialed anywhere
    rows = _audit_rows(tmp_path)
    assert rows[-1]["target"] == REMOTE_NAME
    assert rows[-1]["decision"] == "blocked"


def test_mcp_action_cross_machine_confirm_never_executes(tmp_path, monkeypatch):
    _Capture.install(monkeypatch)
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        router.post("/v1/responses")
        srv, _cfg = _server(tmp_path, monkeypatch)
        draft = call(srv, "mcp_action",
                     {"phase": "draft", "conversation_id": "c1",
                      "dialogue_count": 2, "query": "health check",
                      "action_id": "system_health_check",
                      "parameters": {},
                      "client_origin": REMOTE_IP})
        assert draft["status"] == "pending-confirmation"
        confirm = call(srv, "mcp_action",
                       {"phase": "confirm", "conversation_id": "c1",
                        "dialogue_count": 3, "query": "yes",
                        "client_origin": ""})
    assert confirm["status"] == "blocked"
    assert "Ask again from that machine" in confirm["reason"]
    assert _Capture.url is None                   # nothing executed anywhere


def test_registry_change_between_calls_audits_one_row(tmp_path, monkeypatch):
    """T026 (FR-004): every registry change is audited — resolution detects
    the file changed since the previous read and emits one registry-change
    audit row (no credentials) before the attempt rows of the next call."""
    import agentic_rag_mcp.server as server_mod
    monkeypatch.setattr(server_mod, "build_providers", lambda cfg: [])
    monkeypatch.setattr(server_mod, "Embedder", lambda model, device: object())
    cfg = Config(state_db=tmp_path / "s.sqlite3", vector_dir=tmp_path / "v",
                 decider_enabled=False,
                 hermes_api_url=HERMES_BASE, hermes_api_key="test-key",
                 hermes_audit_path=tmp_path / "audit.jsonl",
                 remote_clients_path=_registry(tmp_path))
    srv = build_server(cfg)
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        router.post("/v1/responses").respond(
            200, content=_sse_ok(_ok_hostname()).encode())
        call(srv, "hermes_run_command",
             {"task": "run hostname", "conversation_id": "c1",
              "client_origin": REMOTE_IP})
        # operator edit: disable the entry (no restart, FR-004)
        path = tmp_path / "remote-clients.toml"
        path.write_text(
            f'[clients."{REMOTE_IP}"]\nname = "{REMOTE_NAME}"\n'
            f'bridge_url = "{REMOTE_BRIDGE}"\nenabled = false\n',
            encoding="utf-8")
        out = call(srv, "hermes_run_command",
                   {"task": "run hostname", "conversation_id": "c2",
                    "client_origin": REMOTE_IP})
    assert out["status"] == "blocked"
    rows = _audit_rows(tmp_path)
    changes = [r for r in rows if r.get("operation") == "registry-change"]
    assert len(changes) == 1, rows
    assert changes[0]["decision"] == "executed"
    # decision executed -> the text rides in `outcome` (hermes_audit contract)
    assert "registry" in str(changes[0].get("outcome", "")).lower()
    assert "target" not in changes[0]           # no machine named — no credentials


def test_office_remote_posts_office_bridge(tmp_path, monkeypatch):
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        route = router.post("/v1/responses").respond(
            200, content=_sse_ok(
                "STEP: OK: opened Word and typed hello raymond\n"
                "TASK: COMPLETED\nACTIVE FILE: C:\\OfficeMCP\\hello.docx\n").encode())
        srv, _cfg = _server(tmp_path, monkeypatch)
        out = call(srv, "hermes_office_task",
                   {"task": "open Word and type hello raymond",
                    "conversation_id": "c1",
                    "client_origin": REMOTE_IP})
    assert out["status"] == "ok"
    body = json.loads(route.calls.last.request.content)
    # office lane: the OfficeMCP per-client tools are named (no-open-word-hangs-up)
    assert REMOTE_CLIENT.mcp_tool_prefix("OfficeMCP") in body["instructions"]
    assert f"OfficeMCP-{REMOTE_NAME}" in body["instructions"]


def test_disabled_registry_refuses_health_check_draft_never_local(tmp_path, monkeypatch):
    _Capture.install(monkeypatch)
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        router.post("/v1/responses")
        srv, _cfg = _server(tmp_path, monkeypatch, enabled=False)
        out = call(srv, "mcp_action",
                   {"phase": "draft", "conversation_id": "c1",
                    "dialogue_count": 2, "query": "health check",
                    "action_id": "system_health_check",
                    "parameters": {},
                    "client_origin": REMOTE_IP})
    assert out["status"] == "blocked"
    assert router.calls == []


def test_broken_registry_refuses_remote_intent_only(tmp_path, monkeypatch):
    broken = tmp_path / "broken.toml"
    broken.write_text("not [ valid toml", encoding="utf-8")
    import agentic_rag_mcp.server as server_mod
    monkeypatch.setattr(server_mod, "build_providers", lambda cfg: [])
    monkeypatch.setattr(server_mod, "Embedder", lambda model, device: object())
    cfg = Config(state_db=tmp_path / "s.sqlite3", vector_dir=tmp_path / "v",
                 decider_enabled=False,
                 hermes_api_url=HERMES_BASE, hermes_api_key="test-key",
                 hermes_audit_path=tmp_path / "audit.jsonl",
                 remote_clients_path=broken)
    srv = build_server(cfg)
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False) as router:
        router.post("/v1/responses").respond(
            200, content=_sse_ok(_ok_hostname()).encode())
        remote = call(srv, "hermes_run_command",
                      {"task": "run hostname", "conversation_id": "c1",
                       "client_origin": REMOTE_IP})
        local = call(srv, "hermes_run_command",
                     {"task": "run hostname", "conversation_id": "c2",
                      "client_origin": ""})
    assert remote["status"] == "blocked"
    assert "unreadable" in remote["reason"]
    assert local["status"] == "ok"                # local paths unaffected


# ------------------------------------------------------------- resolve_target


def test_resolve_target_matrix(tmp_path):
    path = _registry(tmp_path)
    assert resolve_target(str(path), REMOTE_IP).status == "remote"
    assert resolve_target(str(path), "").status == "local"
    assert resolve_target(str(path), "10.9.9.9").status == "local"


def test_resolve_audit_name_is_none_for_local():
    assert LOCAL.audit_name is None
    assert REMOTE.audit_name == REMOTE_NAME
    refused = TargetResolution(status="refused", client=REMOTE_CLIENT,
                               reason="r")
    assert refused.audit_name == REMOTE_NAME

# ------------------------------------------- no-open-microsoft-word (rounds 2-4)

def _fake_office_at(monkeypatch, payloads=None, calls=None):
    """Fake the proxy transports: remote one-shot call_at records (base_url,
    tool, arguments); the persistent local .call is recorded but never
    dialed. Returns the call recorder."""
    import agentic_rag_mcp.office_lanes.proxy as proxy_mod

    if calls is None:
        calls = []

    def fake_call(self, tool, arguments):
        calls.append({"kind": "local", "base_url": self.base,
                      "tool": tool, "arguments": arguments})
        payload = (payloads or {}).get(tool,
                                       {"path": "C:\\OfficeMCP\\x.docx",
                                        "size": 10, "existed": False,
                                        "text_ok": True, "open_docs": 1,
                                        "text": "readback"})
        return {"status": "ok", "text": json.dumps(
            {"success": True, "output": json.dumps(payload)})}

    def fake_call_at(base_url, tool, arguments, timeout_s=60.0):
        calls.append({"kind": "remote", "base_url": base_url,
                       "tool": tool, "arguments": arguments})
        payload = (payloads or {}).get(tool,
                                       {"path": "C:\\OfficeMCP\\x.docx",
                                        "size": 10, "existed": False,
                                        "text_ok": True, "open_docs": 1,
                                        "text": "readback"})
        return {"status": "ok", "text": json.dumps(
            {"success": True, "output": json.dumps(payload)})}

    monkeypatch.setattr(proxy_mod.OfficeProxy, "call", fake_call)
    monkeypatch.setattr(proxy_mod.OfficeProxy, "_start_session",
                        lambda self: None)
    monkeypatch.setattr(proxy_mod, "call_at", fake_call_at)
    return calls


def test_call_at_normalizes_the_sse_suffix(monkeypatch):
    """Live bug (2026-11-28 benchmark): the registry office URL carries /sse,
    OfficeProxy appends its own — /sse/sse dialed 404. call_at must accept
    either form."""
    import agentic_rag_mcp.office_lanes.proxy as proxy_mod
    seen = []

    class _P:
        def __init__(self, base_url, timeout_s=60.0):
            seen.append(base_url)

        def call(self, tool, arguments):
            return {"status": "ok", "text": ""}

        def close(self):
            pass

    monkeypatch.setattr(proxy_mod, "OfficeProxy", _P)
    proxy_mod.call_at("http://10.0.0.9:18888/sse", "RunPython", {})
    proxy_mod.call_at("http://10.0.0.9:18888", "RunPython", {})
    assert seen == ["http://10.0.0.9:18888", "http://10.0.0.9:18888"]


def test_doc_write_v2_remote_writes_via_the_client_bridge(tmp_path, monkeypatch):
    """Round 4 (very-long-long-time-to-answer-back): the office v2 fast path
    is REMOTE-NATIVE — a remote session's write executes the SAME fixed
    template against the requesting machine's OfficeMCP bridge in ONE
    deterministic sidecar call (no inner agent turn), with the identity gate
    armed in the payload and the audit naming the target."""
    calls = _fake_office_at(monkeypatch)
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False):
        srv, _cfg = _server(tmp_path, monkeypatch)
        out = call(srv, "doc_write_v2",
                   {"text": "hello raymond", "conversation_id": "c1",
                    "name": "hello_raymond",
                    "client_origin": REMOTE_IP})
    assert out["status"] == "ok", out
    assert out["text_ok"] is True
    assert len(calls) == 1
    remote = calls[0]
    assert remote["kind"] == "remote"
    # the client's OfficeMCP bridge (registry office URL), never the host's
    assert remote["base_url"] == REMOTE_CLIENT.office_bridge_url()
    assert remote["base_url"] != "http://172.17.0.1:18888"
    assert remote["tool"] == "RunPython"
    data = json.loads(remote["arguments"]["data"])
    assert data["target_host"] == REMOTE_NAME        # identity gate armed
    assert data["text"] == "hello raymond"
    rows = _audit_rows(tmp_path)
    assert rows[-1]["operation"] == "doc-write-v2"
    assert rows[-1]["decision"] == "executed"
    assert rows[-1]["target"] == REMOTE_NAME


def test_doc_write_v2_local_keeps_the_persistent_session(tmp_path, monkeypatch):
    """Unregistered/empty origin: byte-identical local path — the persistent
    session (never call_at), no target_host in the payload, no audit target
    (FR-002)."""
    calls = _fake_office_at(monkeypatch)
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False):
        srv, _cfg = _server(tmp_path, monkeypatch)
        out = call(srv, "doc_write_v2",
                   {"text": "hello raymond", "conversation_id": "c1"})
    assert out["status"] == "ok"
    assert len(calls) == 1
    local = calls[0]
    assert local["kind"] == "local"                 # persistent session
    assert local["base_url"] == "http://172.17.0.1:18888"
    data = json.loads(local["arguments"]["data"])
    assert "target_host" not in data                 # no identity gate locally
    row = _audit_rows(tmp_path)[-1]
    assert row["decision"] == "executed"
    assert "target" not in row


def test_xls_ppt_doc_read_v2_route_remote_sessions_to_the_client(tmp_path, monkeypatch):
    """All four office-v2 tools route remote sessions through call_at to the
    client's OfficeMCP bridge (xls via write_xls, ppt via write_ppt,
    doc_read via read_doc)."""
    calls = _fake_office_at(monkeypatch)
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False):
        srv, _cfg = _server(tmp_path, monkeypatch)
        outs = [
            call(srv, "xls_write_v2",
                 {"cells": {"A1": "x"}, "conversation_id": "c1",
                  "client_origin": REMOTE_IP}),
            call(srv, "ppt_write_v2",
                 {"title": "t", "conversation_id": "c1",
                  "client_origin": REMOTE_IP}),
            call(srv, "doc_read_v2",
                 {"name": "hello", "conversation_id": "c1",
                  "client_origin": REMOTE_IP}),
        ]
    for out in outs:
        assert out["status"] == "ok", out
    assert len(calls) == 3
    for c in calls:
        assert c["kind"] == "remote"
        assert c["base_url"] == REMOTE_CLIENT.office_bridge_url()
        assert json.loads(c["arguments"]["data"])["target_host"] == REMOTE_NAME
    rows = [r for r in _audit_rows(tmp_path)
            if str(r.get("operation", "")).endswith("-v2")]
    assert len(rows) == 3
    for row in rows:
        assert row["decision"] == "executed"
        assert row["target"] == REMOTE_NAME


def test_v2_refused_resolution_still_refuses_honestly(tmp_path, monkeypatch):
    """A disabled registry entry still refuses (never silent local fallback)
    — the round-2 honesty is preserved for refusal paths."""
    _fake_office_at(monkeypatch)
    with respx.mock(base_url=HERMES_BASE, assert_all_called=False):
        srv, _cfg = _server(tmp_path, monkeypatch, enabled=False)
        out = call(srv, "doc_write_v2",
                   {"text": "hello raymond", "conversation_id": "c1",
                    "client_origin": REMOTE_IP})
    assert out["status"] == "blocked"
    assert "disabled" in out["reason"]
    row = _audit_rows(tmp_path)[-1]
    assert row["decision"] == "blocked"
    assert row["target"] == REMOTE_NAME
