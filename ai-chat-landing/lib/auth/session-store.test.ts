import { describe, expect, it } from "vitest"

import {
  ABSOLUTE_MS,
  AuthStore,
  IDLE_MS,
  PREAUTH_MS,
  sanitizeReturnTo,
  type AuthSession,
} from "./session-store"
import type { Identity } from "./claims"
import { spyOnAuthLog } from "./testing/log-spy"

const HOUR = 60 * 60 * 1000

const identity: Identity = {
  oid: "11111111-1111-1111-1111-111111111111",
  tid: "22222222-2222-2222-2222-222222222222",
  email: "alice.chen@contoso.com",
  emailSource: "email",
  displayName: "Alice Chen",
  signedInAt: new Date(0).toISOString(),
}

function storeAt(start = 0, cap?: number) {
  let now = start
  const store = new AuthStore({ now: () => now, cap })
  return {
    store,
    at: (value: number) => {
      now = value
    },
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe("AuthStore", () => {
  it("U22: sanitizes return paths", () => {
    expect(sanitizeReturnTo("/")).toBe("/")
    expect(sanitizeReturnTo("/chat?x=1")).toBe("/chat?x=1")
    expect(sanitizeReturnTo("//evil.example")).toBe("/")
    expect(sanitizeReturnTo("https://evil.example")).toBe("/")
    expect(sanitizeReturnTo("/\\evil.example")).toBe("/")
    expect(sanitizeReturnTo("javascript:alert(1)")).toBe("/")
    expect(sanitizeReturnTo(null)).toBe("/")
    expect(sanitizeReturnTo("/a\nb")).toBe("/")
  })

  it("U14: idle expiry at 8 hours of inactivity", () => {
    const { store, at } = storeAt(0)
    const session = store.createSession(identity)
    at(IDLE_MS - 60_000)
    expect(store.getSession(session.handle)).not.toBeNull()
    at(IDLE_MS + 60_000)
    expect(store.getSession(session.handle)).toBeNull()
  })

  it("U15: the 12-hour absolute cap survives activity and renewal", () => {
    const { store, at } = storeAt(0)
    const session = store.createSession(identity)
    at(7 * HOUR)
    expect(store.touch(session.handle)).not.toBeNull()
    at(ABSOLUTE_MS - 60_000)
    expect(store.touch(session.handle)).not.toBeNull()
    store.setRenewed(session.handle, { accessTokenExpiresAt: new Date(ABSOLUTE_MS + 10 * HOUR).toISOString() })
    at(ABSOLUTE_MS + 60_000)
    expect(store.getSession(session.handle)).toBeNull()
  })

  it("U14b: touch is debounced to one update per minute", () => {
    const { store, advance } = storeAt(0)
    const session = store.createSession(identity)
    advance(30_000)
    store.touch(session.handle)
    expect(session.lastSeenAt).toBe(new Date(0).toISOString())
    advance(31_000)
    store.touch(session.handle)
    expect(session.lastSeenAt).toBe(new Date(61_000).toISOString())
  })

  it("U16: one renewal failure survives, the second ends the session", () => {
    const { store } = storeAt(0)
    const session = store.createSession(identity)
    expect(store.renewalFailed(session.handle)).toBe("ok")
    expect(store.getSession(session.handle)).not.toBeNull()
    expect(store.renewalFailed(session.handle)).toBe("ended")
    expect(store.getSession(session.handle)).toBeNull()
  })

  it("U17: sweep removes expired sessions", () => {
    const { store, at } = storeAt(0)
    store.createSession(identity)
    at(ABSOLUTE_MS + 1)
    store.sweep()
    expect(store.size).toBe(0)
  })

  it("U23: the session cap evicts the least recently seen", () => {
    const { store, advance } = storeAt(0, 2)
    const first = store.createSession(identity)
    advance(1000)
    const second = store.createSession(identity)
    advance(1000)
    const third = store.createSession(identity)
    expect(store.size).toBe(2)
    expect(store.getSession(first.handle)).toBeNull()
    expect(store.getSession(second.handle)).not.toBeNull()
    expect(store.getSession(third.handle)).not.toBeNull()
  })

  it("pre-auth transactions are single use and expire", () => {
    const { store, at } = storeAt(0)
    const tx = store.createPreAuth({
      handle: "h1",
      state: "s",
      nonce: "n",
      codeVerifier: "v",
      returnTo: "/chat",
    })
    expect(tx.returnTo).toBe("/chat")
    expect(store.takePreAuth("h1")?.handle).toBe("h1")
    expect(store.takePreAuth("h1")).toBeNull()

    store.createPreAuth({ handle: "h2", state: "s", nonce: "n", codeVerifier: "v" })
    at(PREAUTH_MS + 1)
    expect(store.takePreAuth("h2")).toBeNull()
  })

  it("U23b: handles are 32 random base64url bytes and eviction is logged without the raw oid", () => {
    const spy = spyOnAuthLog()
    try {
      const { store, advance } = storeAt(0, 1)
      const first = store.createSession(identity)
      expect(first.handle).toMatch(/^[A-Za-z0-9_-]{43}$/)
      advance(1000)
      store.createSession(identity)
      const log = spy.text()
      expect(log).toContain("session_evicted")
      expect(log).not.toContain(identity.oid)
    } finally {
      spy.restore()
    }
  })

  it("unknown handles never resolve", () => {
    const { store } = storeAt(0)
    expect(store.getSession("nope")).toBeNull()
    expect(store.getSession(null)).toBeNull()
    const session: AuthSession | null = store.getSession("missing")
    expect(session).toBeNull()
  })
})
