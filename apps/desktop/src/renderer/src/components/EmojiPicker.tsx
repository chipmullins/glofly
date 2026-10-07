import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  addRecent,
  getRecent,
  getSkinTone,
  loadEmoji,
  searchEmoji,
  setSkinTone,
  withTone,
  type EmojiCategory,
  type EmojiInfo,
  type SkinTone
} from '../lib/emoji'
import { Emoji } from './EmojiText'
import './EmojiPicker.css'

type EmojiPickerProps = {
  /** The button that opened it; the picker sits next to it. */
  anchor: HTMLElement | null
  /** Used for "Recently used", which is kept per account. */
  userId: string
  /** What picking does, for screen readers ("Add emoji", "Add reaction") */
  label: string
  /** Shift+click keeps the picker open (for adding several emoji to a message). */
  allowMultiple?: boolean
  onPick: (emoji: string, keepOpen: boolean) => void
  onClose: () => void
}

const WIDTH = 368
const HEIGHT = 444
const GAP = 8
const COLUMNS = 8

const TONE_SWATCHES: { tone: SkinTone; label: string; color: string }[] = [
  { tone: 0, label: 'Default skin tone', color: '#ffcc4d' },
  { tone: 1, label: 'Light skin tone', color: '#f7dece' },
  { tone: 2, label: 'Medium-light skin tone', color: '#f3d2a2' },
  { tone: 3, label: 'Medium skin tone', color: '#d5ab88' },
  { tone: 4, label: 'Medium-dark skin tone', color: '#af7e57' },
  { tone: 5, label: 'Dark skin tone', color: '#7c533e' }
]

const WAVE: EmojiInfo = {
  emoji: '✋',
  label: 'raised hand',
  words: [],
  skins: ['✋\u{1f3fb}', '✋\u{1f3fc}', '✋\u{1f3fd}', '✋\u{1f3fe}', '✋\u{1f3ff}']
}

function TabIcon({ id }: { id: string }): React.JSX.Element {
  const paths: Record<string, React.ReactNode> = {
    recent: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    smileys: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2" />
        <path d="M9 9.5h.01M15 9.5h.01" />
      </>
    ),
    people: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5" />
      </>
    ),
    nature: (
      <>
        <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14" />
        <path d="M5 19l7-7" />
      </>
    ),
    food: (
      <>
        <path d="M4 10h13v3a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z" />
        <path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H16" />
        <path d="M8 3c-.7 1 .7 2 0 3M12 3c-.7 1 .7 2 0 3" />
      </>
    ),
    travel: (
      <>
        <path d="M5 16V11l2-5h10l2 5v5z" />
        <path d="M5 11h14" />
        <path d="M7 16v2M17 16v2" />
        <path d="M8 13.5h.01M16 13.5h.01" />
      </>
    ),
    activities: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18M3 12h18" />
      </>
    ),
    objects: (
      <>
        <path d="M9 18h6M10 21h4" />
        <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
      </>
    ),
    symbols: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
    flags: (
      <>
        <path d="M5 21V4" />
        <path d="M5 4h11l-2 4 2 4H5" />
      </>
    )
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[id]}
    </svg>
  )
}

/** Above the button, aligned to its right edge; below it if there isn't room above. */
function placeNear(anchor: HTMLElement | null): { top: number; left: number; height: number } {
  const rect =
    anchor?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 2)
  const height = Math.min(HEIGHT, window.innerHeight - GAP * 2)
  let top = rect.top - height - GAP
  if (top < GAP) top = Math.min(rect.bottom + GAP, window.innerHeight - height - GAP)
  // Line up with the button's right edge, or its left edge when that's off the window.
  const preferred = rect.right - WIDTH >= GAP ? rect.right - WIDTH : rect.left
  const left = Math.max(GAP, Math.min(preferred, window.innerWidth - WIDTH - GAP))
  return { top: Math.max(GAP, top), left, height }
}

/** Moves keyboard focus to an emoji in the grid. */
function focusItem(scroller: HTMLElement | null, index: number): void {
  const el = scroller?.querySelector<HTMLButtonElement>(`[data-index="${index}"]`)
  el?.focus({ preventScroll: true })
  el?.scrollIntoView({ block: 'nearest' })
}

/** Where each emoji sits in the grid, for arrow-key moves across sections. */
type Spot = { section: number; position: number }

function buildSpots(sections: EmojiCategory[]): { spots: Spot[]; starts: number[] } {
  const spots: Spot[] = []
  const starts: number[] = []
  sections.forEach((s, section) => {
    starts.push(spots.length)
    s.emoji.forEach((_, position) => spots.push({ section, position }))
  })
  return { spots, starts }
}

