export const runtime = "nodejs"

import { loadAuthConfig } from "@/lib/auth/config"
import { getDiscovery } from "@/lib/auth/discovery"
import { getStore } from "@/lib/auth/session-store"
import {
  clearCookie,
  cookieNames,
  externalOrigin,
  isSameOrigin,
  jsonResponse,
  readCookie,
} from "@/lib/auth/session"
import { logAuthEvent } from "@/lib/auth/log"

export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) {
    return jsonResponse({ error: "invalid_request" }, 403)
  }

  let cfg
  try {
    cfg = loadAuthConfig()
  } catch {
    return jsonResponse({ ok: true })
  }

  const names = cookieNames(cfg)
  const store = getStore()
  store.endSession(readCookie(req, names.session))
  logAuthEvent({ event: "signout" })

  let endSessionUrl: string | undefined
  try {
    const discovery = await getDiscovery(cfg)
    if (discovery.end_session_endpoint) {
      const url = new URL(discovery.end_session_endpoint)
      url.searchParams.set("post_logout_redirect_uri", `${externalOrigin(req)}/`)
      endSessionUrl = url.toString()
    }
  } catch {
    // local sign-out still succeeds when the tenant end-session endpoint is unavailable
  }

  return jsonResponse(
    endSessionUrl ? { ok: true, endSessionUrl } : { ok: true },
    200,
    [clearCookie(names.session, cfg), clearCookie(names.preauth, cfg)],
  )
}
