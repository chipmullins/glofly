/**
 * Emoji: Twemoji pictures, the emoji list for the picker, search, skin tones and
 * "Recently used".
 *
 * Pictures come from the bundled @twemoji/svg set (Emoji 15.0). Newer emoji that it doesn't
 * have yet still work in messages; they just show in the computer's own emoji font.
 */
import { parse } from '@twemoji/parser'
import { base, names } from 'virtual:twemoji'

const available = new Set(names)

/** Twemoji's file name for an emoji: code points in hex, without FE0F unless it's a ZWJ sequence. */
function twemojiName(emoji: string): string {
  const text = emoji.includes('‍') ? emoji : emoji.replace(/️/g, '')
  return Array.from(text, (c) => (c.codePointAt(0) ?? 0).toString(16)).join('-')
}

/** The picture for an emoji, or null if Twemoji doesn't have one. */
export function emojiUrl(emoji: string): string | null {
  let name = twemojiName(emoji)
  if (available.has(name)) return base + name + '.svg'
  // A few pictures keep FE0F even outside ZWJ sequences (and some drop it inside them).
  name = Array.from(emoji, (c) => (c.codePointAt(0) ?? 0).toString(16)).join('-')
  if (available.has(name)) return base + name + '.svg'
  name = twemojiName(emoji.replace(/️/g, ''))
  return available.has(name) ? base + name + '.svg' : null
}

export type TextPiece = { text: string; url: string | null }

/** Splits text into plain runs and emoji (with their pictures). */
export function splitEmoji(text: string): TextPiece[] {
  const pieces: TextPiece[] = []
  let at = 0
  for (const entity of parse(text, { buildUrl: () => '' })) {
    const [start, end] = entity.indices
    const url = emojiUrl(entity.text)
    if (!url) continue // no picture: leave it in the plain text around it
    if (start > at) pieces.push({ text: text.slice(at, start), url: null })
    pieces.push({ text: entity.text, url })
    at = end
  }
  if (at < text.length) pieces.push({ text: text.slice(at), url: null })
  return pieces
}

const JUMBO_MAX = 10

/** True for a message that's only a few emoji (shown big, like the design's chat). */
export function isJumbo(text: string): boolean {
  if (!text.trim() || text.length > 120) return false
  const entities = parse(text, { buildUrl: () => '' })
  if (entities.length === 0 || entities.length > JUMBO_MAX) return false
  let rest = text
  for (let i = entities.length - 1; i >= 0; i--) {
    const [start, end] = entities[i].indices
    rest = rest.slice(0, start) + rest.slice(end)
  }
  return rest.trim() === ''
}

// ---------------------------------------------------------------------------------------
// The picker's emoji list (loaded the first time the picker opens).

export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5 // 0 = default yellow

export type EmojiInfo = {
  /** The emoji itself (fully qualified, e.g. "❤️") */
  emoji: string
  label: string
  /** Lowercase words to search: the label's words and the emoji's tags */
  words: string[]
  /** The five skin-tone versions, if it has them */
  skins: string[] | null
}

export type EmojiCategory = {
  id: string
  label: string
  emoji: EmojiInfo[]
}

/** The picker's categories, in order (emojibase group numbers). "Recently used" comes first. */
const GROUPS: { group: number; id: string; label: string }[] = [
  { group: 0, id: 'smileys', label: 'Smileys & emotion' },
  { group: 1, id: 'people', label: 'People & body' },
  { group: 3, id: 'nature', label: 'Animals & nature' },
  { group: 4, id: 'food', label: 'Food & drink' },
  { group: 5, id: 'travel', label: 'Travel & places' },
  { group: 6, id: 'activities', label: 'Activities' },
  { group: 7, id: 'objects', label: 'Objects' },
  { group: 8, id: 'symbols', label: 'Symbols' },
  { group: 9, id: 'flags', label: 'Flags' }
]

type RawEmoji = {
  label: string
  unicode: string
  hexcode: string
  group?: number
  order?: number
  tags?: string[]
  skins?: { unicode: string; hexcode: string }[]
}

const TONES = ['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF']

