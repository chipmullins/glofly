import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react'
import { api, type AccountRow, type ConstellationRow } from '../lib/api'
import { ago, plural } from '../lib/format'
import { Avatar } from './common'
import { Icon, ICONS } from './icons'
import type { Page } from './Sidebar'
import { PAGE_LABELS } from '../lib/pages'

// 0.8.2: the command bar (Ctrl+K, ⌘K on a Mac). Finds accounts, constellations, pages and actions.
// Actions that change something only open their confirm dialog (with the audit note): nothing
// happens straight from the bar.

export type CommandAction =
  | 'pause'
  | 'lockdown'
  | 'end-calls'
  | 'restart'
  | 'approve-phone'
  | 'test-alert'
  | 'create-account'
  | 'shortcuts'

export type CommandState = { paused: boolean; lockdown: boolean }

type Item = {
  id: string
  group: 'Accounts' | 'Constellations' | 'Pages' | 'Actions'
  title: string
  sub: string
  avatar?: { id: string; name: string }
  icon?: string
  run: () => void
}

const PAGE_HINTS: Partial<Record<Page, string>> = {
  dashboard: 'G then D',
  accounts: 'G then A',
  reports: 'G then R',
  inbox: 'G then I',
  constellations: 'G then C',
  server: 'G then S',
  audit: 'G then L',
  errors: 'G then E'
}

const PAGE_ICONS: Record<Page, string> = {
  dashboard: ICONS.dashboard,
  insights: ICONS.insights,
  accounts: ICONS.accounts,
  signups: ICONS.signups,
  reports: ICONS.reports,
  inbox: ICONS.inbox,
  errors: ICONS.errors,
  constellations: ICONS.constellations,
  announcements: ICONS.announcements,
  server: ICONS.server,
  audit: ICONS.audit
}

const NONE_A: AccountRow[] = []
const NONE_C: ConstellationRow[] = []

const matches = (q: string, ...texts: string[]): boolean =>
  !q || texts.some((t) => t.toLowerCase().includes(q))

