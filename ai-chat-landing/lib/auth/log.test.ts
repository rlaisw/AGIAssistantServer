import { describe, expect, it } from "vitest"

import { logAuthEvent, oidHash } from "./log"
import { spyOnAuthLog } from "./testing/log-spy"

describe("logAuthEvent (U24)", () => {
  it("logs a hashed oid and never the raw identity or a token", () => {
    const spy = spyOnAuthLog()
    try {
      logAuthEvent({
        event: "signin_success",
        requestId: "req-1",
        oid: "11111111-1111-1111-1111-111111111111",
      })
      logAuthEvent({ event: "signin_failure", code: "invalid_state", requestId: "req-2" })
      const text = spy.text()
      expect(text).not.toContain("11111111-1111-1111-1111-111111111111")
      expect(text).not.toContain("access-token")
      const entries = spy.entries()
      expect(entries[0].event).toBe("signin_success")
      expect(entries[0].oidHash).toBe(oidHash("11111111-1111-1111-1111-111111111111"))
      expect(entries[0]).not.toHaveProperty("oid")
      expect(entries[1]).toMatchObject({ event: "signin_failure", code: "invalid_state" })
    } finally {
      spy.restore()
    }
  })

  it("produces a stable 12-character hash and omits it when no oid is known", () => {
    const hash = oidHash("abc")
    expect(hash).toHaveLength(12)
    expect(oidHash("abc")).toBe(hash)
    expect(oidHash(null)).toBeUndefined()
  })
})
