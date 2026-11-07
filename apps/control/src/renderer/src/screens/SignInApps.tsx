import { useCallback, useEffect, useState, type JSX } from 'react'
import { api, type OAuthAppRow } from '../lib/api'
import { ActionDialog, type ActionSpec } from '../components/ActionDialog'
import { Chip } from '../components/common'
import { shortDate } from '../lib/format'

// Communities round (Nov 2026): Sign in with Glofly apps. Since 0.9.0 this is the only place apps are
// made: Sign in with Glofly is only for Glofly's own apps (Gloslate, Tablespin). Edit, new secret,
// switch off (nobody can sign in; tokens stop at once), delete. Not "Made by Glofly" = can't sign in.

const list = (v: string): string[] => v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
const scopesFrom = (v: string): ('email' | 'roles')[] => list(v.toLowerCase()).filter((x): x is 'email' | 'roles' => x === 'email' || x === 'roles')

function appFields(a?: OAuthAppRow): ActionSpec['fields'] {
  return [
    { name: 'name', label: 'App name', maxLength: 40, initial: a?.name ?? '' },
    { name: 'website', label: 'Website (optional)', maxLength: 300, initial: a?.website ?? '' },
    { name: 'privacyUrl', label: 'Privacy policy link', hint: 'People see it on the sign-in page.', maxLength: 300, initial: a?.privacyUrl ?? '' },
    { name: 'termsUrl', label: 'Terms link (optional)', maxLength: 300, initial: a?.termsUrl ?? '' },
    { name: 'redirectUris', label: 'Return addresses', hint: 'Exact, separated by spaces: https://…, or the phone app’s own like tabitat://auth/glofly', maxLength: 2000, initial: a?.redirectUris.join(' ') ?? '' },
    { name: 'scopes', label: 'Also ask for (optional)', hint: 'email and/or roles. Name and photo always.', maxLength: 20, initial: a?.scopes.join(' ') ?? '' }
  ]
}

export function SignInApps({ toast }: { toast: (message: string, bad?: boolean) => void }): JSX.Element {
  const [apps, setApps] = useState<OAuthAppRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionSpec | null>(null)
  const [shown, setShown] = useState<{ name: string; clientId?: string; secret: string | null } | null>(null)
  const make = (confidential: boolean): void =>
    setAction({
      title: confidential ? 'New server app' : 'New phone or browser app',
      intro: confidential
        ? 'A website with its own server. It gets a client secret, shown once.'
        : 'A phone app or a site without a server (like Gloslate’s phone app). No secret; it signs in with PKCE.',
      confirmLabel: 'Make app',
      fields: appFields(),
      run: async (v, note) => {
        const r = await api.newOAuthApp({
          name: v.name,
          website: v.website || null,
          privacyUrl: v.privacyUrl,
          termsUrl: v.termsUrl || null,
          redirectUris: list(v.redirectUris),
          scopes: scopesFrom(v.scopes),
          confidential,
          note
        })
        if (!r.ok) return r
        setShown({ name: r.data.app.name, clientId: r.data.app.clientId, secret: r.data.secret })
        return { ok: true as const, data: { message: `${r.data.app.name} is ready.` } }
      }
    })
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
            Glofly’s own apps (like Gloslate and Tablespin) that people sign in to with Glofly. Only made here: Sign in with Glofly isn’t offered
            to other developers.
          </p>
        </div>
        <div className="row-actions">
          <button type="button" className="btn btn--primary" onClick={() => make(false)}>
            New phone or browser app
          </button>
          <button type="button" className="btn" onClick={() => make(true)}>
            New server app
          </button>
        </div>
      </header>
      {shown && (
        <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }} role="status">
          <strong>{shown.name}</strong>
          {shown.clientId && (
            <div>
              Client ID (not secret): <code>{shown.clientId}</code>{' '}
              <button type="button" className="btn btn--small" onClick={() => void navigator.clipboard.writeText(shown.clientId!)}>
                Copy
              </button>
            </div>
          )}
          {shown.secret ? (
            <div>
              Client secret, <b>shown only now</b>: <code>{shown.secret}</code>{' '}
              <button type="button" className="btn btn--small" onClick={() => void navigator.clipboard.writeText(shown.secret!)}>
                Copy
              </button>
              <div className="muted" style={{ fontSize: 12 }}>
                Keep it on the app’s server, never in a phone app or a web page.
              </div>
            </div>
          ) : (
            <div className="muted">No secret: it signs in with PKCE.</div>
          )}
          <div>
            <button type="button" className="btn btn--small" onClick={() => setShown(null)}>
              I’ve copied it
            </button>
          </div>
        </section>
      )}
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
                      {a.privacyUrl ? <>Privacy: {a.privacyUrl}</> : 'No privacy policy link'}
                      {!a.firstParty && ' · can’t sign anyone in (not marked Glofly’s own)'}
                    </div>
                  </td>
                  <td>{a.owner ? `@${a.owner}` : 'Glofly Control'}</td>
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
                            title: `Edit ${a.name}`,
                            intro: 'Changes apply to the next sign-in. Return addresses must match exactly.',
                            confirmLabel: 'Save',
                            fields: appFields(a),
                            run: (v, note) =>
                              api.setOAuthApp(a.id, {
                                name: v.name,
                                website: v.website || null,
                                privacyUrl: v.privacyUrl || null,
                                termsUrl: v.termsUrl || null,
                                redirectUris: list(v.redirectUris),
                                scopes: scopesFrom(v.scopes),
                                note
                              })
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() =>
                          setAction({
                            title: a.confidential ? `New secret for ${a.name}` : `Give ${a.name} a secret`,
                            intro: a.confidential
                              ? 'The old secret stops working at once. Put the new one on the app’s server.'
                              : 'This turns it into a server app: its phone app can’t sign in any more without a secret.',
                            confirmLabel: 'Make a new secret',
                            danger: !a.confidential,
                            run: async (_v, note) => {
                              const r = await api.newOAuthSecret(a.id, note)
                              if (!r.ok) return r
                              setShown({ name: a.name, secret: r.data.secret })
                              return { ok: true as const, data: { message: 'New secret made.' } }
                            }
                          })
                        }
                      >
                        Secret
                      </button>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() =>
                          setAction({
                            title: a.firstParty ? `Unmark ${a.name}` : `Mark ${a.name} as Glofly's own`,
                            intro: a.firstParty
                              ? 'Only Glofly’s own apps can sign people in, so unmarking it stops all sign-ins with it.'
                              : 'Marks it as one of your apps, so people can sign in with it again.',
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
                            fields: a.disabled ? undefined : [{ name: 'reason', label: 'Reason', maxLength: 200 }],
                            run: (v, note) => api.setOAuthApp(a.id, { disabled: !a.disabled, reason: v.reason || undefined, note })
                          })
                        }
                      >
                        {a.disabled ? 'Switch on' : 'Switch off'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--small btn--danger"
                        onClick={() =>
                          setAction({
                            title: `Delete ${a.name}`,
                            intro: 'Everyone is signed out of it and it can’t be brought back. Its client ID stops working for good.',
                            confirmLabel: 'Delete',
                            danger: true,
                            run: (_v, note) => api.deleteOAuthApp(a.id, note)
                          })
                        }
                      >
                        Delete
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
