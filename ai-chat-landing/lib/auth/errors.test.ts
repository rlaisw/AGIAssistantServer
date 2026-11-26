import { describe, expect, it } from "vitest"

import { AUTH_ERRORS, AuthError, errorMessage, toAuthError } from "./errors"

describe("errors (U20)", () => {
  it("maps every documented code to its status, message, and retryability", () => {
    const expected: Array<[string, number, boolean]> = [
      ["config_invalid", 500, false],
      ["idp_unavailable", 503, true],
      ["signin_cancelled", 400, true],
      ["invalid_state", 400, true],
      ["signin_failed", 400, true],
      ["token_invalid", 400, true],
      ["identity_incomplete", 400, false],
      ["tenant_not_allowed", 403, false],
      ["session_expired", 401, true],
      ["reauthentication_required", 401, true],
      ["signin_required", 401, true],
      ["invalid_request", 403, false],
      ["internal_error", 500, true],
    ]
    expect(Object.keys(AUTH_ERRORS).sort()).toEqual(expected.map(([code]) => code).sort())
    for (const [code, status, retryable] of expected) {
      const error = new AuthError(code as keyof typeof AUTH_ERRORS)
      expect(error.httpStatus).toBe(status)
      expect(error.retryable).toBe(retryable)
      expect(error.userMessage.length).toBeGreaterThan(0)
    }
  })

  it("converts unknown failures to internal_error without leaking details to the user", () => {
    const error = toAuthError(new Error("boom with secret test-secret"))
    expect(error.code).toBe("internal_error")
    expect(error.userMessage).not.toContain("secret")
  })

  it("falls back to the generic message for an unknown code", () => {
    expect(errorMessage("not_a_code")).toBe(AUTH_ERRORS.internal_error.message)
  })
})
