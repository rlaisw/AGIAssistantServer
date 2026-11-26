#!/usr/bin/env node
// Spec 050 operator harness (FR-016 / SC-006 / E8).
// Runs the real authorization-code + PKCE flow as a loopback PUBLIC client:
// no client secret is used or needed. Prints per-step PASS/FAIL and claim
// PRESENCE only — never a token value.
//
// Prerequisite: the app registration lists http://localhost:53682/callback
// under "Mobile and desktop applications" (contracts/entra-app-registration.md).
//
//   ENTRA_TENANT_ID=<guid> ENTRA_CLIENT_ID=<guid> \
//     node ai-chat-landing/scripts/entra-flow-check.mjs

import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { pathToFileURL } from "node:url"
import { createRemoteJWKSet, jwtVerify } from "jose"

export const HARNESS_REDIRECT = process.env.ENTRA_HARNESS_REDIRECT ?? "http://localhost:53682/callback"
const TIMEOUT_MS = 180_000

export function formatFlowReport(steps, claims, lifetimes = {}) {
  const lines = []
  steps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.ok ? "PASS" : "FAIL"} ${step.name}${step.detail ? ` (${step.detail})` : ""}`)
  })
  lines.push(`${steps.filter((s) => s.ok).length}/${steps.length} steps passed`)
  lines.push(
    `claims present: oid=${claims.oid ? "yes" : "no"} email=${claims.email ? "yes" : "no"} tid=${claims.tid ? "yes" : "no"} nonce=${claims.nonce ? "yes" : "no"}`,
  )
  if (typeof lifetimes.idTokenSeconds === "number") lines.push(`id token lifetime: ${lifetimes.idTokenSeconds}s`)
  if (typeof lifetimes.accessTokenSeconds === "number") lines.push(`access token lifetime: ${lifetimes.accessTokenSeconds}s`)
  if (typeof lifetimes.refreshPresent === "boolean") lines.push(`refresh token: ${lifetimes.refreshPresent ? "present" : "absent"}`)
  return lines.join("\n")
}

function waitForCode(state, authorizationUrl) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost")
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("not found")
        return
      }
      const receivedState = url.searchParams.get("state")
      const code = url.searchParams.get("code")
      if (!code || receivedState !== state) {
        res.writeHead(400, { "content-type": "text/plain" }).end("state mismatch")
        finish(new Error("state mismatch or missing code"))
        return
      }
      res.writeHead(200, { "content-type": "text/html" }).end("<p>Sign-in received. You can close this tab.</p>")
      finish(null, code)
    })
    const timer = setTimeout(() => finish(new Error("timed out waiting for the browser callback")), TIMEOUT_MS)
    function finish(error, code) {
      clearTimeout(timer)
      server.close()
      if (error) reject(error)
      else resolve(code)
    }
    server.listen(Number(new URL(HARNESS_REDIRECT).port), "127.0.0.1", () => {
      console.log("\nOpen this URL in your browser and sign in:\n")
      console.log(`${authorizationUrl}\n`)
      console.log(`Waiting for the callback on ${HARNESS_REDIRECT} ...`)
    })
  })
}

async function main() {
  const tenantId = process.env.ENTRA_TENANT_ID
  const clientId = process.env.ENTRA_CLIENT_ID
  if (!tenantId || !clientId) {
    console.error("ENTRA_TENANT_ID and ENTRA_CLIENT_ID are required")
    process.exit(2)
  }
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`
  const discoveryUrl =
    process.env.ENTRA_DISCOVERY_URL ?? `${issuer}/.well-known/openid-configuration`
  const steps = []
  const report = (ok) => {
    console.log(`\n${formatFlowReport(steps, claims, lifetimes)}`)
    process.exit(ok ? 0 : 1)
  }
  let claims = { oid: false, email: false, tid: false, nonce: false }
  const lifetimes = {}

  let discovery
  try {
    const res = await fetch(discoveryUrl, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    discovery = await res.json()
    steps.push({ name: "discovery document", ok: true })
  } catch (error) {
    steps.push({ name: "discovery document", ok: false, detail: error.message })
    return report(false)
  }

  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url")
  const state = randomBytes(32).toString("base64url")
  const nonce = randomBytes(32).toString("base64url")

  const authorize = new URL(discovery.authorization_endpoint)
  authorize.searchParams.set("client_id", clientId)
  authorize.searchParams.set("response_type", "code")
  authorize.searchParams.set("redirect_uri", HARNESS_REDIRECT)
  authorize.searchParams.set("scope", "openid profile email offline_access")
  authorize.searchParams.set("state", state)
  authorize.searchParams.set("nonce", nonce)
  authorize.searchParams.set("code_challenge", challenge)
  authorize.searchParams.set("code_challenge_method", "S256")
  steps.push({ name: "authorization request built (PKCE S256)", ok: true })

  let code
  try {
    code = await waitForCode(state, authorize.toString())
    steps.push({ name: "browser sign-in returned a code with matching state", ok: true })
  } catch (error) {
    steps.push({ name: "browser sign-in", ok: false, detail: error.message })
    return report(false)
  }

  let tokens
  try {
    const res = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        redirect_uri: HARNESS_REDIRECT,
        code_verifier: verifier,
        scope: "openid profile email offline_access",
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    tokens = await res.json()
    steps.push({ name: "token endpoint accepted the code (public client)", ok: true })
  } catch (error) {
    steps.push({ name: "token exchange", ok: false, detail: error.message })
    return report(false)
  }

  let payload
  try {
    const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri))
    const verified = await jwtVerify(tokens.id_token, jwks, {
      issuer,
      audience: clientId,
      clockTolerance: "5m",
    })
    payload = verified.payload
    steps.push({ name: "identity token verified (signature, issuer, audience, expiry)", ok: true })
  } catch (error) {
    steps.push({ name: "identity token verification", ok: false, detail: error.message })
    return report(false)
  }

  claims = {
    oid: typeof payload.oid === "string" && payload.oid.length > 0,
    email:
      (typeof payload.email === "string" && payload.email.length > 0) ||
      (typeof payload.preferred_username === "string" && payload.preferred_username.length > 0),
    tid: payload.tid === tenantId,
    nonce: typeof payload.nonce === "string" && payload.nonce === nonce,
  }
  steps.push({ name: "required claims present", ok: Object.values(claims).every(Boolean) })

  lifetimes.idTokenSeconds =
    typeof payload.exp === "number" && typeof payload.iat === "number" ? payload.exp - payload.iat : undefined
  lifetimes.accessTokenSeconds = tokens.expires_in
  lifetimes.refreshPresent = typeof tokens.refresh_token === "string"

  report(steps.every((step) => step.ok))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`harness failed: ${error.message}`)
    process.exit(1)
  })
}
