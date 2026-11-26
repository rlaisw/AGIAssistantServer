import { describe, expect, it } from "vitest"

import { resolveControlState } from "./control-state"

describe("resolveControlState", () => {
  it("maps an authenticated payload to the display name", () => {
    expect(
      resolveControlState({
        authenticated: true,
        user: { displayName: "  Alice Chen  ", email: "alice.chen@contoso.com" },
      }),
    ).toEqual({ status: "authenticated", displayName: "Alice Chen" })
  })

  it("treats anything else as anonymous", () => {
    expect(resolveControlState({ authenticated: false })).toEqual({ status: "anonymous" })
    expect(resolveControlState({ authenticated: true, user: { displayName: "" } })).toEqual({
      status: "anonymous",
    })
    expect(resolveControlState({ authenticated: true })).toEqual({ status: "anonymous" })
    expect(resolveControlState(null)).toEqual({ status: "anonymous" })
    expect(resolveControlState("garbage")).toEqual({ status: "anonymous" })
  })
})
