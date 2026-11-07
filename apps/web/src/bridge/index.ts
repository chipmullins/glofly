import type {
  AccountDetails,
  FriendLinkAccepted,
  FriendLinkPreview,
  MyFriendLink,
  OnlineAlertsMode,
  ActiveCall,
  Announcement,
  ApiResult,
  Attachment,
  CallAddResult,
  CallJoin,
  ConversationSummary,
  ConstellationMethod,
  FriendLists,
  Broadcast,
  BroadcastJoin,
  GameState,
  GifPage,
  GloflyApi,
  Message,
  MessagePage,
  MessageSearchPage,
  MyStatus,
  PrivacySettings,
  Profile,
  PublicUser,
  SearchResult,
  SignedInDevice,
  SocialToday,
  Sticker,
  TeamNotice,
  WatchPreview,
  WatchUpdate,
  YearInGlow
} from '../../../desktop/src/preload/api-types'
import { isGifId } from '@glofly/shared/gifs'
import { TEAM_REPLY_MAX } from '@glofly/shared/types'
import { looksLikeVideo } from '@glofly/shared/attachments'
import { FRIEND_LINK_PATTERN } from '@glofly/shared/friendLinks'
import { endSession, nothing, onSessionEnded, request, setPauseHandler, unwrap } from './api'
import * as auth from './auth'
import { API_URL, isApple, isId, isTouch } from './config'
import { emit, onEvent } from './events'
import { checkPausedNow, getPaused, getUpdateRequired } from './appStatus'
import { cleanAnnouncement, connectRealtime, disconnectRealtime, sendTyping } from './realtime'
import { getAppSettings, initialAppearance, setAppSettings, startSettings } from './settings'
import {
  askPermission,
  clearAllNotifications,
  clearNotification,
  flashTitle,
  permission,
  pushSupported,
  setBadge,
  showNotification,
  startServiceWorker,
  stopPush,
  syncPush,
  watchNotificationSettings
} from './notifications'
import { startPtt, stopPtt } from './ptt'
import { saveAttachment } from './files'
import { checkNow, onUpdateReady, reload, startUpdateChecks, updateReady } from './updates'
import { startIdleWatch } from './idle'
import { startLongPress } from './touch'
import { reportError } from './errors'

/** 0.7.3: the "tools" gateway's routes (desktop: main/api.ts isToolsRequest). */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const TOOL_PATHS = [
  /^\/account\/two-step(\/(start|confirm|off|remove-phone|backup-codes))?$/,
  /^\/account\/quiet-hours$/,
  /^\/conversations\/scheduled$/,
  new RegExp(`^/conversations/${UUID}/(pins|unread|scheduled)$`, 'i'),
  new RegExp(`^/conversations/${UUID}/scheduled/${UUID}(/send)?$`, 'i'),
  new RegExp(`^/conversations/${UUID}/messages/${UUID}/pin$`, 'i')
]
function isToolsPath(method: unknown, path: unknown, body: unknown): boolean {
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method as string)) return false
  if (typeof path !== 'string' || path.length > 200 || !TOOL_PATHS.some((r) => r.test(path)))
    return false
  if (body === undefined || body === null) return true
  try {
    return typeof body === 'object' && JSON.stringify(body).length <= 20_000
  } catch {
    return false
  }
}

/** 2.0: a request allowed through the constellations gateway (desktop: main/api.ts). */
function isConstellationPath(method: unknown, path: unknown, body: unknown): boolean {
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method as string)) return false
  if (typeof path !== 'string' || path.length > 300) return false
  if (!/^\/(constellations|games)(\/[A-Za-z0-9_-]+)*\/?(\?[A-Za-z0-9=&%._+-]*)?$/.test(path))
    return false
  if (body === undefined || body === null) return true
  try {
    return typeof body === 'object' && JSON.stringify(body).length <= 20_000
  } catch {
    return false
  }
}

