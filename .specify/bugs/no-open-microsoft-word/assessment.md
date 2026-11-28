# Bug Assessment: "open microsoft word" from the remote client writes to the host and never opens Word there

- **Slug**: `no-open-microsoft-word`
- **Created**: 2026-11-28T04:15:00Z
- **Source**: pasted text (user report + the relay agent's answer transcript from the remote-client T020 run)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

User: "no open microsoft word, i typed open microsoft word" — typed the SC-001 acceptance prompt `open microsoft word, type hello raymond` from the registered remote client (a301-11120). No Word window appeared on the client.

The pasted agent transcript shows the routing: the agent classified the prompt as a "Word document task — writing literal text" per the v2 fast-path rule and called `doc_write_v2` (five lines of "hello raymond"). Attempt 1 returned `error:office-v2 verification failed — the saved document does not contain the literal text`; the agent retried with the phrase space-joined on one line → `ok`, file `C:\OfficeMCP\hello raymond x5.docx` (13,325 bytes, created new). The agent relayed all of this honestly and offered to redo it as five lines.

## Symptom

From the remote client, the acceptance prompt created its document (and a visible, fronted Word instance) **on the service host's desktop** instead of the client's — no Word window ever appears on the machine the user sits at. Expected (SC-001): Word opens on the requesting machine with the text typed.

## Reproduction

1. From a browser on a301-11120 (origin 10.161.92.34), send `open microsoft word, type hello raymond`.
2. Observe: no Word window on the client; answer reports a file at `C:\OfficeMCP\hello raymond x5.docx`.
3. Verify wrong machine: `/mnt/c/OfficeMCP/` on the WSL host contains `hello raymond x5.docx` (13,325 — matches the answer) **and** `hello raymond.docx` (13,418 — attempt 1's leftover), both timestamped 12:04 local / 04:04 UTC.
4. Audit trail (`audit.jsonl` 04:04:37 / 04:04:41): two `doc-write-v2` rows, `target: <absent>` — the lane ran host-local and does not even carry `client_origin`.

## Suspected Code Paths

- `dify/AGIAssistant/AGI_Assistant.yml` (agent routing prompt) — "Office tasks: SIMPLE literal WRITES — WORD (… 'open Word and type X') → `doc_write_v2(text, name?, conversation_id)` take the FAST single-hop path": the rule fires **unconditionally**, with no session-origin condition; on a remote session it routes the desktop-interaction phrasing into the host-local v2 engine.
- `src/agentic_rag_mcp/office_lanes/proxy.py` — `OfficeProxy.write_doc` + `_WRITE_TEMPLATE` (the Windows-side engine): `word.Visible = True`, `Documents.Add()`, `Content.Text = d['text']`, `SaveAs2(path)` — runs where OfficeMCP lives, i.e. the **host**; the tool signature has no `client_origin` (spec-053 decision ⑦ kept the v2 lanes out of remote scope).
- `src/agentic_rag_mcp/office_lanes/proxy.py` `_WRITE_TEMPLATE` verification line — `ok = d['text'].strip() in doc.Content.Text.strip()`: Word COM returns paragraph marks as `\r`, the agent sent `\n`-joined text → containment check fails for **any multi-line literal** → attempt 1's spurious error.
- `src/agentic_rag_mcp/office_lanes/proxy.py` `write_doc` error path — on `text_ok: false` returns only "verification failed"; the template has already written and left the document open+visible, and the envelope does not disclose it.

## Root Cause Hypothesis

Three stacked defects, all evidenced:

- **A (the complaint — wrong machine)**: the DSL v2 fast-path routing rule matches "open Word and type X" with no session-origin awareness, and the office-v2 lanes are deliberately outside spec-053's remote scope (decision ⑦). So a remote session's acceptance prompt executes the whole visible-Word flow on the host. This is the exact wrong-machine defect class spec 053 eliminated for the six tools, resurfacing through an un-targeted lane.
- **B (spurious verification error)**: the write template compares the literal against `doc.Content.Text` without newline normalization (`\n` vs Word's `\r`), so every multi-line literal write "fails" and pushes the agent into degraded rewrites (space-joined single line).
- **C (partial-write disclosure)**: verification runs after `SaveAs2`, so the failed attempt left `hello raymond.docx` written and open on the host, undisclosed by the tool's error envelope ("Nothing was written" in the agent's answer was inferred from that envelope and is false).

Confidence: **high** (host filesystem artifacts + audit rows + template code all read directly).

## Proposed Remediation

**Preferred** (minimal, matches the proven pattern):

1. **A**: amend the DSL routing rule — the office-v2 fast path (`doc_write_v2`/`xls_write_v2`/`ppt_write_v2`/`doc_read_v2`) applies **only when `{{#client_origin#}}` is empty** (local-desktop session); a session whose `client_origin` is set routes "open Word/Excel/PowerPoint and type X" to `hermes_office_task` with the full task text — that lane is remote-targeted (per-client `OfficeMCP-<name>` tools, the no-open-word-hangs-up fix) and drives the app on the requesting machine. Publish both twins by explicit ID.
2. **B**: normalize the comparison in `_WRITE_TEMPLATE` — `ok = d['text'].strip().replace('\n', '\r') in doc.Content.Text.strip()` (both paragraphs-as-`\r`) so multi-line literals verify.
3. **C**: on `text_ok: false`, disclose the partial write in the error envelope — the file was saved at `<path>` (existed: `<existed>`) and left open; the current "nothing was written" inference must be impossible.

**Alternatives**:

- Extend remote targeting INTO the office-v2 lanes (spec addendum: `doc_write_v2` gains `client_origin`, the proxy targets the client's OfficeMCP) — the complete fix but a spec-053 scope change; revisit only if v2-speed matters remotely (the office lane is slower).
- For C, alternatively close-and-delete the unverified file on failure — but honest disclosure beats silent cleanup when the user may want the file.

**Files likely to change**:

- `dify/AGIAssistant/AGI_Assistant.yml` (routing rule, both prompt copies)
- `src/agentic_rag_mcp/office_lanes/proxy.py` (`_WRITE_TEMPLATE` normalization; `write_doc` error envelope)
- `tests/unit/test_office_v2.py`, `tests/unit/test_mcp_action_dsl.py` (pins below)

**Tests to add or update**:

- v2 verification: a multi-line `text` payload verifies `text_ok: true` after `\n`→`\r` normalization (unit, mocked RunPython payload).
- v2 error envelope: `text_ok: false` discloses path/existed/open state.
- DSL contract: the v2 fast-path sentence is conditioned on empty `client_origin` (routing amendment), in both prompt copies.

## Risks & Considerations

- The DSL amendment changes routing for remote sessions only; local sessions keep the fast path byte-for-byte — regression risk is low but the prompt edit must be published to BOTH twins (explicit IDs, never name-based).
- The office lane from the client runs the agent with per-client OfficeMCP tools — first live Office-lane run on a301-11120 is still pending (T020); the multi-step office flow there may be slower than the v2 single hop.
- The host currently has stray Word windows/docs open from this bug (both `hello raymond*.docx` were created there, visible+fronted by the template) — the owner should close them.
- B's normalization must not mask genuine content mismatches (only line-ending equivalence, `strip()` + `\n`→`\r`).

## Open Questions

- [NEEDS CLARIFICATION: whether "open Word and type X" from a local session should ALSO prefer the office lane over the v2 fast path when the user's intent is "see it on screen" — the v2 engine does front Word visibly (template line), so local behavior is arguably fine as-is; confirm with the owner.]