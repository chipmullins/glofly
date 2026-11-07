import { useCallback, useEffect, useState, type JSX } from 'react'
import { api, type OAuthAppRow } from '../lib/api'
import { ActionDialog, type ActionSpec } from '../components/ActionDialog'
import { Chip } from '../components/common'
import { shortDate } from '../lib/format'

// Communities round (Nov 2026): Sign in with Glofly apps. Switch any app off (nobody can sign in
// with it; its tokens stop working at once) and mark Glofly's own apps ("Made by Glofly").

export function SignInApps({ toast }: { toast: (message: string, bad?: boolean) => void }): JSX.Element {
  const [apps, setApps] = useState<OAuthAppRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionSpec | null>(null)
  const load = useCallback(() => {
    void api.oauthApps().then((r) => {
      if (r.ok) {
        setApps(r.data.apps)
        setError(null)
      } else setError(r.message)
    })
  }, [])
  useEffect(load, [load])
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Sign-in apps</h1>
          <p className="hint" style={{ margin: 0 }}>
            Sites and apps people sign in to with Glofly. Developers register them in Settings → Developer.
          </p>
        </div>
      </header>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th scope="col">App</th>
                <th scope="col">Made by</th>
                <th scope="col">People</th>
                <th scope="col">Return addresses</th>
                <th scope="col">Since</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {apps?.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No apps yet.
                  </td>
                </tr>
              )}
              {apps?.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.name}</strong> {a.firstParty && <Chip small>Made by Glofly</Chip>} {a.disabled && <Chip small>Switched off</Chip>}
                    <div className="muted" style={{ fontSize: 12 }}>
                      <code>{a.clientId}</code> · {a.confidential ? 'server app' : 'phone/browser app'} · {a.scopes.join(', ') || 'name and photo only'}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {a.privacyUrl ? <>Privacy: {a.privacyUrl}</> : 'No privacy policy link'} ·{' '}
                      {a.devTermsVersion ? `Developer Terms ${a.devTermsVersion} agreed ${shortDate(a.devTermsAcceptedAt ?? a.createdAt)}` : 'Developer Terms not agreed yet'}
                    </div>
                  </td>
                  <td>@{a.owner}</td>
                  <td>{a.people}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {a.redirectUris.join(' · ')}
                  </td>
                  <td className="muted">{shortDate(a.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() =>
                          setAction({
                            title: a.firstParty ? `Unmark ${a.name}` : `Mark ${a.name} as Glofly's own`,
                            intro: a.firstParty
                              ? 'Its consent page goes back to saying who made it.'
                              : 'Its consent page says "Made by Glofly" and leaves out the "not by Glofly" line. Only for apps you run.',
                            confirmLabel: a.firstParty ? 'Unmark' : 'Mark as Glofly’s',
                            run: (_v, note) => api.setOAuthApp(a.id, { firstParty: !a.firstParty, note })
                          })
                        }
                      >
                        {a.firstParty ? 'Unmark' : 'Glofly’s own'}
                      </button>
                      <button
                        type="button"
                        className={a.disabled ? 'btn btn--small' : 'btn btn--small btn--danger'}
                        onClick={() =>
                          setAction({
                            title: a.disabled ? `Switch ${a.name} back on` : `Switch off ${a.name}`,
                            intro: a.disabled
                              ? 'People can sign in with it again.'
                              : 'Nobody can sign in with it, and everyone signed in with it is signed out at once.',
                            confirmLabel: a.disabled ? 'Switch on' : 'Switch off',
                            danger: !a.disabled,
                            fields: a.disabled ? undefined : [{ name: 'reason', label: 'Reason (the developer sees it)', maxLength: 200 }],
                            run: (v, note) => api.setOAuthApp(a.id, { disabled: !a.disabled, reason: v.reason || undefined, note })
                          })
                        }
                      >
                        {a.disabled ? 'Switch on' : 'Switch off'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {action && (
        <ActionDialog
          spec={action}
          onClose={() => setAction(null)}
          onDone={(message) => {
            setAction(null)
            toast(message)
            load()
          }}
        />
      )}
    </>
  )
}
