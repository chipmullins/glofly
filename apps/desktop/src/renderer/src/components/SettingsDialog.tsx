import { useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  AppSettingsChanges,
  PrivacySettings,
  SignedInUser,
  TextSize
} from '../../../preload/api-types'
import { CloseIcon, LogOutIcon } from './icons'
import AccountSettings from './AccountSettings'
import './dialogs.css'
import './SettingsDialog.css'

type SettingsDialogProps = {
  user: SignedInUser
  onClose: () => void
  onLogout: () => void
  onSessionExpired: () => void
  /** The account is set to be deleted and this device is signed out. */
  onAccountDeleted: (deleteAfter: string) => void
}

type Page = 'general' | 'account'

type ToggleKey = 'readReceipts' | 'showLastSeen' | 'showTyping'
type Row = { key: ToggleKey; label: string; desc?: string }

// Wording from the design (Settings → General → Privacy).
const PRIVACY: Row[] = [
  {
    key: 'readReceipts',
    label: 'Read receipts',
    desc: "Let people know when you've read their messages. If you turn this off, you won't see theirs either."
  },
  {
    key: 'showLastSeen',
    label: 'Show when I was last online',
    desc: 'Friends see “Last seen 2 hours ago” when you’re offline.'
  },
  { key: 'showTyping', label: 'Show when I’m typing' }
]

export function Toggle({
  on,
  label,
  disabled = false,
  onChange
}: {
  on: boolean
  label: string
  disabled?: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={on ? 'toggle toggle--on' : 'toggle'}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-knob" />
    </button>
  )
}

