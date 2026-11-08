import type {
  AccountDetails,
  ActivityItem,
  Mutuals,
  ProfileHeader,
  FriendLinkAccepted,
  FriendLinkInfo,
  FriendLinkPreview,
  MyFriendLink,
  Broadcast,
  BroadcastJoin,
  ActiveCall,
  Announcement,
  ApiResult,
  Attachment,
  CallAddResult,
  CallJoin,
  ConversationSummary,
  FireflyEmoji,
  FriendLists,
  GifInfo,
  Message,
  MessagePage,
  MessageSearchPage,
  MuteDuration,
  MyStatus,
  MyStatusChanges,
  PrivacySettings,
  Profile,
  ProfileChanges,
  ReportRequest,
  SearchResult,
  SignedInDevice,
  SocialToday,
  Sticker,
  PublicUser,
  TeamNotice,
  VoiceInfo,
  WatchControl,
  WatchPreview,
  WatchReaction,
  WatchUpdate,
  YearInGlow,
} from '@glofly/shared'
import { request, upload, type Upload } from './http'
import { PLATFORM } from '@/lib/config'

// The Glofly server's API, as the phone app uses it (the same routes as the desktop app).

const map = <A, B>(r: ApiResult<A>, f: (a: A) => B): ApiResult<B> => (r.ok ? { ok: true, data: f(r.data) } : r)
const none = <A,>(r: ApiResult<A>): ApiResult<null> => map(r, () => null)
const enc = encodeURIComponent

// ---- Profiles and status ----

/** 0.9.1: `as` previews what a friend / anyone else sees. */
export const getMyProfile = (as?: 'friend' | 'everyone') => request<Profile>('GET', as ? `/users/me/profile?as=${as}` : '/users/me/profile')
export const getProfile = (userId: string) => request<Profile>('GET', `/users/${userId}/profile`)
export const updateProfile = (changes: ProfileChanges) => request<Profile>('PATCH', '/users/me/profile', changes)
/** Your own name for someone, only you see it (null removes it). */
export const setNickname = (userId: string, nickname: string | null) => request<{ userId: string; nickname: string | null }>('PUT', `/users/${userId}/nickname`, { nickname })
export const setAvatar = (file: Upload) => upload<{ avatarVersion: string }>('PUT', '/users/me/avatar', file)
// 0.9.1 profiles
export const setHeader = (file: Upload) => upload<{ header: ProfileHeader }>('PUT', '/users/me/header', file)
export const removeHeader = () => request<{ header: null }>('DELETE', '/users/me/header')
export const getMutuals = (userId: string) => request<Mutuals & { shown: boolean }>('GET', `/users/${userId}/mutuals`)
export const getActivity = (userId: string, as?: 'friend' | 'everyone') =>
  request<{ shown: boolean; items: ActivityItem[] }>('GET', `/users/${userId}/activity${as ? `?as=${as}` : ''}`)
export const removeAvatar = () => request<{ avatarVersion: null }>('DELETE', '/users/me/avatar')
export const getMyStatus = () => request<MyStatus>('GET', '/users/me/status')
export const setMyStatus = (changes: MyStatusChanges) => request<MyStatus>('PATCH', '/users/me/status', changes)
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
/** "Notify me when they come online" (0.3.0). */
export const setOnlineAlert = (id: string, on: boolean) => request<{ on: boolean; mode?: 'all' | 'selected' | 'none' }>('PUT', `/friends/${id}/online-alert`, { on })
/** "Invite your friends": emails them a link to join Glofly (0.3.0). */
export const inviteFriend = async (email: string) => none(await request('POST', '/friends/invite', { email }))
// 0.8.0: shareable friend invite links (glofly.app/i/<code>)
export const myFriendLink = () => request<MyFriendLink>('GET', '/friends/link')
export const resetFriendLink = () => request<MyFriendLink>('POST', '/friends/link/reset', {})
export const previewFriendLink = (code: string) => request<FriendLinkPreview>('GET', `/friends/link/${enc(code)}`)
export const acceptFriendLink = (code: string) => request<FriendLinkAccepted>('POST', `/friends/link/${enc(code)}/accept`, {})
/** Whose link this is, signed out (the sign-up screen's "Chip invited you"). */
export const friendLinkInfo = (code: string) => request<FriendLinkInfo>('GET', `/i/${enc(code)}/info`, undefined, { auth: false })

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
/** My order for the pinned chats (oldest pin shows first; the server re-times the pins). */
export const orderPins = async (ids: string[]) => none(await request('PUT', '/conversations/pins/order', { ids }))
export const markRead = async (id: string) => none(await request('POST', `/conversations/${id}/read`))