/** The five single-tone versions (light → dark), or null if it doesn't have all five pictured. */
function skinsOf(raw: RawEmoji): string[] | null {
  if (!raw.skins) return null
  const byTone: (string | undefined)[] = []
  for (const skin of raw.skins) {
    const tones = new Set(skin.hexcode.split('-').filter((part) => TONES.includes(part)))
    if (tones.size !== 1) continue // mixed tones (like 🧑🏻‍🤝‍🧑🏿) aren't offered
    const index = TONES.indexOf([...tones][0])
    byTone[index] ??= skin.unicode
  }
  const skins = TONES.map((_, i) => byTone[i])
  return skins.every((s): s is string => !!s && !!emojiUrl(s)) ? skins : null
}

let loading: Promise<{ categories: EmojiCategory[]; byEmoji: Map<string, EmojiInfo> }> | null = null

/** Loads the emoji list once (only emoji that have a Twemoji picture are offered). */
export function loadEmoji(): Promise<{
  categories: EmojiCategory[]
  byEmoji: Map<string, EmojiInfo>
}> {
  loading ??= import('emojibase-data/en/compact.json').then((mod) => {
    const list = (mod as unknown as { default: RawEmoji[] }).default
    const byEmoji = new Map<string, EmojiInfo>()
    const categories = GROUPS.map(({ group, id, label }) => {
      const emoji = list
        .filter((raw) => raw.group === group && emojiUrl(raw.unicode))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((raw): EmojiInfo => {
          const info: EmojiInfo = {
            emoji: raw.unicode,
            label: raw.label,
            words: [
              ...new Set([
                ...raw.label.toLowerCase().split(/[^\p{L}\p{N}]+/u),
                ...(raw.tags ?? []).map((t) => t.toLowerCase())
              ])
            ].filter(Boolean),
            skins: skinsOf(raw)
          }
          byEmoji.set(info.emoji, info)
          return info
        })
      return { id, label, emoji }
    })
    return { categories, byEmoji }
  })
  return loading
}

/** The version of an emoji to use with the chosen skin tone. */
export function withTone(info: EmojiInfo, tone: SkinTone): string {
  return tone > 0 && info.skins ? info.skins[tone - 1] : info.emoji
}

/** Emoji whose label or tags start with every word typed, best matches first. */
export function searchEmoji(categories: EmojiCategory[], query: string): EmojiInfo[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const scored: { info: EmojiInfo; score: number; order: number }[] = []
  let order = 0
  for (const category of categories) {
    for (const info of category.emoji) {
      order++
      if (!terms.every((t) => info.words.some((w) => w.startsWith(t)))) continue
      const label = info.label.toLowerCase()
      const first = terms[0]
      // Exact name first, then names that start with it, then a word in the name, then tags.
      const score =
        label === query.toLowerCase().trim()
          ? 0
          : label.startsWith(first)
            ? 1
            : label.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(first))
              ? 2
              : 3
      scored.push({ info, score, order })
    }
  }
  scored.sort((a, b) => a.score - b.score || a.order - b.order)
  return scored.map((s) => s.info)
}

// ---------------------------------------------------------------------------------------
// Remembered on this computer: "Recently used" (per account) and the skin tone.

const RECENT_MAX = 24 // three rows

const recentKey = (userId: string): string => `glofly.emoji.recent.${userId}`

/** Recently used emoji (their default versions), newest first. */
export function getRecent(userId: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(recentKey(userId)) ?? '[]')
    return Array.isArray(value)
      ? value.filter((e): e is string => typeof e === 'string').slice(0, RECENT_MAX)
      : []
  } catch {
    return []
  }
}

/** Remembers an emoji as recently used (pass its default version, not a skin-tone one). */
export function addRecent(userId: string, emoji: string): void {
  try {
    const list = [emoji, ...getRecent(userId).filter((e) => e !== emoji)].slice(0, RECENT_MAX)
    localStorage.setItem(recentKey(userId), JSON.stringify(list))
  } catch {
    // Storage unavailable: just don't remember it.
  }
}

export function getSkinTone(): SkinTone {
  try {
    const n = Number(localStorage.getItem('glofly.emoji.tone'))
    return (Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0) as SkinTone
  } catch {
    return 0
  }
}

export function setSkinTone(tone: SkinTone): void {
  try {
    localStorage.setItem('glofly.emoji.tone', String(tone))
  } catch {
    // Storage unavailable: the choice lasts until the app closes.
  }
}