/** Communities round: Settings → Connected apps and Developer only. */
function isAppsPath(method: unknown, path: unknown, body: unknown): boolean {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method as string)) return false
  if (typeof path !== 'string' || path.length > 200) return false
  if (!/^\/(account\/connected-apps|developer\/apps)(\/[A-Za-z0-9_-]+)*$/.test(path)) return false
  if (body === undefined || body === null) return true
  try {
    return typeof body === 'object' && JSON.stringify(body).length <= 10_000
  } catch {
    return false
  }
}

/** The sign-in request's parameters (anything else in the address is dropped). */
const OAUTH_KEYS = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'nonce']
function oauthQuery(query: string): URLSearchParams {
  const from = new URLSearchParams(typeof query === 'string' ? query.slice(0, 2000) : '')
  const out = new URLSearchParams()
  for (const k of OAUTH_KEYS) {
    const v = from.get(k)
    if (v !== null) out.set(k, v.slice(0, 500))
  }
  return out
}

// window.glofly for a browser: the same functions the desktop app's preload bridge offers
// (apps/desktop/src/preload/index.ts), done here with fetch, a WebSocket and browser APIs instead
// of the Electron main process. The desktop screens can't tell the difference, except where
// they ask (platform 'web', and the extra `web` section).

const invalid = {
  ok: false as const,
  error: 'invalid' as const,
  message: 'Something about that request was off.'
}
/** Only real ids reach a URL: anything else answers "invalid" without asking the server. */
const badId = (...ids: unknown[]): Promise<typeof invalid> | null =>
  ids.every((id) => id === undefined || isId(id)) ? null : Promise.resolve(invalid)
/** 0.8.0: only a real invite link code goes into an address. */
const badLinkCode = (code: unknown): Promise<typeof invalid> | null =>
  typeof code === 'string' && FRIEND_LINK_PATTERN.test(code) ? null : Promise.resolve(invalid)

/** The call address must be LiveKit's, never anything else the page might be sent to. */
function checkedJoin<T extends { url: string; token: string }>(result: ApiResult<T>): ApiResult<T> {
  if (!result.ok) return result
  const { url, token } = result.data
  const fine =
    typeof token === 'string' &&
    token.length < 4000 &&
    typeof url === 'string' &&
    (/^wss:\/\/[a-z0-9.-]+\.livekit\.cloud\/?$/i.test(url) ||
      /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url))
  return fine
    ? result
    : { ok: false, error: 'server_error', message: "Calls aren't set up correctly on the server." }
}

// Opened from a notification with every tab closed (/?chat=<id>): that chat opens once the main
// screen is up (the first time the live connection connects).
let pendingChat: string | null = null
{
  const chat = new URLSearchParams(location.search).get('chat')
  if (chat && isId(chat)) pendingChat = chat
  // Only ?chat= goes: ?join=<code> (a constellation invite, 0.7.5) and ?friend=<code> (a friend's
  // invite link, 0.8.0) are read and cleared by the screens themselves.
  if (chat) {
    const url = new URL(location.href)
    url.searchParams.delete('chat')
    history.replaceState(null, '', url.pathname + url.search)
  }
}

/** Opens the live connection and push registration once signed in. */
function goLive(): void {
  connectRealtime(() => endSession())
  void syncPush()
  if (pendingChat) {
    const stop = onEvent((event) => {
      if (event.type !== 'connection' || !event.connected) return
      stop()
      const conversationId = pendingChat
      pendingChat = null
      setTimeout(() => emit({ type: 'notification:click', conversationId }), 300)
    })
  }
}

async function thenGoLive<T extends { ok: boolean }>(result: Promise<T>): Promise<T> {
  const value = await result
  if (value.ok) goLive()
  return value
}

const NO_GAMES: GameState = {
  supported: false,
  enabled: false,
  current: null,
  detected: null,
  custom: [],
  hidden: [],
  noticeShown: true
}

/** Screen sharing needs getDisplayMedia (desktop Chrome, Edge, Firefox, Safari; not iPad). */
const screenShareSupported =
  typeof navigator.mediaDevices?.getDisplayMedia === 'function' && !isTouch()

