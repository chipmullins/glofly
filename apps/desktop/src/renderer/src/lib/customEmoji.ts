import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'
import {
  emojiNamesIn,
  type ConstellationEmoji,
  type EmojiInfo as CustomEmojiInfo,
  type EmojiSet
} from '@glofly/shared'
import type { ApiResult, Message } from '../../../preload/api-types'

// Communities round 2: custom emoji + stickers per constellation (approved boards 2a–2b). The
// picker's sets (every constellation you're in) are loaded once and kept fresh by live events.
// A message's text keeps `:name:`; sending says which pictures those names mean (their ids).

const call = <T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<ApiResult<T>> =>
  window.glofly.constellations.request<T>(method === 'PATCH' ? 'PATCH' : method, path, body)

let sets: EmojiSet[] = []
let loaded = false
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
const tell = (): void => listeners.forEach((l) => l())

function load(): Promise<void> {
  loading ??= call<{ sets: EmojiSet[] }>('GET', '/emoji/mine')
    .then((r) => {
      if (r.ok) {
        sets = r.data.sets
        loaded = true
        tell()
      }
    })
    .finally(() => {
      loading = null
    })
  return loading
}

let following = false
function follow(): void {
  if (following) return
  following = true
  window.glofly.onEvent((e) => {
    if (
      e.type === 'emoji:changed' ||
      e.type === 'constellations:changed' ||
      e.type === 'constellation:removed' ||
      (e.type === 'connection' && e.connected)
    )
      void load()
  })
}

/** My constellations' emoji and stickers (an empty list until loaded). */
export function useEmojiSets(): EmojiSet[] {
  useEffect(() => {
    follow()
    if (!loaded) void load()
  }, [])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => sets
  )
}

/** The ones usable in a chat: "outside" ones anywhere, the rest only in their own constellation. */
export function usableSets(all: EmojiSet[], constellationId: string | null): EmojiSet[] {
  return all
    .map((s) => ({
      ...s,
      emoji: s.emoji.filter((e) => e.outside || s.constellation.id === constellationId),
      stickers: s.stickers.filter((e) => e.outside || s.constellation.id === constellationId)
    }))
    .filter((s) => s.emoji.length || s.stickers.length)
    .sort((a, b) =>
      a.constellation.id === constellationId ? -1 : b.constellation.id === constellationId ? 1 : 0
    )
}

/**
 * The ids to send with a message: for each `:name:` in it, my custom emoji with that name (this
 * constellation's first, then any other I may use here).
 */
export function emojiIdsFor(text: string, constellationId: string | null): string[] {
  const names = emojiNamesIn(text)
  if (!names.length || !sets.length) return []
  const usable = usableSets(sets, constellationId)
  const out: string[] = []
  for (const n of names) {
    for (const s of usable) {
      const e = s.emoji.find((x) => x.name === n)
      if (e) {
        out.push(e.id)
        break
      }
    }
  }
  return out.slice(0, 30)
}

/** A custom emoji picked in the picker: ":name:#id" (reactions say which one). */
export const customKey = (e: Pick<ConstellationEmoji, 'id' | 'name'>): string =>
  `:${e.name}:#${e.id}`
/** What goes in the message box for a picked emoji (custom ones: just ":name:"). */
export const typedFor = (picked: string): string => picked.replace(/#[0-9a-f-]{36}$/i, '')

export const emojiApi = {
  list: (id: string) =>
    call<{
      emoji: ConstellationEmoji[]
      stickers: ConstellationEmoji[]
      limits: { emoji: number; stickers: number }
      canManage: boolean
    }>('GET', `/constellations/${id}/emoji`),
  change: (id: string, emojiId: string, changes: { name?: string; outside?: boolean }) =>
    call<{ emoji: ConstellationEmoji[]; stickers: ConstellationEmoji[] }>(
      'PATCH',
      `/constellations/${id}/emoji/${emojiId}`,
      changes
    ),
  remove: (id: string, emojiId: string) =>
    call<{ emoji: ConstellationEmoji[]; stickers: ConstellationEmoji[] }>(
      'DELETE',
      `/constellations/${id}/emoji/${emojiId}`
    ),
  info: (emojiId: string) => call<CustomEmojiInfo>('GET', `/emoji/${emojiId}/info`),
  sendSticker: (stickerId: string, conversationId: string, replyToId?: string) =>
    call<{ message: Message }>('POST', `/emoji/${stickerId}/send`, {
      conversationId,
      ...(replyToId ? { replyToId } : {})
    })
}

/** Where this chat is (its constellation, or null): inside-only emoji only show there. */
export const EmojiPlace = createContext<string | null>(null)
export const useEmojiPlace = (): string | null => useContext(EmojiPlace)
