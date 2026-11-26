export const runtime = "nodejs"

import { timingSafeEqual } from "node:crypto"

import { loadProfilesConfig } from "@/lib/profiles/config"
import { Registry } from "@/lib/profiles/registry"

function sameToken(header: string | null, expected: string): boolean {
  const given = (header ?? "").replace(/^Bearer\s+/i, "")
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(req: Request): Promise<Response> {
  let cfg
  try {
    cfg = loadProfilesConfig()
  } catch {
    return Response.json({ error: "config_invalid" }, { status: 500 })
  }
  if (!sameToken(req.headers.get("authorization"), cfg.provisionToken)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const slug = new URL(req.url).searchParams.get("slug") ?? ""
  try {
    const entry = new Registry(cfg.registryPath).bySlug(slug)
    if (!entry) return Response.json({ error: "profile_missing" }, { status: 404 })
    return Response.json({
      slug: entry.slug,
      status: entry.status,
      createdAt: entry.createdAt,
      lastSeenAt: entry.lastSeenAt,
      lastError: entry.lastError,
    })
  } catch {
    return Response.json({ error: "registry_unavailable" }, { status: 503 })
  }
}