// 0.9.3 forwarding
export type ForwardTarget = {
  conversationId: string
  kind: 'dm' | 'group' | 'nebula'
  title: string
  subtitle: string | null
  userId: string | null
  avatarVersion: string | null
  constellationId: string | null
  iconVersion: string | null
  color: string | null
}
export type ForwardResult = { sent: { conversationId: string; message: Message }[]; failed: { conversationId: string; reason: string }[] }
export async function forwardTargets(): Promise<ApiResult<ForwardTarget[]>> {
  const r = await request<{ targets: ForwardTarget[] }>('GET', '/conversations/forward-targets')
  return r.ok ? { ok: true, data: r.data.targets } : r
}
export const forwardMessage = (messageId: string, to: string[], note: string) =>
  request<ForwardResult>('POST', `/conversations/messages/${messageId}/forward`, { to, ...(note.trim() ? { note } : {}) })

// ---- Messages ----

export const loadMessages = (id: string, before?: string) => request<MessagePage>('GET', `/conversations/${id}/messages${before ? `?before=${before}` : ''}`)
/** Messages containing these words (newest first), in one chat or all; `before` = the last result you have. */
export const searchMessages = (q: string, chat?: string, before?: string) =>
  request<MessageSearchPage>('GET', `/conversations/messages/search?q=${enc(q)}${chat ? `&chat=${chat}` : ''}${before ? `&before=${before}` : ''}`)
