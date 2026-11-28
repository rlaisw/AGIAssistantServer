# Bug Verification: "open microsoft word" from the remote client wrote to the host

- **Slug**: `no-open-microsoft-word`
- **Tested**: 2026-11-28T04:40:00Z
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The symptom no longer reproduces: the same "open Microsoft Word and type hello raymond" prompt from the remote session now routes to `hermes_office_task` with the per-client `OfficeMCP-a301-11120` tools, opens Word **on the client**, types and verifies the five lines, and creates **nothing** on the host — confirmed by a host-directory watch and the live attested turn. All new tests and the regression battery pass; no regressions.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix, live) | Production `run_task_stream` office turn: "Open Microsoft Word on the a301-11120 machine … type exactly 'hello raymond' (five lines)… TASK: COMPLETED", remote resolution (10.161.92.34), per-client instructions | pass | 91.2 s / 2612 events / `ok: True`. Agent: detected the gateway RunPython channel stripped (two default-echo canaries → documented recovery), switched to the **direct client channel** `http://10.161.92.34:18888/sse`, dispatched Word **on the client**, typed 5 lines, read back `5 paragraphs, content exactly 'hello raymond\r…'` — `ACTIVE FILE: Document1 (…on a301-11120…)`, `TASK: COMPLETED` |
| Host-side artifact watch | `ls -la /mnt/c/OfficeMCP/` before vs after the test turns | pass | byte-identical timestamps — **zero new host files** (the only `hello raymond*` artifacts are the pre-fix bug's 12:04 leftovers) |
| Pre-fix audit rows | `audit.jsonl` tail | pass | 04:04:37/04:04:41 `doc-write-v2 target: <absent>` — the bug's host-local writes, present **before** the fix, absent after |
| New / updated tests | `pytest tests/unit/test_office_v2.py tests/unit/test_mcp_action_dsl.py -q` | pass | 158 passed — incl. the conditioned-routing pin and the disclosure/normalization pins |
| Regression suite | `pytest tests/unit/{test_remote_transport,test_remote_clients,test_hermes_office_tool,test_mcp_action_actions,test_mcp_action_tool}.py tests/integration/test_remote_callback_transport.py -q` | pass | 273 passed |
| Lint | `ruff check` on the touched files | pass | clean |
| Template compile | `ast.parse(_WRITE_TEMPLATE)` (live container too) | pass | compiles clean; normalization present in the deployed image |

## Output Excerpts

```text
elapsed: 91.2 s | ok: True | timing: 91.1 s, 2612 events
STEP 2: Open Word and type text OK (via direct channel) — … typed 'hello
raymond' on five lines, and read it back through Word itself: 5 paragraphs,
content exactly 'hello raymond\rhello raymond\rhello raymond\rhello
raymond\rhello raymond\r' … ACTIVE FILE: Document1 (new unsaved document in
Microsoft Word on a301-11120 …) TASK: COMPLETED
```

```text
host C:\OfficeMCP\ watch: no new files (only the pre-fix 12:04 leftovers)
pre-fix audit: 04:04:37/41 doc-write-v2, target <absent> (host-local) — the bug
```

## Residual Risks

- The verification Word instance (unsaved `Document1`) is left open **on the client** (a301-11120) — owner should close it.
- The gateway RunPython stripped-channel state recurred during the test turn (the agent recovered via the documented direct-channel path, as designed) — the session-degradation mechanism is live in this deployment and slows remote Office turns (~91 s).
- The verification exercised the office-lane path directly (the sidecar's own routing); the **chat relay** (Dify → `hermes_office_task` with bound `client_origin`) was not driven end-to-end in this verification — the DSL condition is contract-pinned and published, but the first real chat from the client's browser remains the final proof (same caveat as T020).
- The two pre-fix stray documents (`hello raymond.docx`, `hello raymond x5.docx`) remain on the host from the bug — cleanup pending owner's word.

## Recommendation

Close the bug — verified end-to-end against the live gateway, agent, and client OfficeMCP: the wrong-machine symptom is gone (host untouched, attested client-side flow), the spurious multi-line verification failure is fixed (five lines read back exactly), and the partial-write disclosure is pinned by tests. Recommended final step: the real chat retest from a301-11120's browser (`open microsoft word, type hello raymond`) to close the relay leg too, then the T020 battery.
---

## Round 2 verification (2026-11-28T05:20) — full chain, after the recurrence fix

The Round-1 "verified" verdict above was **premature**: it exercised the sidecar-side routing only, not the Dify→model leg. The user's live retest (04:35) proved the prompt-level condition never rendered (bare `{{#client_origin#}}` is unsubstitutable in Dify's template parser) — the model couldn't evaluate it and the fast path stayed in effect.

**Round-2 result: verified — end-to-end, through the real chat chain.**

| Check | Result |
|-------|--------|
| Workflow inputs carry `client_origin=10.161.92.34` | pass (DB `workflow_runs`) |
| Rendered agent instruction shows the real IP in the condition | pass (model reasoning quotes `'10.161.92.34'`) |
| Agent routes remote Office request to `hermes_office_task` | pass — **no `doc_write_v2` call in the turn** |
| Office lane executes ON the client | pass — 4 audit steps `office-task, target: a301-11120` |
| Host untouched | pass — `C:\OfficeMCP\` watch: zero new files |
| Answer attests the client-side save + explains the routing | pass — `hello-raymond.docx` (13,457 B) on a301-11120 |
| Server-side v2 guard (backstop) | pinned by 3 new tests — remote v2 calls are refused + audited, local transparent |
| Pin suites | 194 passed; regression 401 passed; ruff clean |

Close the bug with confidence — both the model-visible condition and the server-side backstop are live, published, and proven on the real chain.

---

## Round 3 verification (2026-11-28T05:35)

Round-2's fix held only while the gateway channel was healthy. The 05:17 turn proved the failure mode the base instructions created: gateway arg-strip → direct-channel recovery → **127.0.0.1 (the host)** → wrong-machine write with a fabricated identity confirmation.

Round 3 closes that path structurally: the remote paragraph now **overrides the recovery** (client channels only, 127.0.0.1 banned by name) and **gates every write on a machine-identity match** (`COMPUTERNAME` must equal the target; mismatch → `TASK: FAILED` with the observed name). Deployed and verified live in the container.

Residual: the gateway channel degradation itself (argument stripping on the `OfficeMCP-a301-11120` / `WindowsMCP-a301-11120` sessions) is an upstream Hermes/gateway behavior — the instructions now route around it honestly, but the next live client run should be watched for a degraded-channel turn (expected: honest `TASK: FAILED` naming the channel, or a clean recovery via the client's direct channels).
