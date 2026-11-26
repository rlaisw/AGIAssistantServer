import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url")
}

export function createPreAuthSecrets(): {
  state: string
  nonce: string
  codeVerifier: string
  codeChallenge: string
} {
  const codeVerifier = randomToken(32)
  return {
    state: randomToken(32),
    nonce: randomToken(32),
    codeVerifier,
    codeChallenge: codeChallenge(codeVerifier),
  }
}

export function timingSafeEqualStr(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
