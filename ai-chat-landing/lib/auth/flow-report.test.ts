import { describe, expect, it } from "vitest"

import { formatFlowReport } from "../../scripts/entra-flow-check.mjs"

describe("formatFlowReport (FR-016)", () => {
  it("reports per-step pass/fail, the count, and claim presence without values", () => {
    const report = formatFlowReport(
      [
        { name: "authorize redirect", ok: true },
        { name: "token exchange", ok: false, detail: "invalid_grant" },
        { name: "claims", ok: true },
      ],
      { oid: true, email: true, tid: true, nonce: false },
      { idTokenSeconds: 3600, refreshPresent: true },
    )
    expect(report).toContain("1. PASS authorize redirect")
    expect(report).toContain("2. FAIL token exchange (invalid_grant)")
    expect(report).toContain("2/3 steps passed")
    expect(report).toContain("oid=yes email=yes tid=yes nonce=no")
    expect(report).toContain("refresh token: present")
  })
})
