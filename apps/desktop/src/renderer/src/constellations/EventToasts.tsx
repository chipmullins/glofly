import { useEffect, useState } from 'react'
import { community } from '../lib/community'
import { notify, shouldNotify } from '../lib/notify'
import { playSound } from '../lib/sounds'
import './Community.css'

// 0.8.0 events (approved Oct 20 board 13): "Game Night starts in 15 min" for people going or
// maybe, then "Game Night is starting · Join Campfire". On Glofly home and the night side alike
// (bottom right, the night style), with a system notification when Glofly isn't in front.

type Toast = {
  key: string
  constellationId: string
  eventId: string
  phase: 'reminder' | 'started'
  title: string
  constellationName: string
  voiceNebulaId: string | null
  voiceName: string
  nebulaId: string | null
  conversationId: string | null
  inVoice: number
  startsAt: string | null
}

function Mark(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffb347" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M5 7l6 3 3 7 5-4" />
      <circle cx="5" cy="7" r="1.6" fill="#ffb347" />
      <circle cx="11" cy="10" r="1.3" fill="#ffb347" />
      <circle cx="14" cy="17" r="1.6" fill="#ffb347" />
      <circle cx="19" cy="13" r="1.3" fill="#ffb347" />
    </svg>
  )
}

export default function EventToasts({
  meId,
  onOpen
}: {
  meId: string
  /** Open a nebula (the voice nebula to join, or where the event's card is) */
  onOpen: (place: { constellationId: string; nebulaId: string | null }) => void
}): React.JSX.Element | null {
  const [queue, setQueue] = useState<Toast[]>([])
  useEffect(
    () =>
      window.glofly.onEvent((event) => {
        if (event.type !== 'constellation:event' || event.phase === 'changed') return
        const phase = event.phase
        void (async () => {
          // "Starting" goes to everyone in the constellation: only people going or maybe get a toast.
          const r = await community.events(event.constellationId)
          const e = r.ok ? r.data.events.find((x) => x.id === event.eventId) : undefined
          if (!e || e.cancelledAt) return
          if (phase === 'started' && e.mine !== 'going' && e.mine !== 'maybe') return
          const toast: Toast = {
            key: `${event.eventId}:${phase}`,
            constellationId: event.constellationId,
            eventId: event.eventId,
            phase,
            title: event.title ?? e.title,
            constellationName: event.constellationName ?? '',
            voiceNebulaId: event.voiceNebulaId ?? null,
            voiceName: event.voiceName ?? '',
            nebulaId: event.nebulaId ?? null,
            conversationId: event.conversationId ?? null,
            inVoice: event.inVoice ?? 0,
            startsAt: e.startsAt
          }
          playSound('friendOnline')
          setQueue((q) => [...q.filter((t) => t.eventId !== toast.eventId), toast].slice(-3))
          if (shouldNotify()) {
            void notify(
              {
                key: `event:${toast.eventId}`,
                conversationId: toast.conversationId,
                title: phase === 'started' ? `📅 ${toast.title} is starting` : `📅 ${toast.title} starts in 15 min`,
                body:
                  phase === 'started'
                    ? toast.voiceName
                      ? `${toast.voiceName} is open · ${toast.constellationName}`
                      : toast.constellationName
                    : `${toast.constellationName}${toast.voiceName ? ` · ${toast.voiceName}` : ''}`
              },
              null
            )
          }
        })()
      }),
    [meId]
  )
  const t = queue[0]
  // A toast nobody answers folds away after two minutes.
  useEffect(() => {
    if (!t) return
    const timer = setTimeout(() => setQueue((q) => q.filter((x) => x.key !== t.key)), 120_000)
    return () => clearTimeout(timer)
  }, [t])
  if (!t) return null
  const done = (): void => setQueue((q) => q.filter((x) => x.key !== t.key))
  const at = t.startsAt
    ? new Date(t.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : ''
  const others = Math.max(0, t.inVoice - 1)
  const title = t.phase === 'started' ? `${t.title} is starting` : `${t.title} starts in 15 min`
  const text =
    t.phase === 'started'
      ? t.voiceName
        ? `${t.voiceName} is open${t.inVoice ? ` · ${t.inVoice === 1 ? '1 person is' : `${others + 1} people are`} in` : ''}`
        : t.constellationName
      : `${t.constellationName}${t.voiceName ? ` · ${t.voiceName} opens at ${at}` : ` · at ${at}`}`
  return (
    <div className="ev-toast" role="status" aria-live="polite">
      <div className="ev-toast-top">
        <span className="ev-toast-mark">
          <Mark />
        </span>
        <span className="ev-toast-text">
          <b>{title}</b>
          <span>{text}</span>
        </span>
      </div>
      <div className="ev-toast-actions">
        {t.phase === 'started' && t.voiceNebulaId ? (
          <button
            type="button"
            className="ev-toast-main"
            onClick={() => {
              done()
              onOpen({ constellationId: t.constellationId, nebulaId: t.voiceNebulaId })
            }}
          >
            Join {t.voiceName}
          </button>
        ) : (
          <button
            type="button"
            className="ev-toast-main"
            onClick={() => {
              done()
              // "Remind me at 8:30": the "is starting" toast comes then anyway.
              if (t.phase === 'started') onOpen({ constellationId: t.constellationId, nebulaId: t.nebulaId })
            }}
          >
            {t.phase === 'started' ? 'Open event' : `Remind me at ${at}`.replace(/ at $/, '')}
          </button>
        )}
        <button type="button" className="ev-toast-later" onClick={done}>
          {t.phase === 'started' ? 'Later' : 'Dismiss'}
        </button>
      </div>
    </div>
  )
}
