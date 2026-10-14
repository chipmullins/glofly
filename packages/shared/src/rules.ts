// Glofly's rules and limits, the same everywhere: the server enforces them, and the apps
// show them live while people type (register, Edit profile, the message box…).

// ---------------------------------------------------------------------------------------
// Accounts

export const USERNAME_MIN = 3
export const USERNAME_MAX = 20
export const DISPLAY_NAME_MAX = 32
export const PASSWORD_MIN = 8
/** Stops someone sending a huge "password" to slow the server. */
export const PASSWORD_MAX = 128
export const MINIMUM_AGE = 13
export const EMAIL_MAX = 254
export const BIO_MAX = 190
export const STATUS_TEXT_MAX = 80

/** Handles nobody should be able to claim, so no one can impersonate staff. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'glofly',
  'gloflyapp',
  'help',
  'mod',
  'moderator',
  'official',
  'root',
  'security',
  'staff',
  'support',
  'system',
  'team'
])

/** Letters, numbers, periods and underscores; starts and ends with a letter or number. */
export const USERNAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._]*[a-zA-Z0-9])?$/

/** Control characters (invisible formatting codes) are blocked so names can't break layouts. */
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/

/** What's wrong with a username (already trimmed), or null if it's fine. */
export function usernameProblem(username: string): string | null {
  if (username.length < USERNAME_MIN) return `Usernames need at least ${USERNAME_MIN} characters.`
  if (username.length > USERNAME_MAX) return `Usernames can be at most ${USERNAME_MAX} characters.`
  if (!USERNAME_PATTERN.test(username))
    return 'Use letters, numbers, periods and underscores. Start and end with a letter or number.'
  if (/[._]{2}/.test(username)) return "Periods and underscores can't be next to each other."
  if (RESERVED_USERNAMES.has(username.toLowerCase())) return "That username isn't available."
  return null
}

/** What's wrong with a display name (already trimmed), or null if it's fine. */
export function displayNameProblem(name: string): string | null {
  if (name.length < 1) return 'Enter a display name.'
  if (name.length > DISPLAY_NAME_MAX)
    return `Display names can be at most ${DISPLAY_NAME_MAX} characters.`
  if (CONTROL_CHARS.test(name)) return "Display names can't contain hidden characters."
  return null
}

/** What's wrong with a new password, or null if it's fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`
  if (password.length > PASSWORD_MAX) return `Passwords can be at most ${PASSWORD_MAX} characters.`
  if (!/[0-9]/.test(password)) return 'Passwords need at least one number.'
  if (!/\p{L}/u.test(password)) return 'Passwords need at least one letter.'
  return null
}

/** Age in whole years on `today` for someone born on `birthday` (YYYY-MM-DD). */
export function ageOn(birthday: string, today: Date): number {
  const [y, m, d] = birthday.split('-').map(Number)
  let age = today.getUTCFullYear() - y
  const beforeBirthdayThisYear =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)
  if (beforeBirthdayThisYear) age -= 1
  return age
}

/** True for a date that exists (2025-02-30 doesn't). */
export function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * What's wrong with a birthday (YYYY-MM-DD), or null if it's fine. `minimumAge` is 0 only for a
 * restricted (family) account set up in Glofly Control with a parent's consent.
 */
export function birthdayProblem(birthday: string, today = new Date(), minimumAge = MINIMUM_AGE): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return 'Enter your birthday.'
  if (!isRealDate(birthday)) return "That date doesn't exist."
  if (Number(birthday.slice(0, 4)) < 1900) return 'Check the year you were born.'
  const age = ageOn(birthday, today)
  if (age < 0) return "Your birthday can't be in the future."
  if (age < minimumAge) return `You need to be at least ${minimumAge} to use Glofly.`
  return null
}

// ---------------------------------------------------------------------------------------
// Chats

export const MESSAGE_MAX = 4000
export const GROUP_MAX = 25
export const GROUP_NAME_MAX = 50
export const MAX_PINNED = 10
export const MAX_REACTIONS_PER_PERSON = 20

// ---------------------------------------------------------------------------------------
// Photos, files and voice messages

/** Profile and group photos */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024
export const ATTACHMENTS_PER_MESSAGE = 10
export const VOICE_MIN_MS = 200
export const VOICE_MAX_MS = 5 * 60 * 1000
export const VOICE_MAX_BYTES = 6 * 1024 * 1024
export const VOICE_PEAKS_MAX = 64

// ---------------------------------------------------------------------------------------
// Calls

/** How long a call rings (matches the ringtone). */
export const RING_MS = 23_000

/** Nicknames you give someone (only you see them): same length as display names. */
export const NICKNAME_MAX = DISPLAY_NAME_MAX

/** Tidies a nickname (trimmed, inner spaces squeezed). Empty means "remove the nickname". */
export function cleanNickname(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}

export function nicknameProblem(name: string): string | null {
  if (name.length > NICKNAME_MAX) return `Nicknames can be at most ${NICKNAME_MAX} characters.`
  if (CONTROL_CHARS.test(name)) return "Nicknames can't contain hidden characters."
  return null
}
