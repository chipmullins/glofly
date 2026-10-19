// 0.7.3: two-step sign-in, QR code sign-in, sign-in devices and the apps' error reports.
// Types every app and the server agree on, plus a few pure helpers.

// ---------------------------------------------------------------------------------------------
// Two-step sign-in (a 6-digit code by email or text after the password)

export type TwoStepMethod = 'email' | 'sms'

/** Settings → Account → Two-step sign-in */
export type TwoStepStatus = {
  enabled: boolean
  /** The account's email, masked ("c•••@gmail.com"); codes can always go there */
  email: string
  /** The confirmed phone, masked ("•••• 0123"), or null */
  phone: string | null
  /** The server can send texts (an origination number is set up). False: email only for now */
  smsAvailable: boolean
  /** One-time backup codes left */
  backupCodesLeft: number
  /** Two-step needs a confirmed email first */
  emailVerified: boolean
}

/**
 * The answer to a password that was right, for an account with two-step on (only apps that send
 * `twoStepAware: true`; older apps get a 401 saying to update). The code has been sent.
 */
export type LoginTwoStep = {
  twoStep: {
    /** Pass back with the code (valid 10 minutes) */
    challenge: string
    method: TwoStepMethod
    /** Where it went: "c•••@gmail.com" or "•••• 0123" */
    sentTo: string
    /** Other ways that can be asked for instead ("Send it by email instead") */
    alternatives: TwoStepMethod[]
  }
}

export const TWO_STEP_CODE_LENGTH = 6
/** Backup codes look like "k7qp-2mzx" */
export const BACKUP_CODE_PATTERN = /^[a-z0-9]{4}-?[a-z0-9]{4}$/i

/** Only digits (and a backup code's letters and dash) survive: pasted "123 456" works. */
export function cleanCode(typed: string): string {
  const t = typed.trim()
  if (BACKUP_CODE_PATTERN.test(t.replace(/\s+/g, ''))) return t.replace(/\s+/g, '').toLowerCase()
  return t.replace(/\D/g, '').slice(0, TWO_STEP_CODE_LENGTH)
}

/**
 * A US phone number as typed ("(502) 555-0123", "502.555.0123", "+1 502 555 0123") in E.164
 * ("+15025550123"), or null. Other countries: typed with + and the country code.
 */
export function phoneE164(typed: string): string | null {
  const t = typed.trim()
  const digits = t.replace(/\D/g, '')
  if (t.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** "+15025550123" → "•••• 0123" */
export const maskPhone = (e164: string): string => `•••• ${e164.slice(-4)}`

// ---------------------------------------------------------------------------------------------
// QR code sign-in: the computer shows a code, a signed-in phone approves it

/** What the computer gets when it asks for a QR code */
export type QrLoginStart = {
  /** In the QR code (the link `${server}/qr/${id}`) */
  id: string
  /** Kept by the computer only: proves it's the one that asked */
  secret: string
  /** The code works until then (2 minutes); ask for a new one after */
  expiresAt: string
  /** What the QR code holds */
  url: string
}

export type QrLoginState =
  | { state: 'waiting' }
  /** A phone opened it: "Waiting for Riley to approve on their phone" */
  | { state: 'scanned'; by: { displayName: string; avatarVersion: string | null; id: string } }
  | { state: 'declined' }
  | { state: 'expired' }

/** What the phone shows before approving */
export type QrLoginRequest = {
  id: string
  /** "Windows · DESKTOP-4KQ2", "Chrome on a Mac" */
  deviceName: string | null
  /** "desktop" / "web" */
  app: 'desktop' | 'web'
  createdAt: string
  expiresAt: string
}

/** /qr/<id> links (also inside glofly:// links): a QR code's id */
export const QR_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/

/** The id in a scanned QR link (https://api.glofly.app/qr/<id> or glofly://qr-login/<id>), or null */
export function qrIdFrom(text: string): string | null {
  const m = /(?:\/qr\/|qr-login\/)([A-Za-z0-9_-]{22})(?:[/?#]|$)/.exec(text.trim())
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------------------------
// Sign-in devices (Settings → Devices): 0.7.3 adds which app and version

export type DeviceApp = 'desktop' | 'web' | 'android' | 'ios'

/** "Glofly for iPhone", "Glofly in a browser", … */
export function deviceAppName(platform: string | null | undefined): string {
  switch (platform) {
    case 'ios':
      return 'Glofly for iPhone & iPad'
    case 'android':
      return 'Glofly for Android'
    case 'web':
      return 'Glofly in a browser'
    default:
      return 'Glofly Desktop'
  }
}

// ---------------------------------------------------------------------------------------------
// Error reports (Control → Errors)

export type ErrorReport = {
  /** The error's first line (cut to 300 characters; no message text, no personal details) */
  message: string
  /** Where in the code (cut to 4000 characters) */
  stack?: string
  /** Which screen or action: "chat", "call", "watch", "startup" … */
  where?: string
  /** "Windows 11", "iOS 19.1", "Chrome 141 on macOS" */
  os?: string
}

export const ERROR_MESSAGE_MAX = 300
export const ERROR_STACK_MAX = 4000

/**
 * Takes out what could be personal before an error is sent: email addresses, long numbers, ids,
 * tokens and the user's own folders in file paths.
 */
export function scrubError(text: string, max: number): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{32,}\b/g, '<token>')
    .replace(/\b\d{6,}\b/g, '<number>')
    .replace(/([\\/](?:Users|home)[\\/])[^\\/\s]+/gi, '$1<user>')
    .replace(/[?&](?:token|secret|code|key)=[^&\s]+/gi, '?<hidden>')
    .slice(0, max)
}
