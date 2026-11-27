# Contract: infographic proxy route

- `GET /infographics/p/<slug>/<id>/<asset…>` — 200 proxied bytes when session slug == URL slug, else 403
- `GET /infographics/<id>/<asset…>` — passthrough (local trust)
- No traversal; no listing; streaming passthrough with upstream status/content-type.
