"""Spec 053 unit suite — the remote-client registry and per-call resolution.

Test-plan.md §1a: match/disabled/unmatched/ambiguity/malformed matrix plus
the reload rule (FR-004) and the no-credentials rule
(contracts/targeting.md §3)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from agentic_rag_mcp.remote_clients import (
    RegistryError,
    RemoteClient,
    load_registry,
    normalize_origin,
    resolve_target,
)

IP = "192.168.1.42"
REGISTRY = f"""
[clients."{IP}"]
name = "raymond-office"
bridge_url = "http://{IP}:18800/sse"
enabled = true

[clients."192.168.1.43"]
name = "study-pc"
bridge_url = "http://192.168.1.43:18800/sse"
enabled = false
"""


@pytest.fixture()
def registry_path(tmp_path):
    path = tmp_path / "remote-clients.toml"
    path.write_text(REGISTRY, encoding="utf-8")
    return str(path)


# ---- normalize_origin: the match-key grammar (FR-005) ----


@pytest.mark.parametrize("raw,expected", [
    (IP, IP),
    (f"{IP}:8443", IP),          # port stripped
    (f" {IP} ", IP),              # whitespace stripped
    ("FE80::A", "fe80::a"),       # IPv6 lowercased
    ("[fe80::1]", "fe80::1"),     # brackets stripped
])
def test_normalize_origin_address_literals(raw, expected):
    assert normalize_origin(raw) == expected


@pytest.mark.parametrize("junk", [
    "../../etc", "raymond-office.example", "with space", "a\tb", "", None,
])
def test_normalize_origin_never_matches_non_addresses(junk):
    assert normalize_origin(junk) == ""


@pytest.mark.parametrize("raw,expected", [
    ("127.0.0.1:99999", "127.0.0.1"),  # odd port: port stripped, machine kept
    ("10.0.0.5:8080", "10.0.0.5"),
])
def test_normalize_origin_strips_any_port_not_just_sane_ones(raw, expected):
    assert normalize_origin(raw) == expected


# ---- resolution matrix (FR-001/FR-002/FR-006) ----


def test_enabled_match_resolves_remote_with_the_entry(registry_path):
    resolution = resolve_target(registry_path, IP)
    assert resolution.status == "remote"
    assert resolution.client.name == "raymond-office"
    assert resolution.client.bridge_url == f"http://{IP}:18800/sse"
    assert resolution.audit_name == "raymond-office"


def test_disabled_match_refuses_and_never_falls_back_to_local(registry_path):
    resolution = resolve_target(registry_path, "192.168.1.43")
    assert resolution.status == "refused"
    assert resolution.client.name == "study-pc"
    assert "disabled" in resolution.reason
    assert resolution.audit_name == "study-pc"


def test_unmatched_origin_keeps_the_local_default(registry_path):
    for origin in ("192.168.1.99", None, ""):
        resolution = resolve_target(registry_path, origin)
        assert resolution.status == "local"
        assert resolution.client is None
        assert resolution.audit_name is None


@pytest.mark.parametrize("spoof", ["../../etc", "raymond-office.example", "a b"])
def test_spoofed_or_malformed_origin_cannot_match_any_entry(registry_path, spoof):
    assert resolve_target(registry_path, spoof).status == "local"


# ---- the registry file itself ----


def test_missing_file_is_an_empty_registry_all_local(tmp_path):
    resolution = resolve_target(str(tmp_path / "absent.toml"), IP)
    assert resolution.status == "local"
    assert load_registry(str(tmp_path / "absent.toml")) == {}


def test_empty_origin_never_touches_or_fails_on_a_broken_registry(tmp_path):
    broken = tmp_path / "broken.toml"
    broken.write_text("not [ valid toml", encoding="utf-8")
    assert resolve_target(str(broken), "").status == "local"
    assert resolve_target(str(broken), None).status == "local"


def test_broken_registry_refuses_remote_intent(tmp_path):
    broken = tmp_path / "broken.toml"
    broken.write_text("not [ valid toml", encoding="utf-8")
    resolution = resolve_target(str(broken), IP)
    assert resolution.status == "refused"
    assert "unreadable" in resolution.reason


def test_entry_with_credential_like_field_is_refused_never_ignored(tmp_path):
    sneaky = tmp_path / "sneaky.toml"
    sneaky.write_text(
        f'[clients."{IP}"]\nname = "raymond-office"\n'
        f'bridge_url = "http://{IP}:18800/sse"\nenabled = true\n'
        'api_key = "should-not-be-here"\n', encoding="utf-8")
    resolution = resolve_target(str(sneaky), IP)
    assert resolution.status == "refused"
    assert "unsupported fields" in resolution.reason


@pytest.mark.parametrize("entry,problem", [
    (f'[clients."{IP}"]\nbridge_url = "http://{IP}:18800/sse"\n', "name"),
    (f'[clients."{IP}"]\nname = "Raymond Office"\nbridge_url = "http://{IP}:18800/sse"\n',
     "invalid name"),
    (f'[clients."{IP}"]\nname = "raymond"\nbridge_url = "ftp://{IP}:9/sse"\n',
     "bridge_url"),
    ((f'[clients."{IP}"]\nname = "raymond"\nbridge_url = "http://{IP}:18800/sse"\n'
     "enabled = \"true\"\n"), "enabled"),
    (('[clients."raymond-office"]\nname = "raymond"\n'
     'bridge_url = "http://{IP}:18800/sse"\n'), "address literal"),
])
def test_invalid_entries_refuse_remote_intent(tmp_path, entry, problem):
    bad = tmp_path / "bad.toml"
    bad.write_text(entry, encoding="utf-8")
    resolution = resolve_target(str(bad), IP)
    assert resolution.status == "refused"


def test_disabled_flag_defaults_to_true(tmp_path):
    path = tmp_path / "minimal.toml"
    path.write_text(
        f'[clients."{IP}"]\nname = "raymond-office"\n'
        f'bridge_url = "http://{IP}:18800/sse"\n', encoding="utf-8")
    assert resolve_target(str(path), IP).status == "remote"


# ---- FR-004: operator edits take effect on the next call, no restart ----


def test_disable_between_calls_refuses_the_next_request(tmp_path):
    path = tmp_path / "live.toml"
    path.write_text(
        f'[clients."{IP}"]\nname = "raymond-office"\n'
        f'bridge_url = "http://{IP}:18800/sse"\nenabled = true\n', encoding="utf-8")
    assert resolve_target(str(path), IP).status == "remote"
    path.write_text(
        f'[clients."{IP}"]\nname = "raymond-office"\n'
        f'bridge_url = "http://{IP}:18800/sse"\nenabled = false\n', encoding="utf-8")
    resolution = resolve_target(str(path), IP)
    assert resolution.status == "refused"
    assert "disabled" in resolution.reason
    assert resolution.client.name == "raymond-office"


def test_remove_between_calls_returns_the_origin_to_local(tmp_path):
    path = tmp_path / "live.toml"
    path.write_text(
        f'[clients."{IP}"]\nname = "raymond-office"\n'
        f'bridge_url = "http://{IP}:18800/sse"\n', encoding="utf-8")
    assert resolve_target(str(path), IP).status == "remote"
    path.write_text("", encoding="utf-8")
    assert resolve_target(str(path), IP).status == "local"


def test_add_between_routes_the_origin_on_the_next_call(tmp_path):
    path = tmp_path / "live.toml"
    path.write_text("", encoding="utf-8")
    assert resolve_target(str(path), IP).status == "local"
    path.write_text(
        f'[clients."{IP}"]\nname = "raymond-office"\n'
        f'bridge_url = "http://{IP}:18800/sse"\n', encoding="utf-8")
    resolution = resolve_target(str(path), IP)
    assert resolution.status == "remote"
    assert resolution.client.name == "raymond-office"


# ---- the office derivation convention (client runs the host stack) ----
# T027 removed the v1 helper; round 3 of no-open-microsoft-word restored it
# (the DIRECT-CHANNEL RECOVERY OVERRIDE needs the client's OfficeMCP URL).


@pytest.mark.parametrize("bridge,expected", [
    ("http://192.168.1.42:18800/sse", "http://192.168.1.42:18888/sse"),
    ("https://192.168.1.42:18800/sse", "https://192.168.1.42:18888/sse"),
])
def test_office_bridge_url_derivation(bridge, expected):
    client = RemoteClient(origin=IP, name="raymond-office",
                         bridge_url=bridge, enabled=True)
    assert client.office_bridge_url() == expected


@pytest.mark.parametrize("service,expected", [
    ("WindowsMCP", "mcp__WindowsMCP_a301_11120__"),
    ("OfficeMCP", "mcp__OfficeMCP_a301_11120__"),
])
def test_mcp_tool_prefix_underscores_the_gateway_server_name(service, expected):
    """no-open-word-hangs-up: the gateway turns server-name hyphens into
    underscores in tool names — the agent instructions must match."""
    client = RemoteClient(origin=IP, name="a301-11120",
                          bridge_url=f"http://{IP}:18800/sse", enabled=True)
    assert client.mcp_tool_prefix(service) == expected


# ---- T025: creation time per entry (US2/AC3) ----


def test_registry_entry_carries_creation_time(tmp_path):
    """US2/AC3: an inspected entry shows identity, location, status, AND
    creation time. A present `created_at` validates; a missing one defaults
    to the file's mtime (never fabricated as now())."""
    path = tmp_path / "with-created.toml"
    path.write_text(
        f'[clients."{IP}"]\nname = "raymond-office"\n'
        f'bridge_url = "http://{IP}:18800/sse"\n'
        'created_at = "2026-11-28T00:32:00Z"\n', encoding="utf-8")
    registry = load_registry(str(path))
    assert registry[IP].created_at == "2026-11-28T00:32:00Z"

    bare = tmp_path / "bare.toml"
    bare.write_text(
        f'[clients."{IP}"]\nname = "raymond-office"\n'
        f'bridge_url = "http://{IP}:18800/sse"\n', encoding="utf-8")
    file_mtime = datetime.fromtimestamp(bare.stat().st_mtime, UTC).isoformat()
    registry = load_registry(str(bare))
    assert registry[IP].created_at == file_mtime


def test_created_at_must_be_a_plain_string(tmp_path):
    path = tmp_path / "bad.toml"
    path.write_text(
        f'[clients."{IP}"]\nname = "raymond-office"\n'
        f'bridge_url = "http://{IP}:18800/sse"\n'
        'created_at = 20261128\n', encoding="utf-8")  # not a string
    with pytest.raises(RegistryError):
        load_registry(str(path))


# ---- RegistryError is the module's only surface for a broken file ----


def test_load_registry_raises_registryerror_not_raw_exceptions(tmp_path):
    broken = tmp_path / "broken.toml"
    broken.write_text("]]]not toml[[[", encoding="utf-8")
    with pytest.raises(RegistryError):
        load_registry(str(broken))