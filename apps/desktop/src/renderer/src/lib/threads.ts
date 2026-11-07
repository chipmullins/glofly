import type { ApiResult } from '@glofly/shared'
import type { ThreadSummary } from '@glofly/shared/threads'

// Communities round (Nov 2026): threads + forum posts (server threads/routes.ts), through the
// constellations gateway (only /constellations/… goes through it).

const call = <T,>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<ApiResult<T>> =>
  window.glofly.constellations.request<T>(method, path, body)

export type ThreadList = { threads: ThreadSummary[]; hasMore: boolean }
export type ThreadChange = { title?: string; tagIds?: string[]; closed?: boolean; pinned?: boolean; answerMessageId?: string | null }

export const threads = {
  list: (cid: string, nebulaId: string, q: { q?: string; tag?: string; sort?: 'activity' | 'newest'; offset?: number; closed?: boolean } = {}) => {
    const p = new URLSearchParams()
    if (q.q) p.set('q', q.q)
    if (q.tag) p.set('tag', q.tag)
    if (q.sort) p.set('sort', q.sort)
    if (q.offset) p.set('offset', String(q.offset))
    if (q.closed) p.set('closed', '1')
    return call<ThreadList>('GET', `/constellations/${cid}/nebulas/${nebulaId}/threads${p.size ? `?${p}` : ''}`)
  },
  start: (cid: string, nebulaId: string, values: { parentMessageId?: string; title?: string; tagIds?: string[] }) =>
    call<{ thread: ThreadSummary; existed?: boolean }>('POST', `/constellations/${cid}/nebulas/${nebulaId}/threads`, values),
  get: (cid: string, threadId: string) => call<{ thread: ThreadSummary }>('GET', `/constellations/${cid}/threads/${threadId}`),
  change: (cid: string, threadId: string, changes: ThreadChange) =>
    call<{ thread: ThreadSummary }>('PATCH', `/constellations/${cid}/threads/${threadId}`, changes),
  remove: (cid: string, threadId: string) => call<{ ok: true }>('DELETE', `/constellations/${cid}/threads/${threadId}`),
  follow: (cid: string, threadId: string, following: boolean) =>
    call<{ thread: ThreadSummary }>('PUT', `/constellations/${cid}/threads/${threadId}/follow`, { following })
}
