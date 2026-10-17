// The shapes Glofly's server sends and accepts, shared by every Glofly app (desktop, mobile)
// and the server. Moved here from apps/desktop/src/preload/api-types.d.ts (Oct 11, 2026).

import type { WatchReactionEvent, WatchUpdate } from './watch'
// Watch Together's shapes live in watch.ts; re-exported so `@glofly/shared/types` has them too.
export type {
  WatchAction,
  WatchControl,
  WatchPreview,
  WatchReaction,
  WatchReactionEvent,
  WatchState,
  WatchUpdate
} from './watch'

export type SignedInUser = {
  id: string
  username: string
  displayName: string
  /** Changes with every new profile photo. Null means no photo (initials instead). */
  avatarVersion: string | null
  /**
   * 0.4.0: a restricted (family-managed) account. Friends are added by the family (in Glofly
   * Control), so the apps hide Add friend and Invite your friends. Missing = not restricted.
   */
  restricted?: boolean
}

export type LoginRequest = {
  identifier: string
  password: string
  keepSignedIn: boolean
  /** Logging in to an account that's set to be deleted: true restores it. */
  restore?: boolean
}

export type LoginFailureReason =
  | 'wrong_details'
  | 'invalid'
  | 'too_many_requests'
  | 'unreachable'
  | 'server_error'
  | 'deletion_scheduled' // right password, but the account is set to be deleted
  | 'update_required' // this version is too old: the update screen shows

export type LoginResult =
  | { ok: true; user: SignedInUser }
  | { ok: false; reason: LoginFailureReason; message: string; deleteAfter?: string }

export type RegisterRequest = {
  email: string
  username: string
  displayName: string
  password: string
  /** YYYY-MM-DD */
  birthday: string
  acceptTerms: boolean
  /** Needed while sign-ups are invite only. */
  inviteCode?: string
}

/** Who can sign up right now (set in Glofly Control). */
export type SignupMode = 'open' | 'invite' | 'closed'

/** On failure, `fields` holds a message per field (email, username, password, ...). */
export type RegisterResult =
  { ok: true; user: SignedInUser } | { ok: false; fields: Record<string, string>; message?: string }

export type UsernameCheck = { available: boolean; reason?: string }

export type PublicUser = {
  id: string
  username: string
  displayName: string
  /** Changes with every new profile photo. Null means no photo (initials instead). */
  avatarVersion: string | null
  /**
   * Only when you gave this person a nickname (Oct 2026): their own display name. displayName then
   * holds your nickname (the server swaps it in for you alone). Older apps ignore it.
   */
  realName?: string
}

/**
 * A profile card. About me and the join date are only shared with people you're connected
 * to (friends, someone who sent you a request, or someone you chat with); status only with
 * friends. Otherwise they're null.
 */
export type Profile = PublicUser & {
  bio: string | null
  /** ISO date */
  joinedAt: string | null
  presence: Presence | null
}

export type ProfileChanges = { displayName?: string; bio?: string | null }

/** Photo types Glofly accepts for profile photos. */
export type PhotoType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

/** What a person is to you. */
export type Relationship = 'none' | 'friends' | 'outgoing' | 'incoming'
export type SearchResult = PublicUser & { relationship: Relationship }

/** What friends see: 'offline' also covers people set to Invisible. */
export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline'
export type Presence = {
  status: PresenceStatus
  /** Custom status, e.g. "Grinding ranked tonight" (only while not offline) */
  statusText: string | null
  /** ISO date; only for offline people who aren't invisible */
  lastSeenAt: string | null
  /** What they're playing ("Guild Wars 2", since an ISO date), if they share it */
  activity?: Activity | null
  /**
   * "Active on mobile" (0.3.0 servers): only on a phone right now, or closed Glofly on their phone
   * a few minutes ago. Missing on older servers = false.
   */
  mobile?: boolean
}

export type Activity = { name: string; since: string }

/** The status you pick for yourself. */
export type MyStatusChoice = 'online' | 'away' | 'dnd' | 'invisible'
export type MyStatus = { status: MyStatusChoice; statusText: string | null }

