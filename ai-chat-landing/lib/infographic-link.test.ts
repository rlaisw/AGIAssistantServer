// Spec 052 U1–U4: URL builders and legacy rewrite
import { describe, expect, it } from "vitest"
import { infographicHref, rewriteLegacyInfographicUrl, infographicId, validProfileSlug, isInfographicLink } from "./infographic-link"

describe("infographic link helpers (spec 052)", () => {
  it("U1: profiled form carries the slug", () => {
    expect(infographicHref("http://localhost:28080/infographics/4cafe75efa03/", "raymond-lai-tvb-com-hk"))
      .toBe("/infographics/p/raymond-lai-tvb-com-hk/4cafe75efa03/")
  })
  it("U2: no slug → plain form", () => {
    expect(infographicHref("/infographics/4cafe75efa03/", null)).toBe("/infographics/4cafe75efa03/")
  })
  it("U3: legacy loopback rewritten to same-origin", () => {
    expect(rewriteLegacyInfographicUrl("http://localhost:28080/infographics/4cafe75efa03/"))
      .toBe("/infographics/4cafe75efa03/")
  })
  it("U4: non-infographic URL untouched", () => {
    expect(rewriteLegacyInfographicUrl("https://docs.example/x")).toBe("https://docs.example/x")
    expect(isInfographicLink("https://docs.example/x")).toBe(false)
  })
  it("slug grammar and id extraction", () => {
    expect(validProfileSlug("raymond-lai-tvb-com-hk")).toBe(true)
    expect(validProfileSlug("Bad_Slug")).toBe(false)
    expect(infographicId("/infographics/p/x/4cafe75efa03/")).toBe("4cafe75efa03")
    expect(infographicId("/infographics/4cafe75efa03/")).toBe("4cafe75efa03")
  })
})

// bug wrong-infographics-url: the model fabricated a host wrapping the
// tool's relative URL; every infographic href must be rebuilt same-origin
describe("fabricated-host infographic links (bug wrong-infographics-url)", () => {
  it("strips a fabricated host and keeps the profiled path", () => {
    expect(infographicHref("https://infographics.local/infographics/p/raymond-lai-tvb-com-hk/0ef874ea67fc/", null))
      .toBe("/infographics/p/raymond-lai-tvb-com-hk/0ef874ea67fc/")
  })
  it("fabricated host, plain form → same-origin plain path", () => {
    expect(infographicHref("https://infographics.local/infographics/0ef874ea67fc/", null))
      .toBe("/infographics/0ef874ea67fc/")
  })
  it("session slug wins over the URL's slug", () => {
    expect(infographicHref("https://infographics.local/infographics/p/other-user/0ef874ea67fc/", "raymond-lai-tvb-com-hk"))
      .toBe("/infographics/p/raymond-lai-tvb-com-hk/0ef874ea67fc/")
  })
  it("asset suffix preserved", () => {
    expect(infographicHref("https://x.evil/infographics/0ef874ea67fc/img.js", null))
      .toBe("/infographics/0ef874ea67fc/img.js")
  })
})
