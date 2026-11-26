export const runtime = "nodejs"

import { loadAuthConfig } from "@/lib/auth/config"
import { getDiscovery } from "@/lib/auth/discovery"
import { createJwks } from "@/lib/auth/jwks"
import { validateIdToken } from "@/lib/auth/claims"
import { timingSafeEqualStr } from "@/lib/auth/pkce"
import { getStore } from "@/lib/auth/session-store"
import {
  clearCookie,
  cookieNames,
  externalOrigin,
  readCookie,
  redirectResponse,
  serializeCookie,
} from "@/lib/auth/session"
import { toAuthError, type AuthErrorCode } from "@/lib/auth/errors"
import { logAuthEvent } from "@/lib/auth/log"

const TOKEN_TIMEOUT_MS = 10_000

export async function GET(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID()
  let cfg
  try {
    cfg = loadAuthConfig()
  } catch (error) {
    const authError = toAuthError(error)
    logAuthEvent({ event: "signin_failure", code: authError.code, requestId, detail: authError.detail })
    return redirectResponse(`${externalOrigin(req)}/?auth_error=${authError.code}`)
  }

  const url = new URL(req.url)
  const names = cookieNames(cfg)
  const clearBoth = [clearCookie(names.preauth, cfg), clearCookie(names.session, cfg)]

  const fail = (code: AuthErrorCode, detail?: string): Response => {
    logAuthEvent({ event: "signin_failure", code, requestId, detail })
    return redirectResponse(`${externalOrigin(req)}/?auth_error=${code}`, clearBoth)
  }

  const errorParam = url.searchParams.get("error")
  if (errorParam) {
    return fail(errorParam === "access_denied" ? "signin_cancelled" : "signin_failed")
  }

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const store = getStore()
  const tx = store.takePreAuth(readCookie(req, names.preauth))
  if (!tx || !timingSafeEqualStr(state, tx.state)) return fail("invalid_state")
  if (!code) return fail("signin_failed")

  try {
    const discovery = await getDiscovery(cfg)
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: tx.codeVerifier,
      scope: cfg.scopes,
    })
    const res = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
    if (!res.ok) return fail("signin_failed", `token ${res.status}`)

    const data = (await res.json()) as {
      id_token?: string
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    if (!data.id_token) return fail("token_invalid", "no id_token")

    const identity = await validateIdToken(data.id_token, {
      issuer: cfg.issuer,
      audience: cfg.clientId,
      tenantId: cfg.tenantId,
      nonce: tx.nonce,
      key: createJwks(discovery.jwks_uri),
    })

    const now = Date.now()
    const session = store.createSession(identity, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessTokenExpiresAt:
        typeof data.expires_in === "number"
          ? new Date(now + data.expires_in * 1000).toISOString()
          : undefined,
    })

    logAuthEvent({ event: "signin_success", requestId, oid: identity.oid })
    const target = new URL(tx.returnTo, externalOrigin(req))
    return redirectResponse(target.toString(), [
      serializeCookie(names.session, session.handle, cfg),
      clearCookie(names.preauth, cfg),
    ])
  } catch (error) {
    const authError = toAuthError(error)
    return fail(authError.code, authError.detail)
  }
}
