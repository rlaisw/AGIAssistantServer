import { beforeAll, describe, expect, it } from "vitest"

import { validateIdToken, type ValidateOptions } from "./claims"
import { AuthError } from "./errors"
import { createTestKeys, signIdToken, type TestKeys } from "../../tests/support/tokens"

const TENANT = "22222222-2222-2222-2222-222222222222"
const CLIENT = "33333333-3333-3333-3333-333333333333"
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`
const NONCE = "nonce-value"

let keys: TestKeys

beforeAll(async () => {
  keys = await createTestKeys()
})

function baseClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    oid: "11111111-1111-1111-1111-111111111111",
    tid: TENANT,
    email: "alice.chen@contoso.com",
    preferred_username: "alice.chen@contoso.com",
    name: "Alice Chen",
    nonce: NONCE,
    ...overrides,
  }
}

function options(overrides: Partial<ValidateOptions> = {}): ValidateOptions {
  return {
    issuer: ISSUER,
    audience: CLIENT,
    tenantId: TENANT,
    nonce: NONCE,
    key: keys.publicKey,
    ...overrides,
  }
}

async function validate(
  claims: Record<string, unknown>,
  sign: { issuer?: string; audience?: string; expSeconds?: number; nbfSeconds?: number } = {},
) {
  const token = await signIdToken(claims, keys.privateKey, {
    issuer: sign.issuer ?? ISSUER,
    audience: sign.audience ?? CLIENT,
    expSeconds: sign.expSeconds,
    nbfSeconds: sign.nbfSeconds,
  })
  return validateIdToken(token, options())
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).code).toBe(code)
  }
}

describe("validateIdToken", () => {
  it("U4: extracts the complete identity", async () => {
    const identity = await validate(baseClaims())
    expect(identity).toMatchObject({
      oid: "11111111-1111-1111-1111-111111111111",
      tid: TENANT,
      email: "alice.chen@contoso.com",
      emailSource: "email",
      displayName: "Alice Chen",
    })
  })

  it("U5: falls back to preferred_username and records the source", async () => {
    const identity = await validate(baseClaims({ email: undefined }))
    expect(identity.emailSource).toBe("preferred_username")
    expect(identity.email).toBe("alice.chen@contoso.com")
  })

  it("U6/U7: rejects when email is absent or blank and no sign-in name exists", async () => {
    await expectCode(validate(baseClaims({ email: undefined, preferred_username: undefined })), "identity_incomplete")
    await expectCode(validate(baseClaims({ email: "   ", preferred_username: "" })), "identity_incomplete")
  })

  it("U7: a blank email falls through to preferred_username", async () => {
    const identity = await validate(baseClaims({ email: "   " }))
    expect(identity.emailSource).toBe("preferred_username")
  })

  it("U8: rejects a token without oid", async () => {
    await expectCode(validate(baseClaims({ oid: undefined })), "identity_incomplete")
  })

  it("U9: rejects a foreign tenant id", async () => {
    await expectCode(
      validate(baseClaims({ tid: "99999999-9999-9999-9999-999999999999" })),
      "tenant_not_allowed",
    )
  })

  it("U10: rejects a wrong issuer", async () => {
    await expectCode(
      validate(baseClaims(), { issuer: "https://login.microsoftonline.com/other/v2.0" }),
      "token_invalid",
    )
  })

  it("U11: rejects a wrong audience", async () => {
    await expectCode(validate(baseClaims(), { audience: "other-client" }), "token_invalid")
  })

  it("U12: rejects a nonce mismatch", async () => {
    await expectCode(validate(baseClaims({ nonce: "other-nonce" })), "token_invalid")
  })

  it("U13: accepts 4 minutes of clock skew and rejects 6", async () => {
    const now = Math.floor(Date.now() / 1000)
    const ok = await validate(baseClaims(), { expSeconds: now - 240 })
    expect(ok.oid).toBeTruthy()
    await expectCode(validate(baseClaims(), { expSeconds: now - 360 }), "token_invalid")
    await expectCode(validate(baseClaims(), { nbfSeconds: now + 360 }), "token_invalid")
  })

  it("US2: a changed email or display name keeps the same person key", async () => {
    const original = await validate(baseClaims())
    const renamed = await validate(
      baseClaims({ email: "alice.wong@contoso.com", name: "Alice Wong", preferred_username: "alice.wong@contoso.com" }),
    )
    expect(renamed.oid).toBe(original.oid)
    expect(renamed.email).not.toBe(original.email)
  })
})
