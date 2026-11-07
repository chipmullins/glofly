import { useEffect, useState } from 'react'
import type { OAuthRequestInfo, PublicUser } from '@glofly/shared'
import Avatar from '../components/Avatar'
import { web } from '../lib/platform'

/** "Cozy RP Website" → "CR" */
const initialsOf = (name: string): string =>
  (name.trim().split(/\s+/).length > 1 ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') : name.slice(0, 2)).toUpperCase()
import './OAuthConsent.css'

// Communities round (Nov 2026): the Sign in with Glofly consent page (approved canvas board 5),
// in Glofly in a browser only. chat.glofly.app/oauth/authorize?… keeps the request for this tab
// (apps/web install.ts); once you're signed in, this asks. Allow / Cancel send you back to the app
// at the address the server built (one the app registered). The page can't be shown in a frame
// (Caddy: frame-ancestors 'none'), so nobody can trick you into clicking Allow.

const KEY = 'glofly.oauthRequest'

/** The waiting sign-in request, if this tab has one. */
export function pendingOAuth(): string | null {
  if (!web?.oauth) return null
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

function done(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // nothing to clear
  }
}

export default function OAuthConsent({ me, query, onClose }: { me: Pick<PublicUser, 'id' | 'username' | 'displayName' | 'avatarVersion'>; query: string; onClose: () => void }): React.JSX.Element | null {
  const [info, setInfo] = useState<OAuthRequestInfo | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [email, setEmail] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void web!.oauth!.request(query).then((r) => {
      if (!r.ok) setProblem(r.message)
      else {
        setInfo(r.data)
        setPicked(r.data.constellations.filter((c) => c.picked).map((c) => c.id))
      }
    })
  }, [query])
  const go = (redirect: string): void => {
    done()
    window.location.assign(redirect)
  }
  const close = (): void => {
    done()
    onClose()
  }
  if (problem) {
    return (
      <div className="oc-backdrop">
        <main className="oc-card" role="dialog" aria-modal="true" aria-labelledby="oc-title">
          <h1 id="oc-title" className="oc-title">Couldn&apos;t sign you in</h1>
          <p className="oc-text">{problem}</p>
          <button type="button" className="oc-btn oc-btn--gold" onClick={close}>
            OK
          </button>
        </main>
      </div>
    )
  }
  if (!info) return null
  const wantsEmail = info.scopes.includes('email')
  const wantsRoles = info.scopes.includes('roles')
  return (
    <div className="oc-backdrop">
      <main className="oc-card" role="dialog" aria-modal="true" aria-labelledby="oc-title">
        <div className="oc-pair" aria-hidden="true">
          <span className="oc-app">{initialsOf(info.app.name)}</span>
          <span className="oc-dots" />
          <span className="oc-glofly">
            <span />
          </span>
        </div>
        <h1 id="oc-title" className="oc-title">
          {info.app.name} wants to use your Glofly account
        </h1>
        {info.app.firstParty && <span className="oc-made">Made by Glofly</span>}
        <div className="oc-me">
          <Avatar id={me.id} name={me.displayName} avatarVersion={me.avatarVersion} size={36} />
          <span className="oc-me-names">
            <b>{me.displayName}</b>
            <span>@{me.username}</span>
          </span>
        </div>
        <div className="oc-gets">
          <span className="oc-caps">It will get</span>
          <label className="oc-check">
            <input type="checkbox" checked disabled />
            Your Glofly name and photo
          </label>
          {wantsRoles &&
            info.constellations.map((c) => (
              <label key={c.id} className="oc-check">
                <input
                  type="checkbox"
                  checked={picked.includes(c.id)}
                  onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                />
                Your roles in <b>{c.name}</b>
              </label>
            ))}
          {wantsEmail && (
            <label className="oc-check">
              <input type="checkbox" checked={email} onChange={() => setEmail((v) => !v)} />
              Your email address <span className="oc-muted">(optional)</span>
            </label>
          )}
          <span className="oc-muted">It never sees your messages, friends or password.</span>
        </div>
        <div className="oc-buttons">
          <button
            type="button"
            className="oc-btn"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void web!.oauth!.deny(query).then((r) => (r.ok ? go(r.data.redirect) : close()))
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="oc-btn oc-btn--gold"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void web!.oauth!.approve(query, { email, constellationIds: picked }).then((r) => {
                if (r.ok) go(r.data.redirect)
                else {
                  setBusy(false)
                  setProblem(r.message)
                }
              })
            }}
          >
            {info.allowedBefore ? 'Continue' : 'Allow'}
          </button>
        </div>
        <span className="oc-foot">
          {info.app.firstParty ? '' : `Made by ${(info.app.madeBy ?? 'someone else').replace(/^https:\/\//, '')}, not by Glofly. `}
          {info.app.privacyUrl && (
            <>
              {info.app.name}&apos;s{' '}
              <a href={info.app.privacyUrl} target="_blank" rel="noreferrer noopener">
                privacy policy
              </a>
              {info.app.termsUrl && (
                <>
                  {' '}and{' '}
                  <a href={info.app.termsUrl} target="_blank" rel="noreferrer noopener">
                    terms
                  </a>
                </>
              )}{' '}
              say how it uses your info.{' '}
            </>
          )}
          Disconnect it any time in Settings → Connected apps.
        </span>
      </main>
    </div>
  )
}
