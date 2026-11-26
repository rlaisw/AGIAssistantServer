import { describe, expect, it } from "vitest"

import { SIGNED_OUT_FLAG, markSignedOut, signInUrl } from "./signin-url"

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    has: (key: string) => map.has(key),
  }
}

describe("signInUrl (FR-011 / T038)", () => {
  it("forces the account picker exactly once after an explicit sign-out", () => {
    const storage = memoryStorage()
    markSignedOut(storage)
    expect(storage.has(SIGNED_OUT_FLAG)).toBe(true)

    const first = new URL(`http://local${signInUrl(storage, "/chat")}`)
    expect(first.pathname).toBe("/api/auth/signin")
    expect(first.searchParams.get("returnTo")).toBe("/chat")
    expect(first.searchParams.get("prompt")).toBe("select_account")
    expect(storage.has(SIGNED_OUT_FLAG)).toBe(false)

    const second = new URL(`http://local${signInUrl(storage, "/chat")}`)
    expect(second.searchParams.get("prompt")).toBeNull()
  })

  it("uses a plain sign-in when there was no sign-out or storage is unavailable", () => {
    const noFlag = new URL(`http://local${signInUrl(memoryStorage())}`)
    expect(noFlag.searchParams.get("prompt")).toBeNull()
    const plain = new URL(`http://local${signInUrl(null)}`)
    expect(plain.searchParams.get("prompt")).toBeNull()
    expect(plain.searchParams.get("returnTo")).toBe("/")
  })

  it("does not fail when storage throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
      removeItem: () => {
        throw new Error("blocked")
      },
    }
    expect(() => markSignedOut(throwing)).not.toThrow()
    expect(new URL(`http://local${signInUrl(throwing)}`).searchParams.get("prompt")).toBeNull()
  })
})
