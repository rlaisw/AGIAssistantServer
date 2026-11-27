// Spec 052 U5–U9, H1–H5: proxy route contract tests
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

const ORIGIN = "http://localhost:3000"

async function callInfographic(path: string, headers?: Record<string, string>) {
  const { GET } = await import("./route")
  const req = new Request(ORIGIN + path, { headers: headers ?? {} })
  return GET(req as never)
}

beforeEach(() => {
  // anonymous by default; tests override with a stubbed module via vi.doMock below
})
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals() })

describe("infographic proxy route (spec 052)", () => {
  it("U9/H4: malformed slug → 400-level refusal via 404 shape", async () => {
    const res = await callInfographic("/infographics/p/Bad_Slug/4cafe75efa03/")
    expect([400, 404]).toContain(res.status)
  })

  it("H2: unknown id shape rejected", async () => {
    const res = await callInfographic("/infographics/not-a-valid-id/")
    expect(res.status).toBe(404)
  })

  it("H4: traversal rejected", async () => {
    const res = await callInfographic("/infographics/../../etc/passwd")
    expect([400, 404]).toContain(res.status)
  })

  it("H1/H5: profiled URL refused for anonymous sessions", async () => {
    const res = await callInfographic("/infographics/p/raymond-lai-tvb-com-hk/4cafe75efa03/")
    expect(res.status).toBe(403)
  })
})

describe("infographic proxy ownership (spec 052 U6/U7, SC-005)", () => {
  it("U6: owning session can fetch its own profiled infographic", async () => {
    vi.doMock("@/lib/auth/guard", () => ({
      getIdentity: () => ({ oid: "oid-1", email: "raymond.lai@tvb.com.hk", displayName: "Raymond Lai" }),
    }))
    vi.doMock("@/lib/auth/config", () => ({ loadAuthConfig: () => ({}) }))
    vi.resetModules()
    const { GET } = await import("./route")
    const res = await GET(new Request("http://localhost:3000/infographics/p/raymond-lai-tvb-com-hk/4cafe75efa03/") as never)
    // upstream unreachable in test env → either proxied status from upstream or 502; NOT 403
    expect(res.status).not.toBe(403)
  })

  it("U7: mismatched slug refused (SC-005)", async () => {
    vi.doMock("@/lib/auth/guard", () => ({
      getIdentity: () => ({ oid: "oid-1", email: "raymond.lai@tvb.com.hk", displayName: "Raymond Lai" }),
    }))
    vi.doMock("@/lib/auth/config", () => ({ loadAuthConfig: () => ({}) }))
    vi.resetModules()
    const { GET } = await import("./route")
    const res = await GET(new Request("http://localhost:3000/infographics/p/someone-else/4cafe75efa03/") as never)
    expect(res.status).toBe(403)
  })
})

describe("upstream path construction (bug missing-infograhics-url)", () => {
  it("strips the p/<slug>/ segment before proxying, bare id → directory form", async () => {
    vi.doMock("@/lib/auth/guard", () => ({
      getIdentity: () => ({ oid: "oid-1", email: "raymond.lai@tvb.com.hk", displayName: "Raymond Lai" }),
    }))
    vi.doMock("@/lib/auth/config", () => ({ loadAuthConfig: () => ({}) }))
    const forwarded: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      forwarded.push(String(url))
      return new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } })
    }))
    vi.resetModules()
    const { GET } = await import("./route")
    const res = await GET(new Request("http://localhost:3000/infographics/p/raymond-lai-tvb-com-hk/4cafe75efa03/") as never)
    expect(res.status).toBe(200)
    expect(forwarded[0]).toContain("/infographics/4cafe75efa03/")
    expect(forwarded[0]).not.toContain("/p/")
  })

  it("strips the profiled prefix for asset paths too", async () => {
    vi.doMock("@/lib/auth/guard", () => ({
      getIdentity: () => ({ oid: "oid-1", email: "raymond.lai@tvb.com.hk", displayName: "Raymond Lai" }),
    }))
    vi.doMock("@/lib/auth/config", () => ({ loadAuthConfig: () => ({}) }))
    const forwarded: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      forwarded.push(String(url))
      return new Response("x", { status: 200 })
    }))
    vi.resetModules()
    const { GET } = await import("./route")
    await GET(new Request("http://localhost:3000/infographics/p/raymond-lai-tvb-com-hk/4cafe75efa03/img.js") as never)
    expect(forwarded[0]).toContain("/infographics/4cafe75efa03/img.js")
    expect(forwarded[0]).not.toContain("/p/")
  })
})
