import type { AuthConfig } from "./config"

export const SESSION_COOKIE = "hermes_session"
export const PREAUTH_COOKIE = "hermes_auth"

export function cookieNames(cfg: AuthConfig): { session: string; preauth: string } {
  return {
    session: `${cfg.cookiePrefix}${SESSION_COOKIE}`,
    preauth: `${cfg.cookiePrefix}${PREAUTH_COOKIE}`,
  }
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie")
  if (!header) return null
  for (const part of header.split(";")) {
    const index = part.indexOf("=")
    if (index === -1) continue
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim())
    }
  }
  return null
}

export function serializeCookie(
  name: string,
  value: string,
  cfg: AuthConfig,
  maxAgeSeconds?: number,
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"]
  if (cfg.cookieSecure) parts.push("Secure")
  if (typeof maxAgeSeconds === "number") parts.push(`Max-Age=${maxAgeSeconds}`)
  return parts.join("; ")
}

export function clearCookie(name: string, cfg: AuthConfig): string {
  return serializeCookie(name, "", cfg, 0)
}

export function redirectResponse(
  location: string,
  cookies: string[] = [],
  status = 302,
): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" })
  for (const cookie of cookies) headers.append("Set-Cookie", cookie)
  return new Response(null, { status, headers })
}

export function jsonResponse(
  body: unknown,
  status = 200,
  cookies: string[] = [],
): Response {
  const headers = new Headers({ "Cache-Control": "no-store" })
  for (const cookie of cookies) headers.append("Set-Cookie", cookie)
  if (cookies.length) headers.set("Content-Type", "application/json")
  return new Response(JSON.stringify(body), { status, headers })
}

function firstHeader(value: string | null): string | null {
  if (!value) return null
  const first = value.split(",")[0].trim()
  return first.length > 0 ? first : null
}

/** Public origin as the browser sees it, honouring a TLS-terminating reverse proxy. */
export function externalOrigin(req: Request): string {
  const url = new URL(req.url)
  const proto = firstHeader(req.headers.get("x-forwarded-proto")) ?? url.protocol.replace(":", "")
  const safeProto = proto === "https" || proto === "http" ? proto : url.protocol.replace(":", "")
  const host = firstHeader(req.headers.get("x-forwarded-host")) ?? req.headers.get("host") ?? url.host
  return `${safeProto}://${host}`
}

export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "same-site" && site !== "none") return false
  const origin = req.headers.get("origin")
  if (!origin) return true
  return origin === new URL(req.url).origin || origin === externalOrigin(req)
}
