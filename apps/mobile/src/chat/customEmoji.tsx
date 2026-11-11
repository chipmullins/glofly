import type { ReactNode } from 'react'
import { Image } from 'react-native'
import { create } from 'zustand'
import { emojiNamesIn, splitEmoji, type EmojiRef, type EmojiSet } from '@glofly/shared'
import { authHeaders, request, url } from '@/api/http'
import { onSignOut } from '@/state/session'

// Communities round 2 (approved board 2c): custom emoji + stickers per constellation on phones.
// A message keeps ":name:" in its text; `emojis` says which pictures those names are.

export const emojiSource = (id: string) => ({ uri: url(`/emoji/${id}/image`), headers: authHeaders(), cacheKey: `emoji-${id}` })

/** Inline picture for a custom emoji (RN's Image works inside Text). */
export function InlineEmoji({ emoji, size }: { emoji: Pick<EmojiRef, 'id' | 'name'>; size: number }) {
  return <Image source={emojiSource(emoji.id)} accessibilityLabel={`:${emoji.name}:`} style={{ width: size, height: size }} />
}

/** Wraps a "plain text pieces" function so `:name:` becomes the picture. */
export function withCustomEmoji(plain: (text: string, key: string) => ReactNode[], refs: EmojiRef[] | undefined, size: number) {
  if (!refs?.length) return plain
  return (text: string, key: string): ReactNode[] => {
    const out: ReactNode[] = []
    splitEmoji(text, refs).forEach((p, i) => {
      if ('text' in p) out.push(...plain(p.text, `${key}c${i}`))
      else out.push(<InlineEmoji key={`${key}e${i}`} emoji={p.emoji} size={Math.round(size * 1.35)} />)
    })
    return out
  }
}

/** A reaction chip's face: a custom emoji's picture, or the emoji itself. */
export function reactionRef(key: string, refs: EmojiRef[] | undefined): EmojiRef | null {
  return /^:[A-Za-z0-9_]{2,32}:$/.test(key) ? (refs?.find((r) => `:${r.name}:` === key) ?? null) : null
}

// ───────────── The picker's sets ─────────────

export const useEmojiSets = create<{ sets: EmojiSet[]; loaded: boolean }>(() => ({ sets: [], loaded: false }))
onSignOut(() => useEmojiSets.setState({ sets: [], loaded: false }))

let loading: Promise<void> | null = null
export function loadEmojiSets(): Promise<void> {
  loading ??= request<{ sets: EmojiSet[] }>('GET', '/emoji/mine')
    .then((r) => {
      if (r.ok) useEmojiSets.setState({ sets: r.data.sets, loaded: true })
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** The ones usable in a chat: "outside" ones anywhere, the rest only in their constellation. */
export function usableSets(all: EmojiSet[], constellationId: string | null): EmojiSet[] {
  return all
    .map((s) => ({
      ...s,
      emoji: s.emoji.filter((e) => e.outside || s.constellation.id === constellationId),
      stickers: s.stickers.filter((e) => e.outside || s.constellation.id === constellationId),
    }))
    .filter((s) => s.emoji.length || s.stickers.length)
    .sort((a, b) => (a.constellation.id === constellationId ? -1 : b.constellation.id === constellationId ? 1 : 0))
}

/** The ids to send with a message for its ":name:"s. */
export function emojiIdsFor(text: string, constellationId: string | null): string[] {
  const names = emojiNamesIn(text)
  if (!names.length) return []
  const usable = usableSets(useEmojiSets.getState().sets, constellationId)
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

/** What a picked custom emoji puts in the message box (":name:"). */
export const typedFor = (picked: string): string => picked.replace(/#[0-9a-f-]{36}$/i, '')
