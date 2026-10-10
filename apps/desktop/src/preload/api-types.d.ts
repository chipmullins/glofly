// The functions the Glofly UI can call in the main process.
// Shared by the main process, the preload bridge and the React app.

export type SignedInUser = {
  id: string
  username: string
  displayName: string
  /** Changes with every new profile photo. Null means no photo (initials instead). */
  avatarVersion: string | null
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
}

export type Activity = { name: string; since: string }

/** A game you added yourself in Settings → Activity: its program (lowercase .exe) and name. */
export type CustomGame = { exe: string; name: string }
/** A program with a window open, offered by "Add a game". */
export type RunningProgram = { exe: string; title: string }

/** Settings → Activity, and what Glofly sees you playing on this computer. */
export type GameState = {
  /** Game detection works on this computer (Windows) */
  supported: boolean
  /** "Show what I'm playing" */
  enabled: boolean
  /** The game friends see right now (null if none, or sharing is off) */
  current: string | null
  /** The game detected, even while sharing is off */
  detected: string | null
  custom: CustomGame[]
  /** Games never shown, by name */
  hidden: string[]
  /** The one-time "your friends can see this" note has been shown */
  noticeShown: boolean
}

/** The status you pick for yourself. */
export type MyStatusChoice = 'online' | 'away' | 'dnd' | 'invisible'
export type MyStatus = { status: MyStatusChoice; statusText: string | null }

/** `since` is when you became friends, the request was sent, or you blocked them (ISO date). */
export type FriendEntry = PublicUser & { since: string; presence?: Presence }
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
}

export type VoiceInfo = { durationMs: number; peaks: number[] }

/** A short preview of the message being replied to. */
export type ReplyPreview = {
  id: string
  senderId: string
  body: string
  deleted: boolean
  /** Its first photo or file (and how many it has), so "Photo" can show when there's no text. */
  attachment?: { kind: 'image' | 'file'; name: string; count: number; voice?: boolean } | null
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
}

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

/** A screen or window that can be shared, with a small picture of it. */
export type ScreenSource = {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** data: URL */
  thumbnail: string
  /** data: URL of the app's icon (windows only) */
  icon: string | null
}

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

export type AppSettingsChanges = Partial<
  Pick<AppSettings, 'closeToTray' | 'openAtLogin' | 'theme' | 'accent' | 'textSize'>
> & { sounds?: Partial<SoundSettings>; notifications?: Partial<NotificationSettings> }

/** Settings → Notifications & sounds: Windows notifications */
export type NotificationSettings = {
  /** "Desktop notifications" */
  enabled: boolean
  /** "Show message preview": off shows "New message" instead of the text */
  preview: boolean
}

/** A Windows notification, built by the window and shown by the main process. */
export type ShowNotification = {
  /** One notification per key: a new one replaces the old (a chat's id, or "call:<id>") */
  key: string
  /** The chat it's about: clicking it opens this chat (null: the Friends page, e.g. a request) */
  conversationId: string | null
  title: string
  body: string
  /** A round picture of the person (PNG data: URL), or null for the Glofly icon */
  icon: string | null
  /** Calls stay until answered or dismissed */
  call?: boolean
}

/** Short sounds for alerts and call moments, and longer ones that loop while a call rings. */
export type AlertSound =
  | 'chime'
  | 'hello'
  | 'glowOn'
  | 'glowOff'
  | 'blinkIn'
  | 'blinkOut'
  | 'goodnight'
  | 'sparkTrail'
  | 'dewdrop'
  | 'starfall'
  | 'pebble'
  | 'none'
export type CallSound = 'ring' | 'jingle' | 'none'

