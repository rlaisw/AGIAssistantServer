import { GET as callbackRoute } from "@/app/api/auth/callback/entra/route"
import { GET as sessionRoute } from "@/app/api/auth/session/route"
import { GET as signinRoute } from "@/app/api/auth/signin/route"

import { TEST_ORIGIN } from "./fake-idp"

export function setCookies(res: Response): string[] {
  return res.headers.getSetCookie()
}

export function cookiePair(res: Response, name: string): string | null {
  const line = setCookies(res).find((c) => c.startsWith(`${name}=`))
  if (!line) return null
  return line.split(";")[0]
}

export function startSignin(query = "returnTo=/"): Promise<Response> {
  return signinRoute(new Request(`${TEST_ORIGIN}/api/auth/signin?${query}`))
}

export async function runSignin(
  query = "returnTo=/",
): Promise<{ start: Response; callback: Response | null }> {
  const start = await startSignin(query)
  const authorize = start.headers.get("location")
  if (start.status !== 302 || !authorize) return { start, callback: null }

  const preauth = cookiePair(start, "hermes_auth")
  const idpResponse = await fetch(authorize, { redirect: "manual" })
  const redirect = idpResponse.headers.get("location")
  if (!redirect) throw new Error("fake IdP did not redirect")
  const target = new URL(redirect)

  const callback = await callbackRoute(
    new Request(
      `${TEST_ORIGIN}/api/auth/callback/entra?code=${target.searchParams.get("code")}&state=${target.searchParams.get("state")}`,
      { headers: preauth ? { cookie: preauth } : {} },
    ),
  )
  return { start, callback }
}

export function requestWithSession(path: string, sessionPair: string | null): Request {
  return new Request(`${TEST_ORIGIN}${path}`, {
    headers: sessionPair ? { cookie: sessionPair } : {},
  })
}

export function getSession(pair: string | null): Promise<Response> {
  return sessionRoute(requestWithSession("/api/auth/session", pair))
}
