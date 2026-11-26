export const runtime = "nodejs"

import { timingSafeEqual } from "node:crypto"

import { loadProfilesConfig } from "@/lib/profiles/config"
import { toProfileError } from "@/lib/profiles/errors"
import { ensureProfile } from "@/lib/profiles/provision"

function sameToken(header: string | null, expected: string): boolean {
  const given = (header ?? "").replace(/^Bearer\s+/i, "")
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: Request): Promise<Response> {
  let cfg
  try {
    cfg = loadProfilesConfig()
  } catch {
    return Response.json({ error: "config_invalid" }, { status: 500 })
  }
  if (!sameToken(req.headers.get("authorization"), cfg.provisionToken)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  let body: { slug?: unknown; oid?: unknown; email?: unknown; displayName?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "invalid_profile_request" }, { status: 422 })
  }
  if (
    typeof body.slug !== "string" ||
    typeof body.oid !== "string" ||
    typeof body.email !== "string" ||
    (body.displayName !== undefined && typeof body.displayName !== "string")
  ) {
    return Response.json({ error: "invalid_profile_request" }, { status: 422 })
  }
  try {
    const result = await ensureProfile(cfg, {
      slug: body.slug,
      oid: body.oid,
      email: body.email,
      displayName: body.displayName,
    })
    return Response.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    const profileError = toProfileError(error)
    return Response.json({ error: profileError.code }, { status: profileError.status })
  }
}
