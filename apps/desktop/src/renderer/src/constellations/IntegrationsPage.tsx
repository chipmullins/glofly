import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  API_KEY_LIFETIMES,
  INTEGRATION_SCOPES,
  WEBHOOK_EVENTS,
  apiKeyShown,
  type ApiKeyInfo,
  type ApiKeyLifetime,
  type ConstellationDetail,
  type IntegrationActivity,
  type IntegrationScope,
  type WebhookEvent,
  type WebhookInfo
} from '@glofly/shared'
import { integrations, type KeyFields } from '../lib/integrations'
import './Integrations.css'
import ToolsSection from './ToolsSection'

// Communities round (Nov 2026): constellation settings → Integrations, drawn from the approved
// "Glofly communities round" canvas (boards 1–3). Keys, webhook addresses and signing secrets are
// shown once; making or changing anything asks for your password again; the server checks it all.

const ago = (iso: string | null, now: number): string => {
  if (!iso) return 'never used'
  const s = (now - Date.parse(iso)) / 1000
  if (s < 60) return 'used just now'
  if (s < 3600) return `used ${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `used ${Math.floor(s / 3600)} h ago`
  return `used ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}
const when = (iso: string, now: number): string => {
  const s = (now - Date.parse(iso)) / 1000
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const scopeName = (s: IntegrationScope): string => INTEGRATION_SCOPES.find((x) => x.id === s)?.name ?? s

function BotGlyph(): React.JSX.Element {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 4v4M9 13h.01M15 13h.01" />
    </svg>
  )
}

