export type SessionPayload = {
  authenticated?: boolean
  user?: { displayName?: unknown; email?: unknown }
}

export type ControlState =
  | { status: "anonymous" }
  | { status: "authenticated"; displayName: string }

export function resolveControlState(payload: unknown): ControlState {
  const p = payload as SessionPayload | null
  if (
    p &&
    p.authenticated === true &&
    p.user &&
    typeof p.user.displayName === "string" &&
    p.user.displayName.trim().length > 0
  ) {
    return { status: "authenticated", displayName: p.user.displayName.trim() }
  }
  return { status: "anonymous" }
}
