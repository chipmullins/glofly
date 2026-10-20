import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SEARCH_HAS,
  attachmentSummary,
  highlightPieces,
  lastWeekday,
  searchWords,
  shortBody,
  type ConstellationDetail,
  type PublicUser,
  type SearchHas
} from '@glofly/shared'
import Avatar from '../components/Avatar'
import { photoUrl } from '../lib/attachments'
import { community, type CxSearchFilters, type CxSearchResult } from '../lib/community'
import { CloseIcon } from './bits'
import './Community.css'

// Search the whole constellation (0.8.0, approved Oct 20 board 9). Ctrl+F still searches the
// nebula you're in; this searches every nebula you can see, with from: / in: / has: / before:
// filters, results grouped by nebula, newest first.

type Picker = 'from' | 'in' | 'has' | 'before' | null

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function beforeChoices(now = new Date()): { label: string; at: string }[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const out = [{ label: 'Today', at: new Date(today.getTime() + 86_400_000).toISOString() }]
  out.push({ label: 'Yesterday', at: today.toISOString() })
  for (let i = 2; i <= 6; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const day = lastWeekday(d.getDay(), now)
    out.push({ label: DAYS[day.getDay()], at: day.toISOString() })
  }
  const month = new Date(today)
  month.setMonth(month.getMonth() - 1)
  out.push({ label: 'A month ago', at: month.toISOString() })
  return out
}

function SparkSmall(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="#f47a1f" aria-hidden="true">
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
    </svg>
  )
}

