"""Spec 034 — conversation-scoped pending command drafts (data-model.md).

Mirrors the office lane's pending-email pattern, shrunk to the minimum: one
pending draft per conversation; a new draft replaces the old; state is
in-memory and ephemeral by design — the audit JSONL is the durable record
of every draft ever registered.
"""

from __future__ import annotations

import threading


class PowerShellState:
    def __init__(self) -> None:
        self._pending: dict[str, str] = {}
        # spec 053: the registry name of the machine the draft targets —
        # bound at draft time; a confirm from a different machine never runs
        self._target: dict[str, str | None] = {}
        self._lock = threading.Lock()

    def set_pending(self, conversation_id: str, command: str,
                    target_name: str | None = None) -> None:
        with self._lock:
            self._pending[conversation_id] = command
            self._target[conversation_id] = target_name

    def pending(self, conversation_id: str) -> str | None:
        with self._lock:
            return self._pending.get(conversation_id)

    def pending_target(self, conversation_id: str) -> str | None:
        with self._lock:
            return self._target.get(conversation_id)

    def clear(self, conversation_id: str) -> None:
        with self._lock:
            self._pending.pop(conversation_id, None)
            self._target.pop(conversation_id, None)


_state = PowerShellState()


def get_powershell_state() -> PowerShellState:
    return _state
