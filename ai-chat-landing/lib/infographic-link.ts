// Infographic notification-link styling (spec 046): target-based detection and
// a single renderer-owned pin. The label itself is never rewritten.
// Spec 052: links are same-origin, profiled for signed-in users, and legacy
// loopback URLs from old answers are rewritten to the same-origin form.
const INFOGRAPHIC_URL = "/infographics/"
const LEGACY_LOOPBACK = /^https?:\/\/localhost:28080\/infographics\//
const SLUG_SHAPE = /^[a-z0-9-]+$/

export function isInfographicLink(href: string | undefined): boolean {
  return typeof href === "string" && href.includes(INFOGRAPHIC_URL)
}

// E3: if the model emits its own leading pin, remove it once so the renderer's
// pin is the only one. A pin anywhere else in the label is content, not a prefix.
export function infographicDisplayLabel(text: string): string {
  return text.replace(new RegExp(`^\\s*📌\\s*`), "")
}

// spec 052 U1/U2: the URL form for a request — profiled when a slug is known.
// bug wrong-infographics-url: the model may fabricate a host (e.g.
// https://infographics.local/...) when wrapping the tool's relative URL in a
// markdown link — always rebuild infographic hrefs from the /infographics/
// path so the link is same-origin no matter what host the text carried.
export function infographicHref(href: string | undefined, slug: string | null): string {
  const target = href ?? ""
  const m = target.match(/\/infographics\/(?:p\/([a-z0-9-]+)\/)?([0-9a-f]{10,})([^?#]*)/)
  if (!m) return rewriteLegacyInfographicUrl(target)
  const owner = slug ?? m[1] ?? null
  const suffix = m[3] ?? ""
  const id = m[2]
  return owner ? `/infographics/p/${owner}/${id}${suffix}` : `/infographics/${id}${suffix}`
}

// spec 052 U3: old answers embed loopback URLs — rewrite to same-origin.
export function rewriteLegacyInfographicUrl(href: string): string {
  return href.replace(LEGACY_LOOPBACK, INFOGRAPHIC_URL)
}

export function infographicId(href: string): string | null {
  const m = href.match(/\/infographics\/(?:p\/([a-z0-9-]+)\/)?([0-9a-f]{10,})\//)
  return m ? m[2] : null
}

export function validProfileSlug(slug: string): boolean {
  return SLUG_SHAPE.test(slug)
}
