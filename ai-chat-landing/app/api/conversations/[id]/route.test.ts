import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DELETE } from "./route"

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

describe("DELETE /api/conversations/[id] (H1 / SC-010)", () => {
  it("deletes with the requester's scoped user, never the legacy constant", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const res = await DELETE(new Request("http://local/api/conversations/c1"), {
      params: Promise.resolve({ id: "c1" }),
    })
    expect(res.status).toBe(200)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body)) as { user: string }
    expect(body.user).toBe("u-anon")
    expect(body.user).not.toBe("ai-chat-ui-user")
  })
})
