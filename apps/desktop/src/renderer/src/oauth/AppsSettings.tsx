import { useCallback, useEffect, useState } from 'react'
import {
  DEVELOPER_TERMS_URL,
  DEVELOPER_TERMS_VERSION,
  OAUTH_OPTIONAL_SCOPES,
  redirectUriProblem,
  type ApiResult,
  type ConnectedApp,
  type DeveloperApp
} from '@glofly/shared'
import '../constellations/Integrations.css'

/** "Cozy RP Website" → "CR" */
const initialsOf = (name: string): string =>
  (name.trim().split(/\s+/).length > 1 ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') : name.slice(0, 2)).toUpperCase()
import './AppsSettings.css'

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

export function DeveloperIcon({ active }: { active: boolean }): React.JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ stroke: active ? 'var(--glo-link)' : 'currentColor' }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
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
            onClick={() =>
              void call('DELETE', `/account/connected-apps/${a.appId}`).then((r) => {
                if (r.ok) load()
                else setProblem(r.message)
              })
            }
          >
            Disconnect
          </button>
        </div>
      ))}
      <p className="ix-text">Disconnecting signs the app out of your Glofly account straight away. Its own account on its site stays, so ask the site if you want that deleted too.</p>
    </section>
  )
}

function AppForm({
  app,
  onSaved,
  onCancel
}: {
  app: DeveloperApp | null
  onSaved: (secret: string | null) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState(app?.name ?? '')
  const [website, setWebsite] = useState(app?.website ?? '')
  const [privacyUrl, setPrivacyUrl] = useState(app?.privacyUrl ?? '')
  const [termsUrl, setTermsUrl] = useState(app?.termsUrl ?? '')
  const termsDue = !app || app.devTermsVersion !== DEVELOPER_TERMS_VERSION
  const [agree, setAgree] = useState(false)
  const [uris, setUris] = useState((app?.redirectUris ?? []).join('\n'))
  const [scopes, setScopes] = useState<('email' | 'roles')[]>(app?.scopes ?? [])
  const [confidential, setConfidential] = useState(app?.confidential ?? true)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    const list = uris.split(/\s+/).filter(Boolean)
    const bad = list.map(redirectUriProblem).find((p) => p)
    if (bad) return setProblem(bad)
    setBusy(true)
    const body = {
      name,
      website: website.trim() || null,
      privacyUrl: privacyUrl.trim() || null,
      termsUrl: termsUrl.trim() || null,
      redirectUris: list,
      scopes,
      ...(app ? {} : { confidential }),
      ...(agree ? { agreeTerms: true } : {})
    }
    const r = await call<{ app: DeveloperApp; secret?: string | null }>(app ? 'PATCH' : 'POST', app ? `/developer/apps/${app.id}` : '/developer/apps', body)
    setBusy(false)
    if (!r.ok) return setProblem(r.message)
    onSaved(r.data.secret ?? null)
  }
  return (
    <div className="ix-card as-form">
      <div className="ix-card-main">
        <div className="ix-grid2">
          <label className="ix-field">
            App name
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Gloslate" />
          </label>
          <label className="ix-field">
            Website (optional)
            <input value={website} maxLength={200} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" />
          </label>
        </div>
        <div className="ix-grid2">
          <label className="ix-field">
            Privacy policy link
            <input value={privacyUrl} maxLength={300} onChange={(e) => setPrivacyUrl(e.target.value)} placeholder="https://example.com/privacy" />
          </label>
          <label className="ix-field">
            Terms link (optional)
            <input value={termsUrl} maxLength={300} onChange={(e) => setTermsUrl(e.target.value)} placeholder="https://example.com/terms" />
          </label>
        </div>
        <label className="ix-field">
          Return addresses (exact; https, or your phone app&apos;s own like gloslate://auth; one per line)
          <textarea className="as-textarea" rows={3} value={uris} onChange={(e) => setUris(e.target.value)} placeholder="https://example.com/auth/glofly/callback" />
        </label>
        <fieldset className="ix-chips">
          <legend>It may ask for (name and photo always)</legend>
          {OAUTH_OPTIONAL_SCOPES.map((s) => {
            const on = scopes.includes(s.id)
            return (
              <button key={s.id} type="button" aria-pressed={on} title={s.what} className={on ? 'ix-chip ix-chip--on' : 'ix-chip'} onClick={() => setScopes(on ? scopes.filter((x) => x !== s.id) : [...scopes, s.id])}>
                {s.name}
              </button>
            )
          })}
        </fieldset>
        {!app && (
          <fieldset className="ix-chips">
            <legend>Kind of app</legend>
            <button type="button" aria-pressed={confidential} className={confidential ? 'ix-chip ix-chip--on' : 'ix-chip'} onClick={() => setConfidential(true)}>
              A website with its own server (gets a client secret)
            </button>
            <button type="button" aria-pressed={!confidential} className={!confidential ? 'ix-chip ix-chip--on' : 'ix-chip'} onClick={() => setConfidential(false)}>
              A phone app or browser-only site (no secret, PKCE)
            </button>
          </fieldset>
        )}
        {termsDue && (
          <label className="as-agree">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>
              I agree to the{' '}
              <a href={DEVELOPER_TERMS_URL} target="_blank" rel="noreferrer">
                Glofly Developer Terms
              </a>
              {app ? ' (updated since you made this app)' : ''}. People see the privacy policy link when they sign in.
            </span>
          </label>
        )}
        {problem && <p className="cx-error">{problem}</p>}
        <div className="ix-actions">
          <button type="button" className="ix-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="ix-btn ix-btn--gold"
            disabled={busy || !name.trim() || !uris.trim() || !privacyUrl.trim() || (!app && !agree)}
            onClick={() => void save()}
          >
            {app ? 'Save' : 'Make app'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DeveloperSettings(): React.JSX.Element {
  const [apps, setApps] = useState<DeveloperApp[] | null>(null)
  const [editing, setEditing] = useState<DeveloperApp | 'new' | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const load = useCallback(() => {
    void call<{ apps: DeveloperApp[] }>('GET', '/developer/apps').then((r) => {
      if (r.ok) setApps(r.data.apps)
      else setProblem(r.message)
    })
  }, [])
  useEffect(load, [load])
  return (
    <section className="settings-section">
      <div className="ix-section-head">
        <h2 style={{ flex: 1 }}>Developer</h2>
        {editing === null && (
          <button type="button" className="ix-btn ix-btn--gold" onClick={() => setEditing('new')}>
            + New app
          </button>
        )}
      </div>
      <p className="ix-text">
        Let people sign in to your site or app with Glofly (OAuth 2.0 + OpenID Connect, with PKCE). Discovery:{' '}
        <code className="ix-code">{(window.glofly.web?.apiUrl ?? 'https://api.glofly.app') + '/.well-known/openid-configuration'}</code>. Bots and game servers
        use a constellation&apos;s Integrations page instead.{' '}
        <a href={(window.glofly.web?.apiUrl ?? 'https://api.glofly.app') + '/docs/api#signin'} target="_blank" rel="noreferrer">
          Read the API docs
        </a>
      </p>
      {problem && <p className="cx-error">{problem}</p>}
      {secret && (
        <div className="ix-card as-secret">
          <div className="ix-card-main">
            <b>Copy your client secret now</b>
            <span className="ix-muted">This is the only time Glofly shows it. Keep it on your server, never in a phone app or a web page.</span>
            <div className="ix-secret">
              <code>{secret}</code>
              <button type="button" className="ix-copy" onClick={() => void navigator.clipboard.writeText(secret)}>
                Copy
              </button>
            </div>
            <div className="ix-actions">
              <button type="button" className="ix-btn ix-btn--gold" onClick={() => setSecret(null)}>
                I&apos;ve copied it
              </button>
            </div>
          </div>
        </div>
      )}
      {editing === 'new' && (
        <AppForm
          app={null}
          onCancel={() => setEditing(null)}
          onSaved={(s) => {
            setEditing(null)
            setSecret(s)
            load()
          }}
        />
      )}
      {apps?.length === 0 && editing === null && <p className="ix-empty">No apps yet.</p>}
      {apps?.map((a) =>
        editing !== 'new' && editing?.id === a.id ? (
          <AppForm
            key={a.id}
            app={a}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              load()
            }}
          />
        ) : (
          <div key={a.id} className="ix-card">
            <span className="as-icon" aria-hidden="true">
              {initialsOf(a.name)}
            </span>
            <div className="ix-card-main">
              <div className="ix-card-title">
                <b>{a.name}</b>
                {a.firstParty && <span className="as-made">Made by Glofly</span>}
                <span className={a.disabled ? 'ix-bad' : 'ix-good'}>{a.disabled ? 'Switched off by the Glofly team' : 'Active'}</span>
              </div>
              <span className="ix-muted">
                Client ID <code className="ix-code">{a.clientId}</code> · {a.confidential ? 'has a client secret' : 'phone/browser app (PKCE, no secret)'} · {a.people}{' '}
                {a.people === 1 ? 'person' : 'people'} connected
              </span>
              <div className="ix-pills">
                {a.redirectUris.map((u) => (
                  <span key={u} className="ix-pill">
                    {u}
                  </span>
                ))}
                {a.scopes.map((s) => (
                  <span key={s} className="ix-pill">
                    {OAUTH_OPTIONAL_SCOPES.find((x) => x.id === s)?.name}
                  </span>
                ))}
              </div>
              {a.disabled && a.disabledReason && <span className="ix-bad">{a.disabledReason}</span>}
            </div>
            <div className="ix-card-buttons">
              <button type="button" className="ix-btn ix-btn--small" onClick={() => setEditing(a)}>
                Edit
              </button>
              <button
                type="button"
                className="ix-btn ix-btn--small"
                onClick={() =>
                  void call<{ secret: string }>('POST', `/developer/apps/${a.id}/secret`).then((r) => {
                    if (r.ok) {
                      setSecret(r.data.secret)
                      load()
                    } else setProblem(r.message)
                  })
                }
              >
                {a.confidential ? 'New secret' : 'Add a secret'}
              </button>
              <button
                type="button"
                className="ix-btn ix-btn--small ix-btn--danger"
                onClick={() =>
                  void call('DELETE', `/developer/apps/${a.id}`).then((r) => {
                    if (r.ok) load()
                    else setProblem(r.message)
                  })
                }
              >
                Delete
              </button>
            </div>
          </div>
        )
      )}
    </section>
  )
}
