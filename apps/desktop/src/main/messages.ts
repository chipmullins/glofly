import type {
  ApiResult,
  Attachment,
  ConversationSummary,
  Message,
  MessagePage,
  MessageSearchPage
} from '../preload/api-types'
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

const unwrapConversation = (
  result: ApiResult<{ conversation: ConversationSummary }>
): ApiResult<ConversationSummary> =>
  result.ok ? { ok: true, data: result.data.conversation } : result

/** Starts a group chat with friends. */
export async function createGroup(
  userIds: string[],
  name: string | null
): Promise<ApiResult<ConversationSummary>> {
  return unwrapConversation(await request('POST', '/conversations/group', { userIds, name }))
}

export async function renameGroup(
  conversationId: string,
  name: string | null
): Promise<ApiResult<ConversationSummary>> {
  return unwrapConversation(await request('PATCH', `/conversations/${conversationId}`, { name }))
}

export async function addMembers(
  conversationId: string,
  userIds: string[]
): Promise<ApiResult<ConversationSummary>> {
  return unwrapConversation(
    await request('POST', `/conversations/${conversationId}/members`, { userIds })
  )
}

/** Leaves a group (your own id) or removes someone from it. */
export async function removeMember(
  conversationId: string,
  userId: string
): Promise<ApiResult<null>> {
  const result = await request('DELETE', `/conversations/${conversationId}/members/${userId}`)
  return result.ok ? { ok: true, data: null } : result
}

export function loadMessages(
  conversationId: string,
  beforeMessageId?: string
): Promise<ApiResult<MessagePage>> {
  const query = beforeMessageId ? `?before=${beforeMessageId}` : ''
  return request<MessagePage>('GET', `/conversations/${conversationId}/messages${query}`)
}

/** Messages containing these words, newest first (one chat, or all of them). */
export function searchMessages(
  query: string,
  conversationId?: string,
  beforeMessageId?: string
): Promise<ApiResult<MessageSearchPage>> {
  const params = new URLSearchParams({ q: query })
  if (conversationId) params.set('chat', conversationId)
  if (beforeMessageId) params.set('before', beforeMessageId)
  return request<MessageSearchPage>('GET', `/conversations/messages/search?${params}`)
}

const unwrap = (result: ApiResult<{ message: Message }>): ApiResult<Message> =>
  result.ok ? { ok: true, data: result.data.message } : result

export async function sendMessage(
  conversationId: string,
  body: string,
  replyToId?: string,
  attachmentIds?: string[]
): Promise<ApiResult<Message>> {
  return unwrap(
    await request('POST', `/conversations/${conversationId}/messages`, {
      body,
      replyToId,
      ...(attachmentIds?.length ? { attachmentIds } : {})
    })
  )
}

/** Uploads a photo or file to send. It's attached when the message is sent. */
export async function uploadAttachment(
  conversationId: string,
  data: Uint8Array,
  name: string
): Promise<ApiResult<Attachment>> {
  const result = await request<{ attachment: Attachment }>(
    'POST',
    `/conversations/${conversationId}/attachments?name=${encodeURIComponent(name)}`,
    undefined,
    { data, type: 'application/octet-stream' }
  )
  return result.ok ? { ok: true, data: result.data.attachment } : result
}

/** Removes an upload that hasn't been sent. */
export async function removeUpload(
  conversationId: string,
  attachmentId: string
): Promise<ApiResult<null>> {
  const result = await request(
    'DELETE',
    `/conversations/${conversationId}/attachments/${attachmentId}`
  )
  return result.ok ? { ok: true, data: null } : result
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

/** Pins a chat to the top of the sidebar (up to 10), or unpins it. */
export async function pinConversation(
  conversationId: string,
  pinned: boolean
): Promise<ApiResult<null>> {
  const result = await request(pinned ? 'PUT' : 'DELETE', `/conversations/${conversationId}/pin`)
  return result.ok ? { ok: true, data: null } : result
}

export async function markRead(conversationId: string): Promise<ApiResult<null>> {
  const result = await request('POST', `/conversations/${conversationId}/read`)
  return result.ok ? { ok: true, data: null } : result
}