/** `since` is when you became friends, the request was sent, or you blocked them (ISO date). */
export type FriendEntry = PublicUser & {
  since: string
  presence?: Presence
  /** "Notify me when they come online" is on for them (0.3.0 servers; missing = off) */
  onlineAlert?: boolean
}
export type FriendLists = {
  friends: FriendEntry[]
  incoming: FriendEntry[]
  outgoing: FriendEntry[]
  blocked: FriendEntry[]
}

export type ApiError =
  | 'unauthorized' // session ended: go back to the login screen
  | 'unreachable'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'forbidden'
  | 'too_many_requests'
  | 'server_error'
  /** This version of Glofly is too old for the server: the app shows "Please update Glofly" */
  | 'update_required'
  /** 0.4.0: Glofly is paused (Glofly Control → Server): the app shows "Glofly is paused" */
  | 'paused'
export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: ApiError
      message: string
      /** Problems with particular fields, e.g. { currentPassword: "That isn't your current password." } */
      fields?: Record<string, string>
    }

export type Reaction = { emoji: string; userIds: string[] }

/** A photo or file shared in a chat. Photos have their full-size width and height. */
export type Attachment = {
  id: string
  kind: 'image' | 'file'
  name: string
  /** Bytes */
  size: number
  width: number | null
  height: number | null
  /** Voice messages: length and waveform (bar heights 0–100). Missing from older servers. */
  voice?: VoiceInfo | null
  /**
   * 0.5.0 videos: length and size. They're kind "file", so older apps offer them as a download;
   * newer ones play them in the chat (variants "poster" and "video").
   */
  video?: VideoInfo | null
  /** 0.5.0: a sticker (a see-through picture shown without a bubble; older apps show a photo) */
  sticker?: boolean
}

/** 0.5.0: a sticker you made (kept in your sticker tray). */
export type Sticker = { id: string; width: number; height: number; createdAt: string }

export type VoiceInfo = { durationMs: number; peaks: number[] }
export type VideoInfo = { durationMs: number; width: number; height: number }

/** A short preview of the message being replied to. */
export type ReplyPreview = {
  id: string
  senderId: string
  body: string
  deleted: boolean
  /** Its first photo or file (and how many it has), so "Photo" can show when there's no text. */
  attachment?: { kind: 'image' | 'file'; name: string; count: number; voice?: boolean; video?: boolean } | null
}

export type Message = {
  id: string
  conversationId: string
  senderId: string
  /** Empty when deleted */
  body: string
  /** ISO date */
  createdAt: string
  /** ISO date of the last edit, if edited */
  editedAt: string | null
  deleted: boolean
  replyTo: ReplyPreview | null
  reactions: Reaction[]
  /** Photos and files, in order. Empty for a plain text message. */
  attachments: Attachment[]
  /** Group chats: a line like "Chip renamed the group" instead of a message (sent by senderId). */
  event: ChatEvent | null
  /** Group members this message @mentions. Missing from servers before 0.2.0. */
  mentions?: string[]
  // ---- 0.5.0 (missing from older servers; older apps show the body, a plain-text version) ----
  /** A GIF (shown from GIPHY; the body holds its link for older apps) */
  gif?: GifInfo | null
  /** The first link's preview, added by the server a moment after sending */
  linkPreview?: LinkPreview | null
  /** A poll (groups) */
  poll?: Poll | null
  /** A mini game */
  game?: Game | null
  /** A lantern message: fades away once everyone else has read it */
  lantern?: boolean
  /** A lantern that has been read by everyone: when it fades (ISO date) */
  lanternFadeAt?: string | null
}

/** 0.5.0: the reactions that can fly across a chat as fireflies. */
export type FireflyEmoji = '❤️' | '🔥'
export const FIREFLY_EMOJI: readonly FireflyEmoji[] = ['❤️', '🔥']

/** A chat:fireflies event's fields, checked (apps pass on only this). */
export function cleanFireflies(
  p: unknown
): { conversationId: string; userId: string; emoji: FireflyEmoji; id: string } | null {
  const o = p as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const { conversationId, userId, emoji, id } = o
  if (typeof conversationId !== 'string' || typeof userId !== 'string' || typeof id !== 'string') return null
  if (emoji !== '❤️' && emoji !== '🔥') return null
  return { conversationId, userId, emoji, id: id.slice(0, 64) }
}

