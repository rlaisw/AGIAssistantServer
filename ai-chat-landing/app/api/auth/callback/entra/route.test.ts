import { describe, expect, it } from "vitest"

import { GET } from "./route"
import { resetStoreForTests } from "@/lib/auth/session-store"
import { resetAuthCaches } from "@/lib/auth/testing/reset"
import { cookiePair, getSession, runSignin, startSignin } from "@/tests/support/flow"
import {
  TEST_ORIGIN,
  applyTestEnv,
  startFakeIdp,
  type FakeIdpOptions,
} from "@/tests/support/fake-idp"

async function withIdp<T>(opts: FakeIdpOptions, fn: () => Promise<T>): Promise<T> {
  const idp = await startFakeIdp(opts)
  try {
    resetAuthCaches()
    resetStoreForTests()
    applyTestEnv(idp)
    return await fn()
  } finally {
    await idp.close()
  }
}

describe("GET /api/auth/callback/entra (I1–I10)", () => {
  it("I1: completes the flow, sets an opaque session, and clears the pre-auth cookie", async () => {
    await withIdp({}, async () => {
      const { callback } = await runSignin("returnTo=/chat")
      expect(callback!.status).toBe(302)
      expect(callback!.headers.get("location")).toBe(`${TEST_ORIGIN}/chat`)

      const cookies = callback!.headers.getSetCookie()
      const session = cookies.find((c) => c.startsWith("hermes_session="))
      expect(session).toContain("HttpOnly")
      expect(session).not.toContain("Secure")
      expect(cookies.find((c) => c.startsWith("hermes_auth="))).toContain("Max-Age=0")

      const res = await getSession(cookiePair(callback!, "hermes_session"))
      expect(res.status).toBe(200)
      expect(res.headers.get("cache-control")).toBe("no-store")
      const body = (await res.json()) as {
        authenticated: boolean
        user?: { displayName: string; email: string }
        expiresAt?: string
      }
      expect(body.authenticated).toBe(true)
      expect(body.user).toEqual({ displayName: "Alice Chen", email: "alice.chen@contoso.com" })
      expect(body).not.toHaveProperty("oid")
      expect(body.user).not.toHaveProperty("oid")
      expect(Date.parse(body.expiresAt!)).toBeGreaterThan(Date.now())
    })
  })

  it("I2/I3: rejects a missing state and a replayed callback without redeeming twice", async () => {
    await withIdp({}, async () => {
      const start = await startSignin()
      const authorize = start.headers.get("location")!
      const preauth = cookiePair(start, "hermes_auth")!
      const idpResponse = await fetch(authorize, { redirect: "manual" })
      const target = new URL(idpResponse.headers.get("location")!)
      const callbackUrl = `${TEST_ORIGIN}/api/auth/callback/entra?code=${target.searchParams.get("code")}&state=${target.searchParams.get("state")}`
      const headers = { headers: { cookie: preauth } }

      const first = await GET(new Request(callbackUrl, headers))
      expect(first.status).toBe(302)
      expect(first.headers.get("location")).toBe(`${TEST_ORIGIN}/`)

      const replay = await GET(new Request(callbackUrl, headers))
      expect(replay.status).toBe(302)
      expect(replay.headers.get("location")).toBe(`${TEST_ORIGIN}/?auth_error=invalid_state`)
      const cleared = replay.headers.getSetCookie().find((c) => c.startsWith("hermes_session="))
      expect(cleared).toContain("Max-Age=0")
    })
  })

  it("H1: sends a callback configuration failure to the honest banner", async () => {
    await withIdp({}, async () => {
      const saved = process.env.ENTRA_CLIENT_ID
      Reflect.deleteProperty(process.env, "ENTRA_CLIENT_ID")
      try {
        const res = await GET(new Request(`${TEST_ORIGIN}/api/auth/callback/entra?code=x&state=y`))
        expect(res.status).toBe(302)
        expect(res.headers.get("location")).toBe(`${TEST_ORIGIN}/?auth_error=config_invalid`)
      } finally {
        process.env.ENTRA_CLIENT_ID = saved
      }
    })
  })

  it("H4: rejects a callback without a pre-auth cookie", async () => {
    await withIdp({}, async () => {
      const res = await GET(
        new Request(`${TEST_ORIGIN}/api/auth/callback/entra?code=x&state=y`),
      )
      expect(res.headers.get("location")).toBe(`${TEST_ORIGIN}/?auth_error=invalid_state`)
    })
  })

  it("H3: maps an access_denied response to signin_cancelled", async () => {
    await withIdp({}, async () => {
      const res = await GET(
        new Request(`${TEST_ORIGIN}/api/auth/callback/entra?error=access_denied`),
      )
      expect(res.headers.get("location")).toBe(`${TEST_ORIGIN}/?auth_error=signin_cancelled`)
    })
  })

  it("H5: maps a rejected code redemption to signin_failed", async () => {
    await withIdp({ tokenFails: true }, async () => {
      const { callback } = await runSignin()
      expect(callback!.headers.get("location")).toBe(`${TEST_ORIGIN}/?auth_error=signin_failed`)
      const cleared = callback!.headers.getSetCookie().find((c) => c.startsWith("hermes_session="))
      expect(cleared).toContain("Max-Age=0")
    })
  })

  it("H10: rejects a guest from another tenant", async () => {
    await withIdp({ overrides: { tid: "99999999-9999-9999-9999-999999999999" } }, async () => {
      const { callback } = await runSignin()
      expect(callback!.headers.get("location")).toBe(`${TEST_ORIGIN}/?auth_error=tenant_not_allowed`)
    })
  })

  it("H8: rejects a token without oid", async () => {
    await withIdp({ omit: ["oid"] }, async () => {
      const { callback } = await runSignin()
      expect(callback!.headers.get("location")).toBe(`${TEST_ORIGIN}/?auth_error=identity_incomplete`)
    })
  })

  it("I8: falls back to preferred_username when email is absent", async () => {
    await withIdp(
      { omit: ["email"], overrides: { preferred_username: "alias@contoso.com" } },
      async () => {
        const { callback } = await runSignin()
        expect(callback!.status).toBe(302)
        const res = await getSession(cookiePair(callback!, "hermes_session"))
        const body = (await res.json()) as { user?: { email: string } }
        expect(body.user?.email).toBe("alias@contoso.com")
      },
    )
  })

  it("H9: rejects a token with neither email nor sign-in name", async () => {
    await withIdp({ omit: ["email", "preferred_username"] }, async () => {
      const { callback } = await runSignin()
      expect(callback!.headers.get("location")).toBe(`${TEST_ORIGIN}/?auth_error=identity_incomplete`)
    })
  })

  it("H7: rejects a nonce mismatch", async () => {
    await withIdp({ overrides: { nonce: "other-nonce" } }, async () => {
      const { callback } = await runSignin()
      expect(callback!.headers.get("location")).toBe(`${TEST_ORIGIN}/?auth_error=token_invalid`)
    })
  })

  it("H6: rejects an expired identity token", async () => {
    await withIdp({ expiresIn: "-10m" }, async () => {
      const { callback } = await runSignin()
      expect(callback!.headers.get("location")).toBe(`${TEST_ORIGIN}/?auth_error=token_invalid`)
    })
  })
})
