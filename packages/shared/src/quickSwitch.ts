// 0.7.5 quick switcher matching (desktop/web Ctrl+K, and the phones' Chats search).

/**
 * How well `query` matches `text` (higher is better; 0 = no match):
 * whole text starts with it > a word starts with it > initials ("gn" → Game Night) > anywhere.
 * Case and accents don't matter.
 */
export function matchScore(query: string, text: string, keywords = ''): number {
  const q = fold(query).trim()
  if (!q) return 1
  const t = fold(text)
  if (t.startsWith(q)) return 100 - Math.min(40, t.length - q.length)
  const words = t.split(/[^a-z0-9]+/).filter(Boolean)
  if (words.some((w) => w.startsWith(q))) return 70
  // Several words typed: each must start a word, in any order ("night game").
  const parts = q.split(/\s+/).filter(Boolean)
  if (parts.length > 1 && parts.every((p) => words.some((w) => w.startsWith(p)))) return 60
  const initials = words.map((w) => w[0]).join('')
  if (q.length >= 2 && !q.includes(' ') && initials.startsWith(q)) return 55
  const k = fold(keywords)
  if (k && k.split(/[^a-z0-9]+/).some((w) => w && w.startsWith(q))) return 40
  if (q.length >= 2 && t.includes(q)) return 30
  return 0
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}