/** 0.5.0: a GIF from GIPHY (see gifUrl in gifs.ts). */
export type GifInfo = { id: string; title: string; width: number; height: number }

/** 0.5.0: what a link is. `image`: the server saved its picture (loaded from the server). */
export type LinkPreview = {
  url: string
  title: string
  description: string | null
  siteName: string | null
  image: { width: number; height: number } | null
}

/** 0.5.0: a poll and its votes (who picked each option). */
export type Poll = {
  question: string
  options: { text: string; votes: string[] }[]
  /** More than one option may be picked */
  multi: boolean
  /** ISO date it was closed, or null while open */
  closedAt: string | null
}

/** 0.5.0: a mini game in a chat (see games.ts). */
export type Game = import('./games').GameState

/** Things that happen in a chat, shown as a line ("Chip added Maya", "Chip started a video call"). */
export type ChatEvent =
  | { type: 'created'; name: string | null }
  | { type: 'renamed'; name: string | null }
  | { type: 'added'; userIds: string[] }
  | { type: 'removed'; userId: string }
  | { type: 'left' }
  | {
      type: 'call'
      callId: string
      video: boolean
      status: CallStatus
      /** How long it lasted, once ended */
      durationSec: number | null
    }
  /** 0.2.1: someone set (or removed) the group photo */
  | { type: 'photo'; removed: boolean }
  /** 0.5.0: someone started watching a video together in the call (Watch Together) */
  | { type: 'watch'; videoId: string; title: string }

export type CallStatus = 'ringing' | 'ongoing' | 'ended' | 'missed' | 'declined'

/** Where one person in the chat stands in a call. */
export type CallMember = {
  userId: string
  /** joined: in the call · ringing: being rung right now · out: not in it */
  state: 'joined' | 'ringing' | 'out'
  /** While ringing: when it stops (ISO date) */
  ringingUntil: string | null
}

/** A voice or video call, 1-on-1 or group. */
export type Call = {
  id: string
  conversationId: string
  callerId: string
  /** Started as a video call (cameras can still be turned on or off) */
  video: boolean
  status: CallStatus
  /** ISO dates */
  createdAt: string
  answeredAt: string | null
  endedAt: string | null
  /** Everyone in the chat (you included) and where they stand */
  members: CallMember[]
}

/** What's needed to join a call's room: a short-lived pass and where the room is. */
export type CallJoin = { call: Call; token: string; url: string }

/** A ringing or ongoing call in one of your chats. `joined`: you're in it (maybe on another device). */
export type ActiveCall = { call: Call; joined: boolean }

type ConversationBase = {
  id: string
  lastMessage: Message | null
  unreadCount: number
  /** DMs: false if you're no longer friends, or either of you blocked the other. */
  canMessage: boolean
  /** ISO date of the latest activity, for sorting */
  activityAt: string
  /** When you pinned it (ISO date), or null if it isn't pinned */
  pinnedAt: string | null
  /** Everyone else in the chat (groups: longest-standing first) */
  members: PublicUser[]
  /** Including you */
  memberCount: number
  /** When you joined it (ISO date). Missing from servers before 0.2.0. */
  joinedAt?: string
  /** Muted by you until then (ISO date; far in the future = until you unmute), or null */
  mutedUntil?: string | null
  /** Unread messages that @mention you (groups) */
  mentionCount?: number
  /** When you closed it in the sidebar (ISO date), or null. Hidden until a newer message. */
  closedAt?: string | null
}

/** How long to mute a chat for. */
export type MuteDuration = '1h' | '8h' | '24h' | 'forever'

export type DmSummary = ConversationBase & {
  kind: 'dm'
  partner: PublicUser
  name: null
  createdBy: null
  /** How far they've read (ISO date), for "Seen". Null unless both people allow read receipts. */
  partnerReadAt: string | null
}

