# Bug Fix: Remote "open Word" answers take minutes instead of seconds

- **Slug**: `very-long-long-time-to-answer-back`
- **Fixed**: 2026-11-28T07:55:00Z
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The remote Office instructions now mandate a **SINGLE-PAYLOAD FAST PATH** for simple literal writes: one combined tool call whose code asserts the machine identity first, attaches/creates the document, types the literal, saves, and re-reads the file from disk — instead of walking 4–6 separate reasoning round-trips (the 22–308 s turns). All honesty gates (identity, literal match, disk read-back) ride inside the payload; nothing is removed, only coalesced.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src/agentic_rag_mcp/hermes_client.py` | modified | `targeted_instructions(..., office=True)` appends the SINGLE-PAYLOAD FAST PATH block: "do NOT walk the write as separate tool calls", ONE combined payload, six ordered sub-stages (identity-first → attach → type → save → disk re-open read-back → one-message STEP report), gates INSIDE the payload, canaries only when arguments arrive stripped then retry the same combined payload once |
| `tests/unit/test_remote_transport.py` | added tests | `test_office_remote_instructions_mandate_the_single_payload_fast_path` (all directive pins) + `test_run_command_remote_has_no_office_fast_path` (fast path binds only the Office lane) |
| sidecar | redeployed | health ok, tools 59→59; directive verified live in the container |

## Diff Highlights

```python
# hermes_client.py — fast_path (office lane only), inserted after office_line
fast_path = (
    "\nSINGLE-PAYLOAD FAST PATH (very-long-long-time-to-answer-back, "
    "2026-11-28 — binding for simple literal writes): do NOT walk the "
    "write as separate tool calls ... Do ONE combined payload: a single "
    "{office_prefix}Write or RunPython call whose code, IN ORDER: "
    "(1) first line asserts the machine identity ... (5) close and re-open "
    "the saved file FROM DISK and read its text back; (6) report every "
    "sub-stage in one message with the STEP markers ... All honesty gates "
    "(identity, literal match, disk read-back) ride INSIDE the payload — "
    "they are not removed, only coalesced. Channel canaries are needed "
    "ONLY if a call arrives with its arguments stripped ..."
) if office else ""
```

## Tests Added or Updated

- `tests/unit/test_remote_transport.py::test_office_remote_instructions_mandate_the_single_payload_fast_path` — pins the directive: header, "do NOT walk the write as separate tool calls", identity-first-line, FROM-DISK read-back, one-message STEP report, canaries-only-when-stripped
- `tests/unit/test_remote_transport.py::test_run_command_remote_has_no_office_fast_path` — the fast path is Office-lane-only; other lanes unchanged
- Existing override/gate/identity pins: all still green (honesty untouched)

## Local Verification

- Commands: `pytest tests/unit/test_remote_transport.py -q` → **30 passed**; full affected battery (remote + hermes tools + office_v2 + DSL) → **302 passed**; `ruff check` on both files → clean
- Deploy: `deploy redeploy` → 6 steps ok (health, tools 59→59); `docker exec` confirms the directive renders for the a301-11120 resolution in the live container
- Manual: no live remote turn driven this run — that is `/speckit.bug.test`'s job (expect the next real "open microsoft word" from the client to run the combined payload once instead of 4–6 round-trips)

## Deviations from Assessment

- None structurally. The assessment's open question (agent lane vs a sidecar-direct remote write tool bypassing the agent entirely) is answered as: **instructions first** — the combined-payload counterexample (56 s, healthy channel) proves the agent lane can meet ~1 min without a new tool surface; the sidecar-direct remote-write tool stays a spec-addendum option if this floor still disappoints.

## Follow-ups

- **Live timing verification** (`/speckit.bug.test`): next real remote Office turn should show ONE payload round-trip; audit `timing.event_count` should drop from ~800–2500 to roughly the low hundreds.
- The upstream gateway arg-strip remains the tail risk (recovery override + one retry covers it; a Hermes-side fix would remove those turns entirely).
- If the ~30–60 s agent-lane floor still disappoints the owner, the sidecar-direct remote write tool (mirror of `doc_write_v2` semantics over the client bridge) is the spec-addendum escalation.
---

## Round 3 (2026-11-28T08:50) — the structural fix: office v2 goes remote-native

**User escalation**: 90 s still unacceptable. Root cause confirmed in the trace: TWO nested LLM agents + the chronically degrading gateway channel — the fast-path instructions only helped the healthy-channel case (23.8 s sidecar test), while the real chat turns paid the strip + recovery dance (84.9 s / 1,111 events; Dify elapsed up to 308 s).

**Round-3 changes** (the escalation the assessment documented as the spec-addendum option):

| File | Change |
|------|--------|
| `src/agentic_rag_mcp/office_lanes/proxy.py` | + `OfficeProxy.close()`; + module `call_at(base_url, tool, arguments)` — one-shot session to an explicit OfficeMCP base (normalizes a trailing /sse, live-caught 404 bug: /sse/sse); the four helpers (`write_doc`/`write_xls`/`write_ppt`/`read_doc`) gain `base_url`/`target_host` kwargs routing to `call_at`; ALL FOUR templates gain the machine-identity gate first line (`COMPUTERNAME` must equal `target_host`, armed only for remote payloads) |
| `src/agentic_rag_mcp/server.py` | `_v2_route` replaces `_v2_remote_guard`: a remote session executes the SAME fixed template against the requesting machine's OfficeMCP bridge — ONE deterministic sidecar call, no inner agent turn; refused resolutions still refuse honestly; local byte-identical; audits carry the target |
| `dify/AGIAssistant/AGI_Assistant.yml` | SESSION-ORIGIN CONDITION rewritten: v2 tools are remote-native — route simple literal writes to them from EVERY session (they are the fast path); complex Office work → hermes_office_task; round-2 prohibition retired |
| Tests | transport: 4 guard tests → execution tests (remote routes via call_at with target_host armed, local keeps the persistent session, all four tools route, refused still refuses) + `test_call_at_normalizes_the_sse_suffix`; DSL: round-4 routing pin + renderable-placeholder pin generalized |
| Deploy | both twins republished by ID; sidecar redeployed (twice — the /sse fix) |

**Live verification**: remote `doc_write_v2` through the sidecar → **`duration_s: 4.4`**, wrote `C:\OfficeMCP\hello_raymond_v2.docx` (13,456 B, `text_ok: true`) ON a301-11120 via its bridge, identity-gated — **vs 84.9–308 s** through the agent lane (≈20–70×; SC-005's ≤2× satisfied with room to spare). Battery: 500 passed.
