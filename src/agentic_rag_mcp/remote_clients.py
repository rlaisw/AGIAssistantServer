"""Spec 053 — the remote-client registry and per-session target resolution.

Every Hermes-lane desktop operation and every mcp_action procedure resolves
the Windows machine it acts on HERE, once per tool call, from the session's
server-observed client origin (FR-005): an origin matching an enabled
registry entry targets that machine; an empty or unregistered origin keeps
today's local default byte-for-byte (FR-002); a disabled entry or a broken
registry refuses honestly and NEVER re-targets another machine (FR-006).
The registry file is read on every call (operator edits take effect on the
next request, no restart — FR-004) and holds no credentials
(contracts/targeting.md): entries with unexpected fields are refused.
"""

from __future__ import annotations

import os
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

# T026: the audit path mirrors config's default (avoid a config import cycle)
_DEFAULT_AUDIT = Path(
    "~/.config/agentic-rag-mcp/hermes-mcp/audit.jsonl").expanduser()


def _default_audit_path() -> str:
    return str(_DEFAULT_AUDIT)

# address-literal grammar of a registry key and a normalized client_origin:
# IPv4/IPv6 literals, port-stripped, lowercase — never hostnames or paths
# (FR-005: resolution only ever MATCHES an operator-trusted entry, it never
# constructs a machine from input)
_ORIGIN_RE = re.compile(r"^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+)$")
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{1,40}$")
_BRIDGE_RE = re.compile(r"^https?://[0-9a-zA-Z.\-_]+(?::\d+)?/sse$")
_ALLOWED_FIELDS = frozenset({"name", "bridge_url", "enabled", "created_at"})


class RegistryError(Exception):
    """The registry file exists but cannot be used — remote intent refuses."""


@dataclass(frozen=True)
class RemoteClient:
    """One operator-registered Windows machine (data-model.md)."""

    origin: str
    name: str
    bridge_url: str
    enabled: bool
    # spec 053 T025 (US2/AC3): creation time — an explicit `created_at` string
    # in the entry, else the registry file's mtime (never fabricated as now)
    created_at: str = ""

    def office_bridge_url(self) -> str:
        """The same-machine OfficeMCP bridge by the deployment convention
        (client runs the host stack: :18800 -> :8800 WindowsMCP,
        :18888 -> :8888 OfficeMCP). The validated bridge grammar is
        http(s)://host[:port]/sse with an IPv4/hostname host."""
        scheme, rest = self.bridge_url.split("://", 1)
        authority = rest.rsplit("/sse", 1)[0]
        host = authority.rsplit(":", 1)[0]
        return f"{scheme}://{host}:18888/sse"

    def mcp_tool_prefix(self, service: str) -> str:
        """The Hermes gateway's MCP tool prefix for this machine's
        registered server (gateway mcp_servers name ``<service>-<name>``;
        tool names mcp__<server>__<tool> with hyphens as underscores)."""
        server = f"{service}-{self.name}"
        return f"mcp__{server.replace('-', '_')}__"


@dataclass(frozen=True)
class TargetResolution:
    """The per-call routing outcome (data-model.md): local keeps today's
    byte-identical default, remote targets a matched client, refused
    names the machine and runs NOTHING anywhere."""

    status: str  # "local" | "remote" | "refused"
    client: RemoteClient | None = None
    reason: str | None = None

    @property
    def audit_name(self) -> str | None:
        return self.client.name if self.client is not None else None


def normalize_origin(origin: str | None) -> str:
    """Port-stripped, lowercased address literal — the match key grammar.
    Anything else (hostnames, paths, injected text) normalizes to "" and
    can therefore never match an entry."""
    text = (origin or "").strip().lower()
    if "@" in text or "/" in text or " " in text:
        return ""
    host = text.rsplit(":", 1)[0] if text.count(":") == 1 else text
    host = host.strip("[]")
    return host if _ORIGIN_RE.fullmatch(host) else ""


def _entry(origin: str, raw: object) -> RemoteClient:
    if not isinstance(raw, dict):
        raise RegistryError(f"registry entry {origin!r} is not a table")
    unexpected = sorted(set(raw) - _ALLOWED_FIELDS)
    if unexpected:
        # the registry holds no credentials — extra fields (key/token/...)
        # are refused, never ignored (contracts/targeting.md §3)
        raise RegistryError(
            f"registry entry {origin!r} has unsupported fields: {unexpected}")
    name = raw.get("name")
    if not isinstance(name, str) or not _NAME_RE.fullmatch(name):
        raise RegistryError(f"registry entry {origin!r} has an invalid name")
    bridge_url = raw.get("bridge_url")
    if not isinstance(bridge_url, str) or not _BRIDGE_RE.fullmatch(bridge_url):
        raise RegistryError(
            f"registry entry {origin!r} has an invalid bridge_url "
            "(expected http(s)://host:port/sse)")
    enabled = raw.get("enabled", True)
    if not isinstance(enabled, bool):
        raise RegistryError(f"registry entry {origin!r} has a non-boolean enabled")
    created_at = raw.get("created_at", "")
    if not isinstance(created_at, str):
        raise RegistryError(
            f"registry entry {origin!r} has a non-string created_at")
    return RemoteClient(origin=origin, name=name,
                        bridge_url=bridge_url, enabled=enabled,
                        created_at=created_at)


