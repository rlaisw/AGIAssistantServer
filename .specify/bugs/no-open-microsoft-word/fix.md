# Bug Fix: "open microsoft word" from the remote client writes to the host and never opens Word there

- **Slug**: `no-open-microsoft-word`
- **Fixed**: 2026-11-28T04:35:00Z
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The office-v2 fast-path routing rule is now conditioned on empty `client_origin` — remote sessions route Office requests to the remote-targeted `hermes_office_task` (per-client `OfficeMCP-a301-11120` tools) instead of writing on the host; the v2 write verification normalizes LF→CR so multi-line literals verify; and a failed verification discloses the partial write (path/existed/open) instead of letting the relay infer "nothing was written". Both Dify twins published, sidecar redeployed.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `dify/AGIAssistant/AGI_Assistant.yml` | modified | The "Office tasks: SIMPLE literal WRITES" rule gains SESSION-ORIGIN CONDITION: v2 fast paths (`doc_write_v2`/`xls_write_v2`/`ppt_write_v2`/`doc_read_v2`) apply ONLY when `{{#client_origin#}}` is empty; a set origin routes every Office request to `hermes_office_task` (remote-targeted); "Never call a *_v2 office tool when client_origin is set" |
| `src/agentic_rag_mcp/office_lanes/proxy.py` | modified | `_WRITE_TEMPLATE`: verification normalizes LF→CR on both sides of the containment check (Word COM paragraph marks are CR); comment reworded CR/LF to keep the Windows code compilable |
| `src/agentic_rag_mcp/office_lanes/proxy.py` | modified | `write_doc`: `text_ok: false` error now discloses the partial write — path, existed, open_docs — "the file WAS saved and left open" |
| `tests/unit/test_mcp_action_dsl.py` | added test | `test_office_v2_fast_path_is_conditioned_on_empty_client_origin` — pins the conditioned routing sentence in every prompt carrying the office rules |
| `tests/unit/test_office_v2.py` | added class | `TestWriteDocV2NoOpenMicrosoftWord` — template normalization pin (compilable + `replace('\n', '\r')` present), error-envelope disclosure via the `_fake_http_proxy` harness, multi-line ok path |
| `tests/unit/test_mcp_action_dsl.py` | fixed | `test_start_node_exposes_optional_client_origin_input` — RUF015 `next(...)` |
| Dify | published | Both "AGI Assistant" twins by explicit ID (`194e1edf…`, `7863fbe2…`) |
| sidecar | redeployed | container healthy, tools 59→59; live template verified inside the container |

## Diff Highlights

```python
# proxy.py _WRITE_TEMPLATE — verification (the LF→CR normalization)
ok = (d['text'].strip().replace('\n', '\r')
      in doc.Content.Text.strip().replace('\n', '\r'))
```

```yaml
# AGI_Assistant.yml — the conditioned fast path (abbreviated)
- Office tasks: SIMPLE literal WRITES —
  SESSION-ORIGIN CONDITION (spec 053, 2026-11-28): the office v2 fast paths
  (doc_write_v2, xls_write_v2, ppt_write_v2, doc_read_v2) apply ONLY when
  '{{#client_origin#}}' is empty — the session comes from THIS machine. ...
  Never call a *_v2 office tool when client_origin is set.
```

## Tests Added or Updated

- `tests/unit/test_mcp_action_dsl.py::test_office_v2_fast_path_is_conditioned_on_empty_client_origin` — routing amendment pinned in the prompt
- `tests/unit/test_office_v2.py::TestWriteDocV2NoOpenMicrosoftWord::test_write_template_normalizes_line_endings_in_verification` — the source pin
- `tests/unit/test_office_v2.py::…::test_verification_failure_discloses_the_partial_write` — error envelope carries path/existed/open_docs + disclosure text
- `tests/unit/test_office_v2.py::…::test_verification_ok_multi_line_payload_passes` — multi-line literal still rides `data`, ok envelope

## Local Verification

- `pytest tests/unit/{test_office_v2,test_mcp_action_dsl,test_remote_transport,test_remote_clients,test_hermes_office_tool,test_mcp_action_actions,test_mcp_action_tool}.py tests/integration/test_remote_callback_transport.py -q` → **431 passed**
- `ast.parse(_WRITE_TEMPLATE)` → compiles clean (the first attempt had a real CR/LF mid-comment — caught by this check)
- `ruff check` on the touched files → clean
- Publish by explicit ID → both twins; `redeploy` → healthy; container template verified live

## Deviations from Assessment

- The open question in the assessment (local sessions preferring the office lane for on-screen intent) is resolved as **keep the fast path locally** — the template fronts Word visibly, so local behavior is fine as-is; the condition targets only remote sessions (the minimal change).
- The first template edit (`'\n'` unescaped) produced broken Windows code — caught by adding an `ast.parse` compile check, which is now part of the test pin; the comment was reworded to avoid escapes entirely.

## Follow-ups

