// Communities round 2 (Nov 11, 2026): custom emoji + stickers per constellation, free, usable in
// any chat while you're a member (approved canvas "Glofly communities round 2", boards 2a–2c).

export const CONSTELLATION_EMOJI_MAX = 150
export const CONSTELLATION_STICKERS_MAX = 60
/** Uploads: emoji up to 512 KB (still or animated); stickers up to 2 MB before cleaning. */
export const EMOJI_UPLOAD_MAX = 512 * 1024
export const STICKER_UPLOAD_MAX = 2 * 1024 * 1024
export const EMOJI_SIZE = 128
export const STICKER_SIZE = 320
export const EMOJI_NAME_MAX = 32
export const STICKER_NAME_MAX = 30
/** How many custom emoji one message can carry. */
export const EMOJI_PER_MESSAGE = 30

export type EmojiKind = 'emoji' | 'sticker'

/** One of a constellation's emoji or stickers. */
export type ConstellationEmoji = {
  id: string
  kind: EmojiKind
  /** Emoji: the :name: (letters, numbers, _); stickers: a label */
  name: string
  animated: boolean
  width: number
  height: number
  /** Members can use it outside this constellation (DMs, groups, other constellations) */
  outside: boolean
  createdBy: import('./types').PublicUser | null
  createdAt: string
}

/** The emoji a message uses: `:name:` in its text (or as a reaction) shows this picture. */
export type EmojiRef = { id: string; name: string; animated: boolean }

/** The picker: every constellation you're in, with what you may use here. */
export type EmojiSet = {
  constellation: { id: string; name: string; color: string; iconVersion: string | null }
  emoji: ConstellationEmoji[]
  stickers: ConstellationEmoji[]
}

/** What "From Night Raiders" says when you click one in a message. */
export type EmojiInfo = {
  id: string
  name: string
  kind: EmojiKind
  animated: boolean
  /** Null when it's from a private constellation you're not in */
  constellation: { id: string; name: string; color: string; iconVersion: string | null; public: boolean } | null
  member: boolean
}

/** A good emoji name: 2–32 letters, numbers or _. */
export const isEmojiName = (name: string): boolean => /^[A-Za-z0-9_]{2,32}$/.test(name)

/** Turns typed text into an emoji name ("Night Owl!" → "night_owl"), or null. */
export function cleanEmojiName(raw: string): string | null {
  const n = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/^:+|:+$/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .toLowerCase()
    .slice(0, EMOJI_NAME_MAX)
  return isEmojiName(n) ? n : null
}

/** The :name: tokens in some text, in order, once each. */
export function emojiNamesIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/:([A-Za-z0-9_]{2,32}):/g)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** Splits text into plain pieces and custom emoji (for drawing a message). */
export function splitEmoji(text: string, refs: readonly EmojiRef[] | undefined | null): ({ text: string } | { emoji: EmojiRef })[] {
  if (!refs?.length || !text.includes(':')) return [{ text }]
  const byName = new Map(refs.map((r) => [r.name, r]))
  const out: ({ text: string } | { emoji: EmojiRef })[] = []
  let last = 0
  for (const m of text.matchAll(/:([A-Za-z0-9_]{2,32}):/g)) {
    const ref = byName.get(m[1])
    if (!ref || m.index === undefined) continue
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ emoji: ref })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out.length ? out : [{ text }]
}

/** A reaction that is a custom emoji: ":name:" (the message's `emojis` says which picture). */
export const isCustomReaction = (key: string): boolean => /^:[A-Za-z0-9_]{2,32}:$/.test(key)

/** A message that is only custom emoji (1–3), shown bigger, like plain emoji. */
export function onlyEmoji(text: string, refs: readonly EmojiRef[] | undefined | null): boolean {
  if (!refs?.length) return false
  const parts = splitEmoji(text.trim(), refs).filter((p) => !('text' in p) || p.text.trim())
  return parts.length > 0 && parts.length <= 3 && parts.every((p) => 'emoji' in p)
}
