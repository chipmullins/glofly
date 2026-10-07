// The functions the Glofly UI can call in the main process.
// Shared by the main process, the preload bridge and the React app.

export type SignedInUser = {
  id: string
  username: string
  displayName: string
}

export type LoginRequest = {
  identifier: string
  password: string
  keepSignedIn: boolean
}

export type LoginFailureReason =
  'wrong_details' | 'invalid' | 'too_many_requests' | 'unreachable' | 'server_error'

export type LoginResult =
  { ok: true; user: SignedInUser } | { ok: false; reason: LoginFailureReason; message: string }

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

export type PublicUser = { id: string; username: string; displayName: string }

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
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError; message: string }

export type Reaction = { emoji: string; userIds: string[] }

/** A short preview of the message being replied to. */
export type ReplyPreview = { id: string; senderId: string; body: string; deleted: boolean }

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
  | { type: 'connection'; connected: boolean }
  | { type: 'session:expired' }

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
  status: {
    get: () => Promise<ApiResult<MyStatus>>
    /** Change your status and/or custom status (empty text clears it). */
    set: (changes: Partial<MyStatus>) => Promise<ApiResult<MyStatus>>
  }
  conversations: {
    list: () => Promise<ApiResult<ConversationSummary[]>>
    /** Opens (or creates) the DM with a friend. */
    openDm: (userId: string) => Promise<ApiResult<ConversationSummary>>
    /** Newest page, or the page before `beforeMessageId`. Oldest first. */
    messages: (conversationId: string, beforeMessageId?: string) => Promise<ApiResult<MessagePage>>
    send: (conversationId: string, body: string, replyToId?: string) => Promise<ApiResult<Message>>
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
  /** Subscribe to live updates. Returns a function that unsubscribes. */
  onEvent: (listener: (event: GloflyEvent) => void) => () => void
  window: {
    setTheme: (theme: WindowTheme) => void
  }
}
