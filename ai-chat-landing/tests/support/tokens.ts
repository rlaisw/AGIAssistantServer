import { SignJWT, exportJWK, generateKeyPair } from "jose"

export type TestKeys = {
  privateKey: CryptoKey
  publicKey: CryptoKey
  jwk: Record<string, unknown>
}

export const TEST_KID = "test-key"

export async function createTestKeys(): Promise<TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair("RS256")
  const jwk = (await exportJWK(publicKey)) as Record<string, unknown>
  return {
    privateKey,
    publicKey,
    jwk: { ...jwk, kid: TEST_KID, alg: "RS256", use: "sig" },
  }
}

export async function signIdToken(
  claims: Record<string, unknown>,
  privateKey: CryptoKey,
  opts: {
    issuer: string
    audience: string
    expiresIn?: string
    expSeconds?: number
    nbfSeconds?: number
    kid?: string
  },
): Promise<string> {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? TEST_KID })
    .setIssuer(opts.issuer)
    .setAudience(opts.audience)
  if (typeof opts.expSeconds === "number") {
    jwt = jwt.setExpirationTime(opts.expSeconds)
  } else {
    jwt = jwt.setExpirationTime(opts.expiresIn ?? "1h")
  }
  if (typeof opts.nbfSeconds === "number") jwt = jwt.setNotBefore(opts.nbfSeconds)
  return jwt.sign(privateKey)
}
