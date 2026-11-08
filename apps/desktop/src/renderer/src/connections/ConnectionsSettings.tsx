import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ConnectionProvider,
  ConnectionSettings,
  ConnectionsView,
  FriendEntry,
  LinkedAccount
} from '@glofly/shared'
import { Toggle } from '../components/SettingsDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import Avatar from '../components/Avatar'
import {
  changeConnection,
  getConnections,
  SITE_LOOK,
  startLink,
  syncSteam,
  unlink
} from '../lib/connections'
import '../constellations/Integrations.css'
import '../oauth/AppsSettings.css'
import './Connections.css'

// 0.9.3 Settings → Connections (approved canvas "Glofly: forwarding, formatting, live alerts,
// Steam", boards 6 and 8). Linking happens on Steam's, Twitch's and Kick's own sign-in pages in
// the browser; the server tells this page when it's done (connections:changed).

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
function ago(iso: string | null | undefined): string {
  if (!iso) return 'not synced yet'
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 90) return 'synced just now'
  if (s < 3600) return `synced ${Math.floor(s / 60)} minutes ago`
  if (s < 86_400) return `synced ${Math.floor(s / 3600)} h ago`
  return `synced ${day(iso)}`
}

export function ConnectionsIcon({ active }: { active: boolean }): React.JSX.Element {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      style={{ stroke: active ? 'var(--glo-link)' : 'currentColor' }}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </svg>
  )
}

export function SiteBadge({
  site,
  size = 48
}: {
  site: ConnectionProvider
  size?: number
}): React.JSX.Element {
  const look = SITE_LOOK[site]
  return (
    <span
      className="cn-badge"
      style={{
        width: size,
        height: size,
        background: look.color,
        color: look.ink,
        fontSize: size < 40 ? 9 : 11
      }}
      aria-hidden="true"
    >
      {look.badge}
    </span>
  )
}

function Row({
  label,
  desc,
  on,
  onChange
}: {
  label: string
  desc: string
  on: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        <span className="settings-row-desc">{desc}</span>
      </div>
      <Toggle on={on} label={label} onChange={onChange} />
    </div>
  )
}

