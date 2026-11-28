# Bug Assessment: Remote "open Word" answers take minutes instead of seconds

- **Slug**: `very-long-long-time-to-answer-back`
- **Created**: 2026-11-28T07:45:00Z
- **Source**: pasted text (user report) + live audit/Dify-Postgres evidence for the same turns
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

> "although it can open MS Word, but very long-long time, over 3 minutes"

Typed from the registered remote client (a301-11120) during post-fix verification of the "open microsoft word" flow. Word does eventually open on the client (the round-2/3 fixes hold), but the answer takes minutes.

## Symptom

A remote-targeted Office request takes 1–5 minutes end-to-end (Dify `elapsed_time` today: 22–308 s, median ~70 s, worst 308 s at 06:20 UTC) versus the local equivalent's seconds (`doc_write_v2` completes in ~5–15 s). Expected: remote within a small multiple of local (SC-005's ≤2×), or at least well under a minute for a simple literal write.

## Reproduction

1. From a301-11120's browser, send `open microsoft word, type hello raymond` (or any Office request).
2. Wait for the answer — observed live today: 07:32 turn (132 s, cancelled by user at 114 s) → retry 07:35 (56 s), total user-perceived ≈ 4–5 min; earlier turns 172 s (05:15) and 308 s (06:20).
3. Evidence: sidecar audit `office-task` rows today (durations 19.5–114 s per attempt, event counts 271–2480, target `a301-11120`), Dify `workflow_runs` (`elapsed_time` 22–308 s, `total_tokens` 25k–100k, 7 workflow steps), and the 06:27 launch-lane row at 244 s.

## Suspected Code Paths

- `src/agentic_rag_mcp/hermes_client.py` — `OFFICE_INSTRUCTIONS` + the spec-053 remote paragraph: the remote Office protocol is **multi-tool-call by design** (channel canary → machine-identity probe → attach → type → save → read-back), each call a separate gateway round-trip with the model reasoning verbosely between steps (800–2500 events per turn ≈ 25k–100k tokens of reasoning).
- `src/agentic_rag_mcp/hermes_client.py` (round-3 additions) — DIRECT-CHANNEL RECOVERY OVERRIDE + MACHINE-IDENTITY GATE add 2+ extra tool-call round-trips to every remote Office turn (correct, but on the hot path).
- Gateway channel arg-strip (intermittent, upstream Hermes) — when it hits mid-turn, the agent must run the recovery dance (06:54 STEP 1: "4 consecutive argument-carrying calls stripped → switched to direct channel"), adding a whole step.
- Dify pipeline — 7 workflow steps (router → skill_search → agent → honesty checks → finalizer) wrap the agent turn with fixed overhead.
- `src/agentic_rag_mcp/server.py` `hermes_office_task` budget — `cfg.hermes_timeout_s` (default 300 s) bounds each attempt; the 244 s turn shows the lane operating near its budget on bad turns.

## Root Cause Hypothesis

The latency is **agent reasoning over a multi-step remote protocol**, not a hang or a transport fault: every step of the remote Office flow is a separate LLM tool-call round-trip (identity probe, canaries, COM sequence, read-back), each crossing WSL → gateway → LAN → client OfficeMCP, with 1,000–2,500 reasoning events burned between steps. The healthy-channel turn that **combined everything into a single RunPython payload** (07:35:56: "STEP 1: combined Word document-write OK … identity + attach + type + save + read-back in one") finished in 56 s with a clean 5-step report — proving the protocol itself permits a fast path the instructions never mandate. The intermittent gateway arg-strip occasionally inserts a recovery dance, and the user's Stop on a slow turn (114 s) plus the retry doubles the perceived wait. Confidence: **high** (audit timing profiles + Dify elapsed/token counts + the combined-payload counterexample all agree).

## Proposed Remediation

**Preferred**: mandate the **single-payload fast path** in the remote Office instructions — for a plain write request, ONE combined RunPython on the target machine (machine-identity probe + attach/create + type literal + SaveAs + disk re-open read-back in a single payload, reporting the same STEP/TASK markers), instead of 4–6 separate tool calls; the channel canary runs only when the gateway channel is detected stripped; the identity gate rides inside the combined payload (first line: `COMPUTERNAME` check, abort-on-mismatch). This removes most reasoning round-trips while keeping every honesty gate (the gate is in the *code the agent writes on the client*, not in the number of calls). Files: `src/agentic_rag_mcp/hermes_client.py` (remote paragraph + office instructions). Tests: `tests/unit/test_remote_transport.py` pins the "combined single payload" directive and keeps the override/gate pins.

**Alternatives**:
- Trim the remote paragraph/office instruction set (fewer protocol tokens → less reasoning) — cheaper but marginal; the round-trips dominate.
- Fix the upstream gateway arg-strip (session renewal/restart on detection) — removes the recovery-dance turns entirely, but it's Hermes-side, not this repo.
- Answer-side expectation setting ("this drives your machine remotely and takes ~a minute") — pure UX copy, no latency change.

**Files likely to change**:

- `src/agentic_rag_mcp/hermes_client.py`
- `tests/unit/test_remote_transport.py`

**Tests to add or update**:

- The remote office paragraph must mandate the combined single-payload directive (and the identity-gate-first-line form) — pinned strings in the transport suite.
- Existing override/gate pins stay green (no honesty regression).

## Risks & Considerations

- Combining steps must not weaken the identity gate or the verification read-back — they move *into* the payload, they are not removed.
- A bigger single payload raises the chance of a Windows-side COM error mid-payload; the honest per-stage report inside the payload covers this (report each sub-stage, fail honestly).
- `hermes_timeout_s=300` stays the outer bound; the fast path should routinely finish well under it, bad turns included.
- Token spend per turn (25k–100k) also drops with fewer round-trips — cost, not just latency.
- Upstream arg-strip remains the tail risk; the fast path keeps the recovery override for stripped-channel turns.

## Open Questions

- [NEEDS CLARIFICATION: whether ~30–60 s (the combined-payload fast path's realistic floor given the agent in the loop) is acceptable to the owner, or whether they want the remote Office simple-write case to skip the agent lane entirely (e.g., a sidecar-direct remote write tool mirroring `doc_write_v2` semantics over the client bridge) — a bigger design change, spec addendum territory.]