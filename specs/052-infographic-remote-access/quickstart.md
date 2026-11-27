# Quickstart: Infographic remote access (spec 052)

## Prerequisites
- Stack running (sidecar + Chat UI), one Entra-signed-in user with a profile slug.

## Validate
1. New infographic: ask for one → the answer's infographic link is `/infographics/p/<slug>/<id>/`; click → page loads (from a remote machine too).
2. Cross-profile: paste user A's profiled URL into user B's session → 403.
3. Legacy: open an old answer → its `http://localhost:28080/infographics/...` link renders and loads same-origin.
4. Service-down: stop the infographic service → honest error page.

Expected: all above per test-plan.md.
