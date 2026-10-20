import type { Href } from 'expo-router'

// 0.7.5: the settings the Chats search can open on phones (the desktop's Ctrl+K quick switcher
// has its own list), with words people might type for them.

export type PhoneSettingsPlace = { id: string; name: string; where: string; href: Href; keywords: string }

export const PHONE_SETTINGS: PhoneSettingsPlace[] = [
  { id: 'theme', name: 'Theme', where: 'Settings', href: '/settings', keywords: 'appearance dark light mode accent color colour look' },
  { id: 'privacy', name: 'Privacy', where: 'Settings', href: '/settings', keywords: 'read receipts typing last seen online friend requests birthday' },
  { id: 'notifications', name: 'Notifications', where: 'Settings', href: '/settings/notifications', keywords: 'notify alerts preview vibrate full screen calls' },
  { id: 'quiet', name: 'Quiet hours', where: 'Settings → Notifications', href: '/settings/notifications', keywords: 'quiet hours night sleep do not disturb schedule silence' },
  { id: 'sounds', name: 'Message sound', where: 'Settings → Notifications', href: { pathname: '/settings/sound', params: { kind: 'message' } }, keywords: 'sounds ding tone' },
  { id: 'ringtone', name: 'Ringtone', where: 'Settings → Notifications', href: { pathname: '/settings/sound', params: { kind: 'ringtone' } }, keywords: 'ringtone calls ring sound' },
  { id: 'account', name: 'Account', where: 'Settings', href: '/settings/account', keywords: 'email password two step 2fa security devices signed in sign out delete' },
  { id: 'games', name: 'My games', where: 'Settings', href: { pathname: '/games/[id]', params: { id: 'me' } }, keywords: 'games playtime favorites playing' },
  { id: 'year', name: 'Year in Glow', where: 'Settings', href: '/year', keywords: 'year recap stats wrapped' },
  { id: 'about', name: 'About Glofly', where: 'Settings', href: '/settings/about', keywords: 'about version help privacy policy terms support' },
]
