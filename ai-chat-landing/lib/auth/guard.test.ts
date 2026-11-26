import { describe, expect, it } from "vitest"

import type { AuthConfig } from "./config"
import type { Identity } from "./claims"
import { getIdentity, requireIdentity } from "./guard"
import { AuthStore } from "./session-store"

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
  discoveryUrl: "http://localhost/discovery",
  cookieSecure: false,
  cookiePrefix: "",
}

function requestWith(handle?: string): Request {
  return new Request("http://localhost:3000/api/chat", {
    headers: handle ? { cookie: `hermes_session=${handle}` } : {},
  })
}

describe("guard (U21 / I14)", () => {
  it("returns the identity for an active session", () => {
    let now = 0
    const store = new AuthStore({ now: () => now })
    const session = store.createSession(identity)
    now = 1000
    expect(getIdentity(requestWith(session.handle), cfg, store)?.oid).toBe(identity.oid)
    const guard = requireIdentity(requestWith(session.handle), cfg, store)
    expect(guard.ok).toBe(true)
    if (guard.ok) expect(guard.identity.email).toBe(identity.email)
  })

  it("returns 401 signin_required without a valid session", () => {
    const store = new AuthStore({ now: () => 0 })
    expect(getIdentity(requestWith(), cfg, store)).toBeNull()
    expect(requireIdentity(requestWith(), cfg, store)).toEqual({
      ok: false,
      status: 401,
      code: "signin_required",
    })
    expect(requireIdentity(requestWith("unknown"), cfg, store).ok).toBe(false)
  })

  it("treats an expired session as anonymous", () => {
    let now = 0
    const store = new AuthStore({ now: () => now })
    const session = store.createSession(identity)
    now = 13 * 60 * 60 * 1000
    expect(requireIdentity(requestWith(session.handle), cfg, store).ok).toBe(false)
  })
})
