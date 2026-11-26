import { describe, expect, it, vi } from "vitest"
import { LEGACY_USER, exportLegacyConversations } from "./legacy.mjs"

function page(body: unknown) {
  return Response.json(body)
}

describe("legacy history export (T022 / FR-026)", () => {
  it("exports the retired shared user's conversations with messages", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url)
      if (href.includes("/conversations?")) return page({ data: [{ id: "c1" }, { id: "c2" }], has_more: false })
      return page({ data: [{ id: "m1" }], has_more: false })
    })
    const out = await exportLegacyConversations({
      apiBase: "http://dify.test/v1",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(out.conversations).toHaveLength(2)
    expect(out.messages.c1).toHaveLength(1)
    const first = String(fetchImpl.mock.calls[0][0])
    expect(first).toContain(`user=${LEGACY_USER}`)
  })

  it("paginates with last_id", async () => {
    let conversationCalls = 0
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (!String(url).includes("/conversations?")) return page({ data: [] })
      conversationCalls += 1
      if (conversationCalls === 1) return page({ data: [{ id: "c1" }], has_more: true })
      if (conversationCalls === 2) return page({ data: [{ id: "c2" }], has_more: false })
      return page({ data: [] })
    })
    const out = await exportLegacyConversations({
      apiBase: "http://dify.test/v1",
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(out.conversations).toHaveLength(2)
    expect(String(fetchImpl.mock.calls[1][0])).toContain("last_id=c1")
  })
})
