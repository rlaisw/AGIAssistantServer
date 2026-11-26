import { createHash } from "node:crypto"

import { AuthError } from "./errors"

/**
 * Deterministic per-user slug (spec 050 identity contract).
 *
 * The local part AND every DNS label of the domain are kept, because the same
 * person can exist as peter.chan@tvb.com.hk, @tvb.com.cn and @tvb.com — those
 * are three different identities and must never collapse to one slug.
 *
 *   peter.chan@tvb.com.hk -> peter-chan-tvb-com-hk
 *   peter.chan@tvb.com.cn -> peter-chan-tvb-com-cn
 *   peter.chan@tvb.com    -> peter-chan-tvb-com
 */
export function deriveSlug(email: string): string {
  const normalized = email
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")

  const parts = normalized.split("@")
  if (parts.length !== 2) throw new AuthError("identity_incomplete", { detail: "email" })
  const [local, domain] = parts
  if (!local || !domain) throw new AuthError("identity_incomplete", { detail: "email" })

  const slug = [local, ...domain.split(".")]
    .join("-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  if (!slug) throw new AuthError("identity_incomplete", { detail: "email" })
  return slug
}

/** Deterministic suffix used only when a slug is already taken (Phase 2 registry). */
export function collisionSuffix(oid: string): string {
  const normalized = oid.trim().toLowerCase()
  if (!normalized) throw new AuthError("identity_incomplete", { detail: "oid" })
  return createHash("sha256").update(normalized).digest("hex").slice(0, 8)
}

/** Slug with the oid-derived collision suffix; use only after a collision is detected. */
export function slugWithCollision(email: string, oid: string): string {
  return `${deriveSlug(email)}-${collisionSuffix(oid)}`
}
