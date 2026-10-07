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

/** `since` is when you became friends, the request was sent, or you blocked them (ISO date). */
export type FriendEntry = PublicUser & { since: string }
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

export type Message = {
  id: string
  conversationId: string
  senderId: string
  body: string
  /** ISO date */
  createdAt: string
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
}

export type MessagePage = { messages: Message[]; hasMore: boolean }

/** Live updates pushed from the server. */
export type GloflyEvent =
  | { type: 'message:new'; message: Message }
  | { type: 'typing'; conversationId: string; userId: string }
  | { type: 'friends:changed' }
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
  conversations: {
    list: () => Promise<ApiResult<ConversationSummary[]>>
    /** Opens (or creates) the DM with a friend. */
    openDm: (userId: string) => Promise<ApiResult<ConversationSummary>>
    /** Newest page, or the page before `beforeMessageId`. Oldest first. */
    messages: (conversationId: string, beforeMessageId?: string) => Promise<ApiResult<MessagePage>>
    send: (conversationId: string, body: string) => Promise<ApiResult<Message>>
    markRead: (conversationId: string) => Promise<ApiResult<null>>
    typing: (conversationId: string) => void
  }
  /** Subscribe to live updates. Returns a function that unsubscribes. */
  onEvent: (listener: (event: GloflyEvent) => void) => () => void
  window: {
    setTheme: (theme: WindowTheme) => void
  }
}