/** The index an arrow key moves to, or -1 for "up out of the grid" (back to search). */
function moveFrom(
  index: number,
  key: string,
  sections: EmojiCategory[],
  spots: Spot[],
  starts: number[]
): number {
  const total = spots.length
  const { section, position } = spots[index]
  const size = sections[section].emoji.length
  const column = position % COLUMNS
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, index - 1)
    case 'ArrowRight':
      return Math.min(total - 1, index + 1)
    case 'ArrowDown':
      if (position + COLUMNS < size) return index + COLUMNS
      if (Math.floor(position / COLUMNS) < Math.floor((size - 1) / COLUMNS))
        return starts[section] + size - 1
      if (section + 1 < sections.length) {
        return starts[section + 1] + Math.min(column, sections[section + 1].emoji.length - 1)
      }
      return index
    case 'ArrowUp':
      if (position - COLUMNS >= 0) return index - COLUMNS
      if (section > 0) {
        const prevSize = sections[section - 1].emoji.length
        const lastRow = Math.floor((prevSize - 1) / COLUMNS) * COLUMNS
        return starts[section - 1] + Math.min(lastRow + column, prevSize - 1)
      }
      return -1
    case 'Home':
      return 0
    case 'End':
      return total - 1
    default:
      return index
  }
}

type GridProps = {
  sections: EmojiCategory[]
  tone: SkinTone
  active: number
  starts: number[]
  sectionRefs: React.RefObject<Map<string, HTMLElement>>
  onPick: (info: EmojiInfo, keepOpen: boolean) => void
  onHover: (info: EmojiInfo | null) => void
  onFocusIndex: (index: number) => void
  onKeyDown: (e: React.KeyboardEvent, index: number) => void
}