export type GroupSummary = ConversationBase & {
  kind: 'group'
  partner: null
  /** Null = no name (shown as the members' names) */
  name: string | null
  /** Who can remove people (whoever made it, or whoever took over) */
  createdBy: string | null
  partnerReadAt: null
  /** Where you dragged it on the Groups page (lower first); null = never moved */
  groupPosition?: number | null
  /** The group photo's version (null = two members' faces). Missing from servers before 0.2.1. */
  photoVersion?: string | null
}

export type ConversationSummary = DmSummary | GroupSummary

/** Settings → General → Privacy */
export type PrivacySettings = {
  /** Works both ways: off means you don't see other people's either. */
  readReceipts: boolean
  showLastSeen: boolean
  showTyping: boolean
  /** Who can send me friend requests */
  friendRequests: 'everyone' | 'nobody'
  /** "Friends coming online" master switch (0.3.0 servers; missing = on) */
  onlineAlerts?: boolean
}

/** Settings → Account: private details only you see. */
export type AccountDetails = {
  username: string
  email: string
  createdAt: string
  /** Whether they've clicked the link in "Confirm your email". (Missing from older servers.) */
  emailVerified?: boolean
  /** A new address waiting for its confirm link to be clicked, if any. */
  pendingEmail?: string | null
  /** 0.4.0: a family-managed account (can't change its email or delete itself). */
  restricted?: boolean
}

/** Settings → Account → Where you're signed in. */
export type SignedInDevice = {
  id: string
  /** e.g. "Windows · DESKTOP-4KQ2" (older sign-ins: "Glofly Desktop on Windows") */
  deviceName: string | null
  /** "Keep me signed in" (30 days, renewed while used) vs 1 day */
  persistent: boolean
  createdAt: string
  /** Updated at most once an hour while the device is in use */
  lastUsedAt: string
  /** This computer */
  current: boolean
  /** Glofly is open and connected on that device right now */
  online: boolean
}

/** Forgot password: the server answers the same whether or not the account exists. */
export type ForgotPasswordResult = { ok: true } | { ok: false; message: string }

/** Search results, newest first. `people`: everyone they mention. */
export type MessageSearchPage = { results: Message[]; hasMore: boolean; people: PublicUser[] }

/** `people`: everyone the messages mention, including people who've left a group. */
export type MessagePage = { messages: Message[]; hasMore: boolean; people: PublicUser[] }

