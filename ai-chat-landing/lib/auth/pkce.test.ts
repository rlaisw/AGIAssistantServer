import { describe, expect, it } from "vitest"

import { codeChallenge, createPreAuthSecrets, randomToken, timingSafeEqualStr } from "./pkce"

describe("pkce", () => {
  it("U1: S256 matches the RFC 7636 vector", () => {
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    )
  })

  it("U2: tokens are 32 random bytes as 43-character base64url and unique", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      const token = randomToken()
      expect(token).toHaveLength(43)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
      seen.add(token)
    }
    expect(seen.size).toBe(200)

    const secrets = createPreAuthSecrets()
    expect(secrets.state).toHaveLength(43)
    expect(secrets.nonce).toHaveLength(43)
    expect(secrets.codeChallenge).toBe(codeChallenge(secrets.codeVerifier))
  })

  it("U3: constant-time compare accepts equal values only", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true)
    expect(timingSafeEqualStr("abc", "abd")).toBe(false)
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false)
    expect(timingSafeEqualStr(null, "abc")).toBe(false)
    expect(timingSafeEqualStr("abc", undefined)).toBe(false)
  })
})
