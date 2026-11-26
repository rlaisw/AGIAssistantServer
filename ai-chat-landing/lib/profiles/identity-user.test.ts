import { describe, expect, it } from "vitest"
import type { Identity } from "@/lib/auth/claims"
import { ANON_DIFY_USER, difyUserFor, identityInputs } from "./identity-user"

const identity: Identity = {
  oid: "11111111-1111-1111-1111-111111111111",
  tid: "22222222-2222-2222-2222-222222222222",
  email: "peter.chan@tvb.com.hk",
  emailSource: "email",
  displayName: "Peter Chan",
  signedInAt: "2026-01-01T00:00:00.000Z",
}

describe("history scoping (U18, U19)", () => {
  it("uses a hashed per-identity Dify user, never the legacy constant", () => {
    expect(difyUserFor(null)).toBe(ANON_DIFY_USER)
    const user = difyUserFor(identity)
    expect(user).toMatch(/^u-[0-9a-f]{16}$/)
    expect(user).toBe(difyUserFor(identity))
    expect(user).not.toBe("ai-chat-ui-user")
  })

  it("sends identity inputs only when signed in, with the full-FQDN slug", () => {
    expect(identityInputs(null)).toEqual({})
    expect(identityInputs(identity)).toEqual({
      hermes_slug: "peter-chan-tvb-com-hk",
      hermes_email: "peter.chan@tvb.com.hk",
      hermes_oid: identity.oid,
    })
  })
})
