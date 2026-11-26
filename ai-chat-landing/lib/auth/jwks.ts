import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose"

const CACHE_MS = 24 * 60 * 60 * 1000

const keys = new Map<string, JWTVerifyGetKey>()

export function createJwks(uri: string): JWTVerifyGetKey {
  const hit = keys.get(uri)
  if (hit) return hit
  const set = createRemoteJWKSet(new URL(uri), {
    cacheMaxAge: CACHE_MS,
    cooldownDuration: 5_000,
    timeoutDuration: 10_000,
  })
  keys.set(uri, set)
  return set
}

export function clearJwksCache(): void {
  keys.clear()
}