def load_registry(path: str) -> dict[str, RemoteClient]:
    """Read the registry file per call (FR-004). A missing file is an EMPTY
    registry (all-local); a present-but-broken file raises RegistryError so
    remote intent refuses while empty-origin paths never read it."""
    import os
    from datetime import UTC, datetime

    try:
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
            # T025 (US2/AC3): entries without an explicit created_at default
            # to the registry FILE's mtime — a real observed time, never
            # fabricated
            file_mtime = datetime.fromtimestamp(
                os.fstat(fh.fileno()).st_mtime, UTC).isoformat()
    except FileNotFoundError:
        return {}
    except (tomllib.TOMLDecodeError, OSError) as exc:
        raise RegistryError(f"registry unreadable ({exc.__class__.__name__})") from exc
    clients = data.get("clients")
    if clients is None:
        return {}
    if not isinstance(clients, dict):
        raise RegistryError("registry [clients] is not a table")
    registry: dict[str, RemoteClient] = {}
    for raw_origin, raw_entry in clients.items():
        origin = normalize_origin(raw_origin)
        if not origin:
            raise RegistryError(
                f"registry key {raw_origin!r} is not an address literal")
        client = _entry(origin, raw_entry)
        if not client.created_at:
            client = RemoteClient(origin=client.origin, name=client.name,
                                  bridge_url=client.bridge_url,
                                  enabled=client.enabled,
                                  created_at=file_mtime)
        if origin in registry:
            raise RegistryError(f"ambiguous registry: two entries for {origin}")
        registry[origin] = client
    return registry


# T026 (FR-004): the last-seen registry fingerprint (mtime_ns, size) —
# process-global; a change between resolve_target calls is audited once
_LAST_REGISTRY_FINGERPRINT: dict[str, tuple[int, int]] = {}


def _registry_fingerprint(path: str) -> tuple[int, int] | None:
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size)


def _note_registry_change(registry_path: str, audit_path: str | None = None) -> None:
    """Audit one `registry-change` row when the registry file's fingerprint
    changed since the last resolve — operator edits leave an audit
    footprint (FR-004). Never raises: audit must not alter routing."""
    current = _registry_fingerprint(registry_path)
    previous = _LAST_REGISTRY_FINGERPRINT.get(registry_path)
    if previous is not None and current != previous:
        try:
            from .hermes_audit import HermesAudit
            HermesAudit(audit_path or _default_audit_path()).write_attempt(
                decision="executed", operation="registry-change",
                normalized_path=None, allowed_root="",
                outcome=("the remote-client registry changed since the last "
                         "read — operator edits take effect on the next "
                         "request (FR-004); no credentials involved"))
        except Exception:  # noqa: BLE001, S110 — audit never breaks routing
            pass
    if current is not None:
        _LAST_REGISTRY_FINGERPRINT[registry_path] = current


def resolve_target(registry_path: str, client_origin: str | None,
                   audit_path: str | None = None) -> TargetResolution:
    """The one routing decision per desktop tool call (FR-001/FR-002/FR-006).

    T026 (FR-004): a registry file that changed since the previous read
    (mtime) also emits one `registry-change` audit row on the sidecar's
    hermes audit trail — no credentials, just the file's identity and size,
    so every operator edit leaves an audit footprint even when no desktop
    attempt follows."""
    _note_registry_change(registry_path, audit_path)
    origin = normalize_origin(client_origin)
    if not origin:
        # empty or unmatchable origin — today's local default, byte-identical
        return TargetResolution(status="local")
    try:
        registry = load_registry(registry_path)
    except RegistryError as exc:
        return TargetResolution(
            status="refused", reason=(
                f"refused: the remote-client registry is unreadable — nothing "
                f"ran on any machine ({exc}); ask the operator to fix "
                f"{registry_path}"))
    client = registry.get(origin)
    if client is None:
        # unregistered origin (phone, NAT) — today's local default (FR-002)
        return TargetResolution(status="local")
    if not client.enabled:
        return TargetResolution(
            status="refused", client=client, reason=(
                f"refused: {client.name} is disabled for remote desktop "
                f"actions — nothing ran on any machine; ask the operator to "
                f"enable it or run the request from that machine itself"))
    return TargetResolution(status="remote", client=client)