/** A row of choices where one is picked, like the design's Theme and Accent color. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: { value: T; label: string }[]
  value: T | undefined
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={
            o.value === value ? 'segmented-option segmented-option--on' : 'segmented-option'
          }
          disabled={value === undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'larger', label: 'Larger' }
]

function GeneralIcon({ active }: { active: boolean }): React.JSX.Element {
  const fill = active ? 'var(--glo-accent-soft)' : 'var(--glo-sidebar)'
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
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" style={{ fill }} />
      <circle cx="15" cy="12" r="2" style={{ fill }} />
      <circle cx="8" cy="18" r="2" style={{ fill }} />
    </svg>
  )
}

function AccountIcon({ active }: { active: boolean }): React.JSX.Element {
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
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  )
}

export default function SettingsDialog({
  user,
  onClose,
  onLogout,
  onSessionExpired,
  onAccountDeleted
}: SettingsDialogProps): React.JSX.Element {
  const [page, setPage] = useState<Page>('general')
  const [settings, setSettings] = useState<PrivacySettings | null>(null)
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    window.glofly.settings.get().then((result) => {
      if (result.ok) setSettings(result.data)
      else if (result.error === 'unauthorized') onSessionExpired()
      else setNotice(result.message)
    })
    window.glofly.app.getSettings().then((s) => s && setAppSettings(s))
    const onKey = (e: KeyboardEvent): void => {
      // A dialog on top (like "Delete account?") handles its own Escape.
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onSessionExpired])

  async function change<K extends keyof PrivacySettings>(
    key: K,
    value: PrivacySettings[K]
  ): Promise<void> {
    if (!settings) return
    const before = settings
    setSettings({ ...settings, [key]: value }) // change it right away
    const result = await window.glofly.settings.set({ [key]: value })
    if (result.ok) {
      setSettings(result.data)
      setNotice(null)
    } else {
      setSettings(before) // put it back
      if (result.error === 'unauthorized') onSessionExpired()
      else setNotice(result.message)
    }
  }

  async function changeApp(changes: AppSettingsChanges): Promise<void> {
    if (!appSettings) return
    setAppSettings({ ...appSettings, ...changes })
    const saved = await window.glofly.app.setSettings(changes)
    if (saved) setAppSettings(saved)
  }

  function openPage(next: Page): void {
    setPage(next)
    setNotice(null)
    if (contentRef.current) contentRef.current.scrollTop = 0
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="dialog settings"
      >
        <header className="settings-head">
          <h1 id="settings-title">Settings</h1>
          <button
            type="button"
            className="dialog-close"
            aria-label="Close settings"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="settings-body">
          <nav aria-label="Settings sections" className="settings-nav">
            <button
              type="button"
              className={
                page === 'general'
                  ? 'settings-nav-item settings-nav-item--active'
                  : 'settings-nav-item'
              }
              aria-current={page === 'general' ? 'page' : undefined}
              onClick={() => openPage('general')}
            >
              <GeneralIcon active={page === 'general'} />
              General
            </button>
            <button
              type="button"
              className={
                page === 'account'
                  ? 'settings-nav-item settings-nav-item--active'
                  : 'settings-nav-item'
              }
              aria-current={page === 'account' ? 'page' : undefined}
              onClick={() => openPage('account')}
            >
              <AccountIcon active={page === 'account'} />
              Account
            </button>
            <div className="settings-nav-spacer" />
            {appSettings && <span className="settings-version">Glofly v{appSettings.version}</span>}
          </nav>

          <div className="settings-content" ref={contentRef}>
            {notice && (
              <p className="dialog-message" role="alert">
                {notice}
              </p>
            )}

            {page === 'account' ? (
              <AccountSettings
                user={user}
                onSessionExpired={onSessionExpired}
                onAccountDeleted={onAccountDeleted}
              />
            ) : (
              <>
                <section className="settings-section">
                  <h2>Appearance</h2>
                  <div className="settings-card">
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span className="settings-row-label">Theme</span>
                        <span className="settings-row-desc">
                          Match system follows your computer’s light or dark setting.
                        </span>
                      </div>
                      <Segmented
                        label="Theme"
                        value={appSettings?.theme}
                        options={[
                          { value: 'light', label: 'Light' },
                          { value: 'dark', label: 'Dark' },
                          { value: 'system', label: 'Match system' }
                        ]}
                        onChange={(theme) => void changeApp({ theme })}
                      />
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span className="settings-row-label">Accent color</span>
                        <span className="settings-row-desc">
                          Used for buttons, highlights and badges. Works in light and dark.
                        </span>
                      </div>
                      <Segmented
                        label="Accent color"
                        value={appSettings?.accent}
                        options={[
                          { value: 'orange', label: 'Glow Orange' },
                          { value: 'red', label: 'Glofly Red' }
                        ]}
                        onChange={(accent) => void changeApp({ accent })}
                      />
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <label className="settings-row-label" htmlFor="settings-text-size">
                          Text size
                        </label>
                      </div>
                      <select
                        id="settings-text-size"
                        className="settings-select"
                        disabled={!appSettings}
                        value={appSettings?.textSize ?? 'default'}
                        onChange={(e) => void changeApp({ textSize: e.target.value as TextSize })}
                      >
                        {TEXT_SIZES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <h2>Privacy</h2>
                  <div className="settings-card">
                    {PRIVACY.map((row) => (
                      <div key={row.key} className="settings-row">
                        <div className="settings-row-text">
                          <span className="settings-row-label">{row.label}</span>
                          {row.desc && <span className="settings-row-desc">{row.desc}</span>}
                        </div>
                        {settings ? (
                          <Toggle
                            on={settings[row.key]}
                            label={row.label}
                            onChange={(on) => void change(row.key, on)}
                          />
                        ) : (
                          <span className="toggle toggle--loading" aria-hidden="true" />
                        )}
                      </div>
                    ))}
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <label className="settings-row-label" htmlFor="settings-requests">
                          Who can send me friend requests
                        </label>
                        <span className="settings-row-desc">
                          With No one, people can’t send you requests, but you can still send them.
                        </span>
                      </div>
                      <select
                        id="settings-requests"
                        className="settings-select"
                        disabled={!settings}
                        value={settings?.friendRequests ?? 'everyone'}
                        onChange={(e) =>
                          void change('friendRequests', e.target.value as 'everyone' | 'nobody')
                        }
                      >
                        <option value="everyone">Everyone</option>
                        <option value="nobody">No one</option>
                      </select>
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <h2>App</h2>
                  <div className="settings-card">
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span className="settings-row-label">
                          Open Glofly when my computer starts
                        </span>
                        {appSettings && !appSettings.startupAvailable && (
                          <span className="settings-row-desc">
                            Works in the installed app (not while developing).
                          </span>
                        )}
                      </div>
                      {appSettings ? (
                        <Toggle
                          on={appSettings.openAtLogin}
                          label="Open Glofly when my computer starts"
                          disabled={!appSettings.startupAvailable}
                          onChange={(on) => void changeApp({ openAtLogin: on })}
                        />
                      ) : (
                        <span className="toggle toggle--loading" aria-hidden="true" />
                      )}
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <span className="settings-row-label">
                          Keep running in the system tray when closed
                        </span>
                        <span className="settings-row-desc">
                          So you still get messages and calls after closing the window.
                        </span>
                      </div>
                      {appSettings ? (
                        <Toggle
                          on={appSettings.closeToTray}
                          label="Keep running in the system tray when closed"
                          onChange={(on) => void changeApp({ closeToTray: on })}
                        />
                      ) : (
                        <span className="toggle toggle--loading" aria-hidden="true" />
                      )}
                    </div>
                  </div>
                </section>

                <section className="settings-card settings-logout">
                  <div className="settings-row-text">
                    <span className="settings-row-label">Log out</span>
                    <span className="settings-row-desc">
                      Signed in as @{user.username} on this device
                    </span>
                  </div>
                  <button
                    type="button"
                    className="small-button small-button--quiet settings-logout-button"
                    onClick={onLogout}
                  >
                    <LogOutIcon />
                    Log out
                  </button>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
