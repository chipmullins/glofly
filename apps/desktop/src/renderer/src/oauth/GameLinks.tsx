import { useCallback, useEffect, useRef, useState } from 'react'
import { GAME_LINK_GAMES, normalizeLinkCode, type ApiResult, type GameLinkGame, type GameLinkPreview, type LinkedGameServer } from '@glofly/shared'
import '../constellations/Integrations.css'
import './AppsSettings.css'

// Communities round (Nov 2026): Settings → Linked game servers + Enter a code (approved canvas
// boards 7 and 8). Through window.glofly.apps.request (it lets /account/game-links… through).

const call = <T,>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<ApiResult<T>> =>
  window.glofly.apps.request<T>(method, path, body)

export const GAME_LOOK: Record<GameLinkGame, { badge: string; color: string }> = {
  fivem: { badge: 'FiveM', color: '#c2410c' },
  redm: { badge: 'RedM', color: '#9f1239' },
  minecraft: { badge: 'MC', color: '#15803d' }
}

const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const ago = (iso: string | null): string => {
  if (!iso) return 'no joins yet'
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 3600) return `last join ${Math.max(1, Math.floor(s / 60))} min ago`
  if (s < 86_400) return `last join ${Math.floor(s / 3600)} h ago`
  if (s < 2 * 86_400) return 'last join yesterday'
  return `last join ${day(iso)}`
}

export function GameServersIcon({ active }: { active: boolean }): React.JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ stroke: active ? 'var(--glo-link)' : 'currentColor' }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="7" width="19" height="11" rx="5" />
      <path d="M7 11v3M5.5 12.5h3M15.5 12h.01M18 14h.01" />
    </svg>
  )
}

function GameBadge({ game, size = 40 }: { game: GameLinkGame; size?: number }): React.JSX.Element {
  const look = GAME_LOOK[game]
  return (
    <span className="gl-badge" style={{ width: size, height: size, background: look.color }} aria-hidden="true">
      {look.badge}
    </span>
  )
}

