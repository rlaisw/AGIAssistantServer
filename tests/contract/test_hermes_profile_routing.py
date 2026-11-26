"""Spec 051 T012/T013/T031 — profile path, per-profile key, no fallback (I10, U27, U29)."""

from types import SimpleNamespace

import httpx
import pytest

from agentic_rag_mcp import hermes_client
from agentic_rag_mcp.hermes_profiles import ProfileError


def cfg():
    return SimpleNamespace(
        hermes_api_url="http://gateway.test",
        hermes_api_key="LEGACY_KEY",
        hermes_timeout_s=5.0,
    )


def capture(monkeypatch):
    seen = {}

    def fake_post(url, **kwargs):
        seen["url"] = url
        seen["headers"] = kwargs.get("headers", {})
        return httpx.Response(200, json={"output": "ok"})

    monkeypatch.setattr(hermes_client.httpx, "post", fake_post)
    return seen


def test_profile_path_and_key(monkeypatch):
    seen = capture(monkeypatch)
    result = hermes_client.run_task(cfg(), "do it", profile="alice-x", api_key="PROFILE_KEY")
    assert result["ok"] is True
    assert seen["url"] == "http://gateway.test/p/alice-x/v1/responses"
    assert seen["headers"]["Authorization"] == "Bearer PROFILE_KEY"


def test_legacy_path_unchanged(monkeypatch):
    seen = capture(monkeypatch)
    hermes_client.run_task(cfg(), "do it")
    assert seen["url"] == "http://gateway.test/v1/responses"
    assert seen["headers"]["Authorization"] == "Bearer LEGACY_KEY"


def test_no_fallback_and_traversal_refused(monkeypatch):
    seen = capture(monkeypatch)
    with pytest.raises(ProfileError):
        hermes_client.run_task(cfg(), "do it", profile="../other", api_key="K")
    assert "url" not in seen  # refused before any request; never the legacy path


