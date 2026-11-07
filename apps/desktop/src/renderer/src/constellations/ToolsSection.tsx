import { useCallback, useEffect, useState } from 'react'
import type { ApiResult, ConstellationDetail } from '@glofly/shared'
import { Sheet } from './IntegrationsPage'

// Communities round (Nov 2026): Integrations → Glofly tools (approved canvas boards 1 and 15).
// Built in and free: tickets, welcome messages, button roles, logging, giveaways. The server checks
// every setting again (this constellation's nebulas and roles only; button roles only roles
// members may pick themselves).

type ToolName = 'tickets' | 'welcome' | 'buttonRoles' | 'logging' | 'giveaways'
type ToolState = { enabled: boolean; settings: Record<string, unknown>; posted: boolean }
type Giveaway = { id: string; prize: string; winners: number; endsAt: string; endedAt: string | null; winnerIds: string[] }

const call = <T,>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>> =>
  window.glofly.constellations.request<T>(method, path, body)

const TILES: { id: ToolName; name: string; text: string; link: string }[] = [
  { id: 'tickets', name: 'Tickets', text: 'A Help button opens a private nebula with staff.', link: 'Set up' },
  { id: 'welcome', name: 'Welcome', text: 'Greets new members in a nebula you pick.', link: 'Edit message' },
  { id: 'buttonRoles', name: 'Button roles', text: 'Buttons that hand out self-assigned roles.', link: 'Set up' },
  { id: 'logging', name: 'Logging', text: 'Joins, leaves, edits and deletes to a staff nebula.', link: 'Set up' },
  { id: 'giveaways', name: 'Giveaways', text: 'Enter with a button, winners picked fairly.', link: 'Start one' }
]

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={on ? 'am-switch am-switch--on' : 'am-switch'} onClick={() => onChange(!on)}>
      <span className="am-knob" />
    </button>
  )
}

function NebulaSelect({ c, value, onChange, label }: { c: ConstellationDetail; value: string; onChange: (v: string) => void; label: string }): React.JSX.Element {
  return (
    <label className="ix-field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {c.nebulas
          .filter((n) => n.kind === 'text')
          .map((n) => (
            <option key={n.id} value={n.id}>
              #{n.name}
            </option>
          ))}
      </select>
    </label>
  )
}

