import { getDiscovery } from "./discovery"
import type { AuthConfig } from "./config"
import type { AuthStore, AuthSession } from "./session-store"
import { logAuthEvent } from "./log"

const REFRESH_SKEW_MS = 5 * 60 * 1000
const inflight = new Map<string, Promise<void>>()

export function clearRenewalInflight(): void {
  inflight.clear()
}

export function needsRenewal(session: AuthSession, now = Date.now()): boolean {
  if (!session.tokens.refreshToken) return false
  if (!session.tokens.accessTokenExpiresAt) return false
  return Date.parse(session.tokens.accessTokenExpiresAt) - now <= REFRESH_SKEW_MS
}

export async function maybeRenew(
  session: AuthSession,
  cfg: AuthConfig,
  store: AuthStore,
  deps: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<AuthSession | null> {
  if (!needsRenewal(session, (deps.now ?? Date.now)())) return session

  const existing = inflight.get(session.handle)
  if (existing) {
    await existing
    return store.getSession(session.handle)
  }

  const run = (async () => {
    const f = deps.fetch ?? fetch
    try {
      const discovery = await getDiscovery(cfg, deps)
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: session.tokens.refreshToken ?? "",
        scope: cfg.scopes,
      })
      const res = await f(discovery.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body,
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`refresh ${res.status}`)
      const data = (await res.json()) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        id_token?: string
      }
      const now = (deps.now ?? Date.now)()
      logAuthEvent({ event: "renewal", detail: "ok", oid: session.identity.oid })
      store.setRenewed(session.handle, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? session.tokens.refreshToken,
        accessTokenExpiresAt:
          typeof data.expires_in === "number"
            ? new Date(now + data.expires_in * 1000).toISOString()
            : session.tokens.accessTokenExpiresAt,
      })
    } catch {
      logAuthEvent({ event: "renewal", code: "refresh_failed", oid: session.identity.oid })
      store.renewalFailed(session.handle)
    } finally {
      inflight.delete(session.handle)
    }
  })()

  inflight.set(session.handle, run)
  await run
  return store.getSession(session.handle)
}
