import type {
  ApiResult,
  ChatGameKind,
  ChatGameMove,
  FireflyEmoji,
  GifPage,
  Message
} from '../preload/api-types'
import { isUserId, request } from './api'

// 0.5.0 chat extras: GIFs, link previews, polls, mini games and firefly swarms. Every value from
// the window is checked here before it goes anywhere (the window is treated as untrusted).

const invalid = {
  ok: false as const,
  error: 'invalid' as const,
  message: 'Something about that request was off.'
}
const bad = (): Promise<ApiResult<never>> => Promise.resolve(invalid)

const unwrap = async (
  result: Promise<ApiResult<{ message: Message }>>
): Promise<ApiResult<Message>> => {
  const r = await result
  return r.ok ? { ok: true, data: r.data.message } : r
}

const isText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max

export function gifs(query: unknown, offset: unknown): Promise<ApiResult<GifPage>> {
  if (typeof query !== 'string' || query.length > 50) return bad()
  const from =
    Number.isInteger(offset) && (offset as number) >= 0 && (offset as number) < 5000
      ? (offset as number)
      : 0
  const q = query.trim()
  return request<GifPage>(
    'GET',
    q ? `/gifs/search?q=${encodeURIComponent(q)}&offset=${from}` : `/gifs/trending?offset=${from}`
  )
}

export function sendGif(
  id: unknown,
  gifId: unknown,
  replyTo: unknown
): Promise<ApiResult<Message>> {
  if (!isUserId(id) || typeof gifId !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(gifId)) return bad()
  if (replyTo != null && !isUserId(replyTo)) return bad()
  return unwrap(
    request('POST', `/conversations/${id}/messages`, {
      body: '',
      gif: { id: gifId },
      ...(replyTo ? { replyToId: replyTo } : {})
    })
  )
}

export function removePreview(id: unknown, mid: unknown): Promise<ApiResult<Message>> {
  if (!isUserId(id) || !isUserId(mid)) return bad()
  return unwrap(request('DELETE', `/conversations/${id}/messages/${mid}/preview`))
}

export function createPoll(
  id: unknown,
  question: unknown,
  options: unknown,
  multi: unknown
): Promise<ApiResult<Message>> {
  if (!isUserId(id) || !isText(question, 300)) return bad()
  if (!Array.isArray(options) || options.length < 2 || options.length > 6) return bad()
  if (!options.every((o) => isText(o, 300))) return bad()
  return unwrap(
    request('POST', `/conversations/${id}/polls`, { question, options, multi: multi === true })
  )
}

export function vote(id: unknown, mid: unknown, options: unknown): Promise<ApiResult<Message>> {
  if (!isUserId(id) || !isUserId(mid)) return bad()
  if (!Array.isArray(options) || options.length > 6) return bad()
  if (!options.every((o) => Number.isInteger(o) && o >= 0 && o < 6)) return bad()
  return unwrap(request('PUT', `/conversations/${id}/messages/${mid}/vote`, { options }))
}

export function closePoll(id: unknown, mid: unknown): Promise<ApiResult<Message>> {
  if (!isUserId(id) || !isUserId(mid)) return bad()
  return unwrap(request('POST', `/conversations/${id}/messages/${mid}/close-poll`))
}

const KINDS: readonly ChatGameKind[] = ['tictactoe', 'wordguess', 'trivia']

export function startGame(id: unknown, kind: unknown): Promise<ApiResult<Message>> {
  if (!isUserId(id) || !KINDS.includes(kind as ChatGameKind)) return bad()
  return unwrap(request('POST', `/conversations/${id}/games`, { kind }))
}

/** Only the fields of one kind of move pass. */
function cleanMove(m: unknown): ChatGameMove | null {
  const o = m as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  if (Number.isInteger(o.square)) return { square: o.square as number }
  if (typeof o.word === 'string' && o.word.length <= 10) return { word: o.word }
  if (Number.isInteger(o.question) && Number.isInteger(o.choice)) {
    return { question: o.question as number, choice: o.choice as number }
  }
  if (o.reveal === true) return { reveal: true }
  return null
}

export function move(id: unknown, mid: unknown, m: unknown): Promise<ApiResult<Message>> {
  const clean = cleanMove(m)
  if (!isUserId(id) || !isUserId(mid) || !clean) return bad()
  return unwrap(request('POST', `/conversations/${id}/messages/${mid}/move`, clean))
}

export function fireflies(id: unknown, emoji: unknown): Promise<ApiResult<null>> {
  if (!isUserId(id) || (emoji !== '❤️' && emoji !== '🔥')) return bad()
  return request<null>('POST', `/conversations/${id}/fireflies`, { emoji: emoji as FireflyEmoji })
}
