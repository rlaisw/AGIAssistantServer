# Data Model: Infographic remote access (spec 052)

No new persistent entities. The feature reuses existing entities and adds one derived mapping.

## Entities

### InfographicPage (existing, unchanged)
- Identifier: hex id (e.g. `4cafe75efa03`) — existing per-answer identifier
- Storage: unchanged on the infographic service side
- Constraint: identifier ↔ page mapping is 1:1 and stable (FR-003)

### ProfiledInfographicURL (new, derived)
- Shape: `/infographics/p/<slug>/<id>/…`
- `slug`: the requester's profile slug (spec 051 registry), validated by the serving route against the session identity
- `<id>`: the InfographicPage identifier
- Constraint: the slug in the URL MUST equal the requesting session's slug, else 403 (FR-007)

## Validation rules
- Slug in URL must match `[a-z0-9-]+` (slug grammar from spec 051)
- Identifier must match `[0-9a-f]{10,}`; unknown or malformed identifiers produce an honest 404/400, never a fabricated page
- The proxy never lists directories; it serves exactly the path requested (no traversal)

## State transitions
None — stateless request/response proxying.
