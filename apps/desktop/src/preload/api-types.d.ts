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
}

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
}

/** A short preview of the message being replied to. */
export type ReplyPreview = {
  id: string
  senderId: string
  body: string
  deleted: boolean
  /** Its first photo or file (and how many it has), so "Photo" can show when there's no text. */
  attachment?: { kind: 'image' | 'file'; name: string; count: number } | null
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
}

export type ConversationSummary = {
  id: string
  partner: PublicUser
  lastMessage: Message | null
  unreadCount: number
  /** False if you're no longer friends, or either of you blocked the other. */
  canMessage: boolean
  /** ISO date of the latest activity, for sorting */
  activityAt: string
  /** How far they've read (ISO date), for "Seen". Null unless both people allow read receipts. */
  partnerReadAt: string | null
}

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
export type AccountDetails = { username: string; email: string; createdAt: string }

export type AppSettingsChanges = Partial<
  Pick<AppSettings, 'closeToTray' | 'openAtLogin' | 'theme' | 'accent' | 'textSize'>
>

export type ThemeChoice = 'light' | 'dark' | 'system'
export type AccentChoice = 'orange' | 'red'
export type TextSize = 'small' | 'default' | 'large' | 'larger'

/** Settings → General → Appearance and App. Kept on this computer, not on the server. */
export type AppSettings = {
  /** e.g. "0.1.0" */
  version: string
  theme: ThemeChoice
  accent: AccentChoice
  textSize: TextSize
  /** Closing the window keeps Glofly running in the system tray. */
  closeToTray: boolean
  /** Open Glofly when the computer starts. */
  openAtLogin: boolean
  /** False while developing: only the installed app can start with Windows. */
  startupAvailable: boolean
}

export type MessagePage = { messages: Message[]; hasMore: boolean }

/** Live updates pushed from the server. */
export type GloflyEvent =
  | { type: 'message:new'; message: Message }
  | { type: 'message:updated'; message: Message }
  | { type: 'typing'; conversationId: string; userId: string }
  | { type: 'friends:changed' }
  | ({ type: 'presence'; userId: string } & Presence)
  | { type: 'conversation:read'; conversationId: string; userId: string; readAt: string }
  | { type: 'conversations:changed' }
  | { type: 'profile:changed'; userId: string }
  | { type: 'connection'; connected: boolean }
  | { type: 'session:expired' }
  | { type: 'appearance'; accent: AccentChoice; dark: boolean }

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
    /** Signs back in with a saved "Keep me signed in" session. Null if there isn't a valid one. */
    restore: () => Promise<SignedInUser | null>
    logout: () => Promise<void>
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
    /** Newest page, or the page before `beforeMessageId`. Oldest first. */
    messages: (conversationId: string, beforeMessageId?: string) => Promise<ApiResult<MessagePage>>
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
      name: string
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
  /** Subscribe to live updates. Returns a function that unsubscribes. */
  onEvent: (listener: (event: GloflyEvent) => void) => () => void
  window: {
    setTheme: (theme: WindowTheme) => void
  }
}
