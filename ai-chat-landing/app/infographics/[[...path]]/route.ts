// Spec 052: same-origin proxy to the infographic server. Profiled URLs
// (/infographics/p/<slug>/<id>/...) enforce ownership against the session.
import { NextResponse } from "next/server"
import { getIdentity } from "@/lib/auth/guard"
import { identityInputs } from "@/lib/profiles/identity-user"
import { loadAuthConfig } from "@/lib/auth/config"

const UPSTREAM = process.env.INFOGRAPHIC_UPSTREAM ?? "http://127.0.0.1:28080"
const PATH_RE = /^(?:p\/([a-z0-9-]+)\/)?([0-9a-f]{10,})(\/.*)?$/

export async function GET(req: Request) {
  const joined = new URL(req.url).pathname.replace(/^\/infographics\/?/, "").split("/").filter(Boolean).join("/")
  const m = PATH_RE.exec(joined)
  if (!m) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  if (m[1] !== undefined) {
    // spec 052 FR-007: profiled URLs open only for the owning session
    const identity = (() => { try { return getIdentity(req, loadAuthConfig()) } catch { return null } })()
    const owner = identity ? identityInputs(identity).hermes_slug : ""
    if (!owner || owner !== m[1]) {
      return NextResponse.json({ error: "forbidden: this infographic belongs to another user" }, { status: 403 })
    }
  }
  // bug missing-infograhics-url: the p/<slug>/ namespace is app-level only —
  // the infographic server understands /infographics/<id>[/asset]; strip it.
  const asset = m[3] ?? ""
  // bare-id requests (Next strips the trailing slash) get the directory form
  // upstream; asset paths keep their exact suffix
  const upstreamPath = "/infographics/" + m[2] + (asset || "/")
  try {
    const res = await fetch(UPSTREAM + upstreamPath, { headers: { accept: req.headers.get("accept") ?? "*/*" }, redirect: "manual" })
    // upstream 307s bare ids to the loopback host — rewrite Location to same-origin
    const headers = new Headers()
    const contentType = res.headers.get("content-type")
    if (contentType) headers.set("content-type", contentType)
    const location = res.headers.get("location")
    if (location) {
      try {
        headers.set("location", new URL(location, UPSTREAM).pathname + new URL(location).search)
      } catch {
        headers.set("location", location)
      }
    }
    const body = await res.arrayBuffer()
    return new NextResponse(body, { status: res.status, headers })
  } catch {
    return NextResponse.json({ error: "infographic service unavailable" }, { status: 502 })
  }
}
