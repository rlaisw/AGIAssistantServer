import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "./route"

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  saved.DIFY_API_KEY = process.env.DIFY_API_KEY
  saved.DIFY_API_BASE_URL = process.env.DIFY_API_BASE_URL
  process.env.DIFY_API_KEY = "k"
  process.env.DIFY_API_BASE_URL = "http://dify.test/v1"
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
})

describe("GET /api/conversations/[id]/messages (T022 / SC-010)", () => {
  it("scopes a by-reference conversation read to the requester, never the legacy user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [], has_more: false }))
    vi.stubGlobal("fetch", fetchMock)
    const res = await GET(new Request("http://local/api/conversations/c1/messages"), {
      params: Promise.resolve({ id: "c1" }),
    })
    expect(res.status).toBe(200)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get("user")).toBe("u-anon")
    expect(url.searchParams.get("conversation_id")).toBe("c1")
    expect(url.toString()).not.toContain("ai-chat-ui-user")
  })
})