/** Settings → Notifications & sounds */
export type SoundSettings = {
  /** "Notification sounds": off mutes every Glofly sound at once */
  enabled: boolean
  /** "Silence everything in Do Not Disturb" */
  dndSilence: boolean
  /** "Volume": how loud every Glofly sound plays, 0–100 */
  volume: number
  /** "Ringtone & jingle volume": the ringtone and outgoing call jingle, 0–100 */
  callVolume: number
  message: AlertSound
  friendRequest: AlertSound
  login: AlertSound
  /** You log out */
  logout: AlertSound
  /** You're in a call with someone (they answered, or you answered or joined) */
  callConnected: AlertSound
  /** You leave a call, or it ends */
  callEnded: AlertSound
  /** Someone else joins the group call you're in */
  memberJoined: AlertSound
  /** Someone else leaves the group call you're in */
  memberLeft: AlertSound
  /** Plays when someone calls you (with calls) */
  ringtone: CallSound
  /** Plays while you wait for someone to answer (with calls) */
  outgoing: CallSound
}

export type ThemeChoice = 'light' | 'dark' | 'system'
export type AccentChoice = 'orange' | 'red' | 'lagoon' | 'violet'
export type TextSize = 'small' | 'default' | 'large' | 'larger'

/** Settings → General → Appearance and App. Kept on this computer, not on the server. */
export type AppSettings = {
  /** e.g. "0.1.0" */
  version: string
  theme: ThemeChoice
  accent: AccentChoice
  textSize: TextSize
  sounds: SoundSettings
  notifications: NotificationSettings
  /** Closing the window keeps Glofly running in the system tray. */
  closeToTray: boolean
  /** Open Glofly when the computer starts. */
  openAtLogin: boolean
  /** False while developing: only the installed app can start with Windows. */
  startupAvailable: boolean
}

/** Search results, newest first. `people`: everyone they mention. */
export type MessageSearchPage = { results: Message[]; hasMore: boolean; people: PublicUser[] }

/** `people`: everyone the messages mention, including people who've left a group. */
export type MessagePage = { messages: Message[]; hasMore: boolean; people: PublicUser[] }

/** Live updates pushed from the server. */
export type GloflyEvent =
  | { type: 'message:new'; message: Message; people?: PublicUser[] }
  | { type: 'message:updated'; message: Message }
  | { type: 'typing'; conversationId: string; userId: string }
  | { type: 'friends:changed' }
  /** Push to talk: the chosen key went down or came up */
  | { type: 'ptt'; down: boolean }
  | ({ type: 'presence'; userId: string } & Presence)
  | { type: 'conversation:read'; conversationId: string; userId: string; readAt: string }
  | { type: 'conversations:changed' }
  | { type: 'profile:changed'; userId: string }
  /** Your email was confirmed or changed (here or on another device): refetch account details. */
  | { type: 'account:changed' }
  | { type: 'call:updated'; call: Call; caller: PublicUser | null }
  | { type: 'connection'; connected: boolean }
  | { type: 'session:expired' }
  | { type: 'appearance'; accent: AccentChoice; dark: boolean }
  /** A Windows notification was clicked (Glofly is already brought to the front). */
  | { type: 'notification:click'; conversationId: string | null }
  /** This version is too old for the server: show "Please update Glofly". */
  | ({ type: 'app:update-required' } & UpdateRequired)
  /** A message from the Glofly team (a warning) */
  | { type: 'notice:new'; notice: TeamNotice }
  /** The announcement banner changed (null: none showing now) */
  | { type: 'announcement'; announcement: Announcement | null }

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

/** Which screen is showing, so the window buttons can match its colors. */
export type WindowTheme = 'login' | 'app'