const whenLabel = (iso: string): string => {
  const d = new Date(iso)
  const days = (Date.now() - d.getTime()) / 86_400_000
  return days < 6
    ? d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function CxSearch({
  constellation: c,
  onClose,
  onJump
}: {
  constellation: ConstellationDetail
  onClose: () => void
  onJump: (nebulaId: string, messageId: string) => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<Omit<CxSearchFilters, 'q'>>({})
  const [picker, setPicker] = useState<Picker>(null)
  const [who, setWho] = useState('')
  const [results, setResults] = useState<CxSearchResult[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  useEffect(() => inputRef.current?.focus(), [])

  const ready = q.trim().length >= 2 || !!filters.from || !!filters.has || !!filters.in
  useEffect(() => {
    if (!ready) {
      setResults(null)
      setProblem(null)
      return
    }
    const n = ++seq.current
    const t = setTimeout(() => {
      setBusy(true)
      void community.search(c.id, { q, ...filters }).then((r) => {
        if (n !== seq.current) return
        setBusy(false)
        if (r.ok) {
          setResults(r.data.results)
          setHasMore(r.data.hasMore)
          setProblem(null)
        } else setProblem(r.message)
      })
    }, 280)
    return () => clearTimeout(t)
  }, [c.id, q, filters, ready])

  const words = useMemo(() => searchWords(q), [q])
  const groups = useMemo(() => {
    const out: { nebula: CxSearchResult['nebula']; items: CxSearchResult[] }[] = []
    for (const r of results ?? []) {
      const g = out.find((x) => x.nebula.id === r.nebula.id)
      if (g) g.items.push(r)
      else out.push({ nebula: r.nebula, items: [r] })
    }
    return out
  }, [results])

  const members = useMemo(() => {
    const t = who.trim().toLowerCase()
    return c.members
      .map((m) => m.user)
      .filter((u) => !t || u.displayName.toLowerCase().includes(t) || u.username.toLowerCase().includes(t))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, 8)
  }, [c.members, who])

  const textNebulas = c.nebulas.filter((n) => n.kind === 'text')
  const chips: { id: Exclude<Picker, null>; label: string; on: string | null }[] = [
    { id: 'from', label: 'from:', on: filters.from ? `from: ${filters.from.displayName.split(/\s+/)[0]}` : null },
    { id: 'in', label: 'in:', on: filters.in ? `in: #${filters.in.name}` : null },
    { id: 'has', label: 'has:', on: filters.has ? `has: ${filters.has}` : null },
    { id: 'before', label: 'before:', on: filters.before ? `before: ${filters.before.label}` : null }
  ]
  const clear = (id: Exclude<Picker, null>): void => setFilters((f) => ({ ...f, [id]: null }))
  const pick = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]): void => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPicker(null)
    setWho('')
    inputRef.current?.focus()
  }
  const nebulaCount = groups.length
  const count = results?.length ?? 0
  const summary = !ready
    ? 'Type a word, or pick a filter.'
    : busy && results === null
      ? 'Searching…'
      : `${count}${hasMore ? '+' : ''} ${count === 1 ? 'message' : 'messages'} in ${nebulaCount} ${nebulaCount === 1 ? 'nebula' : 'nebulas'} · newest first`

  async function more(): Promise<void> {
    const last = results?.at(-1)
    if (!last) return
    const r = await community.search(c.id, { q, ...filters }, last.message.id)
    if (r.ok) {
      setResults((list) => [...(list ?? []), ...r.data.results.filter((x) => !list?.some((y) => y.message.id === x.message.id))])
      setHasMore(r.data.hasMore)
    }
  }

  return (
    <aside
      className="cxs"
      aria-label={`Search ${c.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (picker) setPicker(null)
          else onClose()
        }
      }}
    >
      <div className="cxs-top">
        <div className="cxs-box">
          <span className="cxs-icon" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          {chips
            .filter((x) => x.on)
            .map((x) => (
              <span key={x.id} className="cxs-token">
                {x.on}
              </span>
            ))}
          <input
            ref={inputRef}
            value={q}
            aria-label={`Search ${c.name}`}
            placeholder={chips.some((x) => x.on) ? '' : `Search ${c.name}`}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // Backspace in an empty box takes off the last filter.
              if (e.key === 'Backspace' && !q) {
                const last = [...chips].reverse().find((x) => x.on)
                if (last) clear(last.id)
              }
            }}
          />
          <span className="cxs-where">in {c.name}</span>
          <button type="button" className="cxs-close" aria-label="Close search" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="cxs-chips" role="group" aria-label="Filters">
          {chips.map((x) => (
            <span key={x.id} className="cxs-chip-wrap">
              <button
                type="button"
                aria-pressed={!!x.on}
                aria-haspopup={x.on ? undefined : 'listbox'}
                aria-expanded={x.on ? undefined : picker === x.id}
                className={x.on ? 'cxs-chip cxs-chip--on' : 'cxs-chip'}
                onClick={() => (x.on ? clear(x.id) : setPicker(picker === x.id ? null : x.id))}
              >
                {x.on ? `✓ ${x.on}` : `+ ${x.label}`}
              </button>
              {picker === x.id && (
                <div className="cxs-pop" role="listbox" aria-label={`Pick ${x.label}`}>
                  {x.id === 'from' && (
                    <>
                      <input
                        className="cxs-pop-find"
                        autoFocus
                        placeholder="Who?"
                        value={who}
                        aria-label="Find a member"
                        onChange={(e) => setWho(e.target.value)}
                      />
                      {members.map((u: PublicUser) => (
                        <button key={u.id} type="button" role="option" aria-selected={false} className="cxs-pop-item" onClick={() => pick('from', u)}>
                          <Avatar id={u.id} name={u.displayName} avatarVersion={u.avatarVersion} size={24} />
                          {u.displayName}
                        </button>
                      ))}
                      {members.length === 0 && <span className="cxs-pop-none">Nobody by that name here.</span>}
                    </>
                  )}
                  {x.id === 'in' &&
                    textNebulas.map((n) => (
                      <button key={n.id} type="button" role="option" aria-selected={false} className="cxs-pop-item" onClick={() => pick('in', { id: n.id, name: n.name })}>
                        <SparkSmall /># {n.name}
                      </button>
                    ))}
                  {x.id === 'has' &&
                    SEARCH_HAS.map((h) => (
                      <button key={h.id} type="button" role="option" aria-selected={false} className="cxs-pop-item" onClick={() => pick('has', h.id as SearchHas)}>
                        {h.id === 'image' ? '🖼️' : h.id === 'link' ? '🔗' : '📎'} {h.name}
                      </button>
                    ))}
                  {x.id === 'before' &&
                    beforeChoices().map((b) => (
                      <button key={b.label} type="button" role="option" aria-selected={false} className="cxs-pop-item" onClick={() => pick('before', b)}>
                        {b.label}
                      </button>
                    ))}
                </div>
              )}
            </span>
          ))}
        </div>
        <div className="cxs-summary" role="status">
          {problem ?? summary}
        </div>
      </div>
      <div className="cxs-results">
        {groups.map((g) => (
          <section key={g.nebula.id} className="cxs-group" aria-label={`${g.nebula.name}, ${g.items.length} results`}>
            <h3 className="cxs-group-head">
              <SparkSmall />
              {g.nebula.name} · {g.items.length} {g.items.length === 1 ? 'result' : 'results'}
            </h3>
            {g.items.map((r) => {
              const m = r.message
              const text = shortBody(m.body) || attachmentSummary(m.attachments)
              const photo = m.attachments.find((a) => a.kind === 'image' && !a.sticker)
              const name = r.sender?.displayName ?? 'Someone'
              return (
                <div key={m.id} className="cxs-hit">
                  <Avatar id={m.senderId} name={name} avatarVersion={r.sender?.avatarVersion ?? null} size={32} />
                  <div className="cxs-hit-main">
                    <div className="cxs-hit-who">
                      <b>{name.split(/\s+/)[0]}</b>
                      <span>{whenLabel(m.createdAt)}</span>
                    </div>
                    <div className="cxs-hit-text">
                      {highlightPieces(text, words).map((p, i) =>
                        p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>
                      )}
                    </div>
                    {photo && (
                      <img
                        className="cxs-hit-photo"
                        alt={photo.name}
                        src={photoUrl(m.conversationId, photo.id, 'preview')}
                        style={photo.width && photo.height ? { aspectRatio: `${photo.width} / ${photo.height}` } : undefined}
                      />
                    )}
                  </div>
                  <button type="button" className="cxs-jump" onClick={() => onJump(r.nebula.id, m.id)}>
                    Jump
                  </button>
                </div>
              )
            })}
          </section>
        ))}
        {ready && results?.length === 0 && !busy && (
          <p className="cxs-none">
            {Object.values(filters).some(Boolean) ? 'Nothing matches all those filters. Try removing one.' : 'Nothing found. Try other words.'}
          </p>
        )}
        {hasMore && (
          <button type="button" className="cx-button cxs-more" onClick={() => void more()}>
            Show more
          </button>
        )}
      </div>
    </aside>
  )
}
