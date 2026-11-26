import { beforeEach, describe, expect, it, vi } from "vitest"

const mockIdentity = vi.hoisted(() => ({ current: null as null | { oid: string; email: string } }))

vi.mock("@/lib/profiles/identity-user", () => ({
  requestIdentity: () => mockIdentity.current,
  difyUserFor: (identity: { oid?: string } | null) => identity ? "u-signedin" : "u-anon",
  identityInputs: (identity: unknown) => identity
    ? { hermes_slug: "raymond-lai-tvb-com-hk", hermes_oid: "oid", hermes_email: "raymond.lai@tvb.com.hk" }
    : {},
}))

import { POST } from "./route"

let calls: { url: string; body: Record<string, unknown> }[] = []
beforeEach(() => {
  mockIdentity.current = null
  calls = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> })
    return Response.json({ ok: true })
  }))
  process.env.DIFY_API_KEY = "k"
  process.env.DIFY_API_BASE_URL = "http://dify.test/v1"
})

function req() {
  return new Request("http://local/api/chat/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId: "t1", conversationId: "c1" }),
  })
}

describe("POST /api/chat/stop (T065)", () => {
  it("uses the signed-in user for Dify and passes identity to the cancel call", async () => {
    mockIdentity.current = { oid: "oid", email: "raymond.lai@tvb.com.hk" }
    const res = await POST(req())
    await new Promise((r) => setTimeout(r, 20))
    expect(res.status).toBe(200)
    const dify = calls.find((c) => c.url.includes("/stop"))
    expect((dify?.body as { user?: string }).user).toBe("u-signedin")
    const mcp = calls.find((c) => (c.body as { method?: string }).method === "tools/call")
    const args = (mcp?.body as { params?: { arguments?: Record<string, string> } })?.params?.arguments ?? {}
    expect(args.hermes_slug).toBe("raymond-lai-tvb-com-hk")
    expect(args.hermes_oid).toBe("oid")
  })

  it("keeps anonymous Stop working without identity args", async () => {
    const res = await POST(req())
    await new Promise((r) => setTimeout(r, 20))
    expect(res.status).toBe(200)
    const dify = calls.find((c) => c.url.includes("/stop"))
    expect((dify?.body as { user?: string }).user).toBe("u-anon")
    const mcp = calls.find((c) => (c.body as { method?: string }).method === "tools/call")
    const args = (mcp?.body as { params?: { arguments?: Record<string, string> } })?.params?.arguments ?? {}
    expect(args.hermes_slug).toBeUndefined()
  })
})
