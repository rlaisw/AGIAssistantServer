export const SIGNED_OUT_FLAG = "hermes:signed-out"

type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

/** Marks an explicit sign-out so the next sign-in forces the account picker (FR-011). */
export function markSignedOut(storage: StorageLike | null | undefined): void {
  try {
    storage?.setItem(SIGNED_OUT_FLAG, "1")
  } catch {
    // storage unavailable (private mode): the tenant logout URL still prompts
  }
}

/** Sign-in URL; consumes the sign-out flag so the picker is forced exactly once. */
export function signInUrl(
  storage: StorageLike | null | undefined,
  returnTo = "/",
): string {
  const params = new URLSearchParams({ returnTo })
  try {
    if (storage?.getItem(SIGNED_OUT_FLAG)) {
      params.set("prompt", "select_account")
      storage.removeItem(SIGNED_OUT_FLAG)
    }
  } catch {
    // storage unavailable: plain sign-in, no forced picker
  }
  return `/api/auth/signin?${params.toString()}`
}