def test_ensure_then_route_with_profile_key(tmp_path):
    """T015: ensure -> key read -> /p/<slug>/v1/responses end to end (fake servers)."""
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from agentic_rag_mcp.hermes_profiles import ProfilesConfig, ensure_profile, read_profile_key

    seen = {}

    class Ensure(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            body = json.loads(self.rfile.read(int(self.headers["content-length"])))
            seen["ensure_slug"] = body["slug"]
            payload = json.dumps({"slug": body["slug"], "status": "active", "created": True}).encode()
            self.send_response(201)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    class Gateway(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            seen["gateway_path"] = self.path
            seen["gateway_auth"] = self.headers.get("authorization")
            payload = b'{"output":"ok"}'
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    def start(handler):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server

    ensure_server = start(Ensure)
    gateway_server = start(Gateway)
    try:
        cfg = ProfilesConfig(
            provision_url=f"http://127.0.0.1:{ensure_server.server_port}/api/profiles/ensure",
            provision_token="tok",
            profiles_dir=tmp_path,
            gateway_url=f"http://127.0.0.1:{gateway_server.server_port}",
        )
        result = ensure_profile(cfg, slug="alice-chen-contoso-com", oid="o", email="alice.chen@contoso.com")
        assert seen["ensure_slug"] == result["slug"]
        home = tmp_path / result["slug"]
        home.mkdir(parents=True)
        (home / ".env").write_text("API_SERVER_KEY=PROFILE_KEY\n", encoding="utf-8")
        key = read_profile_key(tmp_path, result["slug"])

        client_cfg = SimpleNamespace(
            hermes_api_url=cfg.gateway_url, hermes_api_key="LEGACY", hermes_timeout_s=5.0
        )
        out = hermes_client.run_task(client_cfg, "do it", profile=result["slug"], api_key=key)
        assert out["ok"] is True
        assert seen["gateway_path"] == f"/p/{result['slug']}/v1/responses"
        assert seen["gateway_auth"] == "Bearer PROFILE_KEY"
    finally:
        ensure_server.shutdown()
        gateway_server.shutdown()



def test_stream_mode_uses_profile_path_and_key(monkeypatch):
    """T062: the streaming path (conversation_id present) is profile-aware."""
    from types import SimpleNamespace

    import httpx

    from agentic_rag_mcp import hermes_client
    from agentic_rag_mcp.hermes_profiles import clear_resolved_cache

    seen = []

    class FakeResponse:
        status_code = 200
        headers = {"content-type": "text/event-stream"}

        def iter_lines(self):
            return iter(['data: {"type":"response.completed","response":{"output":"ok"}}', "data: [DONE]"])

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        def stream(self, method, url, headers=None, json=None):
            seen.append((url, (headers or {}).get("Authorization")))
            class CM:
                def __enter__(self):
                    return FakeResponse()
                def __exit__(self, *exc):
                    return False
            return CM()

        def close(self):
            pass

    monkeypatch.setattr(hermes_client.httpx, "Client", FakeClient)
    cfg = SimpleNamespace(hermes_api_url="http://gateway.test", hermes_api_key="LEGACY",
                          hermes_timeout_s=5.0)
    clear_resolved_cache()
    hermes_client.run_task_stream(cfg, "do it", "i", 5.0, "conv-1",
                                  profile="alice-x", api_key="PROFILE_KEY")
    assert seen[0] == ("http://gateway.test/p/alice-x/v1/responses", "Bearer PROFILE_KEY")
    seen.clear()
    hermes_client.run_task_stream(cfg, "do it", "i", 5.0, "conv-2")
    assert seen[0] == ("http://gateway.test/v1/responses", "Bearer LEGACY")


def test_lane_uses_profile_when_identified_and_legacy_when_anonymous(tmp_path, monkeypatch):
    """T049: identity present -> /p/<slug>/; absent -> legacy /v1 (FR-021), no profile."""
    import asyncio
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from agentic_rag_mcp.config import Config
    from agentic_rag_mcp.hermes_profiles import clear_resolved_cache
    from agentic_rag_mcp.server import build_server

    seen = {"ensure": [], "gateway": []}

    class Ensure(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            body = json.loads(self.rfile.read(int(self.headers["content-length"])))
            seen["ensure"].append(body["slug"])
            payload = json.dumps({"slug": body["slug"], "status": "active", "created": True}).encode()
            self.send_response(201)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *a):
            pass

    class Gateway(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            seen["gateway"].append((self.path, self.headers.get("authorization")))
            payload = b'{"output":"LAUNCH: SUCCESS notepad"}'
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *a):
            pass

    def start(handler):
        srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return srv

    ensure_srv, gw_srv = start(Ensure), start(Gateway)
    try:
        slug = "alice-chen-contoso-com"
        home = tmp_path / slug
        home.mkdir(parents=True)
        (home / ".env").write_text("API_SERVER_KEY=PROFILE_KEY\n", encoding="utf-8")
        monkeypatch.setenv("HOME", str(tmp_path))
        monkeypatch.setenv("HERMES_PROFILES_DIR", str(tmp_path))
        monkeypatch.setenv("HERMES_PROVISION_URL", f"http://127.0.0.1:{ensure_srv.server_port}/api/profiles/ensure")
        monkeypatch.setenv("HERMES_PROVISION_TOKEN", "tok")
        monkeypatch.setenv("HERMES_REGISTRY_PATH", str(tmp_path / "profiles.json"))
        monkeypatch.setenv("HERMES_AUDIT_PATH", str(tmp_path / "audit.jsonl"))
        clear_resolved_cache()
        server = build_server(Config(state_db=tmp_path / "state.sqlite3",
                                     vector_dir=tmp_path / "vector", decider_enabled=False,
                                     hermes_api_url=f"http://127.0.0.1:{gw_srv.server_port}",
                                     hermes_api_key="LEGACY_KEY"))

        def structured(raw):
            items = list(raw) if isinstance(raw, (list, tuple)) else [raw]
            for block in items:
                text = getattr(block, "text", None)
                if isinstance(text, str) and text.strip().startswith("{"):
                    return json.loads(text)
            return None

        out = asyncio.run(server.call_tool("hermes_launch_app", {
            "task": "launch notepad", "hermes_slug": slug,
            "hermes_oid": "11111111-1111-1111-1111-111111111111",
            "hermes_email": "alice.chen@contoso.com"}))
        assert structured(out).get("status") == "ok", structured(out)
        assert seen["ensure"] == [slug]
        assert seen["gateway"][-1] == (f"/p/{slug}/v1/responses", "Bearer PROFILE_KEY")

        out2 = asyncio.run(server.call_tool("hermes_launch_app", {"task": "launch notepad"}))
        assert structured(out2).get("status") == "ok", structured(out2)
        assert seen["ensure"] == [slug]  # anonymous never provisions
        assert seen["gateway"][-1] == ("/v1/responses", "Bearer LEGACY_KEY")
    finally:
        ensure_srv.shutdown()
        gw_srv.shutdown()
