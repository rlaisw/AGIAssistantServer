import { errorMessage } from "./errors"

export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null
  return errorMessage(code)
}
