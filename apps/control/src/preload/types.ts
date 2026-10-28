// Shapes passed between the Control window and its main process.

export type Failure = {
  ok: false
  status: number
  error: string
  message: string
  fields?: Record<string, string>
}

export type CallResult = { ok: true; data: Record<string, unknown> } | Failure

export type SignInPasswordResult = { ok: true; username: string; displayName: string } | Failure

export type AdminUser = {
  userId: string
  username: string
  displayName: string
  avatarVersion: string | null
}

export type SignInCodeResult =
  { ok: true; expiresAt: string; admin: AdminUser; backupCodesLeft: number } | Failure

export type ControlApi = {
  platform: string
  serverUrl: string
  signIn: {
    password: (username: string, password: string) => Promise<SignInPasswordResult>
    code: (kind: 'code' | 'backupCode', value: string) => Promise<SignInCodeResult>
    signOut: () => Promise<void>
  }
  call: (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown
  ) => Promise<CallResult>
  exportAudit: () => Promise<{ ok: true; saved: boolean } | { ok: false; message: string }>
  /** Oct 28, 2026: Accounts → Export data (saved as a .json file) */
  exportAccount: (
    id: string,
    note: string
  ) => Promise<{ ok: true; saved: boolean } | { ok: false; message: string }>
  copy: (text: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  setScreen: (screen: 'signin' | 'app') => void
  onSignedOut: (callback: (reason: 'expired' | 'ended') => void) => () => void
  /**
   * 0.8.2: a native notification for a Control alert (title ≤120, body ≤300 characters, page one
   * of Control's pages). Clicking it brings Control forward and calls onOpenPage.
   */
  notify: (alert: { title: string; body: string; page: string }) => void
  onOpenPage: (callback: (page: string) => void) => () => void
  /** 0.7.3: Control's own unexpected errors go to the server's error reports */
  reportError: (report: { message: string; stack?: string; where?: string }) => void
}
