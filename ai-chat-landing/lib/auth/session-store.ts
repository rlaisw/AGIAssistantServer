import { randomBytes } from "node:crypto"

import type { Identity } from "./claims"
import { logAuthEvent } from "./log"

export const IDLE_MS = 8 * 60 * 60 * 1000
export const ABSOLUTE_MS = 12 * 60 * 60 * 1000
export const PREAUTH_MS = 10 * 60 * 1000
export const SWEEP_MS = 60 * 1000
export const TOUCH_DEBOUNCE_MS = 60 * 1000
export const SESSION_CAP = 1000

export type SessionTokens = {
  accessToken?: string
  refreshToken?: string
  accessTokenExpiresAt?: string
  idTokenExpiresAt?: string
}

export type AuthSession = {
  handle: string
  identity: Identity
  createdAt: string
  lastSeenAt: string
  absoluteExpiresAt: string
  tokens: SessionTokens
  renewal: { lastRenewalAt?: string; consecutiveFailures: number }
  status: "active"
}

export type PreAuthTransaction = {
  handle: string
  state: string
  nonce: string
  codeVerifier: string
  returnTo: string
  createdAt: string
  expiresAt: string
  usedAt?: string
}

export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value) return "/"
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/"
  if (/[\u0000-\u001f]/.test(value)) return "/"
  try {
    const url = new URL(value, "http://local.invalid")
    if (url.origin !== "http://local.invalid") return "/"
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return "/"
  }
}

export class AuthStore {
  private sessions = new Map<string, AuthSession>()
  private preAuth = new Map<string, PreAuthTransaction>()
  private readonly now: () => number
  private readonly cap: number
  private lastSweep = 0

  constructor(opts: { now?: () => number; cap?: number } = {}) {
    this.now = opts.now ?? Date.now
    this.cap = opts.cap ?? SESSION_CAP
  }

  createPreAuth(input: {
    handle: string
    state: string
    nonce: string
    codeVerifier: string
    returnTo?: string | null
  }): PreAuthTransaction {
    const now = this.now()
    const tx: PreAuthTransaction = {
      handle: input.handle,
      state: input.state,
      nonce: input.nonce,
      codeVerifier: input.codeVerifier,
      returnTo: sanitizeReturnTo(input.returnTo),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PREAUTH_MS).toISOString(),
    }
    this.preAuth.set(tx.handle, tx)
    this.maybeSweep(now)
    return tx
  }

  takePreAuth(handle: string | null): PreAuthTransaction | null {
    if (!handle) return null
    const tx = this.preAuth.get(handle)
    if (!tx) return null
    if (tx.usedAt || Date.parse(tx.expiresAt) <= this.now()) return null
    tx.usedAt = new Date(this.now()).toISOString()
    return tx
  }

  createSession(identity: Identity, tokens: SessionTokens = {}): AuthSession {
    const now = this.now()
    if (this.sessions.size >= this.cap) this.evictOldest()
    const session: AuthSession = {
      handle: randomBytes(32).toString("base64url"),
      identity,
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      absoluteExpiresAt: new Date(now + ABSOLUTE_MS).toISOString(),
      tokens,
      renewal: { consecutiveFailures: 0 },
      status: "active",
    }
    this.sessions.set(session.handle, session)
    this.maybeSweep(now)
    return session
  }

  getSession(handle: string | null): AuthSession | null {
    if (!handle) return null
    const session = this.sessions.get(handle)
    if (!session) return null
    const now = this.now()
    if (now >= Date.parse(session.absoluteExpiresAt) || now >= this.idleDeadline(session)) {
      this.sessions.delete(handle)
      return null
    }
    return session
  }

  touch(handle: string): AuthSession | null {
    const session = this.getSession(handle)
    if (!session) return null
    const now = this.now()
    if (now - Date.parse(session.lastSeenAt) >= TOUCH_DEBOUNCE_MS) {
      session.lastSeenAt = new Date(Math.min(now, Date.parse(session.absoluteExpiresAt))).toISOString()
    }
    return session
  }

  setRenewed(handle: string, tokens: SessionTokens): AuthSession | null {
    const session = this.getSession(handle)
    if (!session) return null
    session.tokens = { ...session.tokens, ...tokens }
    session.renewal.consecutiveFailures = 0
    session.renewal.lastRenewalAt = new Date(this.now()).toISOString()
    return session
  }

  renewalFailed(handle: string): "ok" | "ended" {
    const session = this.getSession(handle)
    if (!session) return "ended"
    session.renewal.consecutiveFailures += 1
    if (session.renewal.consecutiveFailures >= 2) {
      this.sessions.delete(handle)
      return "ended"
    }
    return "ok"
  }

  endSession(handle: string | null): void {
    if (handle) this.sessions.delete(handle)
  }

  get size(): number {
    return this.sessions.size
  }

  sweep(): void {
    const now = this.now()
    for (const [handle, session] of this.sessions) {
      if (now >= Date.parse(session.absoluteExpiresAt) || now >= this.idleDeadline(session)) {
        this.sessions.delete(handle)
      }
    }
    for (const [handle, tx] of this.preAuth) {
      if (Date.parse(tx.expiresAt) + 5 * 60 * 1000 <= now) this.preAuth.delete(handle)
    }
    this.lastSweep = now
  }

  private idleDeadline(session: AuthSession): number {
    return Math.min(Date.parse(session.lastSeenAt) + IDLE_MS, Date.parse(session.absoluteExpiresAt))
  }

  private evictOldest(): void {
    let oldest: string | null = null
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [handle, session] of this.sessions) {
      const at = Date.parse(session.lastSeenAt)
      if (at < oldestAt) {
        oldestAt = at
        oldest = handle
      }
    }
    if (oldest) {
      const evicted = this.sessions.get(oldest)
      this.sessions.delete(oldest)
      logAuthEvent({ event: "session_evicted", code: "session_cap", oid: evicted?.identity.oid })
    }
  }

  private maybeSweep(now: number): void {
    if (now - this.lastSweep >= SWEEP_MS) this.sweep()
  }
}

declare global {
  var __hermesAuthStore: AuthStore | undefined
}

export function getStore(): AuthStore {
  if (!globalThis.__hermesAuthStore) globalThis.__hermesAuthStore = new AuthStore()
  return globalThis.__hermesAuthStore
}

export function resetStoreForTests(store?: AuthStore): AuthStore {
  globalThis.__hermesAuthStore = store ?? new AuthStore()
  return globalThis.__hermesAuthStore
}
