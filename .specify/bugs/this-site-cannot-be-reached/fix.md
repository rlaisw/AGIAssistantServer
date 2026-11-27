# Bug Fix: Model-mangled infographic links — absolute URL emission with a configured public origin

- **Slug**: this-site-cannot-be-reached
- **Fixed**: 2026-11-27T10:45:00+08:00
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Third model-narration variant: given the tool's relative URL, the model fabricated host `infographics` and dropped the `/infographics/` prefix — a shape renderer hardening cannot catch. The tool now emits fully-qualified absolute URLs against a configured public origin (`INFOGRAPHIC_PUBLIC_ORIGIN=https://agia.tvb.com.hk`), giving the model a complete URL to copy verbatim; unset origin falls back to the relative form.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src/agentic_rag_mcp/config.py` | modified | new `infographic_public_origin` field, read from `INFOGRAPHIC_PUBLIC_ORIGIN`, validated at load (`https?://host` only, no path — malformed values raise) |
| `src/agentic_rag_mcp/antv/infographic.py` | modified | `create_infographic` prefixes `{origin}/` when set (profiled and plain forms); relative fallback unchanged; no leading-slash regression (empty prefix = `/`) |
| `src/agentic_rag_mcp/deploy/docker_ops.py` | modified | passes `INFOGRAPHIC_PUBLIC_ORIGIN` into the container at recreate |
| `dify/docker/mcp-server/Dockerfile` | modified | `ENV INFOGRAPHIC_PUBLIC_ORIGIN=https://agia.tvb.com.hk` baked as the durable default (overridable via `-e`) |
| `tests/unit/test_antv_tools.py` | added 2 tests | absolute emission (profiled + plain); malformed-origin config load raises |

## Diff Highlights

```python
origin = getattr(cfg, "infographic_public_origin", "")
prefix = f"{origin}/" if origin else "/"
return {"id": ..., "url": f"{prefix}infographics/{namespace}{infographic_id}/", ...}
```

## Tests Added or Updated

- `test_create_infographic_absolute_when_origin_configured` — `https://agia.tvb.com.hk/infographics/p/<slug>/<id>/` and plain form
- `test_create_infographic_origin_validation` — origin with a path fails config load

## Local Verification

- Commands: `pytest tests/unit -q` → 1373 passed; full frontend `pnpm test` → 330 passed; `pnpm typecheck` clean
- Live after redeploy: container env `INFOGRAPHIC_PUBLIC_ORIGIN=https://agia.tvb.com.hk`; tool emits `https://agia.tvb.com.hk/infographics/p/raymond-lai-tvb-com-hk/9b6151978f6d/` (profiled) and `https://agia.tvb.com.hk/infographics/4b2f04b19533/` (plain)
- Renderer: existing normalization keeps working — absolute URLs still rebuild same-origin at render (9/9 link tests green)

## Deviations from Assessment

None — the assessment's preferred remediation (absolute emission with configured origin) was applied exactly; validation-at-load and the Dockerfile default were anticipated in the assessment's Risks section.

## Follow-ups

- Ask the chat for a fresh infographic: the answer link should now be a complete `https://agia.tvb.com.hk/...` URL that opens directly.
- The two previously broken answers in history still carry their old fabricated links; new answers are fixed at the source.
