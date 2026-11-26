import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthConfig } from "./config"
import type { Identity } from "./claims"
import { maybeRenew, needsRenewal } from "./renew"
import { AuthStore } from "./session-store"
import { resetAuthCaches } from "./testing/reset"
import { spyOnAuthLog } from "./testing/log-spy"

const identity: Identity = {
  oid: "11111111-1111-1111-1111-111111111111",
  tid: "22222222-2222-2222-2222-222222222222",
  email: "alice.chen@contoso.com",
  emailSource: "email",
  displayName: "Alice Chen",
  signedInAt: new Date(0).toISOString(),
}

const cfg: AuthConfig = {
  tenantId: "22222222-2222-2222-2222-222222222222",
  clientId: "33333333-3333-3333-3333-333333333333",
  clientSecret: "secret",
  redirectUri: "http://localhost:3000/api/auth/callback/entra",
  scopes: "openid profile email offline_access",
  issuer: "https://login.microsoftonline.com/22222222-2222-2222-2222-222222222222/v2.0",
  discoveryUrl: "http://idp.test/.well-known/openid-configuration",
  cookieSecure: false,
  cookiePrefix: "",
}

function discoveryResponse() {
  return new Response(
    JSON.stringify({
      issuer: cfg.issuer,
      authorization_endpoint: "http://idp.test/authorize",
      token_endpoint: "http://idp.test/token",
      jwks_uri: "http://idp.test/jwks",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

function tokenResponse(ok = true) {
  return new Response(JSON.stringify({ access_token: "new", expires_in: 3600 }), {
    status: ok ? 200 : 400,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  resetAuthCaches()
})

describe("renewal (U16 / SC-005)", () => {
  it("skips renewal when the access token is fresh or no refresh token exists", () => {
    const now = 1_000_000
    const store = new AuthStore({ now: () => now })
    const fresh = store.createSession(identity, {
      refreshToken: "r",
      accessTokenExpiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    })
    expect(needsRenewal(fresh, now)).toBe(false)

    const noRefresh = store.createSession(identity, {
      accessTokenExpiresAt: new Date(now + 1000).toISOString(),
    })
    expect(needsRenewal(noRefresh, now)).toBe(false)
  })

  it("renews within five minutes of expiry and updates the stored expiry", async () => {
    const now = 1_000_000
    const store = new AuthStore({ now: () => now })
    const session = store.createSession(identity, {
      refreshToken: "r",
      accessTokenExpiresAt: new Date(now + 1000).toISOString(),
    })
    expect(needsRenewal(session, now)).toBe(true)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(tokenResponse(true))
    const spy = spyOnAuthLog()
    const renewed = await maybeRenew(session, cfg, store, { fetch: fetchMock, now: () => now }).finally(() =>
      spy.restore(),
    )
    expect(renewed).not.toBeNull()
    expect(Date.parse(renewed!.tokens.accessTokenExpiresAt!)).toBeGreaterThan(now + 3_000_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // the 12-hour absolute cap is never extended by renewal
    expect(renewed!.absoluteExpiresAt).toBe(session.absoluteExpiresAt)
    expect(spy.text()).toContain('"renewal"')
    expect(spy.text()).not.toContain("access-token")
  })

  it("tolerates one failed renewal and ends the session on the second", async () => {
    const now = 1_000_000
    const store = new AuthStore({ now: () => now })
    const session = store.createSession(identity, {
      refreshToken: "r",
      accessTokenExpiresAt: new Date(now).toISOString(),
    })
    const failing = vi
      .fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(tokenResponse(false))

    const first = await maybeRenew(session, cfg, store, { fetch: failing, now: () => now })
    expect(first).not.toBeNull()
    expect(first!.renewal.consecutiveFailures).toBe(1)

    const second = await maybeRenew(first!, cfg, store, {
      fetch: vi.fn().mockResolvedValue(tokenResponse(false)),
      now: () => now,
    })
    expect(second).toBeNull()
  })
})
