import { describe, expect, it } from "vitest"
import { assertSlug, baseSlugFor, collisionSlug, oidHash } from "./identity"

describe("identity (U1, U2)", () => {
  it("U1: oidHash is 16 hex chars, stable, and never the raw oid", () => {
    const oid = "11111111-1111-1111-1111-111111111111"
    expect(oidHash(oid)).toMatch(/^[0-9a-f]{16}$/)
    expect(oidHash(oid)).toBe(oidHash(oid))
    expect(oidHash(oid)).not.toContain("11111111")
  })

  it("U2: slug validation accepts valid slugs and rejects unsafe ones", () => {
    expect(assertSlug("peter-chan-tvb-com-hk")).toBe("peter-chan-tvb-com-hk")
    for (const bad of ["Peter", "a/b", "..", "", "-x", "x-", "a".repeat(65)]) {
      expect(() => assertSlug(bad)).toThrow()
    }
  })

  it("derives the full-FQDN base and a deterministic collision suffix", () => {
    expect(baseSlugFor("peter.chan@tvb.com.hk")).toBe("peter-chan-tvb-com-hk")
    expect(baseSlugFor("peter.chan@tvb.com.cn")).toBe("peter-chan-tvb-com-cn")
    const oid = "11111111-1111-1111-1111-111111111111"
    expect(collisionSlug("peter-chan-tvb-com-hk", oid)).toBe(
      collisionSlug("peter-chan-tvb-com-hk", oid),
    )
  })
})
