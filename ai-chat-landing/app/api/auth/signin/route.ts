export const runtime = "nodejs"

import { loadAuthConfig } from "@/lib/auth/config"
import { getDiscovery } from "@/lib/auth/discovery"
import { createPreAuthSecrets, randomToken } from "@/lib/auth/pkce"
import { getStore } from "@/lib/auth/session-store"
import { cookieNames, externalOrigin, redirectResponse, serializeCookie } from "@/lib/auth/session"
import { toAuthError } from "@/lib/auth/errors"
import { logAuthEvent } from "@/lib/auth/log"

const PREAUTH_COOKIE_MAX_AGE = 600

export async function GET(req: Request): Promise<Response> {
  try {
    const cfg = loadAuthConfig()
    const url = new URL(req.url)
    const discovery = await getDiscovery(cfg)
    const secrets = createPreAuthSecrets()
    const store = getStore()

    const tx = store.createPreAuth({
      handle: randomToken(32),
      state: secrets.state,
      nonce: secrets.nonce,
      codeVerifier: secrets.codeVerifier,
      returnTo: url.searchParams.get("returnTo"),
    })

    const authorize = new URL(discovery.authorization_endpoint)
    authorize.searchParams.set("client_id", cfg.clientId)
    authorize.searchParams.set("response_type", "code")
    authorize.searchParams.set("redirect_uri", cfg.redirectUri)
    authorize.searchParams.set("scope", cfg.scopes)
    authorize.searchParams.set("state", tx.state)
    authorize.searchParams.set("nonce", tx.nonce)
    authorize.searchParams.set("code_challenge", secrets.codeChallenge)
    authorize.searchParams.set("code_challenge_method", "S256")
    if (url.searchParams.get("prompt") === "select_account") {
      authorize.searchParams.set("prompt", "select_account")
    }

    const cookie = serializeCookie(cookieNames(cfg).preauth, tx.handle, cfg, PREAUTH_COOKIE_MAX_AGE)
    return redirectResponse(authorize.toString(), [cookie])
  } catch (error) {
    const authError = toAuthError(error)
    logAuthEvent({ event: "signin_failure", code: authError.code, detail: authError.detail })
    // Honest UI path: the banner maps ?auth_error=<code> to a sentence (FR-012).
    return redirectResponse(`${externalOrigin(req)}/?auth_error=${authError.code}`)
  }
}