export function createBridge(): GloflyApi {
  startSettings()
  watchNotificationSettings()
  void startServiceWorker()
  startUpdateChecks()
  startIdleWatch()
  startLongPress()
  // The session ended (signed out, expired, signed out from another device): close everything.
  onSessionEnded(() => {
    disconnectRealtime()
    void clearAllNotifications()
    setBadge(0)
  })
  // Paused: the connection closes; the page reloads (and signs back in) once Glofly is back.
  setPauseHandler(() => disconnectRealtime())

  return {
    platform: 'web',
    web: {
      apiUrl: API_URL,
      apple: isApple,
      touch: isTouch(),
      screenShare: screenShareSupported,
      // Communities round: the Sign in with Glofly consent page (only the known parameters go on).
      oauth: {
        request: (query) => request('GET', `/oauth/request?${oauthQuery(query).toString()}`),
        approve: (query, choices) =>
          request('POST', '/oauth/approve', {
            ...Object.fromEntries(oauthQuery(query)),
            email: !!choices.email,
            constellationIds: Array.isArray(choices.constellationIds) ? choices.constellationIds.slice(0, 50) : []
          }),
        deny: (query) => request('POST', '/oauth/deny', Object.fromEntries(oauthQuery(query)))
      },
      notifications: {
        permission,
        ask: askPermission,
        pushSupported: pushSupported()
      }
    },
    auth: {
      login: (r) => thenGoLive(auth.login(r)),
      loginCode: (challenge, code) =>
        typeof code === 'string' && code.length <= 20
          ? thenGoLive(auth.loginCode(challenge, code))
          : Promise.resolve({ ok: false, reason: 'invalid', message: 'Enter the code.' }),
      loginResend: auth.loginResend,
      qrStart: auth.qrStart,
      qrPoll: async (id, secret) => {
        const r = await auth.qrPoll(id, secret)
        if (r.state === 'signed-in') goLive()
        return r
      },
      register: (r) => thenGoLive(auth.register(r)),
      checkUsername: auth.checkUsername,
      signupMode: auth.signupMode,
      friendLinkInfo: auth.friendLinkInfo,
      restore: async () => {
        const user = await auth.restore()
        if (user) goLive()
        return user
      },
      me: auth.me,
      logout: async () => {
        disconnectRealtime()
        await stopPush()
        await clearAllNotifications()
        setBadge(0)
        await auth.logout()
      },
      forgotPassword: auth.forgotPassword
    },
    friends: {
      list: () => request<FriendLists>('GET', '/friends'),
      search: (query) =>
        unwrap(
          request<{ results: SearchResult[] }>(
            'GET',
            `/users/search?q=${encodeURIComponent(query)}`
          ),
          'results'
        ),
      sendRequest: async (username) => {
        const r = await request<{ status: 'pending' | 'accepted' }>('POST', '/friends/requests', {
          username
        })
        return r.ok ? { ok: true, data: { status: r.data.status } } : r
      },
      accept: (id) => badId(id) ?? nothing(request('POST', `/friends/requests/${id}/accept`)),
      removeRequest: (id) => badId(id) ?? nothing(request('DELETE', `/friends/requests/${id}`)),
      remove: (id) => badId(id) ?? nothing(request('DELETE', `/friends/${id}`)),
      block: (id) => badId(id) ?? nothing(request('POST', `/blocks/${id}`)),
      unblock: (id) => badId(id) ?? nothing(request('DELETE', `/blocks/${id}`)),
      setOnlineAlert: (id, on) =>
        badId(id) ??
        request<{ on: boolean; mode?: OnlineAlertsMode }>('PUT', `/friends/${id}/online-alert`, {
          on
        }),
      invite: (email) => nothing(request('POST', '/friends/invite', { email })),
      // 0.8.0: shareable friend invite links
      myLink: () => request<MyFriendLink>('GET', '/friends/link'),
      resetLink: () => request<MyFriendLink>('POST', '/friends/link/reset', {}),
      previewLink: (code) =>
        badLinkCode(code) ?? request<FriendLinkPreview>('GET', `/friends/link/${code}`),
      acceptLink: (code) =>
        badLinkCode(code) ?? request<FriendLinkAccepted>('POST', `/friends/link/${code}/accept`, {})
    },
    settings: {
      get: () => request<PrivacySettings>('GET', '/users/me/settings'),
      set: (changes) => request<PrivacySettings>('PATCH', '/users/me/settings', changes)
    },
    app: {
      getSettings: async () => getAppSettings(),
      setSettings: async (changes) => setAppSettings(changes),
      openPrivacySettings: () => undefined,
      initialAppearance: initialAppearance()
    },
    account: {
      get: () => request<AccountDetails>('GET', '/account'),
      changePassword: (currentPassword, newPassword, signOutOthers) =>
        request('POST', '/account/password', { currentPassword, newPassword, signOutOthers }),
      delete: async (password) => {
        const r = await request<{ deleteAfter: string }>('POST', '/account/delete', { password })
        if (r.ok) {
          await stopPush()
          endSession()
        }
        return r
      },
      resendVerification: () => request('POST', '/account/email/verify', {}),
      changeEmail: (newEmail, password) =>
        request('POST', '/account/email', { newEmail: newEmail.trim(), password }),
      cancelEmailChange: () => request('DELETE', '/account/email/pending'),
      sessions: () => request<{ sessions: SignedInDevice[] }>('GET', '/account/sessions'),
      signOutDevice: (id) => badId(id) ?? request('DELETE', `/account/sessions/${id}`),
      signOutOtherDevices: () => request('DELETE', '/account/sessions')
    },
    status: {
      get: () => request<MyStatus>('GET', '/users/me/status'),
      set: (changes) => request<MyStatus>('PATCH', '/users/me/status', changes)
    },
    profile: {
      getMine: () => request<Profile>('GET', '/users/me/profile'),
      get: (id) => badId(id) ?? request<Profile>('GET', `/users/${id}/profile`),
      update: (changes) => request<Profile>('PATCH', '/users/me/profile', changes),
      setPhoto: (data, type) => request('PUT', '/users/me/avatar', undefined, { data, type }),
      removePhoto: () => request('DELETE', '/users/me/avatar'),
      setNickname: (id, nickname) =>
        badId(id) ?? request('PUT', `/users/${id}/nickname`, { nickname })
    },
    conversations: {
      list: () =>
        unwrap(
          request<{ conversations: ConversationSummary[] }>('GET', '/conversations'),
          'conversations'
        ),
      openDm: (userId) =>
        badId(userId) ??
        unwrap(
          request<{ conversation: ConversationSummary }>('POST', '/conversations/dm', { userId }),
          'conversation'
        ),
      createGroup: (userIds, name) =>
        unwrap(
          request<{ conversation: ConversationSummary }>('POST', '/conversations/group', {
            userIds,
            name
          }),
          'conversation'
        ),
      setGroupPhoto: (id, data, type) =>
        badId(id) ?? request('PUT', `/conversations/${id}/photo`, undefined, { data, type }),
      removeGroupPhoto: (id) => badId(id) ?? request('DELETE', `/conversations/${id}/photo`),
      renameGroup: (id, name) =>
        badId(id) ??
        unwrap(
          request<{ conversation: ConversationSummary }>('PATCH', `/conversations/${id}`, { name }),
          'conversation'
        ),
      addMembers: (id, userIds) =>
        badId(id) ??
        unwrap(
          request<{ conversation: ConversationSummary }>('POST', `/conversations/${id}/members`, {
            userIds
          }),
          'conversation'
        ),
      removeMember: (id, userId) =>
        badId(id, userId) ?? nothing(request('DELETE', `/conversations/${id}/members/${userId}`)),
      messages: (id, before) =>
        badId(id, before) ??
        request<MessagePage>(
          'GET',
          `/conversations/${id}/messages${before ? `?before=${before}` : ''}`
        ),
      search: (query, chat, before) => {
        const q = query.trim()
        if (q.length < 2 || q.length > 100) return Promise.resolve(invalid)
        const params = new URLSearchParams({ q })
        if (chat) params.set('chat', chat)
        if (before) params.set('before', before)
        return (
          badId(chat, before) ??
          request<MessageSearchPage>('GET', `/conversations/messages/search?${params}`)
        )
      },
      send: (id, body, replyToId, attachmentIds, options) =>
        badId(id) ??
        unwrap(
          request<{ message: Message }>('POST', `/conversations/${id}/messages`, {
            body,
            replyToId,
            ...(attachmentIds?.length ? { attachmentIds } : {}),
            ...(options?.lantern ? { lantern: true } : {}),
            ...(options?.clientId ? { clientId: options.clientId } : {})
          }),
          'message'
        ),
      upload: (id, data, name, voice) => {
        if (!isId(id)) return Promise.resolve(invalid)
        if (data.byteLength === 0)
          return Promise.resolve({ ok: false, error: 'invalid', message: 'That file is empty.' })
        // Videos (0.5.0) may be bigger; the server checks they really are videos.
        if (data.byteLength > (looksLikeVideo(name) ? 64 : 25) * 1024 * 1024) {
          return Promise.resolve({
            ok: false,
            error: 'invalid',
            message: looksLikeVideo(name)
              ? 'Videos can be up to 64 MB.'
              : 'Files can be up to 25 MB (videos up to 64 MB).'
          })
        }
        const voiceQuery = voice
          ? `&voice=1&duration=${Math.round(voice.durationMs)}&peaks=${voice.peaks.join(',')}`
          : ''
        return unwrap(
          request<{ attachment: Attachment }>(
            'POST',
            `/conversations/${id}/attachments?name=${encodeURIComponent(name)}${voiceQuery}`,
            undefined,
            { data, type: 'application/octet-stream' }
          ),
          'attachment'
        )
      },
      removeUpload: (id, attachmentId) =>
        badId(id, attachmentId) ??
        nothing(request('DELETE', `/conversations/${id}/attachments/${attachmentId}`)),
      edit: (id, messageId, body) =>
        badId(id, messageId) ??
        unwrap(
          request<{ message: Message }>('PATCH', `/conversations/${id}/messages/${messageId}`, {
            body
          }),
          'message'
        ),
      remove: (id, messageId) =>
        badId(id, messageId) ??
        unwrap(
          request<{ message: Message }>('DELETE', `/conversations/${id}/messages/${messageId}`),
          'message'
        ),
      react: (id, messageId, emoji, on) =>
        badId(id, messageId) ??
        unwrap(
          request<{ message: Message }>(
            on ? 'PUT' : 'DELETE',
            `/conversations/${id}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`
          ),
          'message'
        ),
      markRead: (id) => badId(id) ?? nothing(request('POST', `/conversations/${id}/read`)),
      pin: (id, pinned) =>
        badId(id) ?? nothing(request(pinned ? 'PUT' : 'DELETE', `/conversations/${id}/pin`)),
      orderGroups: (ids) => nothing(request('PUT', '/conversations/groups/order', { ids })),
      orderPins: (ids) => nothing(request('PUT', '/conversations/pins/order', { ids })),
      mute: async (id, duration) => {
        if (!isId(id)) return invalid
        const r = duration
          ? await request<{ mutedUntil: string | null }>('PUT', `/conversations/${id}/mute`, {
              duration
            })
          : await request<{ mutedUntil: string | null }>('DELETE', `/conversations/${id}/mute`)
        return r.ok ? { ok: true, data: { mutedUntil: r.data.mutedUntil ?? null } } : r
      },
      close: (id, closed) =>
        badId(id) ?? nothing(request(closed ? 'PUT' : 'DELETE', `/conversations/${id}/close`)),
      typing: (id) => {
        if (isId(id)) sendTyping(id)
      }
    },
    // 0.5.0 social extras, stickers and broadcasts.
    social: {
      get: () => request<SocialToday>('GET', '/social'),
      hang: (userIds) =>
        userIds !== null && (!Array.isArray(userIds) || !userIds.every(isId))
          ? Promise.resolve(invalid)
          : request('POST', '/social/hang', userIds ? { userIds } : {}),
      stopHang: () => nothing(request('DELETE', '/social/hang')),
      shareBirthday: (share) => request('PUT', '/social/birthday', { share: share === true }),
      year: () => request<YearInGlow>('GET', '/social/year')
    },
    stickers: {
      list: () => unwrap(request<{ stickers: Sticker[] }>('GET', '/stickers'), 'stickers'),
      make: (data) =>
        data.byteLength === 0 || data.byteLength > 15 * 1024 * 1024
          ? Promise.resolve({ ok: false, error: 'invalid', message: 'Pick a photo under 15 MB.' })
          : unwrap(
              request<{ sticker: Sticker }>('POST', '/stickers', undefined, {
                data,
                type: 'application/octet-stream'
              }),
              'sticker'
            ),
      remove: (id) => badId(id) ?? nothing(request('DELETE', `/stickers/${id}`)),
      send: (id, chat, replyToId) =>
        badId(id, chat) ??
        unwrap(
          request<{ message: Message }>('POST', `/stickers/${id}/send`, {
            conversationId: chat,
            ...(replyToId ? { replyToId } : {})
          }),
          'message'
        )
    },
    broadcasts: {
      start: async (title, notify = true) =>
        checkedJoin(
          await request<BroadcastJoin>('POST', '/broadcasts', {
            ...(title ? { title } : {}),
            notify
          })
        ),
      stop: () => nothing(request('DELETE', '/broadcasts')),
      mine: () =>
        request<{ broadcast: Broadcast | null; viewers: PublicUser[] }>('GET', '/broadcasts/mine'),
      watch: async (userId) =>
        badId(userId) ??
        checkedJoin(await request<BroadcastJoin>('POST', `/broadcasts/${userId}/watch`))
    },
    // 0.5.0 chat extras (the server checks everything; these only keep addresses well-formed).
    chat: {
      gifs: (query, offset) => {
        const q = typeof query === 'string' ? query.trim().slice(0, 50) : ''
        const from = Number.isInteger(offset) && (offset ?? 0) >= 0 ? (offset ?? 0) : 0
        if (from >= 5000) return Promise.resolve({ ok: true, data: { gifs: [], next: null } })
        return request<GifPage>(
          'GET',
          q
            ? `/gifs/search?q=${encodeURIComponent(q)}&offset=${from}`
            : `/gifs/trending?offset=${from}`
        )
      },
      sendGif: (id, gifId, replyToId) =>
        badId(id) ??
        (isGifId(gifId)
          ? unwrap(
              request<{ message: Message }>('POST', `/conversations/${id}/messages`, {
                body: '',
                gif: { id: gifId },
                ...(replyToId ? { replyToId } : {})
              }),
              'message'
            )
          : Promise.resolve(invalid)),
      removePreview: (id, mid) =>
        badId(id, mid) ??
        unwrap(
          request<{ message: Message }>('DELETE', `/conversations/${id}/messages/${mid}/preview`),
          'message'
        ),
      createPoll: (id, question, options, multi) =>
        badId(id) ??
        unwrap(
          request<{ message: Message }>('POST', `/conversations/${id}/polls`, {
            question,
            options,
            multi: multi === true
          }),
          'message'
        ),
      vote: (id, mid, options) =>
        badId(id, mid) ??
        unwrap(
          request<{ message: Message }>('PUT', `/conversations/${id}/messages/${mid}/vote`, {
            options
          }),
          'message'
        ),
      closePoll: (id, mid) =>
        badId(id, mid) ??
        unwrap(
          request<{ message: Message }>('POST', `/conversations/${id}/messages/${mid}/close-poll`),
          'message'
        ),
      startGame: (id, kind) =>
        badId(id) ??
        unwrap(
          request<{ message: Message }>('POST', `/conversations/${id}/games`, { kind }),
          'message'
        ),
      move: (id, mid, move) =>
        badId(id, mid) ??
        unwrap(
          request<{ message: Message }>('POST', `/conversations/${id}/messages/${mid}/move`, move),
          'message'
        ),
      fireflies: (id, emoji) =>
        badId(id) ?? request<null>('POST', `/conversations/${id}/fireflies`, { emoji })
    },
    files: {
      save: saveAttachment,
      showInFolder: () => undefined
    },
    calls: {
      start: async (id, video, ring) =>
        badId(id) ??
        checkedJoin(
          await request<CallJoin>('POST', '/calls', {
            conversationId: id,
            video,
            ...(ring ? { ring } : {})
          })
        ),
      active: () => unwrap(request<{ calls: ActiveCall[] }>('GET', '/calls/active'), 'calls'),
      answer: async (id) =>
        badId(id) ?? checkedJoin(await request<CallJoin>('POST', `/calls/${id}/answer`)),
      join: async (id) =>
        badId(id) ?? checkedJoin(await request<CallJoin>('POST', `/calls/${id}/join`)),
      ring: (id, userIds) => badId(id) ?? request<null>('POST', `/calls/${id}/ring`, { userIds }),
      add: (id, userIds) =>
        badId(id) ?? request<CallAddResult>('POST', `/calls/${id}/add`, { userIds }),
      stay: (id) => badId(id) ?? request<null>('POST', `/calls/${id}/stay`),
      decline: (id) => badId(id) ?? request<null>('POST', `/calls/${id}/decline`),
      leave: (id) => badId(id) ?? request<null>('POST', `/calls/${id}/leave`),
      // The browser shows its own picker (getDisplayMedia), so there's no list to show here.
      screenSources: async () => [],
      chooseScreen: async () => true,
      screenAccess: async () => 'granted',
      // Chrome and Edge can share a tab's or the computer's sound; the browser asks which.
      screenSound: {
        support: async () => 'browser',
        start: async () => ({ ok: false }),
        stop: async () => undefined,
        onChunk: () => () => undefined,
        onEnded: () => () => undefined
      }
    },
    watch: {
      playerUrl: async () => `${API_URL}/watch/player`,
      get: (id) => badId(id) ?? request<WatchUpdate>('GET', `/calls/${id}/watch?sites=1`),
      preview: (link) =>
        typeof link === 'string' && link.length > 0 && link.length <= 500
          ? request<WatchPreview>(
              'GET',
              `/calls/watch/preview?sites=1&link=${encodeURIComponent(link)}`
            )
          : Promise.resolve(invalid),
      start: (id, link, control) =>
        badId(id) ?? request<WatchUpdate>('POST', `/calls/${id}/watch?sites=1`, { link, control }),
      control: (id, action, to) =>
        badId(id) ??
        request<WatchUpdate>('POST', `/calls/${id}/watch/control?sites=1`, { action, to }),
      settings: (id, control) =>
        badId(id) ??
        request<WatchUpdate>('POST', `/calls/${id}/watch/settings?sites=1`, { control }),
      report: (id, videoId, durationSec, title) =>
        badId(id) ??
        (typeof videoId === 'string' && /^[A-Za-z0-9_:-]{4,40}$/.test(videoId)
          ? request<null>('POST', `/calls/${id}/watch/report`, { videoId, durationSec, title })
          : Promise.resolve(invalid)),
      react: (id, reaction) =>
        badId(id) ?? request<null>('POST', `/calls/${id}/watch/react`, { reaction }),
      stop: (id) => badId(id) ?? request<WatchUpdate>('DELETE', `/calls/${id}/watch?sites=1`)
    },
    ptt: {
      start: async (choice) => startPtt(choice),
      stop: stopPtt
    },
    notifications: {
      show: (n) => void showNotification(n),
      clear: (key) => void clearNotification(key),
      badge: (count) => setBadge(count)
    },
    // Browsers have no Jump List or Dock menu.
    shortcuts: { take: async () => null },
    // glofly:// links are for the apps; the browser gets ?friend=<code> instead (MainScreen).
    links: { take: async () => null },
    onEvent,
    games: {
      state: async () => NO_GAMES,
      setEnabled: async () => NO_GAMES,
      hide: async () => NO_GAMES,
      add: async () => null,
      remove: async () => NO_GAMES,
      running: async () => [],
      noticeShown: () => undefined,
      onChange: () => () => undefined
    },
    reports: {
      send: (report) => request('POST', '/reports', report)
    },
    // 2.0 Constellations and My games (the same limits as the desktop app's gateway).
    // 0.7.3: two-step settings, quiet hours, pins, mark unread, send later.
    tools: {
      request: <T>(method: ConstellationMethod, path: string, body?: unknown) =>
        isToolsPath(method, path, body)
          ? request<T>(method, path, body ?? undefined)
          : Promise.resolve(invalid as ApiResult<T>)
    },
    // Communities round: Settings → Connected apps and Developer (Sign in with Glofly).
    apps: {
      request: <T>(method: ConstellationMethod, path: string, body?: unknown) =>
        isAppsPath(method, path, body)
          ? request<T>(method, path, body ?? undefined)
          : Promise.resolve(invalid as ApiResult<T>)
    },
    reportError: (report) => reportError(report),
    setErrorReports: () => undefined, // (the page's own setting decides; nothing else runs here)
    constellations: {
      request: <T>(method: ConstellationMethod, path: string, body?: unknown) =>
        isConstellationPath(method, path, body)
          ? request<T>(method, path, body ?? undefined)
          : Promise.resolve(invalid as ApiResult<T>),
      setIcon: (id, data, type, which) =>
        badId(id) ??
        request(
          'PUT',
          `/constellations/${id}/${which === 'banner' ? 'banner' : 'icon'}`,
          undefined,
          {
            data,
            type
          }
        )
    },
    notices: {
      list: async () => {
        const result = await request<{ notices: unknown[]; announcement: unknown }>(
          'GET',
          '/notices'
        )
        if (!result.ok) return result
        const notices: TeamNotice[] = (
          Array.isArray(result.data.notices) ? result.data.notices : []
        )
          .map((n) => n as Record<string, unknown>)
          .filter((n) => typeof n.id === 'string' && typeof n.body === 'string')
          .map((n) => ({
            id: n.id as string,
            kind: typeof n.kind === 'string' ? n.kind : 'warning',
            body: (n.body as string).slice(0, 1000),
            createdAt: String(n.createdAt),
            allowReply: n.allowReply === true
          }))
        const announcement: Announcement | null = cleanAnnouncement(result.data.announcement)
        return { ok: true, data: { notices, announcement } }
      },
      seen: (id) => badId(id) ?? nothing(request('POST', `/notices/${id}/seen`)),
      reply: (id, body) =>
        badId(id) ??
        (typeof body !== 'string' || !body.trim() || body.length > TEAM_REPLY_MAX
          ? Promise.resolve(invalid)
          : nothing(request('POST', `/notices/${id}/reply`, { body: body.trim() })))
    },
    appStatus: {
      updateRequired: async () => getUpdateRequired(),
      paused: async () => getPaused(),
      checkPaused: checkPausedNow
    },
    updates: {
      status: async () => updateReady(),
      onReady: onUpdateReady,
      restart: reload,
      checkNow
    },
    window: {
      setTheme: () => undefined,
      setTitleBarColor: () => undefined,
      // A browser can't flash the taskbar: the tab's title blinks instead until you look at it.
      attention: flashTitle
    }
  }
}
