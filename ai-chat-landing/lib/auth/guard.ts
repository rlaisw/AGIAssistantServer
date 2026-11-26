import { getStore, type AuthStore } from "./session-store"
import { cookieNames, readCookie } from "./session"
import type { AuthConfig } from "./config"
import type { Identity } from "./claims"

export function getIdentity(
  req: Request,
  cfg: AuthConfig,
  store: AuthStore = getStore(),
): Identity | null {
  const handle = readCookie(req, cookieNames(cfg).session)
  const session = store.getSession(handle)
  if (!session) return null
  store.touch(session.handle)
  return session.identity
}

export type GuardResult =
  | { ok: true; identity: Identity }
  | { ok: false; status: 401; code: "signin_required" }

export function requireIdentity(
  req: Request,
  cfg: AuthConfig,
  store: AuthStore = getStore(),
): GuardResult {
  const identity = getIdentity(req, cfg, store)
  if (!identity) return { ok: false, status: 401, code: "signin_required" }
  return { ok: true, identity }
}