function ToolSheet({
  c,
  tool,
  state,
  onClose,
  onSaved,
  onProblem
}: {
  c: ConstellationDetail
  tool: ToolName
  state: ToolState
  onClose: () => void
  onSaved: (message: string) => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const texts = c.nebulas.filter((n) => n.kind === 'text')
  const st = state.settings
  const first = (texts[0]?.id ?? '') as string
  const [nebulaId, setNebulaId] = useState<string>((st.nebulaId as string) ?? first)
  const [staffRoleId, setStaffRoleId] = useState<string>((st.staffRoleId as string) ?? '')
  const [categoryId, setCategoryId] = useState<string>((st.categoryId as string) ?? '')
  const [label, setLabel] = useState<string>((st.label as string) ?? 'Open a ticket')
  const [text, setText] = useState<string>((st.text as string) ?? (tool === 'tickets' ? 'Need help from staff? Open a private ticket.' : 'Pick your roles:'))
  const [message, setMessage] = useState<string>((st.message as string) ?? `Welcome to ${c.name}, {name}!`)
  const [roleIds, setRoleIds] = useState<string[]>((st.roleIds as string[]) ?? [])
  const [log, setLog] = useState({ joins: st.joins !== false, messages: st.messages !== false, roles: st.roles !== false, moderation: st.moderation !== false })
  const [prize, setPrize] = useState('')
  const [winners, setWinners] = useState(1)
  const [hours, setHours] = useState(72)
  const [giveRole, setGiveRole] = useState('')
  const [busy, setBusy] = useState(false)
  const pickable = c.roles.filter((r) => r.kind === 'custom' && r.selfAssign)
  const staffRoles = c.roles.filter((r) => r.kind !== 'member' && r.kind !== 'owner' && !r.selfAssign)
  const title = { tickets: 'Tickets', welcome: 'Welcome messages', buttonRoles: 'Button roles', logging: 'Logging', giveaways: 'Start a giveaway' }[tool]

  const save = async (): Promise<void> => {
    setBusy(true)
    if (tool === 'giveaways') {
      if (!state.enabled) await call('PUT', `/constellations/${c.id}/tools/giveaways`, { enabled: true })
      const r = await call<{ id: string }>('POST', `/constellations/${c.id}/giveaways`, { nebulaId, prize, winners, hours, roleId: giveRole || null })
      setBusy(false)
      return r.ok ? onSaved('The giveaway is up.') : onProblem(r.message)
    }
    const settings =
      tool === 'tickets'
        ? { nebulaId, staffRoleId: staffRoleId || null, categoryId: categoryId || null, label, text }
        : tool === 'welcome'
          ? { nebulaId, message }
          : tool === 'buttonRoles'
            ? { nebulaId, text, roleIds }
            : { nebulaId, ...log }
    const r = await call('PUT', `/constellations/${c.id}/tools/${tool}`, { enabled: true, settings })
    if (!r.ok) {
      setBusy(false)
      return onProblem(r.message)
    }
    if (tool === 'tickets' || tool === 'buttonRoles') {
      const p = await call('POST', `/constellations/${c.id}/tools/${tool}/post`)
      setBusy(false)
      return p.ok ? onSaved(tool === 'tickets' ? 'The ticket button is posted.' : 'The role buttons are posted.') : onProblem(p.message)
    }
    setBusy(false)
    onSaved('Saved.')
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="ix-text">
        {tool === 'tickets'
          ? 'An "Open a ticket" button in a nebula you pick. Each ticket is a private nebula for that member and your staff.'
          : tool === 'welcome'
            ? 'Greets each new member in a nebula ({name} = their name).'
            : tool === 'buttonRoles'
              ? 'A message with buttons that give and take roles members can pick themselves (labels only, never permissions).'
              : tool === 'logging'
                ? 'Copies what happens to a staff nebula. Never the text of messages.'
                : 'Members press Enter; winners are picked at random when it ends and announced in the nebula.'}
      </p>
      <NebulaSelect c={c} value={nebulaId} onChange={setNebulaId} label={tool === 'logging' ? 'Log to' : tool === 'tickets' ? 'Post the button in' : 'Post in'} />
      {tool === 'tickets' && (
        <>
          <div className="ix-grid2">
            <label className="ix-field">
              Staff who see tickets
              <select value={staffRoleId} onChange={(e) => setStaffRoleId(e.target.value)}>
                <option value="">Owner and nebula managers only</option>
                {staffRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ix-field">
              New tickets go in category
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">No category</option>
                {c.categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="ix-field">
            Message
            <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
          </label>
          <label className="ix-field">
            Button text
            <input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
          </label>
        </>
      )}
      {tool === 'welcome' && (
        <label className="ix-field">
          Message ({'{name}'} = their name)
          <textarea className="as-textarea" rows={3} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
        </label>
      )}
      {tool === 'buttonRoles' && (
        <>
          <label className="ix-field">
            Message
            <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
          </label>
          <fieldset className="ix-chips">
            <legend>Buttons (up to 10 roles members can pick themselves)</legend>
            {pickable.length === 0 && <span className="ix-muted">No roles members can pick yet. Make one in Roles (“Members can pick this”).</span>}
            {pickable.map((r) => {
              const on = roleIds.includes(r.id)
              return (
                <button key={r.id} type="button" aria-pressed={on} className={on ? 'ix-chip ix-chip--on' : 'ix-chip'} onClick={() => setRoleIds(on ? roleIds.filter((x) => x !== r.id) : [...roleIds, r.id].slice(0, 10))}>
                  {r.name}
                </button>
              )
            })}
          </fieldset>
        </>
      )}
      {tool === 'logging' && (
        <fieldset className="ix-chips">
          <legend>What to log</legend>
          {(
            [
              ['joins', 'Joins and leaves'],
              ['messages', 'Edits and deletes'],
              ['roles', 'Roles'],
              ['moderation', 'Bans, time-outs and other moderation']
            ] as const
          ).map(([k, name]) => (
            <button key={k} type="button" aria-pressed={log[k]} className={log[k] ? 'ix-chip ix-chip--on' : 'ix-chip'} onClick={() => setLog({ ...log, [k]: !log[k] })}>
              {name}
            </button>
          ))}
        </fieldset>
      )}
      {tool === 'giveaways' && (
        <>
          <label className="ix-field">
            Prize
            <input value={prize} maxLength={100} onChange={(e) => setPrize(e.target.value)} placeholder="Rocket League Fennec" />
          </label>
          <div className="ix-grid2">
            <label className="ix-field">
              Winners
              <input type="number" min={1} max={20} value={winners} onChange={(e) => setWinners(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
            </label>
            <label className="ix-field">
              Ends in
              <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {[1, 6, 24, 72, 168, 336, 720].map((h) => (
                  <option key={h} value={h}>
                    {h < 24 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${h / 24} ${h === 24 ? 'day' : 'days'}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="ix-field">
            Who can enter
            <select value={giveRole} onChange={(e) => setGiveRole(e.target.value)}>
              <option value="">Everyone</option>
              {c.roles
                .filter((r) => r.kind !== 'member' && r.kind !== 'owner')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} only
                  </option>
                ))}
            </select>
          </label>
        </>
      )}
      <div className="ix-actions">
        <button type="button" className="ix-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="ix-btn ix-btn--gold"
          disabled={busy || !nebulaId || (tool === 'giveaways' && !prize.trim()) || (tool === 'buttonRoles' && !roleIds.length)}
          onClick={() => void save()}
        >
          {tool === 'tickets' ? 'Post the button' : tool === 'buttonRoles' ? 'Post' : tool === 'giveaways' ? 'Start giveaway' : 'Save'}
        </button>
      </div>
    </Sheet>
  )
}

export default function ToolsSection({ c, onProblem, onNotice }: { c: ConstellationDetail; onProblem: (m: string) => void; onNotice: (m: string) => void }): React.JSX.Element {
  const [tools, setTools] = useState<Record<ToolName, ToolState> | null>(null)
  const [giveaways, setGiveaways] = useState<Giveaway[]>([])
  const [open, setOpen] = useState<ToolName | null>(null)
  const load = useCallback(() => {
    void call<{ tools: Record<ToolName, ToolState>; giveaways: Giveaway[] }>('GET', `/constellations/${c.id}/tools`).then((r) => {
      if (r.ok) {
        setTools(r.data.tools)
        setGiveaways(r.data.giveaways)
      } else onProblem(r.message)
    })
  }, [c.id, onProblem])
  useEffect(load, [load])
  const toggle = (t: ToolName, on: boolean): void => {
    if (on && t !== 'giveaways' && !Object.keys(tools?.[t].settings ?? {}).length) return setOpen(t)
    void call('PUT', `/constellations/${c.id}/tools/${t}`, { enabled: on }).then((r) => (r.ok ? load() : onProblem(r.message)))
  }
  return (
    <section aria-labelledby="ix-tools" className="ix-section">
      <div>
        <h2 id="ix-tools" className="ix-tools-head">
          Glofly tools
        </h2>
        <p className="ix-muted" style={{ margin: '2px 0 0' }}>
          Built in and free, no bot to invite. They post as “Glofly”.
        </p>
      </div>
      <div className="ix-tools">
        {TILES.map((t) => {
          const s = tools?.[t.id]
          return (
            <div key={t.id} className={s?.enabled ? 'ix-tool ix-tool--on' : 'ix-tool'}>
              <div className="ix-tool-top">
                <b>{t.name}</b>
                <Switch on={!!s?.enabled} label={`${t.name} on`} onChange={(v) => toggle(t.id, v)} />
              </div>
              <span className="ix-muted">{t.text}</span>
              <button type="button" className="ix-link" onClick={() => setOpen(t.id)}>
                {t.link}
              </button>
            </div>
          )
        })}
      </div>
      {giveaways.some((g) => !g.endedAt) && (
        <span className="ix-muted">
          Giveaways running: {giveaways.filter((g) => !g.endedAt).map((g) => `${g.prize} (ends ${new Date(g.endsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })})`).join(', ')}
        </span>
      )}
      {open && tools && (
        <ToolSheet
          c={c}
          tool={open}
          state={tools[open]}
          onClose={() => setOpen(null)}
          onProblem={onProblem}
          onSaved={(m) => {
            setOpen(null)
            onNotice(m)
            load()
          }}
        />
      )}
    </section>
  )
}
