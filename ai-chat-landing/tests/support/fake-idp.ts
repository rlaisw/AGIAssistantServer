import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { createHash } from "node:crypto"

import { createTestKeys, signIdToken, type TestKeys } from "./tokens"

export const TEST_TENANT_ID = "22222222-2222-2222-2222-222222222222"
export const TEST_CLIENT_ID = "33333333-3333-3333-3333-333333333333"
export const TEST_CLIENT_SECRET = "test-secret"
export const TEST_ORIGIN = "http://localhost:3000"

export type FakeIdpOptions = {
  tenantId?: string
  clientId?: string
  clientSecret?: string
  overrides?: Record<string, unknown>
  omit?: string[]
  tokenStatus?: number
  tokenFails?: boolean
  discoveryFails?: boolean
  issuerOverride?: string
  expiresIn?: string
}

export type FakeIdp = {
  url: string
  issuer: string
  keys: TestKeys
  tokenCalls: () => number
  close: () => Promise<void>
}

export async function startFakeIdp(opts: FakeIdpOptions = {}): Promise<FakeIdp> {
  const tenantId = opts.tenantId ?? TEST_TENANT_ID
  const clientId = opts.clientId ?? TEST_CLIENT_ID
  const clientSecret = opts.clientSecret ?? TEST_CLIENT_SECRET
  const keys = await createTestKeys()
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`
  const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string }>()
  let tokenCalls = 0
  let base = ""

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base || "http://127.0.0.1")

    if (url.pathname === "/.well-known/openid-configuration") {
      if (opts.discoveryFails) {
        res.writeHead(503).end("down")
        return
      }
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          issuer: opts.issuerOverride ?? issuer,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          jwks_uri: `${base}/jwks`,
          end_session_endpoint: `${base}/logout`,
        }),
      )
      return
    }

    if (url.pathname === "/authorize") {
      const code = `code-${codes.size + 1}-${Date.now()}`
      codes.set(code, {
        nonce: url.searchParams.get("nonce") ?? "",
        challenge: url.searchParams.get("code_challenge") ?? "",
        redirectUri: url.searchParams.get("redirect_uri") ?? "",
      })
      const target = new URL(codes.get(code)!.redirectUri)
      target.searchParams.set("code", code)
      target.searchParams.set("state", url.searchParams.get("state") ?? "")
      res.writeHead(302, { location: target.toString() }).end()
      return
    }

    if (url.pathname === "/jwks") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: [keys.jwk] }))
      return
    }

    if (url.pathname === "/logout") {
      res.writeHead(302, { location: url.searchParams.get("post_logout_redirect_uri") ?? "/" }).end()
      return
    }

    if (url.pathname === "/token" && req.method === "POST") {
      tokenCalls += 1
      if (opts.tokenFails) {
        res.writeHead(opts.tokenStatus ?? 400, { "content-type": "application/json" }).end(
          JSON.stringify({ error: "invalid_grant" }),
        )
        return
      }
      const body = new URLSearchParams(await readBody(req))
      const code = body.get("code") ?? ""
      const record = codes.get(code)
      if (!record) {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }))
        return
      }
      codes.delete(code)
      if (body.get("client_id") !== clientId || body.get("client_secret") !== clientSecret) {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_client" }))
        return
      }
      const verifier = body.get("code_verifier") ?? ""
      const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url")
      if (challenge !== record.challenge) {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }))
        return
      }
      const claims: Record<string, unknown> = {
        oid: "11111111-1111-1111-1111-111111111111",
        tid: tenantId,
        email: "alice.chen@contoso.com",
        preferred_username: "alice.chen@contoso.com",
        name: "Alice Chen",
        nonce: record.nonce,
        ...(opts.overrides ?? {}),
      }
      for (const key of opts.omit ?? []) delete claims[key]
      const idToken = await signIdToken(claims, keys.privateKey, {
        issuer,
        audience: clientId,
        expiresIn: opts.expiresIn ?? "1h",
      })
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          id_token: idToken,
          access_token: "access-token",
          refresh_token: "refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      )
      return
    }

    res.writeHead(404).end("not found")
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  base = `http://127.0.0.1:${address.port}`

  return {
    url: base,
    issuer,
    keys,
    tokenCalls: () => tokenCalls,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  }
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

export function applyTestEnv(idp: FakeIdp, extra: Record<string, string> = {}): void {
  process.env.ENTRA_TENANT_ID = TEST_TENANT_ID
  process.env.ENTRA_CLIENT_ID = TEST_CLIENT_ID
  process.env.ENTRA_CLIENT_SECRET = TEST_CLIENT_SECRET
  process.env.ENTRA_REDIRECT_URI = `${TEST_ORIGIN}/api/auth/callback/entra`
  process.env.ENTRA_DISCOVERY_URL = `${idp.url}/.well-known/openid-configuration`
  process.env.AUTH_COOKIE_SECURE = "0"
  for (const [key, value] of Object.entries(extra)) process.env[key] = value
}
