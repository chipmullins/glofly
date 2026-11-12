import type {
  ApiResult,
  Attachment,
  ConversationSummary,
  ForwardResult,
  ForwardTarget,
  Message,
  MessagePage,
  MessageSearchPage,
  MuteDuration,
  VoiceInfo,
  PhotoType
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

/** Sets a group's photo (anyone in the group can). */
export const setGroupPhoto = (
  conversationId: string,
  data: Uint8Array,
  type: PhotoType
): Promise<ApiResult<{ photoVersion: string }>> =>
  request('PUT', `/conversations/${conversationId}/photo`, undefined, { data, type })

/** Back to the members' faces. */
export const removeGroupPhoto = (
  conversationId: string
): Promise<ApiResult<{ photoVersion: null }>> =>
  request('DELETE', `/conversations/${conversationId}/photo`)

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
  beforeMessageId?: string,
  threadId?: string
): Promise<ApiResult<MessagePage>> {
  const params = new URLSearchParams()
  if (beforeMessageId) params.set('before', beforeMessageId)
  // Communities round: a thread's replies
  if (threadId) params.set('thread', threadId)
  const query = params.size ? `?${params}` : ''
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
  attachmentIds?: string[],
  options?: {
    lantern?: boolean
    clientId?: string
    threadId?: string
    alsoInNebula?: boolean
    emojis?: string[]
  }
): Promise<ApiResult<Message>> {
  return unwrap(
    await request('POST', `/conversations/${conversationId}/messages`, {
      body,
      replyToId,
      ...(attachmentIds?.length ? { attachmentIds } : {}),
      ...(options?.lantern ? { lantern: true } : {}),
      ...(options?.clientId ? { clientId: options.clientId } : {}),
      ...(options?.emojis?.length ? { emojis: options.emojis } : {}),
      ...(options?.threadId
        ? { threadId: options.threadId, ...(options.alsoInNebula ? { alsoInNebula: true } : {}) }
        : {})
    })
  )
}

/** Uploads a photo or file to send. It's attached when the message is sent. */
export async function uploadAttachment(
  conversationId: string,
  data: Uint8Array,
  name: string,
  voice?: VoiceInfo
): Promise<ApiResult<Attachment>> {
  const voiceQuery = voice
    ? `&voice=1&duration=${Math.round(voice.durationMs)}&peaks=${voice.peaks.join(',')}`
    : ''
  const result = await request<{ attachment: Attachment }>(
    'POST',
    `/conversations/${conversationId}/attachments?name=${encodeURIComponent(name)}${voiceQuery}`,
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
  // Communities round 2: a custom emoji comes as ":name:#<id>" (the id says which picture).
  const custom = /^(:[A-Za-z0-9_]{2,32}:)#([0-9a-f-]{36})$/i.exec(emoji)
  const key = custom ? custom[1] : emoji
  if (!custom && emoji.length > 32)
    return { ok: false, error: 'invalid', message: "That isn't an emoji." }
  const path = `/conversations/${conversationId}/messages/${messageId}/reactions/${encodeURIComponent(key)}${custom && on ? `?id=${custom[2]}` : ''}`
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

/** Closes a chat in my sidebar (nothing deleted), or reopens it. */
export async function closeConversation(
  conversationId: string,
  closed: boolean
): Promise<ApiResult<null>> {
  const result = await request(closed ? 'PUT' : 'DELETE', `/conversations/${conversationId}/close`)
  return result.ok ? { ok: true, data: null } : result
}

/** My order for the Groups page (after dragging a group to a new place). */
export async function orderGroups(ids: string[]): Promise<ApiResult<null>> {
  const result = await request('PUT', '/conversations/groups/order', { ids })
  return result.ok ? { ok: true, data: null } : result
}

/** My order for the pinned chats in the sidebar (after dragging one to a new place). */
export async function orderPins(ids: string[]): Promise<ApiResult<null>> {
  const result = await request('PUT', '/conversations/pins/order', { ids })
  return result.ok ? { ok: true, data: null } : result
}

/** Mutes a chat for a while ('1h', '8h', '24h') or until turned back on ('forever'); null unmutes. */
export async function muteConversation(
  conversationId: string,
  duration: MuteDuration | null
): Promise<ApiResult<{ mutedUntil: string | null }>> {
  const result = duration
    ? await request<{ mutedUntil: string | null }>('PUT', `/conversations/${conversationId}/mute`, {
        duration
      })
    : await request<{ mutedUntil: string | null }>(
        'DELETE',
        `/conversations/${conversationId}/mute`
      )
  return result.ok ? { ok: true, data: { mutedUntil: result.data.mutedUntil ?? null } } : result
}

/** 0.9.3: forwards a message (the server checks every place). */
export const forwardMessage = (
  messageId: string,
  to: string[],
  note: string
): Promise<ApiResult<ForwardResult>> =>
  request<ForwardResult>('POST', `/conversations/messages/${messageId}/forward`, {
    to,
    ...(note.trim() ? { note } : {})
  })

export async function forwardTargets(): Promise<ApiResult<ForwardTarget[]>> {
  const result = await request<{ targets: ForwardTarget[] }>(
    'GET',
    '/conversations/forward-targets'
  )
  return result.ok ? { ok: true, data: result.data.targets } : result
}

/** 0.9.3: mutes until a set moment ("Mute until tomorrow" on a Windows notification). */
export async function muteConversationUntil(
  conversationId: string,
  until: string
): Promise<ApiResult<{ mutedUntil: string | null }>> {
  const result = await request<{ mutedUntil: string | null }>(
    'PUT',
    `/conversations/${conversationId}/mute`,
    { duration: 'until', until }
  )
  return result.ok ? { ok: true, data: { mutedUntil: result.data.mutedUntil ?? null } } : result
}

export async function markRead(conversationId: string): Promise<ApiResult<null>> {
  const result = await request('POST', `/conversations/${conversationId}/read`)
  return result.ok ? { ok: true, data: null } : result
}
