"""Spec 051 — profile helpers (U23–U28)."""

import json

import httpx
import pytest

from agentic_rag_mcp.hermes_profiles import (
    PROFILE_ERRORS,
    ProfileError,
    ProfileKeyCache,
    ProfilesConfig,
    assert_slug,
    auth_headers,
    ensure_profile,
    read_profile_key,
    responses_url,
)


def cfg(tmp_path):
    return ProfilesConfig(
        provision_url="http://provision.test/api/profiles/ensure",
        provision_token="tok",
        profiles_dir=tmp_path,
        gateway_url="http://gateway.test",
    )


def write_profile(tmp_path, slug, key):
    home = tmp_path / slug
    home.mkdir(parents=True, exist_ok=True)
    (home / ".env").write_text(f"OTHER=1\nAPI_SERVER_KEY={key}\n", encoding="utf-8")


def test_slug_regex():
    assert assert_slug("peter-chan-tvb-com-hk") == "peter-chan-tvb-com-hk"
    for bad in ["Peter", "a/b", "..", "", "-x", "x-", "a" * 65]:
        with pytest.raises(ProfileError) as exc:
            assert_slug(bad)
        assert exc.value.code == "invalid_profile_request"


def test_response_url_and_headers():
    assert responses_url("http://g/", "alice-x") == "http://g/p/alice-x/v1/responses"
    assert auth_headers("k")["authorization"] == "Bearer k"
    with pytest.raises(ProfileError):
        responses_url("http://g", "../etc")


def test_read_and_cache(tmp_path):
    write_profile(tmp_path, "alice-x", "K1")
    assert read_profile_key(tmp_path, "alice-x") == "K1"
    now = [0.0]
    cache = ProfileKeyCache(tmp_path, now=lambda: now[0])
    assert cache.get("alice-x") == "K1"
    write_profile(tmp_path, "alice-x", "K2")
    assert cache.get("alice-x") == "K1"  # still cached
    now[0] = 61.0
    assert cache.get("alice-x") == "K2"
    cache.invalidate("alice-x")
    assert cache.get("alice-x") == "K2"


def test_missing_key(tmp_path):
    (tmp_path / "alice-x").mkdir()
    (tmp_path / "alice-x" / ".env").write_text("OTHER=1\n", encoding="utf-8")
    with pytest.raises(ProfileError) as exc:
        read_profile_key(tmp_path, "alice-x")
    assert exc.value.code == "profile_misconfigured"


def test_ensure_success_and_retry():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(409, json={"error": "provisioning_in_progress"})
        return httpx.Response(201, json={"slug": "alice-x", "status": "active", "created": True})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = ensure_profile(cfg("/tmp"), slug="alice-x", oid="o", email="a@b.com", client=client)
    assert result == {"slug": "alice-x", "status": "active", "created": True}
    assert len(calls) == 2
    assert calls[0].headers["authorization"] == "Bearer tok"
    assert json.loads(calls[0].content)["email"] == "a@b.com"


def test_ensure_maps_failures_without_retry():
    for status, code in [(401, "profile_auth_failed"), (403, "profile_disabled"), (422, "invalid_profile_request"), (503, "agent_unavailable")]:
        calls = []

        def handler(request: httpx.Request, status=status) -> httpx.Response:
            calls.append(request)
            return httpx.Response(status, json={"error": code})

        client = httpx.Client(transport=httpx.MockTransport(handler))
        with pytest.raises(ProfileError) as exc:
            ensure_profile(cfg("/tmp"), slug="alice-x", oid="o", email="a@b.com", client=client)
        assert exc.value.code == code
        assert len(calls) == 1


def test_error_table_parity_snapshot():
    # T048: both sides must expose the same 16 codes with the same statuses.
    assert len(PROFILE_ERRORS) == 16
    assert PROFILE_ERRORS["profile_auth_failed"][0] == 401
    assert PROFILE_ERRORS["profile_disabled"][0] == 403
    assert PROFILE_ERRORS["provisioning_in_progress"][0] == 409


def test_ts_error_table_parity():
    """T048: the TS and Python taxonomies must stay identical."""
    import re
    from pathlib import Path

    ts = Path("ai-chat-landing/lib/profiles/errors.ts").read_text(encoding="utf-8")
    pairs = re.findall(r"^\s{2}([a-z_]+): \{ status: (\d+),", ts, re.M)
    ts_table = {code: int(status) for code, status in pairs}
    py_table = {code: status for code, (status, _msg) in PROFILE_ERRORS.items()}
    assert ts_table == py_table


def test_resolve_context_ensures_once_and_reads_key(tmp_path):
    from agentic_rag_mcp.hermes_profiles import clear_resolved_cache, resolve_profile_context

    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(201, json={"slug": "alice-x", "status": "active", "created": True})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    write_profile(tmp_path, "alice-x", "KEY_A")
    clear_resolved_cache()
    slug, key = resolve_profile_context(cfg(tmp_path), slug="alice-x", oid="o", email="a@b.com", client=client)
    assert (slug, key) == ("alice-x", "KEY_A")
    slug2, key2 = resolve_profile_context(cfg(tmp_path), slug="alice-x", oid="o", email="a@b.com", client=client)
    assert (slug2, key2) == (slug, key)
    assert len(calls) == 1  # cached


def test_resolve_context_requires_identity(tmp_path):
    from agentic_rag_mcp.hermes_profiles import resolve_profile_context

    with pytest.raises(ProfileError) as exc:
        resolve_profile_context(cfg(tmp_path), slug="alice-x", oid="", email="a@b.com")
    assert exc.value.code == "identity_required"


def test_turn_scope_ownership():
    from agentic_rag_mcp.hermes_profiles import (
        clear_turn_scopes,
        register_turn_scope,
        turn_scope_allows,
    )

    clear_turn_scopes()
    assert turn_scope_allows("unknown", "alice-x")  # nothing to cancel
    register_turn_scope("c1", "alice-x")
    assert turn_scope_allows("c1", "alice-x")
    assert not turn_scope_allows("c1", "bob-y")          # cross-profile cancel refused
    assert not turn_scope_allows("c1", "")               # anonymous cannot cancel it
    register_turn_scope("c2", "")
    assert turn_scope_allows("c2", "")
    assert not turn_scope_allows("c2", "alice-x")
    clear_turn_scopes()


def test_resolve_writes_routing_audit_without_keys(tmp_path):
    from agentic_rag_mcp.hermes_profiles import clear_resolved_cache, resolve_profile_context

    audit = tmp_path / "audit.jsonl"
    cfgp = ProfilesConfig(
        provision_url="http://provision.test/api/profiles/ensure",
        provision_token="tok",
        profiles_dir=tmp_path,
        gateway_url="http://gateway.test",
        audit_path=audit,
    )

    def handler(request):
        return httpx.Response(201, json={"slug": "alice-x", "status": "active", "created": True})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    write_profile(tmp_path, "alice-x", "SECRET_KEY")
    clear_resolved_cache()
    resolve_profile_context(cfgp, slug="alice-x", oid="o", email="a@b.com", client=client)
    resolve_profile_context(cfgp, slug="alice-x", oid="o", email="a@b.com", client=client)
    lines = [json.loads(l) for l in audit.read_text().splitlines()]
    assert len(lines) == 2 and all(l["event"] == "routing" and l["slug"] == "alice-x" for l in lines)
    assert "SECRET_KEY" not in audit.read_text()