/** A dialog over the settings window. */
export function Sheet({
  title,
  children,
  onClose,
  wide
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
}): React.JSX.Element {
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  return (
    <div className="ix-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={wide ? 'ix-sheet ix-sheet--wide' : 'ix-sheet'}>
        <h2 className="ix-sheet-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <label className="ix-field">
      Your Glofly password, to confirm
      <input type="password" autoComplete="current-password" value={value} maxLength={200} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** "Copy your key now": the one time a secret is shown. */
function ShownOnce({
  title,
  what,
  secret,
  onDone
}: {
  title: string
  what: string
  secret: string
  onDone: () => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <Sheet title={title} onClose={onDone}>
      <p className="ix-text">{what}</p>
      <div className="ix-secret">
        <code>{secret}</code>
        <button
          type="button"
          className="ix-copy"
          onClick={() => {
            void navigator.clipboard.writeText(secret).then(() => setCopied(true))
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="ix-note">
        Treat it like a password: never post it in a chat or put it in a game&apos;s client files. If it leaks, make a new
        one straight away (the old one stops working).
      </p>
      <div className="ix-actions">
        <button type="button" className="ix-btn ix-btn--gold" onClick={onDone}>
          I&apos;ve copied it
        </button>
      </div>
    </Sheet>
  )
}

function NebulaChips({
  c,
  picked,
  onChange,
  label
}: {
  c: ConstellationDetail
  picked: string[]
  onChange: (ids: string[]) => void
  label: string
}): React.JSX.Element {
  const texts = c.nebulas.filter((n) => n.kind === 'text')
  return (
    <fieldset className="ix-chips">
      <legend>{label}</legend>
      {texts.map((n) => {
        const on = picked.includes(n.id)
        return (
          <button
            key={n.id}
            type="button"
            aria-pressed={on}
            className={on ? 'ix-chip ix-chip--on' : 'ix-chip'}
            onClick={() => onChange(on ? picked.filter((x) => x !== n.id) : [...picked, n.id])}
          >
            #{n.name}
          </button>
        )
      })}
    </fieldset>
  )
}

/** Roles I could give the bot: below mine (any for the Owner), not Member, not a pick-it-yourself label. */
function useGivableRoles(c: ConstellationDetail) {
  return useMemo(
    () =>
      c.roles
        .filter((r) => r.kind !== 'member' && r.kind !== 'owner' && !r.selfAssign && (c.me.owner || r.position < c.me.rank))
        .sort((a, b) => b.position - a.position),
    [c]
  )
}

function RoleSelect({
  c,
  value,
  onChange,
  label
}: {
  c: ConstellationDetail
  value: string | null
  onChange: (v: string | null) => void
  label: string
}): React.JSX.Element {
  const roles = useGivableRoles(c)
  return (
    <label className="ix-field">
      {label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Member only</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function KeyDialog({
  c,
  editing,
  onClose,
  onMade,
  onSaved
}: {
  c: ConstellationDetail
  editing: ApiKeyInfo | null
  onClose: () => void
  onMade: (secret: string) => void
  onSaved: () => void
}): React.JSX.Element {
  const [f, setF] = useState<KeyFields>(() => ({
    name: editing?.name ?? '',
    roleId: editing?.roleId ?? null,
    scopes: editing?.scopes ?? ['members:read'],
    postNebulaIds: editing?.postNebulaIds ?? [],
    readNebulaIds: editing?.readNebulaIds ?? [],
    allowedIps: editing?.allowedIps ?? [],
    lifetime: 'never'
  }))
  const [ips, setIps] = useState((editing?.allowedIps ?? []).join(', '))
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const set = <K extends keyof KeyFields>(k: K, v: KeyFields[K]): void => setF((x) => ({ ...x, [k]: v }))
  const toggle = (s: IntegrationScope): void =>
    set('scopes', f.scopes.includes(s) ? f.scopes.filter((x) => x !== s) : [...f.scopes, s])
  const submit = async (): Promise<void> => {
    setBusy(true)
    setProblem(null)
    const fields = {
      ...f,
      allowedIps: ips
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter(Boolean)
    }
    if (editing) {
      const { lifetime: _skip, ...changes } = fields
      void _skip
      const r = await integrations.changeKey(c.id, editing.id, changes, password)
      setBusy(false)
      if (r.ok) onSaved()
      else setProblem(r.message)
    } else {
      const r = await integrations.makeKey(c.id, fields, password)
      setBusy(false)
      if (r.ok) onMade(r.data.secret)
      else setProblem(r.message)
    }
  }
  return (
    <Sheet title={editing ? `Edit ${editing.name}` : 'New API key'} onClose={onClose} wide>
      <div className="ix-grid2">
        <label className="ix-field">
          Bot name (shows in chats)
          <input value={f.name} maxLength={40} onChange={(e) => set('name', e.target.value)} placeholder="Cozy RP Whitelist" />
        </label>
        <RoleSelect c={c} value={f.roleId} onChange={(v) => set('roleId', v)} label="Bot's role" />
      </div>
      <fieldset className="ix-scopes">
        <legend>What it can do</legend>
        {INTEGRATION_SCOPES.map((s) => (
          <label key={s.id} className={f.scopes.includes(s.id) ? 'ix-scope ix-scope--on' : 'ix-scope'}>
            <input type="checkbox" checked={f.scopes.includes(s.id)} onChange={() => toggle(s.id)} />
            <span>
              <b>{s.name}</b>
              <span>{s.what}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {f.scopes.includes('messages:write') && (
        <NebulaChips c={c} picked={f.postNebulaIds} onChange={(v) => set('postNebulaIds', v)} label="Nebulas it can post in" />
      )}
      {f.scopes.includes('messages:read') && (
        <NebulaChips c={c} picked={f.readNebulaIds} onChange={(v) => set('readNebulaIds', v)} label="Nebulas it can read" />
      )}
      <div className="ix-grid2">
        <label className="ix-field">
          Only from these addresses (optional)
          <input value={ips} onChange={(e) => setIps(e.target.value)} placeholder="203.0.113.24" />
        </label>
        {!editing && (
          <label className="ix-field">
            Stops working
            <select value={f.lifetime} onChange={(e) => set('lifetime', e.target.value as ApiKeyLifetime)}>
              {API_KEY_LIFETIMES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <PasswordField value={password} onChange={setPassword} />
      {problem && <p className="cx-error">{problem}</p>}
      <div className="ix-actions">
        <button type="button" className="ix-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="ix-btn ix-btn--gold" disabled={busy || !f.name.trim() || !password} onClick={() => void submit()}>
          {editing ? 'Save' : 'Make key'}
        </button>
      </div>
    </Sheet>
  )
}

/** Asks for the password, then runs `task` with it. */
function Confirm({
  title,
  text,
  action,
  danger,
  needsPassword,
  onClose,
  task
}: {
  title: string
  text: string
  action: string
  danger?: boolean
  needsPassword?: boolean
  onClose: () => void
  task: (password: string) => Promise<string | null>
}): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="ix-text">{text}</p>
      {needsPassword && <PasswordField value={password} onChange={setPassword} />}
      {problem && <p className="cx-error">{problem}</p>}
      <div className="ix-actions">
        <button type="button" className="ix-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? 'ix-btn ix-btn--danger' : 'ix-btn ix-btn--gold'}
          disabled={busy || (needsPassword && !password)}
          onClick={() => {
            setBusy(true)
            void task(password).then((p) => {
              setBusy(false)
              setProblem(p)
            })
          }}
        >
          {action}
        </button>
      </div>
    </Sheet>
  )
}

function HookDialog({
  c,
  kind,
  onClose,
  onMade
}: {
  c: ConstellationDetail
  kind: 'incoming' | 'outgoing'
  onClose: () => void
  onMade: (secret: string, kind: 'incoming' | 'outgoing') => void
}): React.JSX.Element {
  const texts = c.nebulas.filter((n) => n.kind === 'text')
  const [name, setName] = useState('')
  const [nebulaId, setNebulaId] = useState(texts[0]?.id ?? '')
  const [roleId, setRoleId] = useState<string | null>(null)
  const [url, setUrl] = useState('https://')
  const [events, setEvents] = useState<WebhookEvent[]>(['member.joined', 'member.left', 'member.roles'])
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const submit = async (): Promise<void> => {
    setBusy(true)
    setProblem(null)
    if (kind === 'incoming') {
      const r = await integrations.makeIncoming(c.id, { name, nebulaId, roleId }, password)
      setBusy(false)
      if (r.ok) onMade(r.data.url, 'incoming')
      else setProblem(r.message)
    } else {
      const r = await integrations.makeOutgoing(c.id, { name, url, events }, password)
      setBusy(false)
      if (r.ok) onMade(r.data.secret, 'outgoing')
      else setProblem(r.message)
    }
  }
  return (
    <Sheet title={kind === 'incoming' ? 'New incoming webhook' : 'New outgoing webhook'} onClose={onClose}>
      <p className="ix-text">
        {kind === 'incoming'
          ? 'A secret address your server can post to. Messages show up in the nebula you pick, as their own bot.'
          : 'Glofly tells your server when these things happen. Never message contents, only who and their roles.'}
      </p>
      <label className="ix-field">
        {kind === 'incoming' ? 'Posts as' : 'Name'}
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={kind === 'incoming' ? 'Cozy RP Server' : 'Game server events'} />
      </label>
      {kind === 'incoming' ? (
        <div className="ix-grid2">
          <label className="ix-field">
            Nebula
            <select value={nebulaId} onChange={(e) => setNebulaId(e.target.value)}>
              {texts.map((n) => (
                <option key={n.id} value={n.id}>
                  #{n.name}
                </option>
              ))}
            </select>
          </label>
          <RoleSelect c={c} value={roleId} onChange={setRoleId} label="Role (for role-only nebulas)" />
        </div>
      ) : (
        <>
          <label className="ix-field">
            Your server&apos;s address (https)
            <input value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.net/glofly-events" />
          </label>
          <fieldset className="ix-chips">
            <legend>Events</legend>
            {WEBHOOK_EVENTS.map((ev) => {
              const on = events.includes(ev.id)
              return (
                <button
                  key={ev.id}
                  type="button"
                  aria-pressed={on}
                  className={on ? 'ix-chip ix-chip--on' : 'ix-chip'}
                  onClick={() => setEvents(on ? events.filter((x) => x !== ev.id) : [...events, ev.id])}
                >
                  {ev.name}
                </button>
              )
            })}
          </fieldset>
        </>
      )}
      <PasswordField value={password} onChange={setPassword} />
      {problem && <p className="cx-error">{problem}</p>}
      <div className="ix-actions">
        <button type="button" className="ix-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="ix-btn ix-btn--gold" disabled={busy || !name.trim() || !password} onClick={() => void submit()}>
          Make webhook
        </button>
      </div>
    </Sheet>
  )
}

type Open =
  | { kind: 'key'; editing: ApiKeyInfo | null }
  | { kind: 'hook'; hook: 'incoming' | 'outgoing' }
  | { kind: 'secret'; title: string; what: string; secret: string }
  | { kind: 'confirm'; title: string; text: string; action: string; danger?: boolean; needsPassword?: boolean; task: (password: string) => Promise<string | null> }
  | null

export default function IntegrationsPage({
  c,
  onProblem
}: {
  c: ConstellationDetail
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3500)
    return () => clearTimeout(t)
  }, [notice])
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null)
  const [hooks, setHooks] = useState<WebhookInfo[]>([])
  const [log, setLog] = useState<IntegrationActivity[]>([])
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<Open>(null)
  const [now, setNow] = useState(() => Date.now())
  const reload = useCallback(async (): Promise<void> => {
    const [r, a] = await Promise.all([integrations.load(c.id), integrations.activity(c.id)])
    setNow(Date.now())
    if (r.ok) {
      setKeys(r.data.keys)
      setHooks(r.data.hooks)
    } else onProblem(r.message)
    if (a.ok) {
      setLog(a.data.items)
      setMore(a.data.items.length >= 50)
    }
  }, [c.id, onProblem])
  useEffect(() => {
    void reload()
  }, [reload])
  const nebulaName = (id: string | null): string => `#${c.nebulas.find((n) => n.id === id)?.name ?? 'nebula'}`
  const roleName = (id: string | null): string => (id ? (c.roles.find((r) => r.id === id)?.name ?? 'a role') : 'Member')
  const close = (): void => {
    setOpen(null)
    void reload()
  }
  const result = (r: { ok: boolean; message?: string }): string | null => {
    if (r.ok) {
      close()
      return null
    }
    return r.message ?? 'That didn’t work.'
  }

  return (
    <div className="cx-settings-body ix-page">
      <p className="cx-settings-text">
        Connect your game server, a bot or another app to {c.name}. Keys only work for this constellation, Glofly shows each one
        once, and every use is in Activity below.
      </p>

      <ToolsSection c={c} onProblem={onProblem} onNotice={setNotice} />
      {notice && (
        <div role="status" className="ix-toast">
          {notice}
        </div>
      )}

      <section aria-labelledby="ix-keys" className="ix-section">
        <div className="ix-section-head">
          <h2 id="ix-keys">Bots &amp; API keys</h2>
          <button type="button" className="ix-btn ix-btn--gold" onClick={() => setOpen({ kind: 'key', editing: null })}>
            + New API key
          </button>
        </div>
        {keys?.length === 0 && <p className="ix-empty">No keys yet. Make one for your game server&apos;s whitelist script or a bot.</p>}
        {keys?.map((k) => (
          <div key={k.id} className="ix-card">
            <span className="ix-bot" aria-hidden="true">
              <BotGlyph />
            </span>
            <div className="ix-card-main">
              <div className="ix-card-title">
                <b>{k.name}</b>
                <span className="ix-bot-tag">BOT</span>
                <span className="ix-muted">role {roleName(k.roleId)}</span>
              </div>
              <span className="ix-muted">
                <code className="ix-code">{apiKeyShown(k.prefix)}</code> · made {k.createdBy ? `by ${k.createdBy.displayName} ` : ''}
                {new Date(k.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {ago(k.lastUsedAt, now)}
                {k.expiresAt ? ` · stops ${new Date(k.expiresAt).toLocaleDateString()}` : ''}
              </span>
              <div className="ix-pills">
                {k.scopes.length === 0 && <span className="ix-pill">No permissions yet</span>}
                {k.scopes.map((s) => (
                  <span key={s} className="ix-pill">
                    {s === 'messages:write' && k.postNebulaIds.length
                      ? `Post in ${k.postNebulaIds.map(nebulaName).join(', ')}`
                      : s === 'messages:read' && k.readNebulaIds.length
                        ? `Read ${k.readNebulaIds.map(nebulaName).join(', ')}`
                        : scopeName(s)}
                  </span>
                ))}
                {k.allowedIps.length > 0 && <span className="ix-pill">Only from {k.allowedIps.join(', ')}</span>}
              </div>
            </div>
            <div className="ix-card-buttons">
              <button type="button" className="ix-btn ix-btn--small" onClick={() => setOpen({ kind: 'key', editing: k })}>
                Edit
              </button>
              <button
                type="button"
                className="ix-btn ix-btn--small"
                onClick={() =>
                  setOpen({
                    kind: 'confirm',
                    title: `Reset the key for ${k.name}?`,
                    text: 'The old key stops working straight away. You’ll get a new one to paste into your server.',
                    action: 'Reset key',
                    needsPassword: true,
                    task: async (password) => {
                      const r = await integrations.resetKey(c.id, k.id, password)
                      if (!r.ok) return r.message
                      setOpen({ kind: 'secret', title: 'Copy your new key now', what: 'This is the only time Glofly shows it.', secret: r.data.secret })
                      return null
                    }
                  })
                }
              >
                Reset key
              </button>
              <button
                type="button"
                className="ix-btn ix-btn--small ix-btn--danger"
                onClick={() =>
                  setOpen({
                    kind: 'confirm',
                    title: `Delete ${k.name}?`,
                    text: 'The key stops working and its bot leaves the constellation. Its messages stay.',
                    action: 'Delete',
                    danger: true,
                    task: async () => result(await integrations.deleteKey(c.id, k.id))
                  })
                }
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="ix-hooks" className="ix-section">
        <div className="ix-section-head">
          <h2 id="ix-hooks">Webhooks</h2>
          <button type="button" className="ix-btn ix-btn--small" onClick={() => setOpen({ kind: 'hook', hook: 'incoming' })}>
            + Incoming
          </button>
          <button type="button" className="ix-btn ix-btn--small" onClick={() => setOpen({ kind: 'hook', hook: 'outgoing' })}>
            + Outgoing
          </button>
        </div>
        {hooks.length === 0 && <p className="ix-empty">No webhooks yet.</p>}
        <div className="ix-hooks">
          {hooks.map((h) => (
            <div key={h.id} className="ix-hook">
              <span className="ix-eyebrow">{h.kind === 'incoming' ? 'INCOMING · POSTS INTO A NEBULA' : 'OUTGOING · TELLS YOUR SERVER'}</span>
              <b>{h.kind === 'incoming' ? `${h.name} → ${nebulaName(h.nebulaId)}` : h.url}</b>
              <span className="ix-muted">
                {h.kind === 'incoming'
                  ? `Posts as ${h.name} · ${h.lastUsedAt ? `last post ${when(h.lastUsedAt, now).toLowerCase()}` : 'no posts yet'}`
                  : `${h.events.map((e) => WEBHOOK_EVENTS.find((x) => x.id === e)?.name ?? e).join(', ')} · signed (Glofly-Signature) · `}
                {h.kind === 'outgoing' &&
                  (h.disabled ? (
                    <span className="ix-bad">switched off after {h.failures} failures</span>
                  ) : h.lastStatus === null ? (
                    'nothing sent yet'
                  ) : h.lastStatus >= 200 && h.lastStatus < 300 ? (
                    <span className="ix-good">delivered {h.lastUsedAt ? when(h.lastUsedAt, now).toLowerCase() : ''}</span>
                  ) : (
                    <span className="ix-bad">last try failed ({h.lastStatus || 'no answer'})</span>
                  ))}
              </span>
              <div className="ix-hook-buttons">
                {h.kind === 'outgoing' && !h.disabled && (
                  <button
                    type="button"
                    className="ix-btn ix-btn--small"
                    onClick={() =>
                      void integrations.testHook(c.id, h.id).then((r) => {
                        if (!r.ok) onProblem(r.message)
                        else if (!r.data.ok) onProblem(`Your server answered ${r.data.status || 'nothing'} to the test.`)
                        void reload()
                      })
                    }
                  >
                    Send a test
                  </button>
                )}
                {h.kind === 'outgoing' && h.disabled && (
                  <button
                    type="button"
                    className="ix-btn ix-btn--small"
                    onClick={() =>
                      setOpen({
                        kind: 'confirm',
                        title: `Turn ${h.name} back on?`,
                        text: 'Glofly starts sending events to it again.',
                        action: 'Turn on',
                        needsPassword: true,
                        task: async (password) => result(await integrations.changeHook(c.id, h.id, { enabled: true }, password))
                      })
                    }
                  >
                    Turn on
                  </button>
                )}
                <button
                  type="button"
                  className="ix-btn ix-btn--small"
                  onClick={() =>
                    setOpen({
                      kind: 'confirm',
                      title: h.kind === 'incoming' ? `New address for ${h.name}?` : `New signing secret for ${h.name}?`,
                      text: h.kind === 'incoming' ? 'The old address stops working straight away.' : 'Your server needs the new secret to check deliveries.',
                      action: h.kind === 'incoming' ? 'New address' : 'New secret',
                      needsPassword: true,
                      task: async (password) => {
                        const r = await integrations.resetHook(c.id, h.id, password)
                        if (!r.ok) return r.message
                        setOpen({
                          kind: 'secret',
                          title: h.kind === 'incoming' ? 'Copy the new address now' : 'Copy the new secret now',
                          what: 'This is the only time Glofly shows it.',
                          secret: r.data.url ?? r.data.secret ?? ''
                        })
                        return null
                      }
                    })
                  }
                >
                  {h.kind === 'incoming' ? 'New address' : 'New secret'}
                </button>
                <button
                  type="button"
                  className="ix-btn ix-btn--small ix-btn--danger"
                  onClick={() =>
                    setOpen({
                      kind: 'confirm',
                      title: `Delete ${h.name}?`,
                      text: h.kind === 'incoming' ? 'Its address stops working. Messages it posted stay.' : 'Glofly stops sending events to it.',
                      action: 'Delete',
                      danger: true,
                      task: async () => result(await integrations.deleteHook(c.id, h.id))
                    })
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="ix-log" className="ix-section">
        <div className="ix-section-head">
          <h2 id="ix-log">Activity</h2>
        </div>
        {log.length === 0 && <p className="ix-empty">Nothing yet.</p>}
        <ul className="ix-log">
          {log.map((l) => (
            <li key={l.id}>
              <span className="ix-log-when">{when(l.at, now)}</span>
              <span className="ix-log-what">{l.text}</span>
              <span className="ix-muted">{l.from}</span>
            </li>
          ))}
        </ul>
        {more && (
          <button
            type="button"
            className="ix-link"
            onClick={() =>
              void integrations.activity(c.id, log[log.length - 1]?.at).then((r) => {
                if (r.ok) {
                  setLog((x) => [...x, ...r.data.items])
                  setMore(r.data.items.length >= 50)
                }
              })
            }
          >
            See more
          </button>
        )}
      </section>

      {open?.kind === 'key' && (
        <KeyDialog
          c={c}
          editing={open.editing}
          onClose={() => setOpen(null)}
          onSaved={close}
          onMade={(secret) =>
            setOpen({
              kind: 'secret',
              title: 'Copy your key now',
              what: 'This is the only time Glofly shows it. Paste it into your server’s config (for the Glofly Whitelist script: Config.ApiKey). Lost it? Reset the key.',
              secret
            })
          }
        />
      )}
      {open?.kind === 'hook' && (
        <HookDialog
          c={c}
          kind={open.hook}
          onClose={() => setOpen(null)}
          onMade={(secret, kind) =>
            setOpen({
              kind: 'secret',
              title: kind === 'incoming' ? 'Copy the webhook address now' : 'Copy the signing secret now',
              what:
                kind === 'incoming'
                  ? 'Anyone with this address can post in that nebula, so keep it private. POST { "text": "…" } to it.'
                  : 'Your server uses it to check that deliveries really come from Glofly (the Glofly-Signature header).',
              secret
            })
          }
        />
      )}
      {open?.kind === 'secret' && <ShownOnce title={open.title} what={open.what} secret={open.secret} onDone={close} />}
      {open?.kind === 'confirm' && (
        <Confirm
          title={open.title}
          text={open.text}
          action={open.action}
          danger={open.danger}
          needsPassword={open.needsPassword}
          onClose={() => setOpen(null)}
          task={open.task}
        />
      )}
    </div>
  )
}
