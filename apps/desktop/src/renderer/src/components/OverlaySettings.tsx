import { useEffect, useState } from 'react'
import type { OverlayInfo, OverlaySettings as Settings } from '../../../preload/api-types'
import { Segmented, Toggle } from './SettingsDialog'

// Settings → Game overlay (0.7.0, Windows): Glofly on top of the game you're playing (voice,
// pop-ups, a pinned chat; Shift + ` opens it). Saved on this computer (src/main/overlay.ts).

const VOICE: { value: Settings['voice']; label: string }[] = [
  { value: 'full', label: 'Names and photos' },
  { value: 'photos', label: 'Photos only' },
  { value: 'talking', label: "Only who's talking" },
  { value: 'off', label: 'Off' }
]
const CORNERS: { value: Settings['corner']; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' }
]
const POPUPS: { key: keyof Settings['popups']; label: string }[] = [
  { key: 'messages', label: 'Messages' },
  { key: 'calls', label: 'Incoming calls' },
  { key: 'constellations', label: 'Constellation messages' },
  { key: 'friends', label: 'Friends coming online and requests' }
]

/** "Shift+`" → "Shift + `" */
const keyLabel = (k: string): string => k.split('+').join(' + ')

export default function OverlaySettings(): React.JSX.Element {
  // Held once: the effects below must not re-run (a re-run used to end "Try it" right after it began).
  const [api] = useState(() => window.glofly.overlay)
  const [info, setInfo] = useState<OverlayInfo | null>(null)
  const [opacity, setOpacity] = useState<number | null>(null)
  const [trying, setTrying] = useState(false)

  useEffect(() => {
    if (!api) return
    void api.info().then(setInfo)
    return api.onSettings((next) => {
      setInfo(next)
      // The main process says when "Try it" ends (closed, or after 45 seconds).
      if (typeof next.previewing === 'boolean') setTrying(next.previewing)
    })
  }, [api])
  useEffect(() => {
    if (!trying) return
    const t = setTimeout(() => setTrying(false), 45_000)
    return () => clearTimeout(t)
  }, [trying])
  useEffect(() => () => api?.preview(false), [api])

  const s = info?.settings
  const change = (changes: Partial<Settings>): void => {
    if (!api) return
    void api.set(changes).then((next) => next && setInfo(next))
  }

  if (!api || (info && !info.supported)) {
    return (
      <section className="settings-section">
        <h2>Game overlay</h2>
        <p className="settings-section-note">The game overlay is part of Glofly for Windows.</p>
      </section>
    )
  }

  const shownOpacity = opacity ?? s?.opacity ?? 78

  return (
    <>
      <section className="settings-section">
        <h2>Game overlay</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Show Glofly over games</span>
              <span className="settings-row-desc">
                Who&apos;s talking, messages and calls on top of the game you&apos;re playing. Press{' '}
                {s ? keyLabel(s.openKey) : 'Shift + `'} in a game to open it.
              </span>
            </div>
            {s ? (
              <Toggle
                on={s.enabled}
                label="Show Glofly over games"
                onChange={(on) => change({ enabled: on })}
              />
            ) : (
              <span className="toggle toggle--loading" aria-hidden="true" />
            )}
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Try it</span>
              <span className="settings-row-desc">
                Opens the overlay over Glofly, so you can see it without a game. Esc closes it.
              </span>
            </div>
            <button
              type="button"
              className="small-button small-button--quiet"
              disabled={!s?.enabled}
              onClick={() => {
                api.preview(!trying)
                setTrying(!trying)
              }}
            >
              {trying ? 'Stop' : 'Try it'}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-desc">
                Works in games set to <b>borderless</b> or <b>windowed</b> full screen (most
                games&apos; default). A game in exclusive full screen draws over everything, so
                switch it to borderless in the game&apos;s video settings. Glofly never adds
                anything to the game itself, so it&apos;s safe with anti-cheat.
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>Keys</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <label className="settings-row-label" htmlFor="overlay-open-key">
                Open and close
              </label>
              <span className="settings-row-desc">Esc closes it too.</span>
            </div>
            <select
              id="overlay-open-key"
              className="settings-select"
              disabled={!s}
              value={s?.openKey ?? ''}
              onChange={(e) => change({ openKey: e.target.value })}
            >
              {info?.keys.open.map((k) => (
                <option key={k} value={k}>
                  {keyLabel(k)}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <label className="settings-row-label" htmlFor="overlay-mute-key">
                Mute and unmute
              </label>
              <span className="settings-row-desc">
                Only while you&apos;re in a call and a game is in front.
              </span>
            </div>
            <select
              id="overlay-mute-key"
              className="settings-select"
              disabled={!s}
              value={s?.muteKey ?? ''}
              onChange={(e) => change({ muteKey: e.target.value || null })}
            >
              {info?.keys.mute.map((k) => (
                <option key={k} value={k}>
                  {keyLabel(k)}
                </option>
              ))}
              <option value="">None</option>
            </select>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>In game</h2>
        <div className="settings-card">
          <div className="settings-row settings-row--stack">
            <span className="settings-row-label">Voice widget</span>
            <Segmented
              label="Voice widget"
              wide
              options={VOICE}
              value={s?.voice}
              onChange={(voice) => change({ voice })}
            />
          </div>
          <div className="settings-row settings-row--stack">
            <span className="settings-row-label">Where it sits</span>
            <Segmented
              label="Where the voice widget sits"
              wide
              options={CORNERS}
              value={s?.corner}
              onChange={(corner) => change({ corner })}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <label className="settings-row-label" htmlFor="overlay-opacity">
                How solid
              </label>
              <span className="settings-row-desc">Lower lets more of the game show through.</span>
            </div>
            <div className="settings-volume">
              <input
                id="overlay-opacity"
                type="range"
                className="settings-range"
                min={40}
                max={100}
                step={5}
                value={shownOpacity}
                disabled={!s}
                style={{ '--fill': `${((shownOpacity - 40) / 60) * 100}%` } as React.CSSProperties}
                aria-valuetext={`${shownOpacity}%`}
                onChange={(e) => setOpacity(Number(e.target.value))}
                onPointerUp={() => opacity !== null && change({ opacity })}
                onKeyUp={() => opacity !== null && change({ opacity })}
                onBlur={() => opacity !== null && change({ opacity })}
              />
              <span className="settings-volume-value">{shownOpacity}%</span>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>Pop-ups in game</h2>
        <p className="settings-section-note">
          They show over the game instead of as Windows notifications, and follow your mute and Do
          not disturb settings.
        </p>
        <div className="settings-card">
          {POPUPS.map((p) => (
            <div key={p.key} className="settings-row">
              <div className="settings-row-text">
                <span className="settings-row-label">{p.label}</span>
              </div>
              {s ? (
                <Toggle
                  on={s.popups[p.key]}
                  label={p.label}
                  onChange={(on) => change({ popups: { ...s.popups, [p.key]: on } })}
                />
              ) : (
                <span className="toggle toggle--loading" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>Games</h2>
        {info && info.games.length === 0 ? (
          <p className="settings-section-note">
            Games you play show here, so you can turn the overlay off for any of them. Glofly finds
            games the same way as &ldquo;Show what I&apos;m playing&rdquo;.
          </p>
        ) : (
          <div className="settings-card">
            {info?.games.map((g) => {
              const on = !s?.offGames.includes(g)
              return (
                <div key={g} className="settings-row">
                  <div className="settings-row-text">
                    <span className="settings-row-label">{g}</span>
                    <span className="settings-row-desc">{on ? 'Overlay on' : 'Overlay off'}</span>
                  </div>
                  <Toggle
                    on={on}
                    label={`Overlay in ${g}`}
                    disabled={!s}
                    onChange={(next) =>
                      s &&
                      change({
                        offGames: next ? s.offGames.filter((x) => x !== g) : [...s.offGames, g]
                      })
                    }
                  />
                </div>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}
