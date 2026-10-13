import type {
  AccountDetails,
  ActiveCall,
  Announcement,
  ApiResult,
  Attachment,
  CallJoin,
  ConversationSummary,
  FriendLists,
  Message,
  MessagePage,
  MuteDuration,
  MyStatus,
  PrivacySettings,
  Profile,
  ProfileChanges,
  ReportRequest,
  SearchResult,
  SignedInDevice,
  TeamNotice,
  VoiceInfo,
} from '@glofly/shared'
import { request, upload, type Upload } from './http'
import { PLATFORM } from '@/lib/config'

// The Glofly server's API, as the phone app uses it (the same routes as the desktop app).

const map = <A, B>(r: ApiResult<A>, f: (a: A) => B): ApiResult<B> => (r.ok ? { ok: true, data: f(r.data) } : r)
const none = <A,>(r: ApiResult<A>): ApiResult<null> => map(r, () => null)
const enc = encodeURIComponent

// ---- Profiles and status ----

export const getMyProfile = () => request<Profile>('GET', '/users/me/profile')
export const getProfile = (userId: string) => request<Profile>('GET', `/users/${userId}/profile`)
export const updateProfile = (changes: ProfileChanges) => request<Profile>('PATCH', '/users/me/profile', changes)
/** Your own name for someone, only you see it (null removes it). */
export const setNickname = (userId: string, nickname: string | null) => request<{ userId: string; nickname: string | null }>('PUT', `/users/${userId}/nickname`, { nickname })
export const setAvatar = (file: Upload) => upload<{ avatarVersion: string }>('PUT', '/users/me/avatar', file)
export const removeAvatar = () => request<{ avatarVersion: null }>('DELETE', '/users/me/avatar')
export const getMyStatus = () => request<MyStatus>('GET', '/users/me/status')
export const setMyStatus = (changes: Partial<MyStatus>) => request<MyStatus>('PATCH', '/users/me/status', changes)
export const getPrivacy = () => request<PrivacySettings>('GET', '/users/me/settings')
export const setPrivacy = (changes: Partial<PrivacySettings>) => request<PrivacySettings>('PATCH', '/users/me/settings', changes)

// ---- Friends ----

export const listFriends = () => request<FriendLists>('GET', '/friends')
export const searchUsers = async (q: string) => map(await request<{ results: SearchResult[] }>('GET', `/users/search?q=${enc(q)}`), (d) => d.results)
export const sendFriendRequest = (username: string) => request<{ status: 'pending' | 'accepted' }>('POST', '/friends/requests', { username })
export const acceptFriendRequest = async (id: string) => none(await request('POST', `/friends/requests/${id}/accept`))
export const removeFriendRequest = async (id: string) => none(await request('DELETE', `/friends/requests/${id}`))
export const removeFriend = async (id: string) => none(await request('DELETE', `/friends/${id}`))
export const blockUser = async (id: string) => none(await request('POST', `/blocks/${id}`))
export const unblockUser = async (id: string) => none(await request('DELETE', `/blocks/${id}`))

// ---- Chats ----

export const listConversations = async () => map(await request<{ conversations: ConversationSummary[] }>('GET', '/conversations'), (d) => d.conversations)
export const openDm = async (userId: string) => map(await request<{ conversation: ConversationSummary }>('POST', '/conversations/dm', { userId }), (d) => d.conversation)
export const createGroup = async (userIds: string[], name?: string) =>
  map(await request<{ conversation: ConversationSummary }>('POST', '/conversations/group', { userIds, ...(name ? { name } : {}) }), (d) => d.conversation)
export const renameGroup = async (id: string, name: string | null) => map(await request<{ conversation: ConversationSummary }>('PATCH', `/conversations/${id}`, { name }), (d) => d.conversation)
export const addMembers = async (id: string, userIds: string[]) => none(await request('POST', `/conversations/${id}/members`, { userIds }))
export const removeMember = async (id: string, userId: string) => none(await request('DELETE', `/conversations/${id}/members/${userId}`))
export const setGroupPhoto = (id: string, file: Upload) => upload<{ photoVersion: string }>('PUT', `/conversations/${id}/photo`, file)
export const deleteGroupPhoto = (id: string) => request<{ photoVersion: null }>('DELETE', `/conversations/${id}/photo`)
export const pinChat = async (id: string, pinned: boolean) => none(await request(pinned ? 'PUT' : 'DELETE', `/conversations/${id}/pin`))
export const closeChat = async (id: string, closed: boolean) => none(await request(closed ? 'PUT' : 'DELETE', `/conversations/${id}/close`))
export const muteChat = async (id: string, duration: MuteDuration | null) =>
  map(
    duration
      ? await request<{ mutedUntil: string | null }>('PUT', `/conversations/${id}/mute`, { duration })
      : await request<{ mutedUntil: string | null }>('DELETE', `/conversations/${id}/mute`),
    (d) => d?.mutedUntil ?? null,
  )
