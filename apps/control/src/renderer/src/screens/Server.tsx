import { useCallback, useEffect, useState, type JSX } from 'react'
import { api, type ServerInfo } from '../lib/api'
import { ActionDialog, type ActionSpec } from '../components/ActionDialog'
import { Chip } from '../components/common'
import { Icon, ICONS } from '../components/icons'
import { ago, when } from '../lib/format'

// Control → Server (0.4.0): "Pause Glofly" (the kill switch) and "Restart server".

/** "3 days, 4 hours" / "12 minutes". */
function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const part = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
  if (d) return h ? `${part(d, 'day')}, ${part(h, 'hour')}` : part(d, 'day')
  if (h) return m ? `${part(h, 'hour')}, ${part(m, 'minute')}` : part(h, 'hour')
  return m ? part(m, 'minute') : 'less than a minute'
}

type Restart = { phase: 'waiting' | 'back' | 'slow'; from: string; started: number } | null

export function Server({
  toast,
  onPauseChange
}: {
  toast: (message: string, bad?: boolean) => void
  /** The sidebar and the banner follow the switch. */
  onPauseChange: (paused: boolean) => void
}): JSX.Element {
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionSpec | null>(null)
  const [restart, setRestart] = useState<Restart>(null)

  const load = useCallback(
    (): Promise<void> =>
      api.server().then((result) => {
        if (result.ok) {
          setInfo(result.data)
          setError(null)
          onPauseChange(result.data.pause.paused)
        } else setError(result.message)
      }),
    [onPauseChange]
  )

  useEffect(() => {
    void load()
  }, [load])

  // Restarting: ask every 2 seconds until the server answers with a new start time.
  useEffect(() => {
    if (!restart || restart.phase === 'back') return
    let stopped = false
    const tick = async (): Promise<void> => {
      if (stopped) return
      const result = await api.server()
      if (stopped) return
      if (result.ok && result.data.startedAt !== restart.from) {
        setInfo(result.data)
        onPauseChange(result.data.pause.paused)
        const seconds = Math.round((Date.now() - restart.started) / 1000)
        setRestart({ ...restart, phase: 'back' })
        toast(`The server is back (took ${seconds} seconds).`)
        return
      }
      if (Date.now() - restart.started > 90_000 && restart.phase !== 'slow') {
        setRestart({ ...restart, phase: 'slow' })
        return
      }
      timer = setTimeout(() => void tick(), 2000)
    }
    let timer = setTimeout(() => void tick(), 2500)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [restart, toast, onPauseChange])

  const paused = info?.pause.paused === true

  const pauseSpec = (): ActionSpec | null => {
    if (!info) return null
    if (paused) {
      return {
        title: 'Unpause Glofly',
        intro: (
          <>
            Everyone can use Glofly again. Apps check every 30 seconds, so most are back within half
            a minute (older apps reconnect on their own too).
          </>
        ),
        confirmLabel: 'Unpause Glofly',
        notePlaceholder: 'e.g. "Fixed the database issue"',
        run: async (_v, note) => {
          const result = await api.setPause(false, '', note)
          if (result.ok) await load()
          return result
        }
      }
    }
    return {
      title: 'Pause Glofly',
      intro: (
        <>
          <strong>Nobody can use Glofly until you unpause it.</strong> Every app is disconnected
          right away (
          {info.devicesConnected === 1 ? '1 device' : `${info.devicesConnected} devices`} now),
          calls end, nothing can be sent and no notifications go out. Glofly Control keeps working.
          Nothing is deleted and nobody is signed out.
        </>
      ),
      confirmLabel: 'Pause Glofly',
      danger: true,
      fields: [
        {
          name: 'message',
          label: 'Message everyone sees',
          initial: info.pause.message || info.defaultPauseMessage,
          maxLength: 200,
          hint: 'Shown full-screen in Glofly 0.4.0 and newer. Older apps just show a connection error.'
        }
      ],
      notePlaceholder: 'e.g. "Spam wave, stopping it while I clean up"',
      run: async (v, note) => {
        const result = await api.setPause(true, v.message, note)
        if (result.ok) await load()
        return result
      }
    }
  }

  const messageSpec = (): ActionSpec | null =>
    info && {
      title: 'Change the pause message',
      intro:
        'Apps showing “Glofly is paused” pick up the new message on their next check (within 30 seconds).',
      confirmLabel: 'Save message',
      fields: [
        {
          name: 'message',
          label: 'Message everyone sees',
          initial: info.pause.message,
          maxLength: 200
        }
      ],
      run: async (v, note) => {
        const result = await api.setPause(true, v.message, note)
        if (result.ok) await load()
        return result
      }
    }

  const restartSpec = (): ActionSpec | null =>
    info && {
      title: 'Restart the server',
      intro: (
        <>
          The Glofly server stops and starts again by itself, which takes about 10 seconds. Apps
          lose their connection for that moment and reconnect on their own; calls in progress
          usually drop. It only restarts the Glofly server, not the website, the database or the
          machine.
          {paused && ' Glofly stays paused after the restart.'}
        </>
      ),
      confirmLabel: 'Restart server',
      danger: true,
      notePlaceholder: 'e.g. "Server felt slow, trying a restart"',
      run: async (_v, note) => {
        const from = info.startedAt
        const result = await api.restartServer(note)
        if (result.ok) setRestart({ phase: 'waiting', from, started: Date.now() })
        return result
      }
    }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Server</h1>
          <p className="sub">The Glofly server itself: pause everyone, or restart it.</p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => void load()}
          disabled={!!restart && restart.phase !== 'back'}
        >
          <Icon d={ICONS.refresh} size={16} strokeWidth={2} />
          Refresh
        </button>
      </header>

      {error && !restart && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {!info && !error && <p className="loading">Loading…</p>}

      {info && (
        <div className="server-cards">
          <section
            className={`card card-pad server-card${paused ? ' server-card--paused' : ''}`}
            aria-labelledby="pause-title"
          >
            <div className="server-card-head">
              <span className="server-card-icon" aria-hidden="true">
                <Icon d={ICONS.pause} size={22} strokeWidth={2} />
              </span>
              <div className="server-card-titles">
                <h2 id="pause-title">Pause Glofly</h2>
                <span className="hint">The kill switch: stops everyone using Glofly at once.</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={paused}
                aria-labelledby="pause-title"
                className="switch switch--danger"
                onClick={() => setAction(pauseSpec())}
              >
                <span className="switch-knob" />
              </button>
            </div>

            {paused ? (
              <div className="notice notice--bad" role="status">
                <Icon d={ICONS.pause} size={18} strokeWidth={2} />
                <span>
                  <strong>Glofly is paused</strong>
                  {info.pause.since
                    ? ` since ${when(info.pause.since)} (${ago(info.pause.since)})`
                    : ''}
                  . Everyone sees: “{info.pause.message}”
                </span>
              </div>
            ) : (
              <div className="server-status">
                <Chip tone="good">Running</Chip>
                <span className="hint">
                  {info.devicesConnected === 1 ? '1 device' : `${info.devicesConnected} devices`}{' '}
                  connected now
                </span>
              </div>
            )}

            <ul className="server-list">
              <li>Every app is disconnected and new connections are refused.</li>
              <li>Nothing can be sent, no notifications go out, calls end.</li>
              <li>Glofly Control keeps working, and nobody is signed out.</li>
            </ul>

            <div className="server-buttons">
              {paused ? (
                <>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => setAction(pauseSpec())}
                  >
                    Unpause Glofly
                  </button>
                  <button type="button" className="btn" onClick={() => setAction(messageSpec())}>
                    Change message
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => setAction(pauseSpec())}
                >
                  Pause Glofly…
                </button>
              )}
            </div>
          </section>

          <section className="card card-pad server-card" aria-labelledby="restart-title">
            <div className="server-card-head">
              <span className="server-card-icon" aria-hidden="true">
                <Icon d={ICONS.refresh} size={22} strokeWidth={2} />
              </span>
              <div className="server-card-titles">
                <h2 id="restart-title">Restart server</h2>
                <span className="hint">Stops the Glofly server; it starts again by itself.</span>
              </div>
            </div>

            {restart && restart.phase !== 'back' ? (
              <div
                className={`notice${restart.phase === 'slow' ? ' notice--warn' : ''}`}
                role="status"
                aria-live="polite"
              >
                {restart.phase === 'waiting' ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    <span>
                      <strong>Restarting…</strong> Waiting for the server to come back (usually
                      about 10 seconds).
                    </span>
                  </>
                ) : (
                  <span>
                    <strong>It’s taking longer than usual.</strong> Control keeps checking. If it
                    isn’t back in a few minutes, look at it on the server (
                    <code>docker compose ps</code> and <code>docker compose logs server</code> in
                    the deploy folder).
                  </span>
                )}
              </div>
            ) : (
              <dl className="facts">
                <dt>Running since</dt>
                <dd>
                  {when(info.startedAt)} · up {uptime(info.uptimeSec)}
                </dd>
              </dl>
            )}

            {!info.canRestart && (
              <div className="notice notice--warn">
                <Icon d={ICONS.info} size={18} strokeWidth={2} />
                <span>
                  This server can’t restart itself: it isn’t the live server’s Docker (a PC running{' '}
                  <code>npm run dev</code> would just stop). Restart it where it runs.
                </span>
              </div>
            )}

            <div className="server-buttons">
              <button
                type="button"
                className="btn btn--danger-soft"
                disabled={!info.canRestart || (!!restart && restart.phase !== 'back')}
                onClick={() => setAction(restartSpec())}
              >
                {restart && restart.phase !== 'back' ? 'Restarting…' : 'Restart server…'}
              </button>
            </div>
          </section>
        </div>
      )}

      {action && (
        <ActionDialog
          spec={action}
          onClose={() => setAction(null)}
          onDone={(message) => {
            setAction(null)
            toast(message)
          }}
        />
      )}
    </>
  )
}