/** "Only friends I choose": a list of friends with checkboxes. */
function ChooseFriends({
  chosen,
  onChange
}: {
  chosen: string[]
  onChange: (ids: string[]) => void
}): React.JSX.Element {
  const [friends, setFriends] = useState<FriendEntry[] | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    void window.glofly.friends.list().then((r) => r.ok && setFriends(r.data.friends))
  }, [])
  if (!friends) return <p className="ix-muted">Loading your friends…</p>
  if (!friends.length)
    return <p className="ix-muted">Add friends first, then pick who hears about your streams.</p>
  const q = query.trim().toLowerCase()
  const shown = friends.filter(
    (f) => !q || f.displayName.toLowerCase().includes(q) || f.username.toLowerCase().includes(q)
  )
  return (
    <div className="cn-choose">
      <input
        className="cn-search"
        placeholder="Search friends"
        aria-label="Search friends"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="cn-friends" aria-label="Friends who hear when you go live">
        {shown.map((f) => {
          const on = chosen.includes(f.id)
          return (
            <li key={f.id}>
              <label className="cn-friend">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    onChange(on ? chosen.filter((x) => x !== f.id) : [...chosen, f.id])
                  }
                />
                <Avatar id={f.id} name={f.displayName} avatarVersion={f.avatarVersion} size={28} />
                <span className="cn-friend-name">{f.displayName}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <span className="ix-muted">
        {chosen.length === 1 ? '1 friend' : `${chosen.length} friends`} picked
      </span>
    </div>
  )
}

export function ConnectionsSettings(): React.JSX.Element {
  const [view, setView] = useState<ConnectionsView | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<ConnectionProvider | null>(null)
  const [asking, setAsking] = useState<LinkedAccount | null>(null)
  const [busy, setBusy] = useState(false)

  const waitingRef = useRef<ConnectionProvider | null>(null)
  useEffect(() => {
    waitingRef.current = waiting
  })
  const load = useCallback(() => {
    void getConnections().then((r) => {
      if (!r.ok) return setProblem(r.message)
      setView(r.data)
      // Linked in the browser: the waiting line goes once it's there.
      const w = waitingRef.current
      if (w && r.data.accounts.some((a) => a.provider === w)) {
        setNotice(`${SITE_LOOK[w].name} is linked.`)
        setWaiting(null)
      }
    })
  }, [])
  useEffect(() => {
    load()
    return window.glofly.onEvent((e) => {
      if (e.type === 'connections:changed') load()
      if (e.type === 'connection' && e.connected) load()
    })
  }, [load])

  const account = (p: ConnectionProvider): LinkedAccount | undefined =>
    view?.accounts.find((a) => a.provider === p)
  const link = async (p: ConnectionProvider): Promise<void> => {
    setProblem(null)
    setNotice(null)
    const r = await startLink(p)
    if (!r.ok) return setProblem(r.message)
    // Steam's, Twitch's or Kick's own page, in the browser.
    window.open(r.data.url, '_blank', 'noopener,noreferrer')
    setWaiting(p)
  }
  const change = async (
    p: ConnectionProvider,
    settings: Partial<ConnectionSettings>
  ): Promise<void> => {
    // Shown at once; put back if the server says no.
    setView((v) =>
      v
        ? {
            ...v,
            accounts: v.accounts.map((a) =>
              a.provider === p ? { ...a, settings: { ...a.settings, ...settings } } : a
            )
          }
        : v
    )
    const r = await changeConnection(p, settings)
    if (r.ok)
      setView((v) =>
        v ? { ...v, accounts: v.accounts.map((a) => (a.provider === p ? r.data.account : a)) } : v
      )
    else {
      setProblem(r.message)
      load()
    }
  }

  if (!view) {
    return (
      <section className="settings-section">
        <h2>Connections</h2>
        {problem ? <p className="cx-error">{problem}</p> : <p className="ix-muted">Loading…</p>}
      </section>
    )
  }

  const streams = (['twitch', 'kick'] as const).map(account).filter((a): a is LinkedAccount => !!a)
  const steam = account('steam')
  // Twitch and Kick share one set of "when I go live" choices: changing it changes both.
  const live = streams[0]?.settings
  const changeLive = (settings: Partial<ConnectionSettings>): void => {
    for (const a of streams) void change(a.provider, settings)
  }
  const notLinked = (['twitch', 'kick', 'steam'] as const).filter((p) => !account(p))

  return (
    <section className="settings-section cn">
      <div>
        <h2>Connections</h2>
        <p className="ix-text">
          Link where you stream and play. Glofly tells your friends when you go live and fills in My
          games. It never posts anything.
        </p>
      </div>
      {notice && (
        <p className="gl-notice" role="status">
          {notice}
        </p>
      )}
      {problem && <p className="cx-error">{problem}</p>}

      {streams.length > 0 && (
        <div className="settings-card cn-card">
          {streams.map((a) => (
            <div key={a.provider} className="cn-account">
              <SiteBadge site={a.provider} />
              <span className="cn-account-text">
                <b>
                  {SITE_LOOK[a.provider].name} · {a.displayName}
                </b>
                <span className="ix-muted">
                  Linked {day(a.linkedAt)} ·{' '}
                  {a.live ? (
                    <>
                      <b className="cn-live-now">live now</b>
                      {a.live.title ? ` · ${a.live.title}` : ''}
                    </>
                  ) : (
                    'not live'
                  )}
                </span>
              </span>
              <button
                type="button"
                className="ix-btn ix-btn--small ix-btn--danger"
                onClick={() => setAsking(a)}
              >
                Unlink
              </button>
            </div>
          ))}
        </div>
      )}

      {live && (
        <div className="settings-card">
          <h3 className="settings-subhead cn-subhead">When I go live on Twitch or Kick</h3>
          <Row
            label="Tell my friends"
            desc="A notification with Watch together and Open on Twitch or Kick"
            on={live.tellFriends !== 'off'}
            onChange={(on) => changeLive({ tellFriends: on ? 'all' : 'off' })}
          />
          {live.tellFriends !== 'off' && (
            <div className="settings-row settings-row--stack">
              <div className="cn-segment" role="radiogroup" aria-label="Which friends">
                <button
                  type="button"
                  role="radio"
                  aria-checked={live.tellFriends === 'all'}
                  className={live.tellFriends === 'all' ? 'cn-seg cn-seg--on' : 'cn-seg'}
                  onClick={() => changeLive({ tellFriends: 'all' })}
                >
                  All friends
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={live.tellFriends === 'chosen'}
                  className={live.tellFriends === 'chosen' ? 'cn-seg cn-seg--on' : 'cn-seg'}
                  onClick={() => changeLive({ tellFriends: 'chosen' })}
                >
                  Only friends I choose
                </button>
              </div>
              {live.tellFriends === 'chosen' && (
                <ChooseFriends
                  chosen={live.chosen}
                  onChange={(ids) => changeLive({ chosen: ids })}
                />
              )}
            </div>
          )}
          <Row
            label="Show LIVE on my profile and in friends lists"
            desc="With the stream title and game, like Go live in Glofly"
            on={live.showLive}
            onChange={(on) => changeLive({ showLive: on })}
          />
          <Row
            label="Also post in my constellations"
            desc="Only in constellations whose owner allows members' streams (Settings → Live alerts)"
            on={live.postInConstellations}
            onChange={(on) => changeLive({ postInConstellations: on })}
          />
        </div>
      )}

      {steam && (
        <div className="settings-card">
          <div className="cn-account cn-account--pad">
            <SiteBadge site="steam" />
            <span className="cn-account-text">
              <b>Steam · {steam.displayName}</b>
              <span className="ix-muted">
                Linked {day(steam.linkedAt)}
                {typeof steam.gameCount === 'number'
                  ? ` · ${steam.gameCount === 1 ? '1 game' : `${steam.gameCount.toLocaleString()} games`}`
                  : ''}{' '}
                · {ago(steam.syncedAt)}
              </span>
            </span>
            <button
              type="button"
              className="ix-btn ix-btn--small"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                setProblem(null)
                void syncSteam().then((r) => {
                  setBusy(false)
                  if (!r.ok) return setProblem(r.message)
                  setNotice(
                    r.data.publicGames || r.data.count
                      ? `Synced ${r.data.count === 1 ? '1 game' : `${r.data.count} games`} from Steam.`
                      : "Steam didn't share any games. Check that your Game details are Public on Steam."
                  )
                  load()
                })
              }}
            >
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button"
              className="ix-btn ix-btn--small ix-btn--danger"
              onClick={() => setAsking(steam)}
            >
              Unlink
            </button>
          </div>
          <Row
            label="Add my Steam games to My games"
            desc="Real playtime from Steam, including games played on other computers"
            on={steam.settings.myGames}
            onChange={(on) => void change('steam', { myGames: on })}
          />
          <Row
            label={'Show "Playing" from Steam'}
            desc="When you play on another PC or a Steam Deck, friends see it too"
            on={steam.settings.playing}
            onChange={(on) => void change('steam', { playing: on })}
          />
          <Row
            label="Show my Steam profile link on my profile"
            desc="Who sees it follows My games (Everyone / Friends / Only me)"
            on={steam.settings.showLink}
            onChange={(on) => void change('steam', { showLink: on })}
          />
        </div>
      )}
      {steam && (
        <div className="cn-note">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.5" />
          </svg>
          <span>
            Steam only shares playtime when your Steam profile&apos;s <b>Game details</b> are set to
            Public (Steam → your profile → Edit Profile → Privacy Settings).
          </span>
        </div>
      )}

      {notLinked.length > 0 && (
        <div className="cn-list">
          <span className="cn-label">
            {streams.length || steam ? 'NOT LINKED YET' : 'LINK AN ACCOUNT'}
          </span>
          {notLinked.map((p) => {
            const on = view.available[p]
            return (
              <div key={p} className="ix-card cn-unlinked">
                <SiteBadge site={p} />
                <span className="cn-account-text">
                  <b>{SITE_LOOK[p].name}</b>
                  <span className="ix-muted">
                    {!on
                      ? `${SITE_LOOK[p].name} linking isn't set up on this server yet.`
                      : waiting === p
                        ? `Finish signing in on ${SITE_LOOK[p].name}'s page in your browser, then come back here.`
                        : p === 'steam'
                          ? "Fill in My games with your Steam playtime. You sign in on Steam's own page; Glofly never sees your Steam password."
                          : `Tell friends when you go live on ${SITE_LOOK[p].name}. You sign in on ${SITE_LOOK[p].name}'s own page.`}
                  </span>
                </span>
                <button
                  type="button"
                  className="ix-btn ix-btn--gold"
                  disabled={!on}
                  onClick={() => void link(p)}
                >
                  {waiting === p ? 'Open again' : `Link ${SITE_LOOK[p].name}`}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <p className="ix-text">
        Glofly only reads your channel name, whether you&apos;re live, and (Steam) your games and
        playtime. It never posts or chats on your channel, and keeps no Twitch, Kick or Steam
        password or sign-in.
      </p>

      {asking && (
        <ConfirmDialog
          title={`Unlink ${SITE_LOOK[asking.provider].name}?`}
          message={
            asking.provider === 'steam'
              ? "Steam's games and playtime leave My games (time Glofly counted itself stays). You can link it again any time."
              : "Friends won't hear when you go live there any more. You can link it again any time."
          }
          confirmLabel="Unlink"
          danger
          busy={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            setBusy(true)
            void unlink(asking.provider).then((r) => {
              setBusy(false)
              setAsking(null)
              if (r.ok) load()
              else setProblem(r.message)
            })
          }}
        />
      )}
    </section>
  )
}
