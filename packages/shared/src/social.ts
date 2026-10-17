// 0.5.0 social extras: Glows (streaks), "Want to hang?", birthday glow, Broadcast now and the
// Year in Glow recap. The server works these out; the rules both sides need live here.

import type { PublicUser } from './types'

// ---- Glofly's day ----

/** A date as YYYY-MM-DD in a time zone (Glofly's day for glows and birthdays). */
export function dayIn(date: Date, timeZone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/** Whole days from one YYYY-MM-DD to another (negative if `to` is earlier). */
export function dayGap(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

// ---- Glows ----

/** How bright a glow can get. Each day you both write: +1. Each day missed: −1 (never a reset). */
export const GLOW_MAX = 5

export type GlowState = { level: number; days: number; best: number; lastDay: string | null }

/** A glow as the apps show it (null: no glow right now). */
export type Glow = {
  /** 1–5: how bright the firefly is */
  level: number
  /** Days you've both written in this glow */
  days: number
  /** The most days this glow has ever reached */
  best: number
  /** You've both written today */
  litToday: boolean
}

/** Both wrote today: the glow gets brighter (after dimming for any days missed in between). */
export function lightGlow(g: GlowState, today: string): GlowState {
  if (g.lastDay === today) return g
  const missed = g.lastDay ? Math.max(0, dayGap(g.lastDay, today) - 1) : 0
  const dimmed = Math.max(0, g.level - missed)
  const days = dimmed === 0 ? 1 : g.days + 1
  return { level: Math.min(GLOW_MAX, dimmed + 1), days, best: Math.max(g.best, days), lastDay: today }
}

/** What a stored glow looks like today: missed days dim it; it's gone once fully dim. */
export function glowNow(g: GlowState, today: string): Glow | null {
  if (!g.lastDay || g.level <= 0) return null
  const gap = dayGap(g.lastDay, today)
  const level = Math.max(0, g.level - Math.max(0, gap - 1))
  if (level === 0) return null
  return { level, days: g.days, best: g.best, litToday: gap === 0 }
}

/** "3-day glow", "Bright 12-day glow" */
export function glowLabel(g: Glow): string {
  const days = `${g.days}-day glow`
  return g.level >= GLOW_MAX ? `Bright ${days}` : days[0].toUpperCase() + days.slice(1)
}

/** A sentence about a glow, for its tooltip or the profile. */
export function glowDetail(g: Glow, name: string): string {
  if (g.litToday) return `You and ${name} both wrote today. Keep it glowing tomorrow!`
  return `Write to ${name} today to keep it glowing. A missed day dims it a little.`
}

// ---- Want to hang? ----

/** How long "free to hang" lasts. */
export const HANG_MINUTES = 60

export type Hanging = { userId: string; until: string }

// ---- Broadcast now ----

export type Broadcast = {
  userId: string
  /** ISO date */
  startedAt: string
  /** What they're showing ("Playing Minecraft"), or null */
  title: string | null
  /** People watching right now */
  viewers: number
}

/** A pass to watch (or, for the broadcaster, to send) a broadcast. */
export type BroadcastJoin = { url: string; token: string; room: string; broadcast: Broadcast }

export const BROADCAST_TITLE_MAX = 60

// ---- Everything "today" ----

/** GET /social: glows with friends, who's free to hang, birthdays today, who's live. */
export type SocialToday = {
  /** Friend id → their glow with you (only friends with a glow) */
  glows: Record<string, Glow>
  /** Friends free to hang who told you */
  hanging: Hanging[]
  /** You're free to hang until then (and told only these friends, or every friend when null) */
  myHang: { until: string; with: string[] | null } | null
  /** Friends whose birthday is today (they chose to share it) */
  birthdays: string[]
  /** Friends broadcasting right now (yours first if you are) */
  broadcasts: Broadcast[]
  /** Your own birthday is shared with friends */
  shareBirthday: boolean
}

export const EMPTY_SOCIAL: SocialToday = { glows: {}, hanging: [], myHang: null, birthdays: [], broadcasts: [], shareBirthday: false }

/** A birthday (YYYY-MM-DD) falls on this day (YYYY-MM-DD)? Feb 29 counts as Feb 28 in other years. */
export function isBirthdayOn(birthday: string, day: string): boolean {
  const md = birthday.slice(5, 10)
  const today = day.slice(5, 10)
  if (md === today) return true
  const year = +day.slice(0, 4)
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return md === '02-29' && !leap && today === '02-28'
}

// ---- Year in Glow ----

export type YearInGlow = {
  year: number
  /** Before December: "your year so far" */
  soFar: boolean
  messagesSent: number
  /** Who you wrote to most (people, not groups), most first */
  topFriends: { userId: string; messages: number }[]
  /** Your favorite group (most messages you sent) */
  topGroup: { conversationId: string; name: string; messages: number } | null
  /** Your longest glow this year */
  longestGlow: { userId: string; days: number } | null
  calls: number
  callMinutes: number
  /** Emoji you used most, in messages and reactions */
  topEmoji: { emoji: string; count: number }[]
  gifsSent: number
  photosSent: number
  /** The day you sent the most messages */
  busiestDay: { day: string; messages: number } | null
  /** Names and photos for everyone mentioned */
  people: PublicUser[]
}

/** Year in Glow is "in season" in December and the first half of January (last year's). */
export function yearInGlowSeason(now: Date): { year: number; soFar: boolean } {
  const m = now.getMonth()
  if (m === 0 && now.getDate() <= 15) return { year: now.getFullYear() - 1, soFar: false }
  return { year: now.getFullYear(), soFar: m !== 11 }
}
