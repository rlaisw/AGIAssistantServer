import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { loadAuthConfig } from "./config"
import { AuthError } from "./errors"

const ENV_KEYS = [
  "ENTRA_TENANT_ID",
  "ENTRA_CLIENT_ID",
  "ENTRA_CLIENT_SECRET",
  "ENTRA_REDIRECT_URI",
  "ENTRA_DISCOVERY_URL",
  "AUTH_COOKIE_SECURE",
  "NODE_ENV",
]

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  process.env.ENTRA_TENANT_ID = "22222222-2222-2222-2222-222222222222"
  process.env.ENTRA_CLIENT_ID = "33333333-3333-3333-3333-333333333333"
  process.env.ENTRA_CLIENT_SECRET = "secret"
  process.env.ENTRA_REDIRECT_URI = "http://localhost:3000/api/auth/callback/entra"
  Reflect.deleteProperty(process.env, "ENTRA_DISCOVERY_URL")
  Reflect.deleteProperty(process.env, "AUTH_COOKIE_SECURE")
  Reflect.deleteProperty(process.env, "NODE_ENV")
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = saved[key]
  }
})

function resetBaseEnv() {
  process.env.ENTRA_TENANT_ID = "22222222-2222-2222-2222-222222222222"
  process.env.ENTRA_CLIENT_ID = "33333333-3333-3333-3333-333333333333"
  process.env.ENTRA_CLIENT_SECRET = "secret"
  process.env.ENTRA_REDIRECT_URI = "http://localhost:3000/api/auth/callback/entra"
  Reflect.deleteProperty(process.env, "ENTRA_DISCOVERY_URL")
  Reflect.deleteProperty(process.env, "AUTH_COOKIE_SECURE")
  Reflect.deleteProperty(process.env, "NODE_ENV")
}

function expectConfigError(mutate: () => void, key: string) {
  resetBaseEnv()
  mutate()
  try {
    loadAuthConfig()
    throw new Error("expected failure")
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).code).toBe("config_invalid")
    expect((error as AuthError).detail).toContain(key)
  }
}

describe("loadAuthConfig (U19)", () => {
  it("derives the issuer and scopes from valid values", () => {
    const cfg = loadAuthConfig()
    expect(cfg.issuer).toBe(
      "https://login.microsoftonline.com/22222222-2222-2222-2222-222222222222/v2.0",
    )
    expect(cfg.scopes).toBe("openid profile email offline_access")
    expect(cfg.discoveryUrl).toContain("/.well-known/openid-configuration")
    expect(cfg.cookieSecure).toBe(true)
    expect(cfg.cookiePrefix).toBe("__Host-")
  })

  it("fails fast naming the key, never the value", () => {
    expectConfigError(() => Reflect.deleteProperty(process.env, "ENTRA_TENANT_ID"), "ENTRA_TENANT_ID")
    expectConfigError(() => (process.env.ENTRA_CLIENT_ID = "not-a-guid"), "ENTRA_CLIENT_ID")
    expectConfigError(() => (process.env.ENTRA_CLIENT_SECRET = ""), "ENTRA_CLIENT_SECRET")
    expectConfigError(() => (process.env.ENTRA_REDIRECT_URI = ""), "ENTRA_REDIRECT_URI")
  })

  it("rejects non-local plain-HTTP redirect URIs", () => {
    expectConfigError(
      () => (process.env.ENTRA_REDIRECT_URI = "http://example.com/cb"),
      "ENTRA_REDIRECT_URI",
    )
  })

  it("requires HTTPS when NODE_ENV=production", () => {
    resetBaseEnv()
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
    process.env.ENTRA_REDIRECT_URI = "http://localhost:3000/cb"
    const error = (() => {
      try {
        loadAuthConfig()
        return null
      } catch (caught) {
        return caught
      }
    })()
    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).code).toBe("config_invalid")
    expect((error as AuthError).detail).toContain("ENTRA_REDIRECT_URI")
  })

  it("allows the insecure cookie override outside production only", () => {
    process.env.AUTH_COOKIE_SECURE = "0"
    expect(loadAuthConfig().cookieSecure).toBe(false)
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
    process.env.ENTRA_REDIRECT_URI = "https://chat.example.com/cb"
    expect(loadAuthConfig().cookieSecure).toBe(true)
  })

  it("accepts a localhost discovery override and rejects a remote HTTP one", () => {
    process.env.ENTRA_DISCOVERY_URL = "http://127.0.0.1:9999/.well-known/openid-configuration"
    expect(loadAuthConfig().discoveryUrl).toContain("127.0.0.1:9999")
    expectConfigError(
      () => (process.env.ENTRA_DISCOVERY_URL = "http://evil.example.com/discovery"),
      "ENTRA_DISCOVERY_URL",
    )
  })
})
