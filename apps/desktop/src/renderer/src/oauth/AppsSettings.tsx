import { useCallback, useEffect, useState } from 'react'
import { type ApiResult, type ConnectedApp } from '@glofly/shared'
import '../constellations/Integrations.css'

/** "Cozy RP Website" → "CR" */
const initialsOf = (name: string): string =>
  (name.trim().split(/\s+/).length > 1 ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') : name.slice(0, 2)).toUpperCase()
import './AppsSettings.css'
import ConfirmDialog from '../components/ConfirmDialog'

// Communities round (Nov 2026): Settings → Connected apps and Developer (Sign in with Glofly;
// approved canvas boards 6 and 10). Through window.glofly.apps.request, which only lets
// /account/connected-apps… and /developer/apps… through.

const call = <T,>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<ApiResult<T>> =>
  window.glofly.apps.request<T>(method, path, body)

const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const ago = (iso: string | null): string => {
  if (!iso) return 'not used yet'
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 3600) return `used ${Math.max(1, Math.floor(s / 60))} min ago`
  if (s < 86_400) return `used ${Math.floor(s / 3600)} h ago`
  return `used ${day(iso)}`
}

export function AppsIcon({ active }: { active: boolean }): React.JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ stroke: active ? 'var(--glo-link)' : 'currentColor' }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <path d="M17.5 14v7M14 17.5h7" />
    </svg>
  )
}

const what = (a: ConnectedApp): string => {
  const parts = ['name and photo']
  if (a.scopes.includes('email')) parts.push('email')
  if (a.scopes.includes('roles') && a.constellations.length) parts.push(`your roles in ${a.constellations.join(', ')}`)
  return parts.join(', ')
}

export function ConnectedAppsSettings(): React.JSX.Element {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [asking, setAsking] = useState<ConnectedApp | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    void call<{ apps: ConnectedApp[] }>('GET', '/account/connected-apps').then((r) => {
      if (r.ok) setApps(r.data.apps)
      else setProblem(r.message)
    })
  }, [])
  useEffect(load, [load])
  return (
    <section className="settings-section">
      <h2>Connected apps</h2>
      <p className="ix-text">Sites and apps you signed in to with Glofly. They only get what you allowed, and never your messages, friends or password.</p>
      {problem && <p className="cx-error">{problem}</p>}
      {apps?.length === 0 && <p className="ix-empty">No apps yet. When a site offers “Sign in with Glofly”, it shows up here.</p>}
      {apps?.map((a) => (
        <div key={a.appId} className="ix-card">
          <span className="as-icon" aria-hidden="true">
            {initialsOf(a.name)}
          </span>
          <div className="ix-card-main">
            <div className="ix-card-title">
              <b>{a.name}</b>
              {a.firstParty && <span className="as-made">Made by Glofly</span>}
              {a.website && <span className="ix-muted">· {a.website.replace(/^https:\/\//, '')}</span>}
            </div>
            <span className="ix-muted">Can see: {what(a)}</span>
            <span className="ix-muted">
              Allowed {day(a.since)} · {ago(a.lastUsedAt)}
            </span>
          </div>
          <button
            type="button"
            className="ix-btn ix-btn--small ix-btn--danger"
            onClick={() => setAsking(a)}
          >
            Disconnect
          </button>
        </div>
      ))}
      {asking && (
        <ConfirmDialog
          title={`Disconnect ${asking.name}?`}
          message={`${asking.name} is signed out of your Glofly account straight away. To use it with Glofly again you'll sign in again.`}
          confirmLabel="Disconnect"
          danger
          busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            setBusy(true)
            void call('DELETE', `/account/connected-apps/${asking.appId}`).then((r) => {
              setBusy(false)
              setAsking(null)
              if (r.ok) load()
              else setProblem(r.message)
            })
          }}
        />
      )}
      <p className="ix-text">Disconnecting signs the app out of your Glofly account straight away. Its own account on its site stays, so ask the site if you want that deleted too.</p>
    </section>
  )
}
