import { loadAuthConfig } from "@/lib/auth/config"
import { getIdentity } from "@/lib/auth/guard"
import type { Identity } from "@/lib/auth/claims"
import { baseSlugFor, oidHash } from "./identity"

export const LEGACY_DIFY_USER = "ai-chat-ui-user"
export const ANON_DIFY_USER = "u-anon"

export function difyUserFor(identity: Identity | null): string {
  if (!identity) return ANON_DIFY_USER
  return `u-${oidHash(identity.oid)}`
}

/** Server-side identity from the Phase 1 session; null when anonymous or unconfigured. */
export function requestIdentity(req: Request): Identity | null {
  try {
    return getIdentity(req, loadAuthConfig())
  } catch {
    return null
  }
}

export function identityInputs(identity: Identity | null): Record<string, string> {
  if (!identity) return {}
  return { hermes_slug: baseSlugFor(identity.email), hermes_email: identity.email, hermes_oid: identity.oid }
}
