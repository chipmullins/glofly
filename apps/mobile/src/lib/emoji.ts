import { prefs } from './storage'

// Emoji on phones use the phone's own emoji font (Noto on Android). This file: telling an
// emoji-only message apart (shown big), the picker's list, and recently used reactions.

const EMOJI = '(?:[\\u{1F1E6}-\\u{1F1FF}]{2}|[#*0-9]\\uFE0F?\\u20E3|\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}])?)*)'
const ONE_EMOJI = new RegExp(EMOJI, 'gu')

/** A message of only a few emoji (up to 10) is shown big, like the desktop app. */
export function isJumbo(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 120) return false
  const found = t.match(ONE_EMOJI)
  if (!found || found.length > 10) return false
  return t.replace(ONE_EMOJI, '').replace(/[\s️‍]/g, '') === ''
}

export const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👍']

export type PickerEmoji = { emoji: string; label: string; words: string }
export type PickerGroup = { id: string; label: string; emoji: PickerEmoji[] }

const GROUPS: { group: number; id: string; label: string }[] = [
  { group: 0, id: 'smileys', label: 'Smileys & emotion' },
  { group: 1, id: 'people', label: 'People & body' },
  { group: 3, id: 'nature', label: 'Animals & nature' },
  { group: 4, id: 'food', label: 'Food & drink' },
  { group: 5, id: 'travel', label: 'Travel & places' },
  { group: 6, id: 'activities', label: 'Activities' },
  { group: 7, id: 'objects', label: 'Objects' },
  { group: 8, id: 'symbols', label: 'Symbols' },
  { group: 9, id: 'flags', label: 'Flags' },
]

type Raw = { label: string; unicode: string; group?: number; order?: number; tags?: string[] }

let cached: PickerGroup[] | null = null
/** The picker's emoji (loaded the first time it opens). Emoji 15 and older, which phones show. */
export function pickerGroups(): PickerGroup[] {
  if (cached) return cached
  const data = require('emojibase-data/en/compact.json') as Raw[]
  const byGroup = new Map<number, PickerEmoji[]>()
  const sorted = data.filter((e) => e.group !== undefined && e.group !== 2).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  for (const e of sorted) {
    const list = byGroup.get(e.group!) ?? []
    list.push({ emoji: e.unicode, label: e.label, words: [e.label, ...(e.tags ?? [])].join(' ').toLowerCase() })
    byGroup.set(e.group!, list)
  }
  cached = GROUPS.map((g) => ({ id: g.id, label: g.label, emoji: byGroup.get(g.group) ?? [] }))
  return cached
}

export function searchEmoji(query: string, limit = 60): PickerEmoji[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: PickerEmoji[] = []
  for (const g of pickerGroups()) {
    for (const e of g.emoji) {
      if (e.words.includes(q)) out.push(e)
      if (out.length >= limit) return out
    }
  }
  return out
}

let recent: string[] | null = null
export async function recentEmoji(): Promise<string[]> {
  if (!recent) recent = await prefs.get<string[]>('recentEmoji', [])
  return recent
}
export function noteEmojiUsed(emoji: string) {
  recent = [emoji, ...(recent ?? []).filter((e) => e !== emoji)].slice(0, 24)
  void prefs.set('recentEmoji', recent)
}
