// 0.5.0 chat extras: GIFs, link previews, polls, mini games, lantern messages and firefly swarms.
// The server checks every vote and move; these only show the state it sends back.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { gifSize, gifUrl } from '@glofly/shared/gifs'
import { triviaScores, WORD_LENGTH } from '@glofly/shared/games'
import type { TicTacToe, Trivia, WordGuess } from '@glofly/shared/games'
import type {
  ApiResult,
  ChatGameKind,
  ChatGameMove,
  FireflyEmoji,
  GifInfo,
  LinkPreview,
  Message,
  Sticker
} from '../../../preload/api-types'
import { previewImageUrl, stickerUrl } from '../lib/attachments'
import EmojiText from './EmojiText'
import './ChatExtras.css'

type Failure = (error: string, message: string) => void

function Svg({
  children,
  size = 18,
  stroke = 1.9
}: {
  children: React.ReactNode
  size?: number
  stroke?: number
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function LanternIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M9 3h6" />
      <path d="M12 3v2" />
      <path d="M8 7h8l1 3v5l-1 3H8l-1-3v-5z" />
      <path d="M9 21h6" />
      <path d="M12 18v3" />
      <path d="M12 10.5c1 .9 1.2 1.8.6 2.7-.4.5-1 .6-1.4.2-.5-.5-.3-1.4.8-2.9z" />
    </Svg>
  )
}

export function PollIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Svg>
  )
}

export function GameIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <rect x="2.5" y="7" width="19" height="11" rx="5" />
      <path d="M7 11v3M5.5 12.5h3" />
      <path d="M15.5 12h.01M18 13.5h.01" />
    </Svg>
  )
}

export function GifIcon(): React.JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="2.5"
        y="5"
        width="19"
        height="14"
        rx="3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <text
        x="12"
        y="15.2"
        textAnchor="middle"
        fontSize="7.4"
        fontWeight="800"
        fontFamily="inherit"
        fill="currentColor"
        letterSpacing="0.2"
      >
        GIF
      </text>
    </svg>
  )
}

/** Where a popup sits: above its button, right edges lined up (or below if there's no room). */
function placeAbove(
  anchor: HTMLElement,
  width: number,
  height: number
): { top: number; left: number; height: number } {
  const GAP = 8
  const rect = anchor.getBoundingClientRect()
  const h = Math.min(height, window.innerHeight - GAP * 2)
  let top = rect.top - h - GAP
  if (top < GAP) top = Math.min(rect.bottom + GAP, window.innerHeight - h - GAP)
  const preferred = rect.right - width >= GAP ? rect.right - width : rect.left
  const left = Math.max(GAP, Math.min(preferred, window.innerWidth - width - GAP))
  return { top: Math.max(GAP, top), left, height: h }
}

// ---------------------------------------------------------------------------------------------
// GIFs

