import { describe, expect, it } from "vitest"

import { collisionSuffix, deriveSlug, slugWithCollision } from "./slug"

describe("deriveSlug (U25 — full FQDN domain)", () => {
  it("keeps every domain label so tvb.com.hk, tvb.com.cn and tvb.com stay distinct", () => {
    expect(deriveSlug("peter.chan@tvb.com.hk")).toBe("peter-chan-tvb-com-hk")
    expect(deriveSlug("peter.chan@tvb.com.cn")).toBe("peter-chan-tvb-com-cn")
    expect(deriveSlug("peter.chan@tvb.com")).toBe("peter-chan-tvb-com")
    const slugs = new Set([
      deriveSlug("peter.chan@tvb.com.hk"),
      deriveSlug("peter.chan@tvb.com.cn"),
      deriveSlug("peter.chan@tvb.com"),
    ])
    expect(slugs.size).toBe(3)
  })

  it("normalizes case, dots and separators but never drops the domain", () => {
    expect(deriveSlug("Alice.Chen@Contoso.COM")).toBe("alice-chen-contoso-com")
    expect(deriveSlug("  Peter.Chan@TVB.COM.HK  ")).toBe("peter-chan-tvb-com-hk")
    expect(deriveSlug("peter+test@tvb.com.hk")).toBe("peter-test-tvb-com-hk")
    expect(deriveSlug("peter_chan@sub.tvb.com.hk")).toBe("peter-chan-sub-tvb-com-hk")
  })

  it("strips accents without changing the domain", () => {
    expect(deriveSlug("josé.ñ@tvb.com")).toBe("jose-n-tvb-com")
  })

  it("is deterministic and longer than a local-part-only slug", () => {
    expect(deriveSlug("peter.chan@tvb.com")).toBe(deriveSlug("peter.chan@tvb.com"))
    expect(deriveSlug("peter.chan@tvb.com")).not.toBe("peter-chan")
  })

  it("rejects malformed addresses instead of inventing a slug", () => {
    expect(() => deriveSlug("")).toThrow()
    expect(() => deriveSlug("no-at-sign")).toThrow()
    expect(() => deriveSlug("a@b@c")).toThrow()
    expect(() => deriveSlug("@tvb.com")).toThrow()
    expect(() => deriveSlug("peter@")).toThrow()
  })
})

describe("collision handling", () => {
  it("derives a stable 8-character suffix from the oid", () => {
    const oid = "11111111-1111-1111-1111-111111111111"
    expect(collisionSuffix(oid)).toMatch(/^[0-9a-f]{8}$/)
    expect(collisionSuffix(oid)).toBe(collisionSuffix(oid.toUpperCase()))
    expect(collisionSuffix(oid)).not.toBe(collisionSuffix("22222222-2222-2222-2222-222222222222"))
  })

  it("appends the suffix only when asked", () => {
    const oid = "11111111-1111-1111-1111-111111111111"
    expect(slugWithCollision("peter.chan@tvb.com", oid)).toBe(
      `peter-chan-tvb-com-${collisionSuffix(oid)}`,
    )
  })

  it("refuses an empty oid", () => {
    expect(() => collisionSuffix("  ")).toThrow()
  })
})
