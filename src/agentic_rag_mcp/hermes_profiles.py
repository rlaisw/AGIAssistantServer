"""Spec 051 — profile-aware helpers for the multiplexed Hermes gateway.

The profile's own API_SERVER_KEY is read from the read-only profiles mount;
this module never logs it and never falls back to another profile or the
legacy shared key.
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import httpx

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
KEY_CACHE_TTL_S = 60.0

# Canonical code → (status, message). Kept in step with
# ai-chat-landing/lib/profiles/errors.ts (T048 parity test).
PROFILE_ERRORS: dict[str, tuple[int, str]] = {
    "unauthorized": (401, "This service call is not authorized."),
    "invalid_profile_request": (422, "The profile request was not valid."),
    "provisioning_in_progress": (409, "Your assistant profile is being created; try again shortly."),
    "provision_failed": (500, "Your assistant profile could not be created. Try again."),
    "registry_unavailable": (503, "Profile setup is temporarily unavailable."),
    "profile_misconfigured": (500, "Your assistant profile is not configured correctly. Contact the administrator."),
    "profile_auth_failed": (401, "Your assistant access is not valid. Contact the administrator."),
    "profile_disabled": (403, "Your assistant profile is disabled."),
    "profile_missing": (404, "Your assistant profile was not found."),
    "agent_busy": (429, "The assistant is busy. Try again in a moment."),
    "agent_unavailable": (503, "The assistant host is temporarily unavailable."),
    "tool_unavailable": (200, "The Windows tools are unavailable right now."),
    "history_scope_failed": (500, "Chat history could not be scoped to your account; the message was not sent."),
    "legacy_conversation": (404, "That conversation is no longer available."),
    "identity_required": (401, "Please sign in to use your own assistant."),
    "slug_collision": (200, "A distinct profile name was assigned."),
}


class ProfileError(Exception):
    def __init__(self, code: str, detail: str = "") -> None:
        self.code = code
        self.status, self.user_message = PROFILE_ERRORS[code]
        super().__init__(detail or code)


@dataclass(frozen=True)
class ProfilesConfig:
    provision_url: str
    provision_token: str
    profiles_dir: Path
    gateway_url: str
    template_profile: str = "template-pc"
    audit_path: Path = Path("/tmp/hermes-profiles-audit.jsonl")

    @classmethod
    def from_env(cls, env: Optional[dict[str, str]] = None) -> "ProfilesConfig":
        e = env if env is not None else os.environ
        return cls(
            provision_url=e.get("HERMES_PROVISION_URL", "http://172.21.0.1:3000/api/profiles/ensure"),
            provision_token=e.get("HERMES_PROVISION_TOKEN", ""),
            profiles_dir=Path(e.get("HERMES_PROFILES_DIR", "/hermes-profiles")),
            gateway_url=e.get("HERMES_GATEWAY_URL", "http://172.17.0.1:8642"),
            template_profile=e.get("HERMES_TEMPLATE_PROFILE", "template-pc"),
            audit_path=Path(e.get("HERMES_AUDIT_PATH", Path.home() / ".config" / "agentic-rag-mcp" / "hermes-mcp" / "audit.jsonl")),
        )


def assert_slug(slug: str) -> str:
    if not SLUG_RE.match(slug or "") or ".." in slug:
        raise ProfileError("invalid_profile_request", "slug")
    return slug


def responses_url(gateway_url: str, slug: str) -> str:
    return f"{gateway_url.rstrip('/')}/p/{assert_slug(slug)}/v1/responses"


def auth_headers(key: str) -> dict[str, str]:
    return {"authorization": f"Bearer {key}", "content-type": "application/json"}


def read_profile_key(profiles_dir: Path, slug: str) -> str:
    env_path = Path(profiles_dir) / assert_slug(slug) / ".env"
    try:
        text = env_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ProfileError("profile_misconfigured", "env unreadable") from exc
    for line in text.splitlines():
        if line.startswith("API_SERVER_KEY="):
            key = line.split("=", 1)[1].strip()
            if key:
                return key
    raise ProfileError("profile_misconfigured", "key missing")


class ProfileKeyCache:
    def __init__(self, profiles_dir: Path, now: Callable[[], float] = time.monotonic) -> None:
        self._dir = Path(profiles_dir)
        self._now = now
        self._cache: dict[str, tuple[str, float]] = {}

    def get(self, slug: str) -> str:
        hit = self._cache.get(slug)
        if hit and self._now() - hit[1] < KEY_CACHE_TTL_S:
            return hit[0]
        key = read_profile_key(self._dir, slug)
        self._cache[slug] = (key, self._now())
        return key

    def invalidate(self, slug: str) -> None:
        self._cache.pop(slug, None)


def ensure_profile(
    cfg: ProfilesConfig,
    *,
    slug: str,
    oid: str,
    email: str,
    display_name: str = "",
    client: Optional[httpx.Client] = None,
    retry_delay_s: float = 0.2,
) -> dict:
    if not oid.strip():
        raise ProfileError("identity_required")
    payload = {"slug": assert_slug(slug), "oid": oid, "email": email, "displayName": display_name}
    headers = {"authorization": f"Bearer {cfg.provision_token}", "content-type": "application/json"}
    own_client = client is None
    http = client or httpx.Client(timeout=35.0)
    try:
        for attempt in range(2):
            res = http.post(cfg.provision_url, json=payload, headers=headers)
            if res.status_code in (200, 201):
                data = res.json()
                return {"slug": data["slug"], "status": data["status"], "created": bool(data.get("created"))}
            if res.status_code == 409 and attempt == 0:
                time.sleep(retry_delay_s)
                continue
            raise ProfileError(_map_status(res.status_code), f"ensure {res.status_code}")
        raise ProfileError("provisioning_in_progress")
    finally:
        if own_client:
            http.close()


def _map_status(status: int) -> str:
    return {
        401: "profile_auth_failed",
        403: "profile_disabled",
        404: "profile_missing",
        409: "provisioning_in_progress",
        422: "invalid_profile_request",
        429: "agent_busy",
        503: "agent_unavailable",
    }.get(status, "agent_unavailable")


_RESOLVED: dict[tuple[str, str], tuple[str, float]] = {}


def _audit_routing(audit_path: Path, slug: str, outcome: str = "ok") -> None:
    import json
    try:
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        with audit_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"event": "routing", "slug": slug, "outcome": outcome,
                                 "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}) + "\n")
    except OSError:
        pass


def resolve_profile_context(
    cfg: ProfilesConfig,
    *,
    slug: str,
    oid: str,
    email: str,
    display_name: str = "",
    ttl_s: float = 300.0,
    client: Optional[httpx.Client] = None,
    now: Callable[[], float] = time.monotonic,
) -> tuple[str, str]:
    """Ensure the profile (cached) and return (canonical_slug, profile_key).

    Refuses without an identity: anonymous callers never create or route to a
    profile. Cached positive results avoid an ensure call per tool invocation.
    """
    if not (slug or "").strip() or not (oid or "").strip():
        raise ProfileError("identity_required")
    memo_key = (assert_slug(slug), oid)
    hit = _RESOLVED.get(memo_key)
    if hit and now() - hit[1] < ttl_s:
        canonical = hit[0]
    else:
        result = ensure_profile(cfg, slug=slug, oid=oid, email=email,
                                display_name=display_name, client=client)
        canonical = str(result["slug"])
        _RESOLVED[memo_key] = (canonical, now())
    _audit_routing(cfg.audit_path, canonical)
    return canonical, read_profile_key(cfg.profiles_dir, canonical)


def clear_resolved_cache() -> None:
    _RESOLVED.clear()


_TURN_SCOPE: dict[str, Optional[str]] = {}


def register_turn_scope(conversation_id: str, slug: str = "") -> None:
    """Bind a Dify conversation to the profile that runs it (None = legacy)."""
    if conversation_id:
        _TURN_SCOPE[conversation_id] = assert_slug(slug) if slug else None


def turn_scope_allows(conversation_id: str, slug: str = "") -> bool:
    """Cancel is allowed only for a conversation this scope owns.

    An unknown conversation has nothing registered to cancel (noop path), so it
    is allowed; a registered conversation must match the caller's profile.
    """
    if not conversation_id or conversation_id not in _TURN_SCOPE:
        return True
    return _TURN_SCOPE[conversation_id] == (assert_slug(slug) if slug else None)


def clear_turn_scopes() -> None:
    _TURN_SCOPE.clear()