/** Search GIPHY (trending until you type), click one to send it. */
export function GifPicker({
  anchor,
  onPick,
  onPickSticker,
  onClose
}: {
  anchor: HTMLElement
  onPick: (gif: GifInfo) => void
  /** 0.5.0 custom stickers: the Stickers tab */
  onPickSticker: (sticker: Sticker) => void
  onClose: () => void
}): React.JSX.Element {
  const WIDTH = 380
  const [tab, setTab] = useState<'gifs' | 'stickers'>('gifs')
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<GifInfo[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [problem, setProblem] = useState('')
  const [place, setPlace] = useState(() => placeAbove(anchor, WIDTH, 460))
  const boxRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const asked = useRef(0)

  const load = useCallback(async (q: string, offset: number) => {
    const ask = ++asked.current
    if (offset === 0) setStatus('loading')
    const result = await window.glofly.chat.gifs(q, offset)
    if (ask !== asked.current) return // a newer search is on its way
    if (!result.ok) {
      setStatus('error')
      setProblem(result.message)
      return
    }
    setGifs((list) => (offset === 0 ? result.data.gifs : [...list, ...result.data.gifs]))
    setNext(result.data.next)
    setStatus('ready')
  }, [])

  // Search a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => void load(query, 0), query ? 350 : 0)
    return () => clearTimeout(timer)
  }, [query, load])

  useEffect(() => {
    const onResize = (): void => setPlace(placeAbove(anchor, WIDTH, 460))
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!boxRef.current?.contains(t) && !anchor.contains(t)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('resize', onResize)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])

  function onScroll(): void {
    const el = scrollRef.current
    if (!el || next === null || status !== 'ready') return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      const from = next
      setNext(null) // one page at a time
      void load(query, from)
    }
  }

  // Two columns, each GIF in the shorter one (a tidy masonry).
  const columns: GifInfo[][] = [[], []]
  const heights = [0, 0]
  for (const g of gifs) {
    const col = heights[0] <= heights[1] ? 0 : 1
    columns[col].push(g)
    heights[col] += g.height / Math.max(1, g.width)
  }

  return (
    <div
      ref={boxRef}
      className="gif-picker"
      role="dialog"
      aria-label="Send a GIF"
      style={{ top: place.top, left: place.left, height: place.height, width: WIDTH }}
    >
      <div className="gif-tabs" role="tablist" aria-label="GIFs or stickers">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'gifs'}
          className={tab === 'gifs' ? 'gif-tab gif-tab--on' : 'gif-tab'}
          onClick={() => setTab('gifs')}
        >
          GIFs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'stickers'}
          className={tab === 'stickers' ? 'gif-tab gif-tab--on' : 'gif-tab'}
          onClick={() => setTab('stickers')}
        >
          My stickers
        </button>
      </div>
      {tab === 'stickers' ? (
        <StickerTray onPick={onPickSticker} />
      ) : (
        <>
          <div className="gif-picker-head">
            <label className="gif-search">
              <Svg size={16}>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </Svg>
              <input
                autoFocus
                value={query}
                maxLength={50}
                placeholder="Search GIPHY"
                aria-label="Search GIFs"
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
                  ×
                </button>
              )}
            </label>
          </div>
          <div className="gif-picker-label">{query.trim() ? 'Results' : 'Trending'}</div>
          <div className="gif-picker-grid" ref={scrollRef} onScroll={onScroll}>
            {status === 'error' ? (
              <p className="gif-picker-empty">{problem}</p>
            ) : status === 'loading' && gifs.length === 0 ? (
              <div className="gif-picker-cols" aria-busy="true">
                {[0, 1].map((c) => (
                  <div key={c} className="gif-col">
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className="gif-skeleton"
                        style={{ height: 90 + ((i + c) % 3) * 30 }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ) : gifs.length === 0 ? (
              <p className="gif-picker-empty">No GIFs for “{query.trim()}”. Try another word.</p>
            ) : (
              <div className="gif-picker-cols">
                {columns.map((col, c) => (
                  <div key={c} className="gif-col">
                    {col.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        className="gif-option"
                        title={g.title}
                        aria-label={`Send GIF: ${g.title}`}
                        style={{ aspectRatio: `${g.width} / ${g.height}` }}
                        onClick={() => onPick(g)}
                      >
                        <img src={gifUrl(g.id, 'small')} alt="" loading="lazy" draggable={false} />
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="gif-picker-foot">
            <span>Powered by</span>
            <strong>GIPHY</strong>
          </div>
        </>
      )}
    </div>
  )
}

/** Your stickers, and "Make a sticker" from a photo (the server cuts out the background). */
function StickerTray({ onPick }: { onPick: (sticker: Sticker) => void }): React.JSX.Element {
  const [stickers, setStickers] = useState<Sticker[] | null>(null)
  const [making, setMaking] = useState(false)
  const [problem, setProblem] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void window.glofly.stickers.list().then((r) => {
      if (cancelled) return
      if (r.ok) setStickers(r.data)
      else setProblem(r.message)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function make(file: File): Promise<void> {
    setMaking(true)
    setProblem('')
    const r = await window.glofly.stickers.make(await file.arrayBuffer())
    setMaking(false)
    if (r.ok) setStickers((list) => [r.data, ...(list ?? [])])
    else setProblem(r.message)
  }

  async function remove(id: string): Promise<void> {
    setStickers((list) => list?.filter((x) => x.id !== id) ?? null)
    const r = await window.glofly.stickers.remove(id)
    if (!r.ok) setProblem(r.message)
  }

  return (
    <div className="sticker-tray">
      <p className="sticker-hint">
        Turn any photo into a sticker: Glofly cuts out what&apos;s in front.
      </p>
      {problem && (
        <p className="sticker-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="sticker-grid">
        <button
          type="button"
          className="sticker-make"
          disabled={making}
          onClick={() => fileRef.current?.click()}
        >
          {making ? (
            <>
              <span className="sticker-spinner" aria-hidden="true" />
              Cutting it out…
            </>
          ) : (
            <>
              <Svg size={22}>
                <path d="M12 5v14M5 12h14" />
              </Svg>
              Make a sticker
            </>
          )}
        </button>
        {stickers?.map((st) => (
          <div key={st.id} className="sticker-cell">
            <button
              type="button"
              className="sticker-option"
              aria-label="Send sticker"
              title="Send"
              onClick={() => onPick(st)}
            >
              <img src={stickerUrl(st.id)} alt="" draggable={false} loading="lazy" />
            </button>
            <button
              type="button"
              className="sticker-remove"
              aria-label="Delete sticker"
              title="Delete from your stickers"
              onClick={() => void remove(st.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {stickers?.length === 0 && !making && (
        <p className="sticker-empty">Your stickers show up here.</p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void make(f)
        }}
      />
    </div>
  )
}

/** A GIF in a message. */
export function GifView({ gif }: { gif: GifInfo }): React.JSX.Element {
  const size = gifSize(gif, 280)
  const [failed, setFailed] = useState(false)
  return (
    <div className="msg-gif" style={{ width: size.width, height: size.height }}>
      {failed ? (
        <span className="msg-gif-missing">GIF couldn’t load</span>
      ) : (
        <img
          src={gifUrl(gif.id, 'full')}
          alt={gif.title}
          title={gif.title}
          width={size.width}
          height={size.height}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
      <span className="msg-gif-tag" aria-hidden="true">
        GIF
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Link previews

export function LinkPreviewCard({
  conversationId,
  messageId,
  preview,
  canRemove,
  onRemove
}: {
  conversationId: string
  messageId: string
  preview: LinkPreview
  canRemove: boolean
  onRemove: () => void
}): React.JSX.Element {
  const [imageOk, setImageOk] = useState(true)
  const wide = !!preview.image && preview.image.width >= preview.image.height * 1.3
  const https = preview.url.startsWith('https://')
  let host = ''
  try {
    host = new URL(preview.url).hostname.replace(/^www\./, '')
  } catch {
    host = ''
  }
  const inner = (
    <>
      {preview.image && imageOk && (
        <img
          className="link-card-image"
          src={previewImageUrl(conversationId, messageId)}
          alt=""
          loading="lazy"
          draggable={false}
          style={
            wide ? { aspectRatio: `${preview.image.width} / ${preview.image.height}` } : undefined
          }
          onError={() => setImageOk(false)}
        />
      )}
      <span className="link-card-text">
        <span className="link-card-site">{preview.siteName || host}</span>
        <span className="link-card-title">
          <EmojiText text={preview.title} />
        </span>
        {preview.description && (
          <span className="link-card-desc">
            <EmojiText text={preview.description} />
          </span>
        )}
      </span>
    </>
  )
  return (
    <div className={wide ? 'link-card link-card--wide' : 'link-card'}>
      {https ? (
        <a
          className="link-card-body"
          href={preview.url}
          target="_blank"
          rel="noreferrer noopener"
          title={preview.url}
        >
          {inner}
        </a>
      ) : (
        <span className="link-card-body" title={preview.url}>
          {inner}
        </span>
      )}
      {canRemove && (
        <button
          type="button"
          className="link-card-remove"
          aria-label="Remove preview"
          title="Remove preview"
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Polls

export function PollCard({
  message,
  meId,
  nameOf,
  canAct,
  onUpdated,
  onFailure
}: {
  message: Message
  meId: string
  nameOf: (userId: string) => string
  canAct: boolean
  onUpdated: (m: Message) => void
  onFailure: Failure
}): React.JSX.Element | null {
  const poll = message.poll
  const [busy, setBusy] = useState(false)
  if (!poll) return null
  const voters = new Set(poll.options.flatMap((o) => o.votes))
  const mine = poll.options.map((o, i) => (o.votes.includes(meId) ? i : -1)).filter((i) => i >= 0)
  const most = Math.max(1, ...poll.options.map((o) => o.votes.length))
  const closed = !!poll.closedAt
  const open = canAct && !closed

  async function run(call: Promise<ApiResult<Message>>): Promise<void> {
    setBusy(true)
    const result = await call
    setBusy(false)
    if (result.ok) onUpdated(result.data)
    else onFailure(result.error, result.message)
  }

  function pick(i: number): void {
    if (!open || busy || !poll) return
    const next = poll.multi
      ? mine.includes(i)
        ? mine.filter((x) => x !== i)
        : [...mine, i]
      : mine.includes(i)
        ? []
        : [i]
    void run(window.glofly.chat.vote(message.conversationId, message.id, next))
  }

  const total = voters.size
  return (
    <div className={closed ? 'poll-card poll-card--closed' : 'poll-card'}>
      <div className="poll-head">
        <span className="poll-badge">
          <PollIcon size={14} /> Poll
        </span>
        <span className="poll-hint">
          {closed ? 'Closed' : poll.multi ? 'Pick any' : 'Pick one'}
        </span>
      </div>
      <p className="poll-question">
        <EmojiText text={poll.question} />
      </p>
      <div
        className="poll-options"
        role={poll.multi ? 'group' : 'radiogroup'}
        aria-label={poll.question}
      >
        {poll.options.map((o, i) => {
          const picked = mine.includes(i)
          const share = total ? Math.round((o.votes.length / total) * 100) : 0
          const leading = closed && o.votes.length === most && o.votes.length > 0
          return (
            <button
              key={i}
              type="button"
              role={poll.multi ? 'checkbox' : 'radio'}
              aria-checked={picked}
              className={[
                'poll-option',
                picked && 'poll-option--picked',
                leading && 'poll-option--leading'
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={!open || busy}
              title={
                o.votes.length
                  ? o.votes.map((id) => (id === meId ? 'You' : nameOf(id))).join(', ')
                  : 'No votes yet'
              }
              onClick={() => pick(i)}
            >
              <span
                className="poll-bar"
                style={{ width: `${total ? (o.votes.length / most) * 100 : 0}%` }}
              />
              <span
                className={poll.multi ? 'poll-check poll-check--multi' : 'poll-check'}
                aria-hidden="true"
              >
                {picked && (
                  <Svg size={12} stroke={3}>
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </Svg>
                )}
              </span>
              <span className="poll-option-text">
                <EmojiText text={o.text} />
              </span>
              <span className="poll-count">{total > 0 && `${share}%`}</span>
            </button>
          )
        })}
      </div>
      <div className="poll-foot">
        <span>
          {total === 0 ? 'No votes yet' : total === 1 ? '1 vote' : `${total} votes`}
          {mine.length > 0 && !closed && ' · tap again to take it back'}
        </span>
        {message.senderId === meId && !closed && canAct && (
          <button
            type="button"
            className="poll-close"
            disabled={busy}
            onClick={() =>
              void run(window.glofly.chat.closePoll(message.conversationId, message.id))
            }
          >
            Close poll
          </button>
        )}
      </div>
    </div>
  )
}

/** Ask the group something: a question and 2–6 choices. */
export function NewPollDialog({
  onCreate,
  onClose
}: {
  onCreate: (question: string, options: string[], multi: boolean) => Promise<boolean>
  onClose: () => void
}): React.JSX.Element {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multi, setMulti] = useState(false)
  const [busy, setBusy] = useState(false)
  const filled = options.map((o) => o.trim()).filter(Boolean)
  const ready = question.trim().length > 0 && new Set(filled).size >= 2 && !busy

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    const ok = await onCreate(question.trim(), filled, multi)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog poll-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New poll"
        onSubmit={(e) => void submit(e)}
      >
        <h1 className="poll-dialog-title">
          <PollIcon size={20} /> New poll
        </h1>
        <label className="poll-field">
          <span>Question</span>
          <input
            autoFocus
            value={question}
            maxLength={120}
            placeholder="Where should we eat?"
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <div className="poll-field">
          <span>Choices</span>
          {options.map((o, i) => (
            <div key={i} className="poll-choice-row">
              <input
                value={o}
                maxLength={120}
                placeholder={`Choice ${i + 1}`}
                aria-label={`Choice ${i + 1}`}
                onChange={(e) =>
                  setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
              {options.length > 2 && (
                <button
                  type="button"
                  className="poll-choice-remove"
                  aria-label={`Remove choice ${i + 1}`}
                  onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {options.length < 6 && (
            <button
              type="button"
              className="poll-add-choice"
              onClick={() => setOptions((list) => [...list, ''])}
            >
              + Add a choice
            </button>
          )}
        </div>
        <label className="poll-multi">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
          <span>Let people pick more than one</span>
        </label>
        <div className="confirm-actions">
          <button type="button" className="small-button small-button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="small-button small-button--primary" disabled={!ready}>
            {busy ? 'Posting…' : 'Post poll'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Mini games

const GAME_NAMES: Record<ChatGameKind, string> = {
  tictactoe: 'Tic-tac-toe',
  wordguess: 'Word guess',
  trivia: 'Trivia'
}
const GAME_BLURBS: Record<ChatGameKind, string> = {
  tictactoe: 'You against whoever plays next',
  wordguess: 'Find the five-letter word together',
  trivia: 'Five questions, everyone answers'
}

type GameProps = {
  message: Message
  meId: string
  nameOf: (userId: string) => string
  canAct: boolean
  /** Everyone in the chat, you included */
  memberIds: string[]
  onUpdated: (m: Message) => void
  onFailure: Failure
}

export function GameCard(props: GameProps): React.JSX.Element | null {
  const g = props.message.game
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState('')
  if (!g) return null

  async function play(move: ChatGameMove): Promise<boolean> {
    setBusy(true)
    setRefused('')
    const result = await window.glofly.chat.move(
      props.message.conversationId,
      props.message.id,
      move
    )
    setBusy(false)
    if (result.ok) {
      props.onUpdated(result.data)
      return true
    }
    if (result.error === 'unauthorized') props.onFailure(result.error, result.message)
    else setRefused(result.message)
    return false
  }

  return (
    <div className={`game-card game-card--${g.kind}`}>
      <div className="game-head">
        <span className="game-badge">
          <GameIcon size={14} /> {GAME_NAMES[g.kind]}
        </span>
      </div>
      {g.kind === 'tictactoe' ? (
        <TicTacToeView g={g} {...props} busy={busy} play={play} />
      ) : g.kind === 'wordguess' ? (
        <WordGuessView g={g} {...props} busy={busy} play={play} />
      ) : (
        <TriviaView g={g} {...props} busy={busy} play={play} />
      )}
      {refused && (
        <p className="game-refused" role="alert">
          {refused}
        </p>
      )}
    </div>
  )
}

type ViewProps<T> = GameProps & {
  g: T
  busy: boolean
  play: (move: ChatGameMove) => Promise<boolean>
}

const you = (id: string | null, meId: string, nameOf: (id: string) => string): string =>
  !id ? 'someone' : id === meId ? 'You' : nameOf(id)

function TicTacToeView({
  g,
  meId,
  nameOf,
  canAct,
  busy,
  play
}: ViewProps<TicTacToe>): React.JSX.Element {
  const myMark = meId === g.x ? 'X' : meId === g.o ? 'O' : g.o === null ? 'O' : null
  const turnOf = g.turn === 'X' ? g.x : g.o
  const myTurn = !g.winner && myMark === g.turn && (g.turn === 'X' || g.o === meId || g.o === null)
  const status = g.winner
    ? g.winner === 'draw'
      ? "It's a draw!"
      : `${you(g.winner === 'X' ? g.x : g.o, meId, nameOf)} ${
          (g.winner === 'X' ? g.x : g.o) === meId ? 'win' : 'wins'
        }! 🎉`
    : myTurn
      ? g.o === null && meId !== g.x
        ? 'Make a move to play O'
        : 'Your turn'
      : turnOf
        ? `${you(turnOf, meId, nameOf)}'s turn`
        : 'Waiting for someone to play O'
  return (
    <>
      <div className="ttt-players">
        <span
          className={g.turn === 'X' && !g.winner ? 'ttt-player ttt-player--turn' : 'ttt-player'}
        >
          <b className="ttt-x">X</b> {you(g.x, meId, nameOf)}
        </span>
        <span
          className={g.turn === 'O' && !g.winner ? 'ttt-player ttt-player--turn' : 'ttt-player'}
        >
          <b className="ttt-o">O</b> {g.o ? you(g.o, meId, nameOf) : 'open seat'}
        </span>
      </div>
      <div className="ttt-board" role="grid" aria-label="Tic-tac-toe board">
        {g.board.map((cell, i) => (
          <button
            key={i}
            type="button"
            role="gridcell"
            aria-label={cell ? `Square ${i + 1}: ${cell}` : `Square ${i + 1}: empty`}
            className={[
              'ttt-cell',
              cell && `ttt-cell--${cell.toLowerCase()}`,
              g.line?.includes(i) && 'ttt-cell--win'
            ]
              .filter(Boolean)
              .join(' ')}
            disabled={!canAct || busy || !!cell || !myTurn}
            onClick={() => void play({ square: i })}
          >
            {cell}
          </button>
        ))}
      </div>
      <p className={g.winner ? 'game-status game-status--done' : 'game-status'}>{status}</p>
    </>
  )
}

function WordGuessView({
  g,
  meId,
  nameOf,
  canAct,
  busy,
  play
}: ViewProps<WordGuess>): React.JSX.Element {
  const [word, setWord] = useState('')
  const rows = Array.from({ length: g.maxGuesses }, (_, i) => g.guesses[i] ?? null)
  const solver = g.solved ? (g.guesses.at(-1)?.userId ?? null) : null
  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (word.length !== WORD_LENGTH || busy) return
    if (await play({ word })) setWord('')
  }
  return (
    <>
      <div className="wg-grid" aria-label="Guesses so far">
        {rows.map((r, i) => (
          <div
            key={i}
            className="wg-row"
            title={r ? `${you(r.userId, meId, nameOf)} guessed ${r.word}` : undefined}
          >
            {Array.from({ length: WORD_LENGTH }, (_, j) => (
              <span
                key={j}
                className={r ? `wg-tile wg-tile--${r.marks[j]}` : 'wg-tile'}
                style={r ? ({ '--i': j } as React.CSSProperties) : undefined}
              >
                {r?.word[j] ?? ''}
              </span>
            ))}
            {r && <span className="wg-who">{you(r.userId, meId, nameOf)}</span>}
          </div>
        ))}
      </div>
      {g.over ? (
        <p className="game-status game-status--done">
          {g.solved
            ? `${you(solver, meId, nameOf)} got it in ${g.guesses.length}! 🎉`
            : `Out of guesses. The word was ${g.answer ?? '…'}.`}
        </p>
      ) : canAct ? (
        <form className="wg-form" onSubmit={(e) => void submit(e)}>
          <input
            value={word}
            maxLength={WORD_LENGTH}
            placeholder="Your guess"
            aria-label="Your five-letter guess"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setWord(e.target.value.replace(/[^a-z]/gi, '').toUpperCase())}
          />
          <button
            type="submit"
            className="small-button small-button--primary"
            disabled={busy || word.length !== WORD_LENGTH}
          >
            Guess
          </button>
        </form>
      ) : null}
      {!g.over && (
        <p className="game-status">
          {g.maxGuesses - g.guesses.length} of {g.maxGuesses} guesses left · anyone can guess
        </p>
      )}
    </>
  )
}

function TriviaView({
  g,
  meId,
  nameOf,
  canAct,
  memberIds,
  busy,
  play
}: ViewProps<Trivia>): React.JSX.Element {
  const scores = triviaScores(g)
  if (g.over) {
    const board = memberIds
      .map((id) => ({ id, score: scores[id] ?? 0 }))
      .filter((x) => g.picks.some((p) => p.userId === x.id))
      .sort((a, b) => b.score - a.score)
    const top = board[0]?.score ?? 0
    return (
      <>
        <p className="trivia-done">Final scores</p>
        <ol className="trivia-board">
          {board.map((x) => (
            <li key={x.id} className={x.score === top && top > 0 ? 'trivia-winner' : undefined}>
              <span>{you(x.id, meId, nameOf)}</span>
              <b>
                {x.score}/{g.questions.length}
              </b>
            </li>
          ))}
        </ol>
      </>
    )
  }
  const q = g.questions[g.current]
  const last = g.current > 0 ? g.questions[g.current - 1] : null
  const answered = new Set(g.picks.filter((p) => p.question === g.current).map((p) => p.userId))
  const iAnswered = answered.has(meId)
  const waiting = memberIds.filter((id) => !answered.has(id)).length
  return (
    <>
      {last && (
        <p className="trivia-last">
          Last answer: <b>{last.choices[last.answer] ?? '?'}</b>
        </p>
      )}
      <div
        className="trivia-progress"
        aria-label={`Question ${g.current + 1} of ${g.questions.length}`}
      >
        {g.questions.map((_, i) => (
          <span
            key={i}
            className={
              i < g.current
                ? 'trivia-dot trivia-dot--done'
                : i === g.current
                  ? 'trivia-dot trivia-dot--now'
                  : 'trivia-dot'
            }
          />
        ))}
        <span className="trivia-cat">{q.category}</span>
      </div>
      <p className="trivia-q">{q.q}</p>
      <div className="trivia-choices">
        {q.choices.map((c, i) => (
          <button
            key={i}
            type="button"
            className="trivia-choice"
            disabled={!canAct || busy || iAnswered}
            onClick={() => void play({ question: g.current, choice: i })}
          >
            <span className="trivia-letter">{'ABCD'[i]}</span>
            {c}
          </button>
        ))}
      </div>
      <div className="game-status trivia-wait">
        <span>
          {iAnswered
            ? waiting > 0
              ? `Answer locked in · waiting for ${waiting} more`
              : 'Answer locked in'
            : `${answered.size} answered`}
        </span>
        {g.host === meId && canAct && answered.size > 0 && (
          <button
            type="button"
            className="poll-close"
            disabled={busy}
            onClick={() => void play({ reveal: true })}
          >
            Show answer
          </button>
        )}
      </div>
    </>
  )
}

/** Pick a game to start in the chat. */
export function GameMenu({
  anchor,
  onPick,
  onClose
}: {
  anchor: HTMLElement
  onPick: (kind: ChatGameKind) => void
  onClose: () => void
}): React.JSX.Element {
  const WIDTH = 300
  const ref = useRef<HTMLDivElement>(null)
  const [place] = useState(() => placeAbove(anchor, WIDTH, 216))
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      className="menu game-menu"
      role="menu"
      style={{ top: place.top, left: place.left, width: WIDTH }}
    >
      <span className="menu-head">Play a game</span>
      {(Object.keys(GAME_NAMES) as ChatGameKind[]).map((k) => (
        <button
          key={k}
          type="button"
          role="menuitem"
          className="menu-item game-menu-item"
          onClick={() => onPick(k)}
        >
          <span className={`game-menu-icon game-menu-icon--${k}`} aria-hidden="true">
            {k === 'tictactoe' ? '#' : k === 'wordguess' ? 'W' : '?'}
          </span>
          <span className="menu-item-text">
            <span>{GAME_NAMES[k]}</span>
            <span className="menu-item-sub">{GAME_BLURBS[k]}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Lantern messages

/** A lantern's tag, and how far through its fade it is. */
export function LanternTag({ fadeAt }: { fadeAt: string | null | undefined }): React.JSX.Element {
  return (
    <span className={fadeAt ? 'lantern-tag lantern-tag--fading' : 'lantern-tag'}>
      <LanternIcon size={13} />
      {fadeAt ? 'Fading away…' : 'Lantern · fades once read'}
    </span>
  )
}

// ---------------------------------------------------------------------------------------------
// Firefly swarms across the chat

type Swarm = {
  id: string
  emoji: FireflyEmoji
  name: string
  flies: { x: number; delay: number; drift: number; size: number }[]
}

/** Long-press ❤️ or 🔥 on a message: a swarm of fireflies rises across everyone's chat. */
export function ChatFireflies({
  conversationId,
  nameOf,
  meId
}: {
  conversationId: string
  nameOf: (userId: string) => string
  meId: string
}): React.JSX.Element {
  const [swarms, setSwarms] = useState<Swarm[]>([])
  const nameRef = useRef(nameOf)
  useLayoutEffect(() => {
    nameRef.current = nameOf
  })
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    return window.glofly.onEvent((e) => {
      if (e.type !== 'chat:fireflies' || e.conversationId !== conversationId) return
      const count = reduce ? 3 : 14
      const swarm: Swarm = {
        id: e.id,
        emoji: e.emoji,
        name: e.userId === meId ? 'You' : nameRef.current(e.userId),
        flies: Array.from({ length: count }, () => ({
          x: 6 + Math.random() * 88,
          delay: Math.random() * 900,
          drift: Math.round((Math.random() - 0.5) * 120),
          size: 0.7 + Math.random() * 0.6
        }))
      }
      setSwarms((all) => (all.some((s) => s.id === swarm.id) ? all : [...all.slice(-3), swarm]))
      setTimeout(() => setSwarms((all) => all.filter((s) => s.id !== swarm.id)), 4600)
    })
  }, [conversationId, meId])
  return (
    <div className="chat-fireflies" aria-live="polite">
      {swarms.map((s) => (
        <div key={s.id} className="chat-swarm">
          {s.flies.map((f, i) => (
            <span
              key={i}
              className={`chat-fly chat-fly--${s.emoji === '🔥' ? 'fire' : 'heart'}`}
              style={
                {
                  left: `${f.x}%`,
                  animationDelay: `${f.delay}ms`,
                  '--drift': `${f.drift}px`,
                  '--size': f.size
                } as React.CSSProperties
              }
            >
              {s.emoji === '🔥' ? (
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 2c1 3.5 4.5 5.5 4.5 10a4.5 4.5 0 0 1-9 0c0-2 1-3.4 2-4.5.2 1.6 1 2.6 2 3 0-3 .5-5.6.5-8.5z"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 20.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 3.1c0 5.6-7.5 10-7.5 10z"
                  />
                </svg>
              )}
            </span>
          ))}
          <span className="chat-swarm-name">
            {s.name} sent {s.emoji === '🔥' ? 'fire' : 'love'}
          </span>
        </div>
      ))}
    </div>
  )
}
