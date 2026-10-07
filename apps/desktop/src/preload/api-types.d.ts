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

export type GloflyApi = {
  auth: {
    login: (request: LoginRequest) => Promise<LoginResult>
    logout: () => Promise<void>
  }
}
