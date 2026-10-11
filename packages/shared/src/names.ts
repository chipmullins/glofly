/** "Chip" → "C", "Jasmine Lee" → "JL" */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = Array.from(words[0])[0] ?? ''
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** Splits text so the part matching a search can be highlighted. */
export function splitMatch(
  text: string,
  query: string
): { before: string; match: string; after: string } | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const lower = text.toLowerCase()
  // Match the start of the text, or the start of a word.
  let index = lower.startsWith(q) ? 0 : lower.indexOf(` ${q}`)
  if (index > 0) index += 1
  if (index < 0) return null
  return {
    before: text.slice(0, index),
    match: text.slice(index, index + q.length),
    after: text.slice(index + q.length)
  }
}

/** "2026-10-07T..." → "Oct 7, 2026" */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}
