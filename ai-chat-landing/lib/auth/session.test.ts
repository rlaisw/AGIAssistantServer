import { describe, expect, it } from "vitest"

import type { AuthConfig } from "./config"
import {
  clearCookie,
  cookieNames,
  externalOrigin,
  isSameOrigin,
  jsonResponse,
  readCookie,
  redirectResponse,
  serializeCookie,
} from "./session"

function cfg(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    tenantId: "22222222-2222-2222-2222-222222222222",
    clientId: "33333333-3333-3333-3333-333333333333",
    clientSecret: "secret",
    redirectUri: "http://localhost:3000/api/auth/callback/entra",
    scopes: "openid profile email offline_access",
    issuer: "https://login.microsoftonline.com/22222222-2222-2222-2222-222222222222/v2.0",
    discoveryUrl: "http://localhost/.well-known/openid-configuration",
    cookieSecure: true,
    cookiePrefix: "__Host-",
    ...overrides,
  }
}

describe("cookies (U18)", () => {
  it("uses __Host- names and Secure flags in production mode", () => {
    const names = cookieNames(cfg())
    expect(names.session).toBe("__Host-hermes_session")
    expect(names.preauth).toBe("__Host-hermes_auth")
    const cookie = serializeCookie(names.session, "handle", cfg(), 600)
    expect(cookie).toContain("__Host-hermes_session=handle")
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")
    expect(cookie).toContain("Path=/")
    expect(cookie).toContain("Secure")
    expect(cookie).toContain("Max-Age=600")
  })

  it("uses plain names and no Secure flag in local development", () => {
    const local = cfg({ cookieSecure: false, cookiePrefix: "" })
    const names = cookieNames(local)
    expect(names.session).toBe("hermes_session")
    const cookie = serializeCookie(names.session, "h", local)
    expect(cookie).not.toContain("Secure")
  })

  it("clears with Max-Age=0", () => {
    expect(clearCookie("hermes_session", cfg({ cookiePrefix: "" }))).toContain("Max-Age=0")
  })

  it("reads the requested cookie only", () => {
    const req = new Request("http://localhost:3000/", {
      headers: { cookie: "a=1; hermes_session=abc%2Fdef; b=2" },
    })
    expect(readCookie(req, "hermes_session")).toBe("abc/def")
    expect(readCookie(req, "missing")).toBeNull()
  })

  it("builds redirects and JSON with cookies and no-store", () => {
    const redirect = redirectResponse("http://localhost:3000/x", ["a=b"])
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get("location")).toBe("http://localhost:3000/x")
    expect(redirect.headers.get("set-cookie")).toContain("a=b")
    expect(redirect.headers.get("cache-control")).toBe("no-store")

    const json = jsonResponse({ ok: true }, 200, ["a=b"])
    expect(json.status).toBe(200)
    expect(json.headers.get("content-type")).toContain("application/json")
  })
})

describe("proxy-aware origin (behind nginx)", () => {
  it("reports the public https origin from forwarded headers", () => {
    const req = new Request("http://172.21.0.1:3000/api/auth/signin", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "agia.tvb.com.hk" },
    })
    expect(externalOrigin(req)).toBe("https://agia.tvb.com.hk")
    expect(externalOrigin(new Request("http://localhost:3000/"))).toBe("http://localhost:3000")
  })

  it("accepts the browser Origin when it matches the forwarded origin", () => {
    const req = new Request("http://172.21.0.1:3000/api/auth/signout", {
      method: "POST",
      headers: {
        origin: "https://agia.tvb.com.hk",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "agia.tvb.com.hk",
        "sec-fetch-site": "same-origin",
      },
    })
    expect(isSameOrigin(req)).toBe(true)
  })
})

describe("isSameOrigin (I17)", () => {
  it("accepts same-origin and same-site requests", () => {
    expect(
      isSameOrigin(
        new Request("http://localhost:3000/api/auth/signout", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).toBe(true)
    expect(
      isSameOrigin(
        new Request("http://localhost:3000/api/auth/signout", {
          method: "POST",
          headers: { "sec-fetch-site": "same-site" },
        }),
      ),
    ).toBe(true)
  })

  it("rejects cross-site and foreign-origin requests", () => {
    expect(
      isSameOrigin(
        new Request("http://localhost:3000/api/auth/signout", {
          method: "POST",
          headers: { "sec-fetch-site": "cross-site" },
        }),
      ),
    ).toBe(false)
    expect(
      isSameOrigin(
        new Request("http://localhost:3000/api/auth/signout", {
          method: "POST",
          headers: { origin: "http://evil.example" },
        }),
      ),
    ).toBe(false)
  })
})
