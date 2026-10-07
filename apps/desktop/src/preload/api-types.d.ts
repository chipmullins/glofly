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
  | 'too_many_requests'
  | 'server_error'
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError; message: string }

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
  window: {
    setTheme: (theme: WindowTheme) => void
  }
}
