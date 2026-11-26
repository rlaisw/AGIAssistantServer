export type ProfileErrorCode =
  | "unauthorized"
  | "invalid_profile_request"
  | "provisioning_in_progress"
  | "provision_failed"
  | "registry_unavailable"
  | "profile_misconfigured"
  | "profile_auth_failed"
  | "profile_disabled"
  | "profile_missing"
  | "agent_busy"
  | "agent_unavailable"
  | "tool_unavailable"
  | "history_scope_failed"
  | "legacy_conversation"
  | "identity_required"
  | "slug_collision"

export const PROFILE_ERRORS: Record<ProfileErrorCode, { status: number; message: string }> = {
  unauthorized: { status: 401, message: "This service call is not authorized." },
  invalid_profile_request: { status: 422, message: "The profile request was not valid." },
  provisioning_in_progress: { status: 409, message: "Your assistant profile is being created; try again shortly." },
  provision_failed: { status: 500, message: "Your assistant profile could not be created. Try again." },
  registry_unavailable: { status: 503, message: "Profile setup is temporarily unavailable." },
  profile_misconfigured: { status: 500, message: "Your assistant profile is not configured correctly. Contact the administrator." },
  profile_auth_failed: { status: 401, message: "Your assistant access is not valid. Contact the administrator." },
  profile_disabled: { status: 403, message: "Your assistant profile is disabled." },
  profile_missing: { status: 404, message: "Your assistant profile was not found." },
  agent_busy: { status: 429, message: "The assistant is busy. Try again in a moment." },
  agent_unavailable: { status: 503, message: "The assistant host is temporarily unavailable." },
  tool_unavailable: { status: 200, message: "The Windows tools are unavailable right now." },
  history_scope_failed: { status: 500, message: "Chat history could not be scoped to your account; the message was not sent." },
  legacy_conversation: { status: 404, message: "That conversation is no longer available." },
  identity_required: { status: 401, message: "Please sign in to use your own assistant." },
  slug_collision: { status: 200, message: "A distinct profile name was assigned." },
}

export class ProfileError extends Error {
  readonly code: ProfileErrorCode
  readonly status: number
  readonly userMessage: string
  constructor(code: ProfileErrorCode, detail?: string) {
    super(detail ?? code)
    this.name = "ProfileError"
    this.code = code
    this.status = PROFILE_ERRORS[code].status
    this.userMessage = PROFILE_ERRORS[code].message
  }
}

export function toProfileError(value: unknown): ProfileError {
  if (value instanceof ProfileError) return value
  return new ProfileError("provision_failed", value instanceof Error ? value.message : String(value))
}
