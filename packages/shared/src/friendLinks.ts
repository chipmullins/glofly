// 0.8.0 shareable friend invite links: glofly.app/i/<code>. Everyone gets one personal link;
// signing up from it, or opening it while signed in, makes you friends with its owner at once.
// A code reads like `chip-7Kq4mZ`: the owner's username squeezed to letters and digits, a dash,
// then six random letters and digits (62^6 ≈ 57 billion per name, with per-IP and per-account
// limits on trying them). Resetting makes a new code; the old one stops working right away.

import type { PublicUser } from './types'

/** The random part's length. */
export const FRIEND_LINK_RANDOM = 6
/** The name part's longest length. */
export const FRIEND_LINK_SLUG_MAX = 12
/** A friend link code: `chip-7Kq4mZ`. */
export const FRIEND_LINK_PATTERN = /^[a-z0-9]{1,12}-[A-Za-z0-9]{6}$/
/** At most this many people become your friends through your link a day (abuse cap). */
export const FRIEND_LINK_DAILY_CAP = 50

/** The name part of a code: "Chip.M_2" → "chipm2" ("glofly" if nothing is left). */
export function friendLinkSlug(username: string): string {
  const slug = username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, FRIEND_LINK_SLUG_MAX)
  return slug || 'glofly'
}

/** The link people share, without https:// (as the apps show it): glofly.app/i/<code>. */
export const friendLinkText = (code: string): string => `glofly.app/i/${code}`
/** The full link (what gets copied and shared). */
export const friendLinkUrl = (code: string): string => `https://${friendLinkText(code)}`

/**
 * The code in something someone pasted or opened: https://glofly.app/i/<code>, glofly.app/i/<code>,
 * glofly://i/<code>, chat.glofly.app/?friend=<code>, or just the code. Null if there isn't one.
 */
export function friendLinkCodeFrom(text: string): string | null {
  const t = text.trim()
  const m =
    t.match(/(?:^|\/)i\/([a-z0-9]{1,12}-[A-Za-z0-9]{6})(?:[/?#].*)?$/) ??
    t.match(/[?&]friend=([a-z0-9]{1,12}-[A-Za-z0-9]{6})(?:[&#].*)?$/) ??
    t.match(/^([a-z0-9]{1,12}-[A-Za-z0-9]{6})$/)
  return m ? m[1] : null
}

/** "3 friends joined from your link" / "New link. Nobody has used it yet." (the approved lines) */
export function friendLinkJoinedLine(joined: number): string {
  if (joined <= 0) return 'New link. Nobody has used it yet.'
  return joined === 1 ? '1 friend joined from your link' : `${joined} friends joined from your link`
}

/** The approved sentence under "Copy your invite link" / "Share your invite link". */
export const FRIEND_LINK_PITCH = "Send your invite link. You'll automatically be friends as soon as they join."
/** What a dead link says (reset, or its owner can't be added any more). */
export const FRIEND_LINK_DEAD = "This invite link doesn't work anymore. Ask your friend for a new one."
/** The share sheet's message on phones. */
export const friendLinkShareMessage = (code: string): string => `Join me on Glofly ${friendLinkUrl(code)}`

/** GET /friends/link: your own invite link. */
export type MyFriendLink = {
  code: string
  /** https://glofly.app/i/<code> */
  url: string
  /** How many people became your friends through this link (resets with the link). */
  joined: number
  createdAt: string
}

/** GET /friends/link/:code: whose link it is and what they are to you. */
export type FriendLinkPreview = {
  user: PublicUser
  relationship: 'none' | 'friends' | 'outgoing' | 'incoming' | 'self'
}

/** POST /friends/link/:code/accept */
export type FriendLinkAccepted = {
  status: 'accepted' | 'already_friends'
  user: PublicUser
}

/** GET /i/:code/info (no sign-in): what a sign-up screen may show about the link's owner. */
export type FriendLinkInfo = {
  displayName: string
  username: string
}
