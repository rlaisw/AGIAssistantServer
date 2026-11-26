import { jwtVerify } from "jose"
import { AuthError } from "./errors"
import { timingSafeEqualStr } from "./pkce"

export type EmailSource = "email" | "preferred_username"

export type Identity = {
  oid: string
  tid: string
  email: string
  emailSource: EmailSource
  displayName: string
  signedInAt: string
}

type VerifyKey = Parameters<typeof jwtVerify>[1]

export type ValidateOptions = {
  issuer: string
  audience: string
  tenantId: string
  nonce: string
  key: VerifyKey
  now?: () => number
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

export async function validateIdToken(
  token: string,
  opts: ValidateOptions,
): Promise<Identity> {
  const now = opts.now ?? Date.now

  let payload: Record<string, unknown>
  try {
    const result = await jwtVerify(token, opts.key, {
      issuer: opts.issuer,
      audience: opts.audience,
      clockTolerance: "5m",
      currentDate: new Date(now()),
    })
    payload = result.payload as Record<string, unknown>
  } catch {
    throw new AuthError("token_invalid", { detail: "signature/claims" })
  }

  if (!timingSafeEqualStr(nonEmpty(payload.nonce), opts.nonce)) {
    throw new AuthError("token_invalid", { detail: "nonce" })
  }

  const tid = nonEmpty(payload.tid)
  if (!tid) throw new AuthError("identity_incomplete", { detail: "tid" })
  if (tid !== opts.tenantId) {
    throw new AuthError("tenant_not_allowed", { detail: "tid" })
  }

  const oid = nonEmpty(payload.oid)
  if (!oid) throw new AuthError("identity_incomplete", { detail: "oid" })

  const preferred = nonEmpty(payload.preferred_username)
  const emailClaim = nonEmpty(payload.email)
  const email = emailClaim ?? preferred
  if (!email) throw new AuthError("identity_incomplete", { detail: "email" })

  const displayName =
    nonEmpty(payload.name) ?? preferred ?? email.split("@")[0]

  return {
    oid,
    tid,
    email,
    emailSource: emailClaim ? "email" : "preferred_username",
    displayName,
    signedInAt: new Date(now()).toISOString(),
  }
}
