import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { POST } from "./route"
import { AuthStore, resetStoreForTests } from "@/lib/auth/session-store"
import { resetAuthCaches } from "@/lib/auth/testing/reset"
import { cookiePair, runSignin } from "@/tests/support/flow"
import {
  TEST_ORIGIN,
  applyTestEnv,
  startFakeIdp,
  type FakeIdp,
} from "@/tests/support/fake-idp"

let idp: FakeIdp

beforeAll(async () => {
  idp = await startFakeIdp()
})

afterAll(async () => {
  await idp.close()
})

function signout(cookie?: string | null, headers: Record<string, string> = {}) {
  return POST(
    new Request(`${TEST_ORIGIN}/api/auth/signout`, {
      method: "POST",
      headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}), ...headers },
    }),
  )
}

describe("POST /api/auth/signout (I11–I12, I17)", () => {
  it("clears the session, both cookies, and returns the tenant end-session URL", async () => {
    resetAuthCaches()
    resetStoreForTests()
    applyTestEnv(idp)
    const { callback } = await runSignin()
    const pair = cookiePair(callback!, "hermes_session")!

    const res = await signout(pair)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; endSessionUrl?: string }
    expect(body.ok).toBe(true)
    expect(body.endSessionUrl).toContain("/logout")
    expect(body.endSessionUrl).toContain("post_logout_redirect_uri")

    const cleared = res.headers.getSetCookie()
    expect(cleared.find((c) => c.startsWith("hermes_session="))).toContain("Max-Age=0")
    expect(cleared.find((c) => c.startsWith("hermes_auth="))).toContain("Max-Age=0")
  })

  it("is idempotent and succeeds without a session", async () => {
    resetAuthCaches()
    resetStoreForTests()
    applyTestEnv(idp)
    const res = await signout(null)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it("I17: rejects cross-site sign-out with 403", async () => {
    resetAuthCaches()
    resetStoreForTests()
    applyTestEnv(idp)
    const res = await signout(null, { "sec-fetch-site": "cross-site" })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "invalid_request" })
  })

  it("I12: local sign-out succeeds when the tenant end-session endpoint is unavailable", async () => {
    const down = await startFakeIdp({ discoveryFails: true })
    try {
      resetAuthCaches()
      applyTestEnv(down)
      const store = new AuthStore()
      resetStoreForTests(store)
      const session = store.createSession({
        oid: "11111111-1111-1111-1111-111111111111",
        tid: "22222222-2222-2222-2222-222222222222",
        email: "alice.chen@contoso.com",
        emailSource: "email",
        displayName: "Alice Chen",
        signedInAt: new Date().toISOString(),
      })
      const res = await signout(`hermes_session=${session.handle}`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    } finally {
      await down.close()
    }
  })
})