/** The emoji themselves. Kept separate so hovering (which updates the preview) doesn't redraw them. */
const Grid = memo(function Grid({
  sections,
  tone,
  active,
  starts,
  sectionRefs,
  onPick,
  onHover,
  onFocusIndex,
  onKeyDown
}: GridProps): React.JSX.Element {
  return (
    <>
      {sections.map((section, s) => (
        <section
          key={section.id}
          className="ep-section"
          aria-label={section.label}
          ref={(el) => {
            if (el) sectionRefs.current.set(section.id, el)
            else sectionRefs.current.delete(section.id)
          }}
        >
          <h3 className="ep-section-title">{section.label}</h3>
          <div className="ep-grid" role="group" aria-label={section.label}>
            {section.emoji.map((info, position) => {
              const index = starts[s] + position
              const shown = withTone(info, tone)
              return (
                <button
                  key={info.emoji}
                  type="button"
                  className="ep-item"
                  data-index={index}
                  tabIndex={index === active ? 0 : -1}
                  aria-label={info.label}
                  onClick={(e) => onPick(info, e.shiftKey)}
                  onMouseEnter={() => onHover(info)}
                  onFocus={() => onFocusIndex(index)}
                  onKeyDown={(e) => onKeyDown(e, index)}
                >
                  <Emoji emoji={shown} className="ep-item-emoji" />
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
})

export default function EmojiPicker({
  anchor,
  userId,
  label,
  allowMultiple = false,
  onPick,
  onClose
}: EmojiPickerProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef(new Map<string, HTMLElement>())
  const [data, setData] = useState<Awaited<ReturnType<typeof loadEmoji>> | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [tone, setTone] = useState<SkinTone>(getSkinTone)
  const [toneOpen, setToneOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [hovered, setHovered] = useState<EmojiInfo | null>(null)
  const [currentTab, setCurrentTab] = useState<string>('')
  const [position, setPosition] = useState(() => placeNear(anchor))
  // "Recently used" as it was when the picker opened, so it doesn't reshuffle while picking.
  const [recent] = useState(() => getRecent(userId))

  useEffect(() => {
    let cancelled = false
    loadEmoji().then(
      (loaded) => !cancelled && setData(loaded),
      () => !cancelled && setFailed(true)
    )
    return () => {
      cancelled = true
    }
  }, [])

  // Stay next to the button when the window is resized.
  useEffect(() => {
    const onResize = (): void => setPosition(placeNear(anchor))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [anchor])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // Clicking anywhere else closes it (clicking the button that opened it is left to the button).
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || anchor?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [anchor, onClose])

  const sections = useMemo<EmojiCategory[]>(() => {
    if (!data) return []
    if (query.trim()) {
      return [
        { id: 'results', label: 'Search results', emoji: searchEmoji(data.categories, query) }
      ]
    }
    const recentInfo = recent.flatMap((e) => data.byEmoji.get(e) ?? [])
    return recentInfo.length > 0
      ? [{ id: 'recent', label: 'Recently used', emoji: recentInfo }, ...data.categories]
      : data.categories
  }, [data, query, recent])

  const { spots, starts } = useMemo(() => buildSpots(sections), [sections])
  const searching = query.trim().length > 0
  const noResults = searching && spots.length === 0

  /** A new search starts back at the first result. */
  function changeQuery(value: string): void {
    setQuery(value)
    setActive(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  const pick = useCallback(
    (info: EmojiInfo, keepOpen: boolean) => {
      addRecent(userId, info.emoji)
      onPick(withTone(info, tone), allowMultiple && keepOpen)
    },
    [userId, tone, onPick, allowMultiple]
  )

  const onGridKey = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        return
      }
      e.preventDefault()
      const next = moveFrom(index, e.key, sections, spots, starts)
      if (next === -1) searchRef.current?.focus()
      else {
        setActive(next)
        focusItem(scrollRef.current, next)
      }
    },
    [sections, spots, starts, setActive]
  )

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' && spots.length > 0) {
      e.preventDefault()
      const { section, position: p } = spots[0]
      pick(sections[section].emoji[p], e.shiftKey)
    }
    if (e.key === 'ArrowDown' && spots.length > 0) {
      e.preventDefault()
      setActive(0)
      focusItem(scrollRef.current, 0)
    }
  }

  function onPanelKey(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (toneOpen) setToneOpen(false)
      else onClose()
    }
  }

  function jumpTo(id: string): void {
    const scroll = (): void => {
      const el = sectionRefs.current.get(id)
      const scroller = scrollRef.current
      if (el && scroller) scroller.scrollTop = el.offsetTop - scroller.offsetTop
      setCurrentTab(id)
    }
    if (!searching) return scroll()
    // Leaving a search: wait for the full list to come back first.
    changeQuery('')
    requestAnimationFrame(() => requestAnimationFrame(scroll))
  }

  // Highlight the tab of the section being scrolled through.
  function onScroll(): void {
    const scroller = scrollRef.current
    if (!scroller || searching) return
    let current = sections[0]?.id ?? ''
    for (const s of sections) {
      const el = sectionRefs.current.get(s.id)
      if (el && el.offsetTop - scroller.offsetTop <= scroller.scrollTop + 8) current = s.id
    }
    setCurrentTab(current)
  }

  const shownTab = searching ? '' : currentTab || sections[0]?.id || ''
  const activeInfo = spots[active]
    ? sections[spots[active].section]?.emoji[spots[active].position]
    : undefined
  const preview = hovered ?? activeInfo ?? null
  const tabs = [
    ...(recent.length > 0 ? [{ id: 'recent', label: 'Recently used' }] : []),
    ...(data?.categories ?? []).map(({ id, label }) => ({ id, label }))
  ]

  return createPortal(
    <div
      ref={panelRef}
      className="emoji-picker"
      role="dialog"
      aria-label={label}
      style={{ top: position.top, left: position.left, height: position.height }}
      onKeyDown={onPanelKey}
    >
      <div className="ep-header">
        <label className="ep-search">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            value={query}
            placeholder="Find an emoji"
            aria-label="Find an emoji"
            spellCheck={false}
            maxLength={40}
            onChange={(e) => changeQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          {query && (
            <button
              type="button"
              className="ep-clear"
              aria-label="Clear search"
              onClick={() => {
                changeQuery('')
                searchRef.current?.focus()
              }}
            >
              ×
            </button>
          )}
        </label>
        <div className="ep-tone">
          <button
            type="button"
            className="ep-tone-button"
            aria-label={`Skin tone: ${TONE_SWATCHES[tone].label}`}
            aria-expanded={toneOpen}
            title="Skin tone"
            onClick={() => setToneOpen((o) => !o)}
          >
            <Emoji emoji={withTone(WAVE, tone)} className="ep-tone-emoji" />
          </button>
          {toneOpen && (
            <div className="ep-tone-menu" role="menu" aria-label="Skin tone">
              {TONE_SWATCHES.map((s) => (
                <button
                  key={s.tone}
                  type="button"
                  role="menuitemradio"
                  aria-checked={tone === s.tone}
                  aria-label={s.label}
                  title={s.label}
                  className={tone === s.tone ? 'ep-swatch ep-swatch--on' : 'ep-swatch'}
                  style={{ background: s.color }}
                  onClick={() => {
                    setTone(s.tone)
                    setSkinTone(s.tone)
                    setToneOpen(false)
                    searchRef.current?.focus()
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <nav className="ep-tabs" aria-label="Emoji categories">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === shownTab ? 'ep-tab ep-tab--on' : 'ep-tab'}
            aria-label={t.label}
            aria-current={t.id === shownTab ? 'true' : undefined}
            title={t.label}
            onClick={() => jumpTo(t.id)}
          >
            <TabIcon id={t.id} />
          </button>
        ))}
      </nav>

      <div
        className="ep-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        onMouseLeave={() => setHovered(null)}
      >
        {failed ? (
          <p className="ep-empty">Emoji couldn&apos;t load. Close this and try again.</p>
        ) : !data ? (
          <p className="ep-empty">Loading emoji…</p>
        ) : noResults ? (
          <p className="ep-empty">No emoji match “{query.trim()}”.</p>
        ) : (
          <Grid
            sections={sections}
            tone={tone}
            active={active}
            starts={starts}
            sectionRefs={sectionRefs}
            onPick={pick}
            onHover={setHovered}
            onFocusIndex={setActive}
            onKeyDown={onGridKey}
          />
        )}
      </div>

      <div className="ep-footer" aria-hidden="true">
        {preview ? (
          <>
            <Emoji emoji={withTone(preview, tone)} className="ep-footer-emoji" />
            <span className="ep-footer-label">{preview.label}</span>
          </>
        ) : (
          <span className="ep-footer-hint">Pick an emoji</span>
        )}
        {allowMultiple && <span className="ep-footer-tip">Shift+click to add more</span>}
      </div>
    </div>,
    document.body
  )
}
