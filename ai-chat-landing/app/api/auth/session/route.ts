export const runtime = "nodejs"

import { loadAuthConfig } from "@/lib/auth/config"
import { maybeRenew } from "@/lib/auth/renew"
import { getStore } from "@/lib/auth/session-store"
import { clearCookie, cookieNames, jsonResponse, readCookie } from "@/lib/auth/session"

export async function GET(req: Request): Promise<Response> {
  let cfg
  try {
    cfg = loadAuthConfig()
  } catch {
    return jsonResponse({ authenticated: false })
  }

  const names = cookieNames(cfg)
  const handle = readCookie(req, names.session)
  const store = getStore()
  const session = store.getSession(handle)
  if (!session) {
    return jsonResponse(
      { authenticated: false },
      200,
      handle ? [clearCookie(names.session, cfg)] : [],
    )
  }

  const renewed = await maybeRenew(session, cfg, store)
  if (!renewed) {
    return jsonResponse({ authenticated: false }, 200, [clearCookie(names.session, cfg)])
  }

  return jsonResponse({
    authenticated: true,
    user: {
      displayName: renewed.identity.displayName,
      email: renewed.identity.email,
    },
    expiresAt: renewed.absoluteExpiresAt,
  })
}