function EnterCode({ onClose, onLinked }: { onClose: () => void; onLinked: (serverName: string) => void }): React.JSX.Element {
  const [value, setValue] = useState('')
  const [preview, setPreview] = useState<GameLinkPreview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
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
  const digits = value.replace(/\D/g, '').slice(0, 6)
  const code = normalizeLinkCode(digits)

  const next = async (): Promise<void> => {
    if (!code) return
    setBusy(true)
    setProblem(null)
    const r = await call<{ preview: GameLinkPreview }>('POST', '/account/game-links/preview', { code })
    setBusy(false)
    if (r.ok) setPreview(r.data.preview)
    else setProblem(r.message)
  }
  const link = async (): Promise<void> => {
    setBusy(true)
    const r = await call<{ serverName: string }>('POST', '/account/game-links', { code })
    setBusy(false)
    if (r.ok) onLinked(r.data.serverName)
    else setProblem(r.message)
  }

  return (
    <div className="ix-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Link a game server" className="ix-sheet gl-sheet">
        {!preview ? (
          <>
            <h2 className="ix-sheet-title">Link a game server</h2>
            <p className="ix-text">Type the code the game is showing you.</p>
            <label className="gl-code" onClick={() => input.current?.focus()}>
              <span className="gl-visually-hidden">Code</span>
              <input
                ref={input}
                autoFocus
                className="gl-code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value.replace(/[^\d-\s]/g, '').slice(0, 7))
                  setProblem(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && void next()}
              />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="gl-digit-wrap">
                  {i === 3 && (
                    <span className="gl-dash" aria-hidden="true">
                      –
                    </span>
                  )}
                  <span className={i === digits.length ? 'gl-digit gl-digit--at' : 'gl-digit'} aria-hidden="true">
                    {digits[i] ?? ''}
                  </span>
                </span>
              ))}
            </label>
            <span className="ix-muted gl-center">Codes work once, for 10 minutes.</span>
            {problem && <p className="cx-error">{problem}</p>}
            <div className="ix-actions">
              <button type="button" className="ix-btn" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="ix-btn ix-btn--gold" disabled={!code || busy} onClick={() => void next()}>
                Next
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="gl-head">
              <GameBadge game={preview.game} size={48} />
              <h2 className="ix-sheet-title">Link to {preview.serverName}?</h2>
            </div>
            <div className="gl-facts">
              <span>
                <span className="ix-muted">Constellation ·</span> {preview.constellationName}{' '}
                <span className="ix-muted">{preview.member ? "(you're a member)" : "(you're not a member yet)"}</span>
              </span>
              <span>
                <span className="ix-muted">Joining as ·</span> {preview.playerName} <span className="ix-muted">on {GAME_LINK_GAMES[preview.game]}</span>
              </span>
              <span>
                <span className="ix-muted">It will see ·</span> your Glofly name and your roles in {preview.constellationName}
              </span>
            </div>
            {preview.replaces && (
              <p className="ix-text">
                This replaces your link to the player <b>{preview.replaces}</b> (one player per Glofly account on each server).
              </p>
            )}
            {!preview.member && <p className="cx-error">Join {preview.constellationName} on Glofly first, then type the code again.</p>}
            <p className="ix-text">Only link if you're joining this server right now. Nobody from Glofly or the server will ever ask you for this code in a chat.</p>
            {problem && <p className="cx-error">{problem}</p>}
            <div className="ix-actions">
              <button type="button" className="ix-btn" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="ix-btn ix-btn--gold" disabled={busy || !preview.member} onClick={() => void link()}>
                Link
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function GameServersSettings(): React.JSX.Element {
  const [servers, setServers] = useState<LinkedGameServer[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [entering, setEntering] = useState(false)
  const load = useCallback(() => {
    void call<{ servers: LinkedGameServer[] }>('GET', '/account/game-links').then((r) => {
      if (r.ok) setServers(r.data.servers)
      else setProblem(r.message)
    })
  }, [])
  useEffect(load, [load])
  return (
    <section className="settings-section">
      <div className="gl-title">
        <h2>Linked game servers</h2>
        <button type="button" className="ix-btn ix-btn--gold" onClick={() => setEntering(true)}>
          Enter a code
        </button>
      </div>
      <p className="ix-text">Game servers that let you in with your Glofly account. Each one only sees your Glofly name and your roles in its constellation.</p>
      {notice && (
        <p className="gl-notice" role="status">
          {notice}
        </p>
      )}
      {problem && <p className="cx-error">{problem}</p>}
      {servers?.length === 0 && <p className="ix-empty">No game servers yet. When a server asks you to link your Glofly account, press Enter a code.</p>}
      {servers?.map((s) => (
        <div key={s.id} className="ix-card">
          <GameBadge game={s.game} />
          <div className="ix-card-main">
            <div className="ix-card-title">
              <b>{s.serverName}</b>
            </div>
            <span className="ix-muted">
              Playing as {s.playerName} · {s.roles.length ? `${s.roles.length === 1 ? 'role' : 'roles'} ${s.roles.join(', ')}` : 'no roles'}
            </span>
            <span className="ix-muted">
              Linked {day(s.createdAt)} · {ago(s.lastUsedAt)}
            </span>
          </div>
          <button
            type="button"
            className="ix-btn ix-btn--small ix-btn--danger"
            onClick={() =>
              void call('DELETE', `/account/game-links/${s.id}`).then((r) => {
                if (r.ok) load()
                else setProblem(r.message)
              })
            }
          >
            Unlink
          </button>
        </div>
      ))}
      <p className="ix-text">Unlinking means the server can't look you up any more; you'll be asked for a new code next time you join. Your characters and progress stay on the game server.</p>
      {entering && (
        <EnterCode
          onClose={() => setEntering(false)}
          onLinked={(name) => {
            setEntering(false)
            setNotice(`Linked to ${name}. Go back to the game: you'll join in a moment.`)
            load()
          }}
        />
      )}
    </section>
  )
}
