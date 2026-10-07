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

const unwrap = (result: ApiResult<{ message: Message }>): ApiResult<Message> =>
  result.ok ? { ok: true, data: result.data.message } : result

export async function sendMessage(
  conversationId: string,
  body: string,
  replyToId?: string
): Promise<ApiResult<Message>> {
  return unwrap(
    await request('POST', `/conversations/${conversationId}/messages`, { body, replyToId })
  )
}

export async function editMessage(
  conversationId: string,
  messageId: string,
  body: string
): Promise<ApiResult<Message>> {
  return unwrap(
    await request('PATCH', `/conversations/${conversationId}/messages/${messageId}`, { body })
  )
}

export async function deleteMessage(
  conversationId: string,
  messageId: string
): Promise<ApiResult<Message>> {
  return unwrap(await request('DELETE', `/conversations/${conversationId}/messages/${messageId}`))
}

export async function reactToMessage(
  conversationId: string,
  messageId: string,
  emoji: string,
  on: boolean
): Promise<ApiResult<Message>> {
  const path = `/conversations/${conversationId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`
  return unwrap(await request(on ? 'PUT' : 'DELETE', path))
}

export async function markRead(conversationId: string): Promise<ApiResult<null>> {
  const result = await request('POST', `/conversations/${conversationId}/read`)
  return result.ok ? { ok: true, data: null } : result
}
