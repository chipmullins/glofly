import { useCallback, useEffect, useState } from 'react'
import type { SignedInDevice } from '../../../preload/api-types'
import { timeAgo } from '../lib/presence'

// Settings → Account → Where you're signed in: every device with a Glofly sign-in, and a way
// to sign any of them out (say, a computer you no longer use, or one you don't recognise).

function DeviceIcon({ online }: { online: boolean }): React.JSX.Element {
  return (
    <span className={online ? 'acct-device-icon acct-device-icon--on' : 'acct-device-icon'}>
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    </span>
  )
}

const signedInOn = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** "Last used" is saved at most once an hour, so anything under an hour reads as such. */
function lastActive(d: SignedInDevice): string {
  if (d.online) return 'Online now'
  const age = Date.now() - new Date(d.lastUsedAt).getTime()
  return age < 60 * 60 * 1000 ? 'Active in the last hour' : `Active ${timeAgo(d.lastUsedAt)}`
}

export default function DevicesSettings({
  onSessionExpired
}: {
  onSessionExpired: () => void
}): React.JSX.Element {
  const [devices, setDevices] = useState<SignedInDevice[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  const load = useCallback(() => {
    window.glofly.account.sessions().then((result) => {
      if (result.ok) setDevices(result.data.sessions)
      else if (result.error === 'unauthorized') onSessionExpired()
    })
  }, [onSessionExpired])

  // Another device signing out (or this list changing elsewhere) refreshes it.
  useEffect(() => {
    load()
    return window.glofly.onEvent((event) => {
      if (event.type === 'account:changed') load()
    })
  }, [load])

  async function signOut(device: SignedInDevice): Promise<void> {
    if (busy) return
    setBusy(device.id)
    const result = await window.glofly.account.signOutDevice(device.id)
    setBusy(null)
    if (!result.ok && result.error === 'unauthorized') return onSessionExpired()
    setNote(
      result.ok || result.error === 'not_found'
        ? { text: `Signed out of ${device.deviceName ?? 'that device'}.` }
        : { text: result.message, bad: true }
    )
    load()
  }

  async function signOutOthers(): Promise<void> {
    if (busy) return
    setBusy('all')
    const result = await window.glofly.account.signOutOtherDevices()
    setBusy(null)
    if (!result.ok) {
      if (result.error === 'unauthorized') return onSessionExpired()
      setNote({ text: result.message, bad: true })
      return
    }
    const n = result.data.signedOut
    setNote({
      text: n
        ? `Signed out of ${n} other ${n === 1 ? 'device' : 'devices'}.`
        : 'No other devices were signed in.'
    })
    load()
  }

  const others = devices?.filter((d) => !d.current).length ?? 0

  return (
    <div className="settings-card acct-card acct-devices">
      {devices === null ? (
        <span className="settings-row-desc">Loading…</span>
      ) : (
        <ul className="acct-device-list">
          {devices.map((d) => (
            <li key={d.id} className="acct-device">
              <DeviceIcon online={d.current || d.online} />
              <div className="settings-row-text acct-device-text">
                <span className="settings-row-label">{d.deviceName ?? 'Unknown device'}</span>
                <span className="settings-row-desc">
                  {d.current ? (
                    <span className="acct-device-this">This device</span>
                  ) : (
                    lastActive(d)
                  )}{' '}
                  · Signed in {signedInOn(d.createdAt)}
                </span>
              </div>
              {!d.current && (
                <button
                  type="button"
                  className="small-button small-button--quiet"
                  disabled={busy !== null}
                  aria-label={`Sign out of ${d.deviceName ?? 'this device'}`}
                  onClick={() => void signOut(d)}
                >
                  {busy === d.id ? 'Signing out…' : 'Sign out'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="acct-devices-footer">
        <span className={note?.bad ? 'acct-error' : 'acct-saved'} role="status">
          {note?.text}
        </span>
        {others > 1 && (
          <button
            type="button"
            className="link-button acct-devices-all"
            disabled={busy !== null}
            onClick={() => void signOutOthers()}
          >
            {busy === 'all' ? 'Signing out…' : 'Sign out of all other devices'}
          </button>
        )}
      </div>
    </div>
  )
}
