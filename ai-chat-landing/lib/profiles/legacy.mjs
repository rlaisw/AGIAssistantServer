// FR-026: pre-cutover Dify conversations, operator export only.
export const LEGACY_USER = "ai-chat-ui-user"

/**
 * @param {{apiBase: string, apiKey: string, user?: string, fetchImpl?: typeof fetch}} opts
 * @returns {Promise<{conversations: unknown[], messages: Record<string, unknown[][]>}>}
 */
export async function exportLegacyConversations(opts) {
  const base = opts.apiBase.replace(/\/+$/, "")
  const user = opts.user ?? LEGACY_USER
  const doFetch = opts.fetchImpl ?? fetch
  const headers = { Authorization: `Bearer ${opts.apiKey}` }
  const getJson = async (path) => {
    const res = await doFetch(`${base}${path}`, { headers })
    if (!res.ok) throw new Error(`Dify ${path} → HTTP ${res.status}`)
    return res.json()
  }
  const conversations = []
  let lastId = ""
  for (;;) {
    const params = new URLSearchParams({ user, limit: "100" })
    if (lastId) params.set("last_id", lastId)
    const page = await getJson(`/conversations?${params}`)
    const data = page.data ?? []
    conversations.push(...data)
    if (!page.has_more || data.length === 0) break
    lastId = String(data[data.length - 1].id)
  }
  const messages = {}
  for (const item of conversations) {
    const id = item.id
    const params = new URLSearchParams({ conversation_id: id, user, limit: "100" })
    const page = await getJson(`/messages?${params}`)
    messages[id] = [page.data ?? []]
  }
  return { conversations, messages }
}
