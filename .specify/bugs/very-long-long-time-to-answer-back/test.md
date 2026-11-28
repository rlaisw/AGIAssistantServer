# Bug Verification: Remote "open Word" answers take minutes instead of seconds

- **Slug**: `very-long-long-time-to-answer-back`
- **Tested**: 2026-11-28T08:08:00Z
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The latency collapse reproduced and is fixed: the exact prompt that measured 91 s (pre-fix multi-call protocol) and up to 308 s (Dify elapsed, worst turn) now completes in **23.8 s / 309 events, one combined STEP report** — the agent executed the single-payload fast path (identity → write → save → disk re-open → read-back match → TASK: COMPLETED) instead of walking 4–6 reasoning round-trips. No regressions: 131 tests green across the affected suites, ruff clean.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix, live) | Production `run_task_stream` office turn: "Open Microsoft Word on the a301-11120 machine … type exactly 'hello raymond' (five lines) …", remote resolution, new instructions | pass | **23.8 s, `ok: True`, 309 events** (baseline: 91.2 s/2612 events pre-fast-path; Dify elapsed up to 308 s). Agent's single STEP: "machine identity confirmed a301-11120; wrote 'hello raymond' on five lines, saved to disk, closed and re-opened from disk, read-back matched exactly five 'hello raymond' lines" → `ACTIVE FILE: C:\Users\RLWC145\Documents\hello_raymond.docx` → TASK: COMPLETED |
| Directive present (pre-turn) | `targeted_instructions(OFFICE_INSTRUCTIONS, remote, office=True)` in the live container | pass | SINGLE-PAYLOAD FAST PATH block renders for the a301-11120 resolution |
| New / updated tests | `pytest tests/unit/test_remote_transport.py -q` | pass | 30 passed — incl. the 3 fast-path pins (directive, Office-lane-only scope, gates-unchanged) |
| Regression suite | `pytest tests/unit/test_remote_{transport,clients}.py tests/unit/test_office_v2.py tests/unit/test_hermes_office_tool.py tests/integration/test_remote_callback_transport.py -q` | pass | 131 passed |
| Lint | `ruff check src/agentic_rag_mcp/hermes_client.py tests/unit/test_remote_transport.py` | pass | clean |

## Output Excerpts

```text
elapsed: 23.8 s | ok: True | events: 309
STEP 1: open Word, type 5 lines, save, verify OK — machine identity confirmed
a301-11120; wrote 'hello raymond' on five lines, saved to disk, closed and
re-opened from disk, read-back matched exactly five 'hello raymond' lines,
and the document is the active one in the Word window.
ACTIVE FILE: C:\Users\RLWC145\Documents\hello_raymond.docx
TASK: COMPLETED
```

Baseline for comparison (assessment evidence): pre-fix remote turns 19.5–114 s per attempt (Dify elapsed 22–308 s), 271–2480 events; the healthy-channel combined-payload outlier finished in 56 s — the fix makes that outlier the mandated norm.

## Residual Risks

- The verification left a Word document on the client: `C:\Users\RLWC145\Documents\hello_raymond.docx` (open/active in Word on a301-11120) — owner should close/delete it.
- The verification drove the **agent lane** (the sidecar's own resolution path, identical instructions to the chatflow); the full browser→Dify→agent chain adds the router/finalizer steps (your 07:32 chat run measured 132 s elapsed vs my 56 s sidecar-side for the same era) — expect real chats to land proportionally lower than before but with the same fixed overhead around them.
- The intermittent gateway arg-strip still exists upstream; on a stripped-channel turn the agent runs the canary + recovery once (then the same combined payload) — an occasional slower turn, honestly attributed, not minutes.
- One live sample on the fast path; Dify elapsed/token baselines (25k–100k reasoning tokens per turn) should drop comparably — worth a glance at `workflow_runs` on the next real chat.

## Recommendation

Close the bug — verified with live evidence: the >3-minute remote Office answer is gone (23.8 s vs 91–308 s baseline), the fast path executed exactly as mandated (one payload, identity-gated, disk-read-back), and the honesty gates all survived coalescing (all override/identity/read-back pins green). The fix rides on the deployed sidecar now; your next real "open microsoft word" from the client should confirm the chat-level timing.
---

## Round 3 verification (2026-11-28T08:50) — the structural fix, live-benched

The round-1/2 fast-path instructions were necessary but not sufficient: real chat turns still paid the second agent + the gateway strip + recovery (84.9 s / 1,111 events measured on the user's 08:07 turn). Round 3 removes the inner agent from the hot path entirely: the office-v2 tools execute their fixed templates directly against the requesting machine's OfficeMCP bridge.

| Check | Result |
|-------|--------|
| Live remote `doc_write_v2` (sidecar → client bridge) | **4.4 s** (audit `duration_s`), wrote + verified ON a301-11120 (`hello_raymond_v2.docx`, text_ok true) — vs 84.9–308 s agent-lane baseline |
| Identity gate | armed in the payload (`target_host`), local payloads unchanged |
| Routing pins | round-4 DSL pin (remote-native, no prohibition), renderable-placeholder pin, all-four-tools routing, refused-still-refuses |
| Battery | 500 passed; ruff clean (pre-existing I001 only) |
| Deploy | both twins published by ID; sidecar healthy, round-4 liveness verified in-container |

Residual: the browser→Dify chain still adds its fixed overhead (router/classifier/finalizer, ~10–15 s) around the 4.4 s tool call — a real chat "open microsoft word" should land ~15–25 s total (from minutes). The gateway arg-strip is now irrelevant for simple writes (no agent in the path); it remains for complex Office work via hermes_office_task.

**Close the bug** — verified with live benchmark evidence.

## Owner acceptance (2026-11-28T09:27Z) — CLOSED

Owner-attested live from the a301-11120 browser through the full chat chain: "tested open word, excel and powerpoint, average time is about 10 seconds." Audit rows (09:25:18–09:26:38): `doc-write-v2` **1.7 s**, `xls-write_v2` **3.1 s**, `ppt_write_v2` **2.3 s** — all `executed`, `target: a301-11120`; the ~10 s perceived average is Dify pipeline overhead around deterministic sub-4-second remote tool calls. From 84.9–308 s to ~10 s end-to-end. Bug closed with owner acceptance.
