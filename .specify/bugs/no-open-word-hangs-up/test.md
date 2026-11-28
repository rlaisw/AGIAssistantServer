# Bug Verification: Remote-targeted agent lanes hang — Word never opens

- **Slug**: `no-open-word-hangs-up`
- **Tested**: 2026-11-28T03:08:00Z
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The original symptom no longer reproduces: the same remote-targeted agent-lane turn that hung twice (60.7 s / 117.3 s, both user-cancelled, no verdict) now completes in 36.5 s with a real attested verdict — Word launched on a301-11120 via the per-client registered tool. All new tests and regression suites pass; no regressions found.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | Live `run_task_stream` turn through the real Hermes gateway + agent against the client bridge: "Launch WINWORD.EXE … on the a301-11120 machine using its per-client tools … LAUNCH: SUCCESS" | pass | 36.5 s, 151 events, `ok: True`; agent used `mcp__WindowsMCP_a301_11120__App` (mode launch, name WINWORD.EXE, no arguments), verified PID 15808 window "Document2 - Word" — Word opened on the client, TASK: COMPLETED + LAUNCH: SUCCESS. Pre-fix the identical prompt path produced no verdict until user Stop (audit rows 01:01:59 / 01:04:23 UTC). |
| Instructions shape (pre-turn) | `resolve_target` + `targeted_instructions` against the live registry | pass | resolution `remote(a301-11120)`; paragraph names `mcp__WindowsMCP_a301_11120__App`, no "open an SSE session" |
| New / updated tests | `pytest tests/unit/test_remote_clients.py tests/unit/test_remote_transport.py tests/integration/test_remote_callback_transport.py -q` | pass | 63 passed — incl. the hyphen→underscore prefix pin and the forbidden SSE-manual-string assertions |
| Regression suite | `pytest tests/unit/test_hermes_{run,powershell,launch,office}_tool.py test_hermes_audit.py test_hermes_profiles.py -q` | pass | 87 passed |
| Lint | `ruff check` on the four touched repo files | pass | clean |

## Output Excerpts

```text
elapsed: 36.5 s
ok: True
timing: 36.4 s, 151 events
TASK: COMPLETED. Launched WINWORD.EXE (Microsoft Word) on a301-11120 via
mcp__WindowsMCP_a301_11120__App (mode launch, name WINWORD.EXE, no arguments).
Verified running: PID 15808, window title "Document2 - Word" …
LAUNCH: SUCCESS
```

## Residual Risks

- The verification Word instance was left running on a301-11120 (PID 15808) — owner should close it.
- One live sample on the launch lane; the office lane's remote path (`OfficeMCP-a301-11120`) shares the mechanism but was not exercised live in this verification (unit-level only).
- Gateway tool-count growth (34 per-client tools): watch tool-sync/prompt size; `lazy: true` is the documented fallback.
- Keepalive/session-TTL (180 s gateway default vs WindowsMCP session TTL) not measured — first long Office turn should be watched.

## Recommendation

Close the bug — verified end-to-end against the live gateway, agent, and client bridge: the symptom is gone, the fix mechanism is exercised (per-client registered tools, named in the instructions, attested by the agent), and no regressions appeared. The full T020 acceptance battery (office lane live, never-list refusal from the client, remote health check, host regression) can now proceed from a301-11120's browser.