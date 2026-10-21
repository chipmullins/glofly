// 0.7.5 Ctrl+K quick switcher (QuickSwitcher.dc.html): the matching and the list of settings
// places it can open. Pure functions, so they're easy to test.

export { matchScore } from '@glofly/shared/quickSwitch'

export type SettingsPlace = {
  id: string
  name: string
  /** Settings → page → section */
  where: string
  page: 'general' | 'voice' | 'overlay' | 'account' | 'about'
  /** A row id (without "settings-") or the section heading to scroll to */
  focus?: string
  keywords: string
  /** Only in the desktop app on Windows (the game overlay), or only the desktop app */
  only?: 'windows' | 'desktop'
}

/** The settings the quick switcher can open, with words people might type for them. */
export const SETTINGS_PLACES: SettingsPlace[] = [
  {
    id: 'theme',
    name: 'Theme',
    where: 'Settings → General → Appearance',
    page: 'general',
    focus: 'Appearance',
    keywords: 'appearance dark light mode accent color colour text size font look'
  },
  {
    id: 'privacy',
    name: 'Privacy',
    where: 'Settings → General → Privacy',
    page: 'general',
    focus: 'Privacy',
    keywords: 'read receipts typing last seen online friend requests birthday'
  },
  {
    id: 'invite-link',
    name: 'Your invite link',
    where: 'Settings → General → Friends',
    page: 'general',
    focus: 'invite-link',
    keywords: 'invite link share friends copy reset join url'
  },
  {
    id: 'notifications',
    name: 'Notifications & sounds',
    where: 'Settings → General',
    page: 'general',
    focus: 'Notifications & sounds',
    keywords: 'notify alerts sounds ringtone volume preview mute ding'
  },
  {
    id: 'quiet',
    name: 'Quiet hours',
    where: 'Settings → General → Notifications',
    page: 'general',
    focus: 'quiet-hours',
    keywords: 'quiet hours night sleep do not disturb schedule silence'
  },
  {
    id: 'activity',
    name: 'Show what I’m playing',
    where: 'Settings → General → Activity',
    page: 'general',
    focus: 'Activity',
    keywords: 'activity playing games status detect',
    only: 'desktop'
  },
  {
    id: 'app',
    name: 'Start with my computer',
    where: 'Settings → General → App',
    page: 'general',
    focus: 'App',
    keywords: 'app startup login tray menu bar close background updates',
    only: 'desktop'
  },
  {
    id: 'audio',
    name: 'Microphone and speakers',
    where: 'Settings → Voice & video',
    page: 'voice',
    focus: 'Microphone and speakers',
    keywords: 'voice audio mic microphone speakers headset input output devices'
  },
  {
    id: 'camera',
    name: 'Camera',
    where: 'Settings → Voice & video',
    page: 'voice',
    focus: 'Camera',
    keywords: 'video webcam camera mirror'
  },
  {
    id: 'ptt',
    name: 'Push to talk',
    where: 'Settings → Voice & video → Input mode',
    page: 'voice',
    focus: 'Input mode',
    keywords: 'push to talk ptt input mode open mic key'
  },
  {
    id: 'noise',
    name: 'Noise suppression',
    where: 'Settings → Voice & video → Voice processing',
    page: 'voice',
    focus: 'Voice processing',
    keywords: 'noise suppression echo cancellation voice processing background'
  },
  {
    id: 'overlay',
    name: 'Game overlay',
    where: 'Settings → Game overlay',
    page: 'overlay',
    keywords: 'overlay game in game keys hotkey',
    only: 'windows'
  },
  {
    id: 'email',
    name: 'Email',
    where: 'Settings → Account',
    page: 'account',
    focus: 'Email',
    keywords: 'email address change confirm'
  },
  {
    id: 'two-step',
    name: 'Two-step sign-in',
    where: 'Settings → Account',
    page: 'account',
    focus: 'Two-step sign-in',
    keywords: 'two step 2fa security code sign in login backup codes'
  },
  {
    id: 'devices',
    name: 'Where you’re signed in',
    where: 'Settings → Account',
    page: 'account',
    focus: 'Where you’re signed in',
    keywords: 'devices sessions signed in sign out log out security'
  },
  {
    id: 'password',
    name: 'Password',
    where: 'Settings → Account',
    page: 'account',
    focus: 'Password',
    keywords: 'password change security'
  },
  {
    id: 'delete',
    name: 'Delete my account',
    where: 'Settings → Account → Danger zone',
    page: 'account',
    focus: 'Danger zone',
    keywords: 'delete account close remove'
  },
  {
    id: 'about',
    name: 'About Glofly',
    where: 'Settings → About',
    page: 'about',
    keywords: 'about version help privacy policy terms credits support'
  }
]

/** Remembered places (most recent first), so an empty switcher shows where you've been. */
export type RecentPlace = { kind: 'chat'; id: string } | { kind: 'constellation'; id: string }

const RECENT_KEY = 'glofly.quickRecent'
const RECENT_MAX = 6

export function readRecent(userId: string): RecentPlace[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null') as {
      userId: string
      places: RecentPlace[]
    } | null
    return raw?.userId === userId && Array.isArray(raw.places) ? raw.places : []
  } catch {
    return []
  }
}

export function noteRecent(userId: string, place: RecentPlace): void {
  const places = [
    place,
    ...readRecent(userId).filter((p) => !(p.kind === place.kind && p.id === place.id))
  ].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify({ userId, places }))
  } catch {
    // Storage full or off: recents just aren't remembered.
  }
}
