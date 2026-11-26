import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { resetStoreForTests } from "@/lib/auth/session-store"
import { resetAuthCaches } from "@/lib/auth/testing/reset"
import { cookiePair, getSession, runSignin } from "@/tests/support/flow"
import { applyTestEnv, startFakeIdp, type FakeIdp } from "@/tests/support/fake-idp"

let idp: FakeIdp

beforeAll(async () => {
  idp = await startFakeIdp()
})

afterAll(async () => {
  await idp.close()
})

describe("GET /api/auth/session", () => {
  it("reports anonymous without a session", async () => {
    resetAuthCaches()
    resetStoreForTests()
    applyTestEnv(idp)
    const res = await getSession(null)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authenticated: false })
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("reports the signed-in user without exposing oid or tokens", async () => {
    resetAuthCaches()
    resetStoreForTests()
    applyTestEnv(idp)
    const { callback } = await runSignin()
    const res = await getSession(cookiePair(callback!, "hermes_session"))
    const body = (await res.json()) as { authenticated: boolean; user: Record<string, unknown> }
    expect(body.authenticated).toBe(true)
    expect(Object.keys(body.user).sort()).toEqual(["displayName", "email"])
  })

  it("treats an unknown handle as anonymous and clears the cookie", async () => {
    resetAuthCaches()
    resetStoreForTests()
    applyTestEnv(idp)
    const res = await getSession("hermes_session=unknown-handle")
    expect(await res.json()).toEqual({ authenticated: false })
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith("hermes_session="))
    expect(cleared).toContain("Max-Age=0")
  })
})
