import { useCallback, useEffect, useState } from 'react'
import type { DiscordBridgeInfo, DiscordNewChannel } from '@glofly/shared/discord'
import type { ConstellationDetail } from '../../../preload/api-types'
import { can } from '../lib/constellations'
import './Community.css'

// 0.12.0 (Chip, Nov 28): with "Bridge new Discord channels automatically" on, a channel made in
// Discord later is bridged with the nebula that has its name. When none does, the people who can
// manage the bridge see this card in that constellation (bottom right, the night style like
// EventToasts): make a nebula and bridge, bridge it by hand on the Discord bridge page, or not now.
// It waits on the server, so it also shows the next time they open the constellation.

const call = <T,>(method: 'GET' | 'POST', path: string, body?: unknown) =>
  window.glofly.constellations.request<T>(method, path, body)

function Mark(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 7h11l-3-3M17 17H6l3 3" />
    </svg>
  )
}

export default function DiscordNewChannels({
  c,
  onManual,
  onProblem
}: {
  c: ConstellationDetail
  /** Opens Constellation settings → Discord bridge */
  onManual: () => void
  onProblem: (message: string) => void
}): React.JSX.Element | null {
  const manage = can(c, 'manageConstellation')
  const [list, setList] = useState<DiscordNewChannel[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!manage) return
    void call<{ newChannels: DiscordNewChannel[] }>('GET', `/constellations/${c.id}/discord/new-channels`).then(
      (r) => r.ok && setList(r.data.newChannels)
    )
  }, [c.id, manage])

  useEffect(() => {
    setList([])
    load()
    return window.glofly.onEvent((event) => {
      if (event.type === 'discord:newChannel' && event.constellationId === c.id) load()
      if (event.type === 'connection' && event.connected) load()
    })
  }, [c.id, load])

  const ch = list[0]
  if (!manage || !ch) return null
  const done = (): void => setList((l) => l.filter((x) => x.id !== ch.id))
  const where = ch.parent ? ` (in ${ch.parent})` : ''

  return (
    <div className="ev-toast dc-new-toast" role="status" aria-live="polite">
      <div className="ev-toast-top">
        <span className="ev-toast-mark">
          <Mark />
        </span>
        <span className="ev-toast-text">
          <b>
            New {ch.voice ? 'voice channel' : 'channel'} on Discord: {ch.voice ? '' : '#'}
            {ch.name}
          </b>
          <span>
            It was added to your Discord server{where}, but we couldn’t match it to a nebula.
          </span>
        </span>
      </div>
      <div className="ev-toast-actions">
        {can(c, 'manageNebulas') && (
          <button
            type="button"
            className="ev-toast-main"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void call<DiscordBridgeInfo>('POST', `/constellations/${c.id}/discord/pairs`, {
                discordChannelId: ch.id,
                newNebula: true
              }).then((r) => {
                setBusy(false)
                if (!r.ok) return onProblem(r.message ?? 'Couldn’t bridge that channel.')
                done()
              })
            }}
          >
            {ch.voice ? 'Make a voice nebula and bridge' : 'Make a nebula and bridge'}
          </button>
        )}
        <button
          type="button"
          className="ev-toast-later"
          onClick={() => {
            onManual()
          }}
        >
          Bridge manually…
        </button>
        <button
          type="button"
          className="ev-toast-later"
          onClick={() => {
            done()
            void call('POST', `/constellations/${c.id}/discord/new-channels/${ch.id}/dismiss`)
          }}
        >
          Not now
        </button>
      </div>
    </div>
  )
}