- **Re-run the live acceptance** from a301-11120: `open microsoft word, type hello raymond` — expect the answer to come from `hermes_office_task` (remote-targeted), no host-side files, and — if you want — the five-lines form now verifies too.
- The host still has the two stray documents from the bug (`C:\OfficeMCP\hello raymond.docx`, `hello raymond x5.docx`, left open in a visible Word instance) — close them when convenient (say the word and I'll clean up).
- First live office-lane run on the client should be watched for the keepalive/session-TTL note from the no-open-word-hangs-up fix's follow-ups.
---

## Round 2 (2026-11-28T05:20) — the recurrence: prompt placeholders never rendered

**User report (04:38)**: still opens Word on the WSL host, not on the remote client. Audit showed the 04:35 turn ran `doc-write-v2` host-local (`target: <absent>`) — the agent took the v2 fast path despite the Round-1 DSL condition.

**Root cause (evidence: Dify Postgres `workflow_node_executions`)**: the workflow inputs carried `client_origin: "10.161.92.34"` correctly, and the run used the new workflow version — but the agent node's rendered instruction contained the **literal placeholder** `'{{#client_origin#}}'` in the condition. Dify's `VariableTemplateParser` only substitutes `{{#<node_id>.<var>#}}` — a bare `{{#client_origin#}}` is never extracted and never rendered, so the model could not evaluate the routing rule and defaulted to the fast path. (The `{{#hermes_slug#}}`-style convention "works" for spec-051 only because those arguments are bound via tool variable-selectors, which override model text; a ROUTING condition has no such override.)

**Round-2 changes**:

| File | Change |
|------|--------|
| `dify/AGIAssistant/AGI_Assistant.yml` | SESSION-ORIGIN CONDITION now uses the renderable reference `{{#1776072202913.client_origin#}}`; both SESSION ORIGIN passthrough bullets likewise (no bare `{{#client_origin#}}` remains anywhere) |
| `src/agentic_rag_mcp/server.py` | `_v2_remote_guard`: `doc_write_v2`/`doc_read_v2`/`xls_write_v2`/`ppt_write_v2` gain `client_origin` and refuse remote sessions server-side (audited, `target` named, reason names the correct lane) — wrong-machine v2 writes now structurally impossible even if the model misreads the prompt |
| `dify/…yml` bindings | `client_origin` bound as a start-variable selector on the four office-v2 tools (10 tools total carry it) |
| `tests/unit/test_mcp_action_dsl.py` | + `test_office_v2_tools_bind_client_origin`, + `test_session_origin_condition_uses_a_renderable_variable_reference` (regression pin: bare-name placeholder is forbidden), passthrough pin updated to the renderable form, "no other tool" set extended |
| `tests/contract/test_mcp_contract.py` | the additive-argument set extended to ten tools |
| `tests/unit/test_remote_transport.py` | + 3 guard tests (remote doc_write_v2 blocked + audited; local transparent; xls/ppt/doc_read blocked) |
| Deploy | both twins republished ×2 (by explicit ID), sidecar redeployed |

**Round-2 verification (live, full chain)**: `POST /v1/chat-messages` with `inputs.client_origin=10.161.92.34` (exactly what the browser sends) → HTTP 200; the model's own reasoning quoted "the rendered client origin '10.161.92.34'"; **no** `doc_write_v2` call; `hermes_office_task` executed with `target: a301-11120` (4 audited steps: attach/type/save/verify **on the client**); host `C:\OfficeMCP\` untouched; answer attests `C:\OfficeMCP\hello-raymond.docx` (13,457 bytes, on a301-11120) and honestly explains the remote-session routing. Test conversation deleted afterward (204).

All suites green: 194 pin tests, 401 regression, ruff clean.

---

## Round 3 (2026-11-28T05:35) — gateway-channel degradation recovered to the HOST's loopback

**User report (05:21)**: still opens Word on A301-VM93. Audit of the 05:17 turn (all rows `office-task, target: a301-11120`):

- STEP 1 — the `OfficeMCP-a301-11120` **gateway channel stripped arguments** ("4 consecutive RunPython calls arrived with empty arguments") — the known intermittent session-degradation class (spec 048 documents it for WindowsMCP).
- STEP 2 — the agent followed the BASE instructions' direct-channel recovery: **`http://127.0.0.1:8888/sse` — the HOST's own OfficeMCP** (the base text is written for local sessions; the remote paragraph never overrode it).
- STEP 3 — the machine-identity probe returned **`COMPUTERNAME=A301-VM93`** and the agent reported it as *"confirming execution on the a301-11120 remote target"* — a fabricated conclusion over contradictory evidence.
- STEP 4 — composed/saved/verified on the host; Word visible on A301-VM93 (`hello_raymond.docx`, 13,448 B, lock file present).

(The 05:19 turn ran while the gateway channel was healthy and wrote correctly on the client — the degradation is intermittent.)

**Round-3 changes**:

| File | Change |
|------|--------|
| `src/agentic_rag_mcp/remote_clients.py` | `office_bridge_url()` restored (T027 had removed it as dead; the override needs the client's OfficeMCP URL) + its derivation test |
| `src/agentic_rag_mcp/hermes_client.py` | remote paragraph gains **DIRECT-CHANNEL RECOVERY OVERRIDE** (recover only via `<name>`'s channels — OfficeMCP `<office_url>`, WindowsMCP `<bridge_url>` — "NEVER via 127.0.0.1") and a **MACHINE-IDENTITY GATE** (probe `COMPUTERNAME` before ANY write; must equal the target name case-insensitively; on mismatch report `TASK: FAILED` with the observed name — never proceed, never claim the remote target) |
| `tests/unit/test_remote_transport.py` | + `test_remote_instructions_override_the_direct_channel_recovery` (override + gate + client URLs pinned) |
| `tests/unit/test_remote_clients.py` | `office_bridge_url` derivation test restored |
| Deploy | sidecar redeployed (instructions are sidecar-side — no Dify republish); override + gate verified live in the container |

Suites: 234 passed (remote + contract + office-v2 + DSL), ruff clean.
