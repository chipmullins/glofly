import type { Message, MessagePage } from '@glofly/shared'
import type { ThreadSummary } from '@glofly/shared/threads'
import { request } from '@/api/http'

// Communities round (Nov 2026): threads + forum posts (server threads/routes.ts).

export type ThreadList = { threads: ThreadSummary[]; hasMore: boolean }

export const threadsApi = {
  list: (cid: string, nebulaId: string, q: { q?: string; tag?: string; sort?: 'activity' | 'newest'; offset?: number } = {}) => {
    const p = new URLSearchParams()
    if (q.q) p.set('q', q.q)
    if (q.tag) p.set('tag', q.tag)
    if (q.sort) p.set('sort', q.sort)
    if (q.offset) p.set('offset', String(q.offset))
    const qs = p.toString()
    return request<ThreadList>('GET', `/constellations/${cid}/nebulas/${nebulaId}/threads${qs ? `?${qs}` : ''}`)
  },
  start: (cid: string, nebulaId: string, values: { parentMessageId?: string; title?: string; tagIds?: string[] }) =>
    request<{ thread: ThreadSummary; existed?: boolean }>('POST', `/constellations/${cid}/nebulas/${nebulaId}/threads`, values),
  get: (cid: string, threadId: string) => request<{ thread: ThreadSummary }>('GET', `/constellations/${cid}/threads/${threadId}`),
  change: (cid: string, threadId: string, changes: { title?: string; tagIds?: string[]; closed?: boolean; pinned?: boolean; answerMessageId?: string | null }) =>
    request<{ thread: ThreadSummary }>('PATCH', `/constellations/${cid}/threads/${threadId}`, changes),
  remove: (cid: string, threadId: string) => request<{ ok: true }>('DELETE', `/constellations/${cid}/threads/${threadId}`),
  follow: (cid: string, threadId: string, following: boolean) =>
    request<{ thread: ThreadSummary }>('PUT', `/constellations/${cid}/threads/${threadId}/follow`, { following }),
  read: (cid: string, threadId: string) => request<{ ok: true }>('POST', `/constellations/${cid}/threads/${threadId}/read`),
  messages: (conversationId: string, threadId: string, before?: string) =>
    request<MessagePage>('GET', `/conversations/${conversationId}/messages?thread=${threadId}${before ? `&before=${before}` : ''}`),
  send: (conversationId: string, threadId: string, body: string, replyToId?: string, alsoInNebula?: boolean) =>
    request<{ message: Message }>('POST', `/conversations/${conversationId}/messages`, {
      body,
      threadId,
      ...(replyToId ? { replyToId } : {}),
      ...(alsoInNebula ? { alsoInNebula: true } : {}),
    }),
}
