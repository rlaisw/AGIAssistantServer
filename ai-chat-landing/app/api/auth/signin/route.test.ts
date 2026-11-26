import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { GET } from "./route"
import { resetStoreForTests } from "@/lib/auth/session-store"
import { resetAuthCaches } from "@/lib/auth/testing/reset"
import { TEST_ORIGIN, applyTestEnv, startFakeIdp, type FakeIdp } from "@/tests/support/fake-idp"

let idp: FakeIdp

beforeAll(async () => {
  idp = await startFakeIdp()
})

afterAll(async () => {
  await idp.close()
})

describe("GET /api/auth/signin (I1)", () => {
  it("redirects to the tenant authorize endpoint with PKCE and a pre-auth cookie", async () => {
    resetAuthCaches()
    resetStoreForTests()
    applyTestEnv(idp)

    const res = await GET(new Request(`${TEST_ORIGIN}/api/auth/signin?returnTo=/chat`))
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get("location")!)
    expect(location.origin).toBe(idp.url)
    expect(location.pathname).toBe("/authorize")
    expect(location.searchParams.get("client_id")).toBe("33333333-3333-3333-3333-333333333333")
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/callback/entra",
    )
    expect(location.searchParams.get("scope")).toBe("openid profile email offline_access")
    expect(location.searchParams.get("response_type")).toBe("code")
    expect(location.searchParams.get("state")).toHaveLength(43)
    expect(location.searchParams.get("nonce")).toHaveLength(43)
    expect(location.searchParams.get("code_challenge_method")).toBe("S256")
    expect(location.searchParams.get("code_challenge")).toBeTruthy()

    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("hermes_auth="))
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("Max-Age=600")
    expect(cookie).not.toContain("Secure")
  })

  it("forwards prompt=select_account when asked", async () => {
    applyTestEnv(idp)
    const res = await GET(new Request(`${TEST_ORIGIN}/api/auth/signin?prompt=select_account`))
    expect(new URL(res.headers.get("location")!).searchParams.get("prompt")).toBe("select_account")
  })

  it("I15: sends the user to the honest banner without a cookie when discovery is unavailable", async () => {
    const down = await startFakeIdp({ discoveryFails: true })
    try {
      resetAuthCaches()
      applyTestEnv(down)
      const res = await GET(new Request(`${TEST_ORIGIN}/api/auth/signin`))
      expect(res.status).toBe(302)
      expect(res.headers.get("location")).toBe(`${TEST_ORIGIN}/?auth_error=idp_unavailable`)
      expect(res.headers.getSetCookie()).toHaveLength(0)
    } finally {
      await down.close()
    }
  })

  it("H1: sends the user to the honest banner when configuration is missing", async () => {
    applyTestEnv(idp)
    const saved = process.env.ENTRA_CLIENT_ID
    Reflect.deleteProperty(process.env, "ENTRA_CLIENT_ID")
    try {
      const res = await GET(new Request(`${TEST_ORIGIN}/api/auth/signin`))
      expect(res.status).toBe(302)
      expect(res.headers.get("location")).toBe(`${TEST_ORIGIN}/?auth_error=config_invalid`)
      expect(res.headers.getSetCookie()).toHaveLength(0)
    } finally {
      process.env.ENTRA_CLIENT_ID = saved
    }
  })
})