export type GloflyApi = {
  /** 'win32' on Windows, 'darwin' on Mac, 'linux' on Linux */
  platform: string
  auth: {
    login: (request: LoginRequest) => Promise<LoginResult>
    /** Creates an account and signs it in (kept signed in). */
    register: (request: RegisterRequest) => Promise<RegisterResult>
    /** Live "Available" check. Null if the server can't be reached. */
    checkUsername: (username: string) => Promise<UsernameCheck | null>
    /** Open, invite only or closed (Glofly Control → Sign-ups). Null if the server can't be reached. */
    signupMode: () => Promise<SignupMode | null>
    /** Signs back in with a saved "Keep me signed in" session. Null if there isn't a valid one. */
    restore: () => Promise<SignedInUser | null>
    logout: () => Promise<void>
    /** Emails a reset link if the username or email belongs to an account. */
    forgotPassword: (identifier: string) => Promise<ForgotPasswordResult>
  }
  friends: {
    list: () => Promise<ApiResult<FriendLists>>
    search: (query: string) => Promise<ApiResult<SearchResult[]>>
    /** If they already sent you a request, this accepts it (status 'accepted'). */
    sendRequest: (username: string) => Promise<ApiResult<{ status: 'pending' | 'accepted' }>>
    accept: (userId: string) => Promise<ApiResult<null>>
    /** Declines a request to you, or cancels one you sent. */
    removeRequest: (userId: string) => Promise<ApiResult<null>>
    remove: (userId: string) => Promise<ApiResult<null>>
    block: (userId: string) => Promise<ApiResult<null>>
    unblock: (userId: string) => Promise<ApiResult<null>>
  }
  settings: {
    get: () => Promise<ApiResult<PrivacySettings>>
    set: (changes: Partial<PrivacySettings>) => Promise<ApiResult<PrivacySettings>>
  }
  app: {
    getSettings: () => Promise<AppSettings>
    setSettings: (changes: AppSettingsChanges) => Promise<AppSettings>
    /** Mac: opens System Settings → Privacy & Security at that list (does nothing on Windows). */
    openPrivacySettings: (pane: 'microphone' | 'camera' | 'screen' | 'accessibility') => void
    /** Theme and accent at startup, known before anything is drawn (so nothing flashes). */
    initialAppearance: { accent: AccentChoice; dark: boolean }
  }
  account: {
    get: () => Promise<ApiResult<AccountDetails>>
    /** This device stays signed in; with signOutOthers, every other device is signed out. */
    changePassword: (
      currentPassword: string,
      newPassword: string,
      signOutOthers: boolean
    ) => Promise<ApiResult<{ signedOut: number }>>
    /** Signs out everywhere. The account is removed for good after 30 days unless restored. */
    delete: (password: string) => Promise<ApiResult<{ deleteAfter: string }>>
    /** Sends the "Confirm your email" link again. */
    resendVerification: () => Promise<ApiResult<{ ok: true }>>
    /** Sends a confirm link to the new address; the email changes once it's clicked. */
    changeEmail: (
      newEmail: string,
      password: string
    ) => Promise<ApiResult<{ pendingEmail: string }>>
    cancelEmailChange: () => Promise<ApiResult<{ ok: true }>>
    /** Every device signed in to this account, this one first. */
    sessions: () => Promise<ApiResult<{ sessions: SignedInDevice[] }>>
    /** Signs one other device out right away. */
    signOutDevice: (sessionId: string) => Promise<ApiResult<{ ok: true }>>
    /** Signs out every device except this one. */
    signOutOtherDevices: () => Promise<ApiResult<{ signedOut: number }>>
  }
  status: {
    get: () => Promise<ApiResult<MyStatus>>
    /** Change your status and/or custom status (empty text clears it). */
    set: (changes: Partial<MyStatus>) => Promise<ApiResult<MyStatus>>
  }
  profile: {
    /** Your own profile, for Edit profile. */
    getMine: () => Promise<ApiResult<Profile>>
    /** Someone's profile card. */
    get: (userId: string) => Promise<ApiResult<Profile>>
    update: (changes: ProfileChanges) => Promise<ApiResult<Profile>>
    /** Uploads a new profile photo (up to 8 MB). The server crops it and removes hidden photo data. */
    setPhoto: (data: ArrayBuffer, type: PhotoType) => Promise<ApiResult<{ avatarVersion: string }>>
    removePhoto: () => Promise<ApiResult<{ avatarVersion: null }>>
  }
  conversations: {
    list: () => Promise<ApiResult<ConversationSummary[]>>
    /** Opens (or creates) the DM with a friend. */
    openDm: (userId: string) => Promise<ApiResult<ConversationSummary>>
    /** Starts a group with at least two friends (up to 25 people, including you). */
    createGroup: (userIds: string[], name: string | null) => Promise<ApiResult<ConversationSummary>>
    /** Anyone in the group can rename it. Null or empty clears the name. */
    /** Sets the group photo (anyone in the group can; a line in the chat says so). */
    setGroupPhoto: (
      conversationId: string,
      data: ArrayBuffer,
      type: PhotoType
    ) => Promise<ApiResult<{ photoVersion: string }>>
    /** Back to the members' faces. */
    removeGroupPhoto: (conversationId: string) => Promise<ApiResult<{ photoVersion: null }>>
    renameGroup: (
      conversationId: string,
      name: string | null
    ) => Promise<ApiResult<ConversationSummary>>
    /** Anyone in the group can add their friends. */
    addMembers: (
      conversationId: string,
      userIds: string[]
    ) => Promise<ApiResult<ConversationSummary>>
    /** Your own id leaves the group; anyone else's removes them (only whoever made it). */
    removeMember: (conversationId: string, userId: string) => Promise<ApiResult<null>>
    /** Newest page, or the page before `beforeMessageId`. Oldest first. */
    messages: (conversationId: string, beforeMessageId?: string) => Promise<ApiResult<MessagePage>>
    /** Messages containing these words (2+ characters), in one chat or all of them. */
    search: (
      query: string,
      conversationId?: string,
      beforeMessageId?: string
    ) => Promise<ApiResult<MessageSearchPage>>
    /** `body` can be empty when sending photos or files. */
    send: (
      conversationId: string,
      body: string,
      replyToId?: string,
      attachmentIds?: string[]
    ) => Promise<ApiResult<Message>>
    /** Uploads a photo or file (up to 25 MB) to send with the next message. */
    upload: (
      conversationId: string,
      data: ArrayBuffer,
      name: string,
      /** A voice message recorded in Glofly (Opus, up to 5 minutes) */
      voice?: VoiceInfo
    ) => Promise<ApiResult<Attachment>>
    /** Removes an upload that hasn't been sent. */
    removeUpload: (conversationId: string, attachmentId: string) => Promise<ApiResult<null>>
    edit: (conversationId: string, messageId: string, body: string) => Promise<ApiResult<Message>>
    remove: (conversationId: string, messageId: string) => Promise<ApiResult<Message>>
    react: (
      conversationId: string,
      messageId: string,
      emoji: string,
      on: boolean
    ) => Promise<ApiResult<Message>>
    markRead: (conversationId: string) => Promise<ApiResult<null>>
    /** Pins a chat to the top of the sidebar (up to 10, saved on your account), or unpins it. */
    pin: (conversationId: string, pinned: boolean) => Promise<ApiResult<null>>
    /** Your order for the Groups page (saved on your account). */
    orderGroups: (ids: string[]) => Promise<ApiResult<null>>
    /** Mutes a chat for a while or until turned back on; null unmutes. */
    mute: (
      conversationId: string,
      duration: MuteDuration | null
    ) => Promise<ApiResult<{ mutedUntil: string | null }>>
    /** Closes a chat in the sidebar (history kept; comes back with a new message), or reopens it. */
    close: (conversationId: string, closed: boolean) => Promise<ApiResult<null>>
    typing: (conversationId: string) => void
  }
  files: {
    /** Asks where to save, then saves it there. Null if the person cancelled. */
    save: (
      conversationId: string,
      attachment: Attachment
    ) => Promise<ApiResult<{ path: string } | null>>
    /** Shows a file Glofly just saved in File Explorer. */
    showInFolder: (path: string) => void
  }
  calls: {
    /** Calls a friend. Returns the pass to join the call's room right away (it rings meanwhile). */
    start: (conversationId: string, video: boolean) => Promise<ApiResult<CallJoin>>
    /** Ringing and ongoing calls in your chats (to show an incoming call after a restart). */
    active: () => Promise<ApiResult<ActiveCall[]>>
    answer: (callId: string) => Promise<ApiResult<CallJoin>>
    /** Joins a group call that's going on, or gets back into yours (restart, moving devices). */
    join: (callId: string) => Promise<ApiResult<CallJoin>>
    /** Group calls: rings people in the group who aren't in the call. */
    ring: (callId: string, userIds: string[]) => Promise<ApiResult<null>>
    decline: (callId: string) => Promise<ApiResult<null>>
    /** Hangs up (or cancels the call while it's still ringing). */
    leave: (callId: string) => Promise<ApiResult<null>>
    /** Screens and windows that can be shared. */
    screenSources: () => Promise<ScreenSource[]>
    /** Picks what the next screen share shows (the share itself starts in the call). */
    chooseScreen: (sourceId: string) => Promise<boolean>
    /**
     * Mac: whether macOS allows Glofly to record the screen (System Settings → Privacy &
     * Security → Screen & System Audio Recording). Always "granted" on Windows.
     */
    screenAccess: () => Promise<'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'>
  }
  ptt: {
    /**
     * Push to talk: starts listening for the chosen key or mouse button ("key:Backquote",
     * "mouse:4") during a call, even with another app in front. Holding it sends
     * { type: 'ptt', down } events. "permission": Mac needs Glofly allowed under Accessibility.
     */
    start: (choice: string) => Promise<'ok' | 'permission' | 'unavailable'>
    stop: () => void
  }
  notifications: {
    show: (notification: ShowNotification) => void
    /** Takes a chat's (or call's) notification away, e.g. once you've read the chat. */
    clear: (key: string) => void
    /** The unread count on the taskbar icon; `image` is the badge drawn by the window. */
    badge: (count: number, image: string | null) => void
  }
  /** Subscribe to live updates. Returns a function that unsubscribes. */
  onEvent: (listener: (event: GloflyEvent) => void) => () => void
  /** "Playing Guild Wars 2": game detection and Settings → Activity (this computer). */
  games: {
    state: () => Promise<GameState>
    setEnabled: (enabled: boolean) => Promise<GameState>
    hide: (name: string, hide: boolean) => Promise<GameState>
    add: (exe: string, name: string) => Promise<GameState | null>
    remove: (exe: string) => Promise<GameState>
    /** Programs with a window open, for "Add a game" */
    running: () => Promise<RunningProgram[]>
    noticeShown: () => void
    onChange: (listener: (state: GameState) => void) => () => void
  }
  /** Report a message or a person to the Glofly team. */
  reports: {
    send: (request: ReportRequest) => Promise<ApiResult<{ ok: true; alreadyReported?: boolean }>>
  }
  /** Messages from the Glofly team, and the announcement banner. */
  notices: {
    list: () => Promise<ApiResult<{ notices: TeamNotice[]; announcement: Announcement | null }>>
    /** "I understand" */
    seen: (noticeId: string) => Promise<ApiResult<null>>
  }
  /** Set when the server needs a newer Glofly (checked at startup). */
  appStatus: {
    updateRequired: () => Promise<UpdateRequired | null>
  }
  /** New versions of Glofly (installed app only). */
  updates: {
    /** The version downloaded and waiting for a restart, or null. */
    status: () => Promise<string | null>
    /** Called when a new version has finished downloading. Returns a function that unsubscribes. */
    onReady: (listener: (version: string) => void) => () => void
    /** Closes Glofly, installs the new version and opens it again. */
    restart: () => void
    /** Looks for a new version right away. 'unavailable': this copy can't update itself. */
    checkNow: () => Promise<'checking' | 'unavailable'>
  }
  window: {
    setTheme: (theme: WindowTheme) => void
    /** Brings Glofly to your attention (an incoming call): shows it if it's in the tray, flashes the taskbar. */
    attention: () => void
  }
}
