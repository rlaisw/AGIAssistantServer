import { AuthError } from "./errors"

export type AuthConfig = {
  tenantId: string
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string
  issuer: string
  discoveryUrl: string
  cookieSecure: boolean
  cookiePrefix: string
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SCOPES = "openid profile email offline_access"

function fail(key: string): never {
  throw new AuthError("config_invalid", { detail: `missing or invalid ${key}` })
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]"
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const tenantId = env.ENTRA_TENANT_ID?.trim() ?? ""
  const clientId = env.ENTRA_CLIENT_ID?.trim() ?? ""
  const clientSecret = env.ENTRA_CLIENT_SECRET ?? ""
  const redirectUri = env.ENTRA_REDIRECT_URI?.trim() ?? ""

  if (!GUID.test(tenantId)) fail("ENTRA_TENANT_ID")
  if (!GUID.test(clientId)) fail("ENTRA_CLIENT_ID")
  if (!clientSecret) fail("ENTRA_CLIENT_SECRET")
  if (!redirectUri) fail("ENTRA_REDIRECT_URI")

  let parsed: URL
  try {
    parsed = new URL(redirectUri)
  } catch {
    fail("ENTRA_REDIRECT_URI")
  }
  const httpsOk = parsed.protocol === "https:"
  const localHttp = parsed.protocol === "http:" && isLocalHost(parsed.hostname)
  if (!httpsOk && !localHttp) fail("ENTRA_REDIRECT_URI")

  const production = env.NODE_ENV === "production"
  if (production && !httpsOk) fail("ENTRA_REDIRECT_URI")

  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`
  const override = env.ENTRA_DISCOVERY_URL?.trim()
  let discoveryUrl = `${issuer}/.well-known/openid-configuration`
  if (override) {
    let o: URL
    try {
      o = new URL(override)
    } catch {
      fail("ENTRA_DISCOVERY_URL")
    }
    if (o.protocol !== "https:" && !(o.protocol === "http:" && isLocalHost(o.hostname))) {
      fail("ENTRA_DISCOVERY_URL")
    }
    discoveryUrl = o.toString()
  }

  const secureFlag = env.AUTH_COOKIE_SECURE
  const cookieSecure = production
    ? true
    : secureFlag === "0" || secureFlag === "false"
      ? false
      : true

  return {
    tenantId,
    clientId,
    clientSecret,
    redirectUri,
    scopes: SCOPES,
    issuer,
    discoveryUrl,
    cookieSecure,
    cookiePrefix: cookieSecure ? "__Host-" : "",
  }
}
