// 0.9.3 Live alert cards: shared bits (kept apart from the component for fast refresh).
import { useSyncExternalStore } from 'react'
import type { LiveCard } from '@glofly/shared'

/** Only each site's own pages are opened from a card. */
export function isCardUrl(card: LiveCard): boolean {
  if (card.site === 'twitch') return /^https:\/\/www\.twitch\.tv\/[a-z0-9_]{2,25}$/.test(card.url)
  if (card.site === 'kick') return /^https:\/\/kick\.com\/[a-z0-9_-]{2,40}$/.test(card.url)
  return /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(card.url)
}

/** The alert's text without its last line (the link, shown by the card instead). */
export const liveAlertBody = (body: string, card: LiveCard): string =>
  body.endsWith(`\n${card.url}`) ? body.slice(0, -card.url.length - 1) : body

// The voice nebulas' names of the constellation on screen (ConstellationView keeps it up to date).
let voiceNames = new Map<string, string>()
const listeners = new Set<() => void>()
export function setVoiceNebulaNames(next: Map<string, string>): void {
  voiceNames = next
  for (const l of listeners) l()
}
export function useVoiceName(id: string | null): string | null {
  const names = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => voiceNames
  )
  return id ? (names.get(id) ?? null) : null
}

/** "Watch together": ConstellationView joins the voice nebula and starts the stream there. */
export const WATCH_TOGETHER_EVENT = 'glofly:watch-together'
export type WatchTogetherDetail = { url: string; watchNebulaId: string | null }
