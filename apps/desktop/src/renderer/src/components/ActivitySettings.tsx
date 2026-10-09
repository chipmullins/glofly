import { useEffect, useState } from 'react'
import type { GameState, RunningProgram } from '../../../preload/api-types'
import { Toggle } from './SettingsDialog'
import { GameIcon } from './icons'

/**
 * Settings → Activity: "Show what I'm playing", the game detected right now (with Hide),
 * games you added yourself, games you hid, and "Add a game" from what's running.
 * All saved on this computer.
 */
export default function ActivitySettings(): React.JSX.Element {
  const [state, setState] = useState<GameState | null>(null)
  const [adding, setAdding] = useState(false)
  const [programs, setPrograms] = useState<RunningProgram[] | null>(null)
  const [pickedExe, setPickedExe] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    let alive = true
    void window.glofly.games.state().then((s) => alive && setState(s))
    const stop = window.glofly.games.onChange(setState)
    return () => {
      alive = false
      stop()
    }
  }, [])

  const openAdd = (): void => {
    setAdding(true)
    setPrograms(null)
    setPickedExe('')
    setName('')
    void window.glofly.games.running().then(setPrograms)
  }

  const add = async (): Promise<void> => {
    const exe = pickedExe
    const clean = name.trim()
    if (!exe || !clean) return
    const next = await window.glofly.games.add(exe, clean)
    if (next) {
      setState(next)
      setAdding(false)
    }
  }

  if (!state) {
    return (
      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-desc">Loading…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="settings-card">
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Show what I&apos;m playing</span>
          <span className="settings-row-desc">
            {state.supported
              ? 'Friends see the game you’re playing, like “Playing Guild Wars 2”. Only the game’s name is shared, never your other programs.'
              : 'Glofly can spot the game you’re playing on Windows.'}
          </span>
        </div>
        <Toggle
          on={state.enabled}
          label="Show what I'm playing"
          onChange={(on) => void window.glofly.games.setEnabled(on).then(setState)}
        />
      </div>

      {state.supported && (
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-label">Right now</span>
            <span className="settings-row-desc activity-now">
              {state.detected ? (
                <>
                  <GameIcon size={15} />
                  {state.enabled ? 'Playing' : 'Detected (not shared)'}{' '}
                  <strong>{state.detected}</strong>
                </>
              ) : (
                'No game detected'
              )}
            </span>
          </div>
          {state.detected && (
            <button
              type="button"
              className="small-button small-button--quiet"
              onClick={() => void window.glofly.games.hide(state.detected!, true).then(setState)}
            >
              Never show this game
            </button>
          )}
        </div>
      )}

      {state.supported && (
        <div className="settings-row settings-row--stack">
          <div className="settings-row-text">
            <span className="settings-row-label">Your games</span>
            <span className="settings-row-desc">
              A game Glofly doesn&apos;t spot? Start it, then add it here.
            </span>
          </div>
          {state.custom.length > 0 && (
            <ul className="activity-list">
              {state.custom.map((g) => (
                <li key={g.exe}>
                  <span className="activity-list-name">
                    <strong>{g.name}</strong>
                    <span>{g.exe}</span>
                  </span>
                  <button
                    type="button"
                    className="small-button small-button--quiet"
                    onClick={() => void window.glofly.games.remove(g.exe).then(setState)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {adding ? (
            <div className="activity-add">
              <label className="settings-row-label" htmlFor="activity-program">
                Pick the game from what&apos;s running
              </label>
              <select
                id="activity-program"
                className="settings-select activity-select"
                value={pickedExe}
                disabled={!programs}
                onChange={(e) => {
                  const exe = e.target.value
                  setPickedExe(exe)
                  const program = programs?.find((p) => p.exe === exe)
                  if (program && !name.trim()) setName(program.title.slice(0, 64))
                }}
              >
                <option value="">
                  {programs === null
                    ? 'Looking for running programs…'
                    : programs.length === 0
                      ? 'No programs with a window found'
                      : 'Choose a program'}
                </option>
                {programs?.map((p) => (
                  <option key={p.exe} value={p.exe}>
                    {p.title} ({p.exe})
                  </option>
                ))}
              </select>
              <label className="settings-row-label" htmlFor="activity-name">
                Name friends will see
              </label>
              <input
                id="activity-name"
                className="settings-input"
                value={name}
                maxLength={64}
                placeholder="e.g. Guild Wars 2"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void add()}
              />
              <div className="activity-add-buttons">
                <button
                  type="button"
                  className="small-button small-button--quiet"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="small-button small-button--primary"
                  disabled={!pickedExe || !name.trim()}
                  onClick={() => void add()}
                >
                  Add game
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="small-button small-button--quiet" onClick={openAdd}>
              Add a game
            </button>
          )}
        </div>
      )}

      {state.hidden.length > 0 && (
        <div className="settings-row settings-row--stack">
          <div className="settings-row-text">
            <span className="settings-row-label">Hidden games</span>
            <span className="settings-row-desc">These never show, even while you play them.</span>
          </div>
          <ul className="activity-list">
            {state.hidden.map((game) => (
              <li key={game}>
                <span className="activity-list-name">
                  <strong>{game}</strong>
                </span>
                <button
                  type="button"
                  className="small-button small-button--quiet"
                  onClick={() => void window.glofly.games.hide(game, false).then(setState)}
                >
                  Show again
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
