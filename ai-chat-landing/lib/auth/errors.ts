export type AuthErrorCode =
  | "config_invalid"
  | "idp_unavailable"
  | "signin_cancelled"
  | "invalid_state"
  | "signin_failed"
  | "token_invalid"
  | "identity_incomplete"
  | "tenant_not_allowed"
  | "session_expired"
  | "reauthentication_required"
  | "signin_required"
  | "invalid_request"
  | "internal_error"

type Definition = { status: number; message: string; retryable: boolean }

export const AUTH_ERRORS: Record<AuthErrorCode, Definition> = {
  config_invalid: { status: 500, message: "Sign-in is not configured on this server.", retryable: false },
  idp_unavailable: { status: 503, message: "The organization's sign-in service is unavailable. Try again.", retryable: true },
  signin_cancelled: { status: 400, message: "Sign-in was cancelled.", retryable: true },
  invalid_state: { status: 400, message: "That sign-in attempt expired. Please try again.", retryable: true },
  signin_failed: { status: 400, message: "Sign-in could not be completed.", retryable: true },
  token_invalid: { status: 400, message: "Sign-in could not be verified.", retryable: true },
  identity_incomplete: { status: 400, message: "Your organization did not provide a usable identity.", retryable: false },
  tenant_not_allowed: { status: 403, message: "Use your organization account to sign in.", retryable: false },
  session_expired: { status: 401, message: "Your session has ended. Please sign in again.", retryable: true },
  reauthentication_required: { status: 401, message: "Please sign in again.", retryable: true },
  signin_required: { status: 401, message: "Please sign in to continue.", retryable: true },
  invalid_request: { status: 403, message: "That request could not be processed.", retryable: false },
  internal_error: { status: 500, message: "Something went wrong. Please try again.", retryable: true },
}

export class AuthError extends Error {
  readonly code: AuthErrorCode
  readonly httpStatus: number
  readonly userMessage: string
  readonly retryable: boolean
  readonly detail?: string

  constructor(code: AuthErrorCode, opts: { detail?: string } = {}) {
    const def = AUTH_ERRORS[code]
    super(def.message)
    this.name = "AuthError"
    this.code = code
    this.httpStatus = def.status
    this.userMessage = def.message
    this.retryable = def.retryable
    this.detail = opts.detail
  }
}

export function isAuthError(value: unknown): value is AuthError {
  return value instanceof AuthError
}

export function toAuthError(value: unknown): AuthError {
  if (isAuthError(value)) return value
  return new AuthError("internal_error", {
    detail: value instanceof Error ? value.message : String(value),
  })
}

export function errorMessage(code: string): string {
  return AUTH_ERRORS[code as AuthErrorCode]?.message ?? AUTH_ERRORS.internal_error.message
}
