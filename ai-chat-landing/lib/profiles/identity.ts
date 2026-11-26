import { createHash } from "node:crypto"
import { deriveSlug, collisionSuffix } from "@/lib/auth/slug"
import { ProfileError } from "./errors"

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export function oidHash(oid: string): string {
  return createHash("sha256").update(oid.trim()).digest("hex").slice(0, 16)
}

export function assertSlug(slug: string): string {
  if (!SLUG_RE.test(slug) || slug.includes("..")) {
    throw new ProfileError("invalid_profile_request", "slug")
  }
  return slug
}

/** Base slug from verified identity; the registry may add the oid suffix on collision. */
export function baseSlugFor(email: string): string {
  return assertSlug(deriveSlug(email))
}

export function collisionSlug(base: string, oid: string): string {
  return assertSlug(`${base}-${collisionSuffix(oid)}`)
}
