import { AuthError } from "./errors"
import type { AuthConfig } from "./config"

export type Discovery = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  end_session_endpoint?: string
}

type Entry = { at: number; data: Discovery }
const CACHE_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 10_000

const cache = new Map<string, Entry>()

export function clearDiscoveryCache(): void {
  cache.clear()
}

async function fetchOnce(url: string, deps: { fetch?: typeof fetch }): Promise<Discovery> {
  const f = deps.fetch ?? fetch
  const res = await f(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  })
  if (!res.ok) throw new AuthError("idp_unavailable", { detail: `discovery ${res.status}` })
  const data = (await res.json()) as Partial<Discovery>
  if (
    typeof data.authorization_endpoint !== "string" ||
    typeof data.token_endpoint !== "string" ||
    typeof data.jwks_uri !== "string" ||
    typeof data.issuer !== "string"
  ) {
    throw new AuthError("idp_unavailable", { detail: "discovery shape" })
  }
  return data as Discovery
}

export async function getDiscovery(
  cfg: AuthConfig,
  deps: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<Discovery> {
  const now = deps.now ?? Date.now
  const hit = cache.get(cfg.discoveryUrl)
  if (hit && now() - hit.at < CACHE_MS) return hit.data

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const data = await fetchOnce(cfg.discoveryUrl, deps)
      if (data.issuer !== cfg.issuer) {
        throw new AuthError("config_invalid", { detail: "discovery issuer mismatch" })
      }
      cache.set(cfg.discoveryUrl, { at: now(), data })
      return data
    } catch (error) {
      lastError = error
      if (error instanceof AuthError && error.code === "config_invalid") throw error
    }
  }
  throw new AuthError("idp_unavailable", {
    detail: lastError instanceof Error ? lastError.message : "discovery failed",
  })
}