/** Live updates the server sends over the real-time connection (Socket.IO event name = type). */
export type ServerEvent =
  | {
      type: 'message:new'
      message: Message
      people?: PublicUser[]
      /** 2.0: it's in a constellation's nebula (not one of your Glofly chats) */
      nebula?: boolean
    }
  | { type: 'message:updated'; message: Message }
  | { type: 'typing'; conversationId: string; userId: string }
  | { type: 'friends:changed' }
  | ({ type: 'presence'; userId: string } & Presence)
  /** Someone you asked about came online ("Notify me when they come online", 0.3.0) */
  | { type: 'friend:online'; user: PublicUser }
  /** Someone joined Glofly from your invite and is now your friend (0.3.0) */
  | { type: 'friend:joined'; user: PublicUser }
  | { type: 'conversation:read'; conversationId: string; userId: string; readAt: string }
  | { type: 'conversations:changed' }
  | { type: 'profile:changed'; userId: string }
  /** Your email was confirmed or changed (here or on another device): refetch account details. */
  | { type: 'account:changed' }
  | { type: 'call:updated'; call: Call; caller: PublicUser | null }
  /** 0.5.0 Watch Together: the video a call is watching changed (play, pause, skip, stop…) */
  | ({ type: 'watch:updated' } & WatchUpdate)
  /** 0.5.0 Watch Together: someone sent a firefly reaction over the video */
  | ({ type: 'watch:reaction' } & WatchReactionEvent)
  /** 0.5.0: someone sent a swarm of fireflies across a chat (long-press ❤️ or 🔥) */
  | { type: 'chat:fireflies'; conversationId: string; userId: string; emoji: FireflyEmoji; id: string }
  /** 0.5.0: glows, hangs, birthdays or broadcasts changed: fetch GET /social again */
  | { type: 'social:changed' }
  /** 0.5.0: a friend is free to hang (a gentle ping with a Join button) */
  | { type: 'hang:ping'; userId: string; until: string }
  /** This version is too old for the server: show "Please update Glofly". */
  | ({ type: 'app:update-required' } & UpdateRequired)
  /** 0.4.0: Glofly is paused (Glofly Control → Server → Pause Glofly) */
  | ({ type: 'app:paused' } & Paused)
  /** 0.4.0: the pause is over */
  | { type: 'app:resumed' }
  /** A message from the Glofly team (a warning) */
  | { type: 'notice:new'; notice: TeamNotice }
  /** The announcement banner changed (null: none showing now) */
  | { type: 'announcement'; announcement: Announcement | null }
  // ---- 2.0 Constellations and My games (only apps that say they know them get these) ----
  /** My dashboard changed (joined, left, invited, renamed…): reload the cards */
  | { type: 'constellations:changed' }
  /** Something in this constellation changed (nebulas, roles, members, settings): reload it */
  | { type: 'constellation:updated'; constellationId: string }
  /** Someone posted in one of its nebulas */
  | {
      type: 'constellation:activity'
      constellationId: string
      nebulaId: string
      conversationId: string
      senderId: string
      mentions: string[]
      /** Should this ding and notify me (my setting for the nebula, mutes, @mentions)? */
      alert?: 'message' | 'mention' | null
      /** With an alert: what the notification shows */
      nebulaName?: string
      constellationName?: string
      senderName?: string
      preview?: string
    }
  /** Who's in one of its voice nebulas changed */
  | { type: 'constellation:voice'; constellationId: string; voice: import('./constellations').VoiceNebulaState }
  /** It's gone for me (deleted, I was kicked or banned, or it was taken down) */
  | { type: 'constellation:removed'; constellationId: string; reason: 'kicked' | 'banned' | 'taken_down' | 'deleted' }
  /** My games changed (on another device) */
  | { type: 'games:changed' }

/** 0.4.0: Glofly is paused (Glofly Control → Server → Pause Glofly). Nobody can use it until then. */
export type Paused = {
  /** What the admin wrote, e.g. "Glofly is paused for maintenance. Back soon." */
  message: string
  /** When the pause started (ISO), if known */
  since: string | null
}

/** Reads the server's 503 "paused" answer (or the live connection's notice). Null if it isn't one. */
export function pausedFrom(body: unknown): Paused | null {
  const b = body as { error?: unknown; message?: unknown; since?: unknown } | null
  if (!b || b.error !== 'paused') return null
  return {
    message:
      typeof b.message === 'string' && b.message.trim() && b.message.length <= 300
        ? b.message
        : 'Glofly is paused for maintenance. Back soon.',
    since: typeof b.since === 'string' && b.since.length <= 40 ? b.since : null
  }
}

/** The server needs a newer Glofly (Control → minimum app version). */
export type UpdateRequired = {
  message: string
  minVersion: string | null
  /** Where to get it (glofly.app/download) */
  downloadUrl: string
}

/** A message from the Glofly team to you (a warning from Glofly Control). */
export type TeamNotice = { id: string; kind: string; body: string; createdAt: string }

/** The banner at the top of everyone's app (Glofly Control → Announcements). */
export type Announcement = {
  id: string
  body: string
  tone: 'info' | 'important'
  /** Optional "Learn more" link (https only) */
  linkUrl: string | null
  linkLabel: string | null
  createdAt: string
  endsAt: string | null
}

export type ReportReason =
  'spam' | 'harassment' | 'hate' | 'sexual' | 'violence' | 'self_harm' | 'other'

/** Report a message (messageId + conversationId) or a person (userId). */
export type ReportRequest = {
  messageId?: string
  conversationId?: string
  userId?: string
  reason: ReportReason
  details?: string
  /** Also block them */
  block?: boolean
}

// 0.5.0 social types live in social.ts (with their rules); re-exported for the apps' API types.
export type { Broadcast, BroadcastJoin, Glow, Hanging, SocialToday, YearInGlow } from './social'
