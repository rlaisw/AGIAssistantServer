import { createHash } from "node:crypto"

export type AuthLogEventName =
  | "signin_success"
  | "signin_failure"
  | "renewal"
  | "signout"
  | "guard_blocked"
  | "session_evicted"

export type AuthLogEvent = {
  event: AuthLogEventName
  code?: string
  requestId?: string
  oid?: string | null
  detail?: string
}

export function oidHash(oid: string | null | undefined): string | undefined {
  if (!oid) return undefined
  return createHash("sha256").update(oid).digest("hex").slice(0, 12)
}

export function logAuthEvent(event: AuthLogEvent): void {
  const payload: Record<string, unknown> = { auth: true, event: event.event }
  if (event.code) payload.code = event.code
  if (event.requestId) payload.requestId = event.requestId
  const hashed = oidHash(event.oid)
  if (hashed) payload.oidHash = hashed
  if (event.detail) payload.detail = event.detail
  console.info(JSON.stringify(payload))
}