export const sendMessage = async (id: string, body: string, replyToId?: string, attachmentIds?: string[], lantern?: boolean, clientId?: string) =>
  map(
    await request<{ message: Message }>('POST', `/conversations/${id}/messages`, {
      body,
      ...(replyToId ? { replyToId } : {}),
      ...(attachmentIds?.length ? { attachmentIds } : {}),
      ...(lantern ? { lantern: true } : {}),
      // 0.7.5: the same on a retry, so the server never makes a copy
      ...(clientId ? { clientId } : {}),
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

/** `ring` (groups, 0.5.2): only these people are rung; the rest of the group can join. */
export const startCall = (conversationId: string, video: boolean, ring?: string[]) =>
  request<CallJoin>('POST', '/calls', { conversationId, video, ...(ring?.length ? { ring } : {}) })
export const activeCalls = async () => map(await request<{ calls: ActiveCall[] }>('GET', '/calls/active'), (d) => d.calls)
export const answerCall = (callId: string) => request<CallJoin>('POST', `/calls/${callId}/answer`)
export const joinCall = (callId: string) => request<CallJoin>('POST', `/calls/${callId}/join`)
export const ringMore = async (callId: string, userIds: string[]) => none(await request('POST', `/calls/${callId}/ring`, { userIds }))
/** 0.5.2 Add people: a 1-on-1 call moves to a new group with everyone; a group call rings them. */
export const addToCall = (callId: string, userIds: string[]) => request<CallAddResult>('POST', `/calls/${callId}/add`, { userIds })
/** 0.5.2 Group calls: on your own, keep the call going another 7 minutes. */
export const stayInCall = async (callId: string) => none(await request('POST', `/calls/${callId}/stay`))
export const declineCall = async (callId: string) => none(await request('POST', `/calls/${callId}/decline`))
export const leaveCall = async (callId: string) => none(await request('POST', `/calls/${callId}/leave`))

// ---- Watch Together (0.5.0) ----

export const watchGet = (callId: string) => request<WatchUpdate>('GET', `/calls/${callId}/watch?sites=2`)
export const watchPreview = (link: string) => request<WatchPreview>('GET', `/calls/watch/preview?sites=2&link=${enc(link)}`)
export const watchStart = (callId: string, link: string, control?: WatchControl) => request<WatchUpdate>('POST', `/calls/${callId}/watch?sites=2`, { link, control })
export const watchControl = (callId: string, action: 'play' | 'pause' | 'seek' | 'back' | 'forward', to?: number) =>
  request<WatchUpdate>('POST', `/calls/${callId}/watch/control?sites=2`, { action, to })
export const watchSettings = (callId: string, control: WatchControl) => request<WatchUpdate>('POST', `/calls/${callId}/watch/settings?sites=2`, { control })
export const watchReport = async (callId: string, videoId: string, durationSec: number, title?: string) =>
  none(await request('POST', `/calls/${callId}/watch/report`, { videoId, durationSec, title }))
export const watchReact = async (callId: string, reaction: WatchReaction) => none(await request('POST', `/calls/${callId}/watch/react`, { reaction }))
export const watchStop = (callId: string) => request<WatchUpdate>('DELETE', `/calls/${callId}/watch?sites=2`)

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
// 0.8.2: answer a Glofly Team message (goes to Glofly Control's Inbox)
export const noticeReply = async (id: string, body: string) => none(await request('POST', `/notices/${id}/reply`, { body }))

// ---- Push notifications ----

/** voipToken: iPhone lock-screen calls (left out when there isn't one yet: the server keeps what it has). */
/** features (0.7.0): what this app can show; "constellations" = nebula alerts (older servers ignore it). */
export const registerPush = async (token: string, preview: boolean, voipToken?: string, sounds?: { messageSound: string; ringtone: string }) =>
  none(await request('PUT', '/devices/push', { token, platform: PLATFORM, preview, ...(voipToken ? { voipToken } : {}), ...(sounds ?? {}), features: ['constellations'] }))
export const unregisterPush = async () => none(await request('DELETE', '/devices/push'))

// ---- 0.5.0 chat extras: GIFs, link previews, polls, games, firefly swarms ----

export type GifPage = { gifs: GifInfo[]; next: number | null }
export type ChatGameKind = 'tictactoe' | 'wordguess' | 'trivia'
export type ChatGameMove = { square: number } | { word: string } | { question: number; choice: number } | { reveal: true }
const messageOf = (r: ApiResult<{ message: Message }>) => map(r, (d) => d.message)

/** Trending (empty query) or a search, 24 at a time. */
export const gifs = (query: string, offset = 0) => {
  const q = query.trim().slice(0, 50)
  return request<GifPage>('GET', q ? `/gifs/search?q=${enc(q)}&offset=${offset}` : `/gifs/trending?offset=${offset}`)
}
export const sendGif = async (id: string, gifId: string, replyToId?: string) =>
  messageOf(await request('POST', `/conversations/${id}/messages`, { body: '', gif: { id: gifId }, ...(replyToId ? { replyToId } : {}) }))
export const removePreview = async (id: string, messageId: string) => messageOf(await request('DELETE', `/conversations/${id}/messages/${messageId}/preview`))
export const createPoll = async (id: string, question: string, options: string[], multi: boolean) =>
  messageOf(await request('POST', `/conversations/${id}/polls`, { question, options, multi }))
export const vote = async (id: string, messageId: string, options: number[]) => messageOf(await request('PUT', `/conversations/${id}/messages/${messageId}/vote`, { options }))
export const closePoll = async (id: string, messageId: string) => messageOf(await request('POST', `/conversations/${id}/messages/${messageId}/close-poll`))
export const startGame = async (id: string, kind: ChatGameKind) => messageOf(await request('POST', `/conversations/${id}/games`, { kind }))
export const gameMove = async (id: string, messageId: string, move: ChatGameMove) => messageOf(await request('POST', `/conversations/${id}/messages/${messageId}/move`, move))
export const fireflies = async (id: string, emoji: FireflyEmoji) => none(await request('POST', `/conversations/${id}/fireflies`, { emoji }))
/** A link preview's picture (the server's copy). */
export const previewImagePath = (id: string, messageId: string) => `/conversations/${id}/messages/${messageId}/preview-image`

// ---- 0.5.0 social extras: glows, hangs, birthdays, Year in Glow; stickers; broadcasts ----

export const social = () => request<SocialToday>('GET', '/social')
export const hang = (userIds: string[] | null) =>
  request<{ until: string; with: string[] | null; told: number }>('POST', '/social/hang', userIds ? { userIds } : {})
export const stopHang = async () => none(await request('DELETE', '/social/hang'))
export const shareBirthday = (share: boolean) => request<{ share: boolean }>('PUT', '/social/birthday', { share })
export const yearInGlow = () => request<YearInGlow>('GET', '/social/year')

export const stickers = async () => map(await request<{ stickers: Sticker[] }>('GET', '/stickers'), (d) => d.stickers)
/** A photo → a sticker (the server cuts out the background). */
export const makeSticker = async (file: Upload) => map(await upload<{ sticker: Sticker }>('POST', '/stickers', file), (d) => d.sticker)
export const removeSticker = async (id: string) => none(await request('DELETE', `/stickers/${id}`))
export const sendSticker = async (id: string, conversationId: string, replyToId?: string) =>
  map(await request<{ message: Message }>('POST', `/stickers/${id}/send`, { conversationId, ...(replyToId ? { replyToId } : {}) }), (d) => d.message)
export const stickerImagePath = (id: string) => `/stickers/${id}/image`

/** A pass to watch a friend's broadcast. The address must be LiveKit's, never anything else. */
export const watchBroadcast = async (userId: string): Promise<ApiResult<BroadcastJoin>> => {
  const r = await request<BroadcastJoin>('POST', `/broadcasts/${userId}/watch`)
  if (!r.ok) return r
  const fine =
    typeof r.data.token === 'string' &&
    r.data.token.length < 4000 &&
    (/^wss:\/\/[a-z0-9.-]+\.livekit\.cloud\/?$/i.test(r.data.url) || /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(r.data.url))
  return fine ? r : { ok: false, error: 'server_error', message: "Broadcasts aren't set up correctly on the server." }
}
export type { Broadcast, PublicUser as BroadcastPerson }