export const orderGroups = async (ids: string[]) => none(await request('PUT', '/conversations/groups/order', { ids }))
export const markRead = async (id: string) => none(await request('POST', `/conversations/${id}/read`))

// ---- Messages ----

export const loadMessages = (id: string, before?: string) => request<MessagePage>('GET', `/conversations/${id}/messages${before ? `?before=${before}` : ''}`)
export const sendMessage = async (id: string, body: string, replyToId?: string, attachmentIds?: string[]) =>
  map(
    await request<{ message: Message }>('POST', `/conversations/${id}/messages`, {
      body,
      ...(replyToId ? { replyToId } : {}),
      ...(attachmentIds?.length ? { attachmentIds } : {}),
    }),
    (d) => d.message,
  )
export const editMessage = async (id: string, messageId: string, body: string) =>
  map(await request<{ message: Message }>('PATCH', `/conversations/${id}/messages/${messageId}`, { body }), (d) => d.message)
export const deleteMessage = async (id: string, messageId: string) => map(await request<{ message: Message }>('DELETE', `/conversations/${id}/messages/${messageId}`), (d) => d.message)
export const react = async (id: string, messageId: string, emoji: string, on: boolean) =>
  map(await request<{ message: Message }>(on ? 'PUT' : 'DELETE', `/conversations/${id}/messages/${messageId}/reactions/${enc(emoji)}`), (d) => d.message)

/** Uploads a photo, file or voice message to send; attached when the message is sent. */
export async function uploadAttachment(
  id: string,
  file: Upload & { name: string },
  voice?: VoiceInfo,
  onProgress?: (f: number) => void,
  signal?: AbortSignal,
): Promise<ApiResult<Attachment>> {
  const voiceQuery = voice ? `&voice=1&duration=${Math.round(voice.durationMs)}&peaks=${voice.peaks.join(',')}` : ''
  const r = await upload<{ attachment: Attachment }>(
    'POST',
    `/conversations/${id}/attachments?name=${enc(file.name)}${voiceQuery}`,
    { uri: file.uri, type: 'application/octet-stream' },
    onProgress,
    signal,
  )
  return map(r, (d) => d.attachment)
}
export const removeUpload = async (id: string, attachmentId: string) => none(await request('DELETE', `/conversations/${id}/attachments/${attachmentId}`))

// ---- Calls ----

export const startCall = (conversationId: string, video: boolean) => request<CallJoin>('POST', '/calls', { conversationId, video })
export const activeCalls = async () => map(await request<{ calls: ActiveCall[] }>('GET', '/calls/active'), (d) => d.calls)
export const answerCall = (callId: string) => request<CallJoin>('POST', `/calls/${callId}/answer`)
export const joinCall = (callId: string) => request<CallJoin>('POST', `/calls/${callId}/join`)
export const ringMore = async (callId: string, userIds: string[]) => none(await request('POST', `/calls/${callId}/ring`, { userIds }))
export const declineCall = async (callId: string) => none(await request('POST', `/calls/${callId}/decline`))
export const leaveCall = async (callId: string) => none(await request('POST', `/calls/${callId}/leave`))

// ---- Account ----

export const getAccount = () => request<AccountDetails>('GET', '/account')
export const changePassword = async (currentPassword: string, newPassword: string, signOutOthers: boolean) =>
  request<{ signedOut?: number }>('POST', '/account/password', { currentPassword, newPassword, signOutOthers })
export const resendConfirmEmail = async () => none(await request('POST', '/account/email/verify', {}))
export const deleteAccount = (password: string) => request<{ deleteAfter: string }>('POST', '/account/delete', { password })
export const listSessions = async () => map(await request<{ sessions: SignedInDevice[] }>('GET', '/account/sessions'), (d) => d.sessions)

// ---- Safety ----

export const report = async (r: ReportRequest) => none(await request('POST', '/reports', r))
export const getNotices = () => request<{ notices: TeamNotice[]; announcement: Announcement | null }>('GET', '/notices')
export const noticeSeen = async (id: string) => none(await request('POST', `/notices/${id}/seen`))

// ---- Push notifications ----

/** voipToken: iPhone lock-screen calls (left out when there isn't one yet: the server keeps what it has). */
export const registerPush = async (token: string, preview: boolean, voipToken?: string) =>
  none(await request('PUT', '/devices/push', { token, platform: PLATFORM, preview, ...(voipToken ? { voipToken } : {}) }))
export const unregisterPush = async () => none(await request('DELETE', '/devices/push'))