export function CommandBar({
  state,
  onClose,
  onPage,
  onOpenAccount,
  onOpenConstellation,
  onAction
}: {
  state: CommandState
  onClose: () => void
  onPage: (page: Page) => void
  onOpenAccount: (id: string, then?: 'message' | 'friend') => void
  onOpenConstellation: (id: string) => void
  onAction: (action: CommandAction) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{
    q: string
    accounts: AccountRow[]
    constellations: ConstellationRow[]
  } | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const ticket = useRef(0)
  const listId = useId()
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  // Focus the box; put focus back where it was afterwards.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  // Search accounts and constellations a moment after typing stops.
  const q = query.trim()
  useEffect(() => {
    const mine = ++ticket.current
    if (!q) return
    const timer = setTimeout(() => {
      void Promise.all([api.accounts(q, 'all'), api.constellations(q, 'all')]).then(([a, c]) => {
        if (mine !== ticket.current) return
        setFound({
          q,
          accounts: a.ok ? a.data.accounts.slice(0, 5) : [],
          constellations: c.ok ? c.data.constellations.slice(0, 4) : []
        })
      })
    }, 200)
    return () => clearTimeout(timer)
  }, [q])
  const searching = q !== '' && found?.q !== q
  const accounts = q && found ? found.accounts : NONE_A
  const constellations = q && found ? found.constellations : NONE_C

  const items = useMemo((): Item[] => {
    const lower = q.toLowerCase()
    const list: Item[] = []
    for (const c of constellations) {
      list.push({
        id: `c-${c.id}`,
        group: 'Constellations',
        title: c.name,
        sub: `${plural(c.memberCount, 'member')}${c.openReports ? ` · ${plural(c.openReports, 'open report')}` : ''}${c.takenDownAt ? ' · taken down' : ''}`,
        avatar: { id: c.id, name: c.name },
        run: () => onOpenConstellation(c.id)
      })
    }
    for (const a of accounts) {
      list.push({
        id: `a-${a.id}`,
        group: 'Accounts',
        title: `${a.displayName}  @${a.username}`,
        sub: a.online
          ? 'Online now'
          : a.lastSeenAt
            ? `Last seen ${ago(a.lastSeenAt)}`
            : `Joined ${ago(a.createdAt)}`,
        avatar: { id: a.id, name: a.displayName },
        run: () => onOpenAccount(a.id)
      })
    }
    const actions: (Omit<Item, 'group'> & { words: string })[] = []
    const first = accounts[0]
    if (first) {
      actions.push(
        {
          id: 'x-message',
          title: `Send a message to @${first.username}…`,
          sub: 'Message as Glofly team',
          icon: ICONS.message,
          words: '',
          run: () => onOpenAccount(first.id, 'message')
        },
        {
          id: 'x-friend',
          title: `Add a friend for @${first.username}…`,
          sub: 'They become friends straight away',
          icon: ICONS.addFriend,
          words: '',
          run: () => onOpenAccount(first.id, 'friend')
        }
      )
    }
    const fixed: (Omit<Item, 'group'> & { words: string })[] = [
      {
        id: 'x-create',
        title: 'Create account',
        sub: 'Invite someone by email',
        icon: ICONS.plus,
        words: 'new invite add',
        run: () => onAction('create-account')
      },
      {
        id: 'x-lockdown',
        title: state.lockdown ? 'Turn off Lockdown' : 'Turn on Lockdown',
        sub: state.lockdown
          ? 'New accounts can do everything again'
          : 'New accounts can only talk to friends',
        icon: ICONS.lock,
        words: 'lockdown spam emergency',
        run: () => onAction('lockdown')
      },
      {
        id: 'x-pause',
        title: state.paused ? 'Unpause Glofly' : 'Pause Glofly',
        sub: state.paused
          ? 'Everyone can use Glofly again'
          : 'Everyone sees the pause screen. Control keeps working.',
        icon: ICONS.pause,
        words: 'pause kill switch emergency stop',
        run: () => onAction('pause')
      },
      {
        id: 'x-calls',
        title: 'End all calls',
        sub: 'Hangs up every call and Watch Together',
        icon: ICONS.calls,
        words: 'calls hang up voice emergency',
        run: () => onAction('end-calls')
      },
      {
        id: 'x-restart',
        title: 'Restart server',
        sub: 'Back in about 10 seconds',
        icon: ICONS.refresh,
        words: 'restart reboot server',
        run: () => onAction('restart')
      },
      {
        id: 'x-phone',
        title: 'Approve a new iPhone…',
        sub: 'Shows a code to type on the phone',
        icon: ICONS.phone,
        words: 'phone iphone pair device approve',
        run: () => onAction('approve-phone')
      },
      {
        id: 'x-test',
        title: 'Send a test alert',
        sub: 'To your approved phones',
        icon: ICONS.bell,
        words: 'alert notification push test',
        run: () => onAction('test-alert')
      },
      {
        id: 'x-shortcuts',
        title: 'Keyboard shortcuts',
        sub: 'Every shortcut in Control',
        icon: ICONS.info,
        words: 'keys help ?',
        run: () => onAction('shortcuts')
      }
    ]
    const pages = (Object.keys(PAGE_LABELS) as Page[])
      .filter((p) => matches(lower, PAGE_LABELS[p], p))
      .map((p): Item => ({
        id: `p-${p}`,
        group: 'Pages',
        title: PAGE_LABELS[p],
        sub: PAGE_HINTS[p]
          ? `Go to ${PAGE_LABELS[p]} · ${PAGE_HINTS[p]}`
          : `Go to ${PAGE_LABELS[p]}`,
        icon: PAGE_ICONS[p],
        run: () => onPage(p)
      }))
    list.push(...(lower ? pages : pages.slice(0, 5)))
    for (const a of [...actions, ...fixed.filter((x) => matches(lower, x.title, x.sub, x.words))]) {
      list.push({ ...a, group: 'Actions' })
    }
    return list
  }, [q, accounts, constellations, state, onAction, onOpenAccount, onOpenConstellation, onPage])

  // Keep the highlight on a real row.
  const current = Math.min(active, Math.max(0, items.length - 1))
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [current, items])

  const choose = (item: Item | undefined): void => {
    if (!item) return
    onClose()
    item.run()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(items.length ? (current + 1) % items.length : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(items.length ? (current - 1 + items.length) % items.length : 0)
    } else if (e.key === 'Home' && e.ctrlKey) {
      setActive(0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(items[current])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    } else if (e.key === 'Tab') {
      // The box is the only stop: focus stays inside the bar.
      e.preventDefault()
    }
  }

  const groups = (['Constellations', 'Accounts', 'Pages', 'Actions'] as const)
    .map((g) => ({ g, rows: items.map((it, i) => ({ it, i })).filter((x) => x.it.group === g) }))
    .filter((x) => x.rows.length)

  return (
    <div
      className="backdrop backdrop--command"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="command" role="dialog" aria-modal="true" aria-label="Command bar">
        <label className="command-box">
          <Icon d={ICONS.search} size={20} strokeWidth={2} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items[current] ? `${listId}-${current}` : undefined}
            aria-label="Search accounts, constellations, pages and actions"
            placeholder="Search accounts, constellations, pages and actions"
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
          />
          <kbd>Esc</kbd>
        </label>
        <div ref={listRef} id={listId} className="command-list" role="listbox" aria-label="Results">
          {groups.map(({ g, rows }) => (
            <div key={g} role="group" aria-labelledby={`${listId}-${g}`}>
              <span id={`${listId}-${g}`} className="command-group" role="presentation">
                {g}
              </span>
              {rows.map(({ it, i }) => (
                <div
                  key={it.id}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === current}
                  className="command-item"
                  onMouseMove={() => i !== current && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(it)}
                >
                  {it.avatar ? (
                    <Avatar id={it.avatar.id} name={it.avatar.name} />
                  ) : (
                    <span className="command-icon" aria-hidden="true">
                      <Icon d={it.icon ?? ICONS.arrow} size={18} strokeWidth={2} />
                    </span>
                  )}
                  <span className="text">
                    <span className="title">{it.title}</span>
                    <span className="sub">{it.sub}</span>
                  </span>
                  {i === current && <span className="hint-key">Enter</span>}
                </div>
              ))}
            </div>
          ))}
          {items.length === 0 && (
            <p className="command-empty" role="status">
              {searching ? 'Searching…' : `Nothing matches “${q}”.`}
            </p>
          )}
          {searching && items.length > 0 && (
            <p className="command-empty command-empty--small" role="status">
              Searching accounts and constellations…
            </p>
          )}
        </div>
        <footer className="command-foot">
          <span>
            <strong>↑ ↓</strong> move
          </span>
          <span>
            <strong>Enter</strong> open
          </span>
          <span>
            <strong>G</strong> then <strong>R</strong> Reports
          </span>
          <span>
            <strong>J / K</strong> next/previous report
          </span>
          <span>
            <strong>?</strong> all shortcuts
          </span>
        </footer>
      </div>
    </div>
  )
}
