import type { ApiResult, ConversationSummary, Message, MessagePage } from '../preload/api-types'
import { request } from './api'

export async function listConversations(): Promise<ApiResult<ConversationSummary[]>> {
  const result = await request<{ conversations: ConversationSummary[] }>('GET', '/conversations')
  return result.ok ? { ok: true, data: result.data.conversations } : result
}

export async function openDm(userId: string): Promise<ApiResult<ConversationSummary>> {
  const result = await request<{ conversation: ConversationSummary }>('POST', '/conversations/dm', {
    userId
  })
  return result.ok ? { ok: true, data: result.data.conversation } : result
}

export function loadMessages(
  conversationId: string,
  beforeMessageId?: string
): Promise<ApiResult<MessagePage>> {
  const query = beforeMessageId ? `?before=${beforeMessageId}` : ''
  return request<MessagePage>('GET', `/conversations/${conversationId}/messages${query}`)
}

export async function sendMessage(
  conversationId: string,
  body: string
): Promise<ApiResult<Message>> {
  const result = await request<{ message: Message }>(
    'POST',
    `/conversations/${conversationId}/messages`,
    { body }
  )
  return result.ok ? { ok: true, data: result.data.message } : result
}

export async function markRead(conversationId: string): Promise<ApiResult<null>> {
  const result = await request('POST', `/conversations/${conversationId}/read`)
  return result.ok ? { ok: true, data: null } : result
}
