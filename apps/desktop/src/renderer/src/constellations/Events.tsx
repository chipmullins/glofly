import { useEffect, useRef, useState } from 'react'
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_TITLE_MAX,
  RSVP_ANSWERS,
  eventDateTile,
  eventIcs,
  eventPhase,
  eventTimeLabel,
  eventWhenLabel,
  type ConstellationDetail,
  type ConstellationEvent,
  type RsvpAnswer
} from '@glofly/shared'
import Avatar from '../components/Avatar'
import { community, downloadIcs, type EventValues } from '../lib/community'
import { CloseIcon, SpeakerIcon } from './bits'
import './Community.css'

// Events with RSVP (0.8.0, approved Oct 20 board 13): the card in a nebula, the "Upcoming" chip
// in the sidebar, and the dialog to plan or change one.

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name

/** The four-point star the cards' corners twinkle with. */
function Spark({ style }: { style: React.CSSProperties }): React.JSX.Element {
  return <span className="ev-spark" aria-hidden="true" style={style} />
}

/** An event's card under its "made an event 📅" message. */
export function EventCard({
  event: e,
  constellation: c,
  now,
  inVoice,
  onChanged,
  onEdit,
  onJoinVoice,
  onProblem
}: {
  event: ConstellationEvent
  constellation: ConstellationDetail
  now: number
  /** People in its voice nebula right now (for "Happening now · 9 in Campfire") */
  inVoice: number
  onChanged: (e: ConstellationEvent) => void
  onEdit: (e: ConstellationEvent) => void
  onJoinVoice: (voiceNebulaId: string) => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const tile = eventDateTile(e.startsAt)
  const voice = e.voiceNebulaId ? c.nebulas.find((n) => n.id === e.voiceNebulaId) : null
  const phase = eventPhase(e, now)
  const closed = phase === 'cancelled' || phase === 'ended'
  let when = eventWhenLabel(e, now)
  if (phase === 'live' && voice && inVoice > 0) when = `Happening now · ${inVoice} in ${voice.name}`
  const answer = async (a: RsvpAnswer): Promise<void> => {
    if (busy || closed) return
    setBusy(true)
    const next = e.mine === a ? null : a
    // Shown at once; the server's answer replaces it.
    const optimistic: ConstellationEvent = {
      ...e,
      mine: next,
      going: e.going - (e.mine === 'going' ? 1 : 0) + (next === 'going' ? 1 : 0),
      maybe: e.maybe - (e.mine === 'maybe' ? 1 : 0) + (next === 'maybe' ? 1 : 0)
    }
    onChanged(optimistic)
    const r = await community.rsvp(c.id, e.id, next)
    setBusy(false)
    if (r.ok) onChanged(r.data.event)
    else {
      onChanged(e)
      onProblem(r.message)
    }
  }
  const label = (id: RsvpAnswer, name: string): string =>
    id === 'going' ? `${name} · ${e.going}` : id === 'maybe' ? `${name} · ${e.maybe}` : name
  return (
    <div
      className={`ev-card${phase === 'cancelled' ? ' ev-card--cancelled' : ''}`}
      role="group"
      aria-label={`Event: ${e.title}`}
    >
      <div className="ev-card-head">
        <Spark style={{ right: 30, top: 16 }} />
        <span className="ev-dot" aria-hidden="true" style={{ right: 90, top: 50 }} />
        <div className="ev-tile" aria-hidden="true">
          <span className="ev-tile-day">{tile.weekday}</span>
          <span className="ev-tile-num">{tile.day}</span>
          <span className="ev-tile-month">{tile.month}</span>
        </div>
        <div className="ev-card-title">
          <div className="ev-title">{e.title}</div>
          <div className="ev-sub">
            {eventTimeLabel(e.startsAt)}
            {voice && (
              <>
                {' · '}
                <SpeakerIcon size={14} color="#ffb347" />
                {voice.name}
              </>
            )}
            {e.host ? ` · hosted by ${firstName(e.host.displayName)}` : ''}
          </div>
          <div className="ev-when">{when}</div>
        </div>
      </div>
      <div className="ev-card-body">
        {e.description && <div className="ev-desc">{e.description}</div>}
        {!closed && (
          <div className="ev-rsvp" role="group" aria-label="Your answer">
            {RSVP_ANSWERS.map((a) => (
              <button
                key={a.id}
                type="button"
                aria-pressed={e.mine === a.id}
                className={`ev-rsvp-btn${e.mine === a.id ? ` ev-rsvp-btn--on ev-rsvp-btn--${a.id}` : ''}`}
                disabled={busy}
                onClick={() => void answer(a.id)}
              >
                {e.mine === a.id ? '✓ ' : ''}
                {label(a.id, a.name)}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            {phase === 'live' && voice ? (
              <button type="button" className="ev-link" onClick={() => onJoinVoice(voice.id)}>
                Join {voice.name}
              </button>
            ) : (
              <button
                type="button"
                className="ev-link"
                onClick={() =>
                  downloadIcs(
                    `${e.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'event'}.ics`,
                    eventIcs(e, `${c.name}${voice ? ` · ${voice.name}` : ''}`)
                  )
                }
              >
                Add to calendar
              </button>
            )}
          </div>
        )}
        <div className="ev-foot">
          {e.faces.length > 0 && (
            <span className="ev-faces" aria-hidden="true">
              {e.faces.map((f) => (
                <Avatar
                  key={f.id}
                  id={f.id}
                  name={f.displayName}
                  avatarVersion={f.avatarVersion}
                  size={26}
                />
              ))}
            </span>
          )}
          <span>
            {phase === 'cancelled' ? (
              'This event was cancelled.'
            ) : (
              <>
                <b>{e.going} going</b>
                {e.maybe ? ` · ${e.maybe} maybe` : ''}
              </>
            )}
          </span>
          <span style={{ flex: 1 }} />
          {e.canManage && phase !== 'cancelled' && phase !== 'ended' && (
            <button type="button" className="ev-manage" onClick={() => onEdit(e)}>
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** The sidebar chip: the next event (or the one happening now). Glows when it's soon or live. */
export function EventsChip({
  events,
  now,
  onOpen,
  onPlan
}: {
  events: ConstellationEvent[]
  now: number
  onOpen: (e: ConstellationEvent) => void
  /** Plan one (only for people who can), shown when nothing's coming up */
  onPlan: (() => void) | null
}): React.JSX.Element | null {
  const live = events.filter((e) => eventPhase(e, now) === 'live')
  const next = events
    .filter((e) => ['upcoming', 'soon'].includes(eventPhase(e, now)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const e = live[0] ?? next[0]
  if (!e) {
    if (!onPlan) return null
    return (
      <button type="button" className="ev-chip ev-chip--plan" onClick={onPlan}>
        <span aria-hidden="true">📅</span>
        <span>Plan an event</span>
      </button>
    )
  }
  const phase = eventPhase(e, now)
  const start = new Date(e.startsAt)
  const soonText =
    phase === 'live'
      ? null
      : phase === 'soon'
        ? `in ${Math.max(1, Math.ceil((start.getTime() - now) / 60_000))} min`
        : start.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <button
      type="button"
      className={`ev-chip${phase === 'live' || phase === 'soon' ? ' ev-chip--glow' : ''}${phase === 'live' ? ' ev-chip--live' : ''}`}
      onClick={() => onOpen(e)}
      aria-label={`${phase === 'live' ? 'Happening now' : 'Upcoming'}: ${e.title}`}
    >
      <span aria-hidden="true" className="ev-chip-icon">
        📅
      </span>
      <span className="ev-chip-text">
        <span className="ev-chip-label">{phase === 'live' ? 'HAPPENING NOW' : 'UPCOMING'}</span>
        <span className="ev-chip-name">
          {e.title.split(':')[0]} · {soonText ?? 'live now'}
        </span>
      </span>
      {live.length + next.length > 1 && (
        <span className="ev-chip-more" aria-label={`${live.length + next.length - 1} more`}>
          +{live.length + next.length - 1}
        </span>
      )}
    </button>
  )
}

const pad = (n: number): string => String(n).padStart(2, '0')
const localDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Plan an event, or change one. */
export function EventDialog({
  constellation: c,
  nebulaId,
  editing,
  onClose,
  onSaved
}: {
  constellation: ConstellationDetail
  /** Where the card goes (the nebula you're in, if it's a text one) */
  nebulaId: string | null
  editing: ConstellationEvent | null
  onClose: () => void
  onSaved: (e: ConstellationEvent | null) => void
}): React.JSX.Element {
  const textNebulas = c.nebulas.filter((n) => n.kind === 'text' && !n.readOnly)
  const voiceNebulas = c.nebulas.filter((n) => n.kind === 'voice')
  const [start] = useState(() => {
    if (editing) return new Date(editing.startsAt)
    const d = new Date(Date.now() + 24 * 3_600_000)
    d.setHours(20, 0, 0, 0)
    return d
  })
  const [title, setTitle] = useState(editing?.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [date, setDate] = useState(localDate(start))
  const [time, setTime] = useState(localTime(start))
  const [hours, setHours] = useState(() =>
    editing?.endsAt
      ? String(
          Math.round((Date.parse(editing.endsAt) - Date.parse(editing.startsAt)) / 1_800_000) / 2
        )
      : '3'
  )
  const [where, setWhere] = useState(
    editing?.nebulaId ??
      (textNebulas.some((n) => n.id === nebulaId) ? nebulaId! : (textNebulas[0]?.id ?? ''))
  )
  const [voice, setVoice] = useState(
    editing ? (editing.voiceNebulaId ?? '') : (voiceNebulas[0]?.id ?? '')
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => titleRef.current?.focus(), [])
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  async function save(): Promise<void> {
    const startsAt = new Date(`${date}T${time}`)
    if (Number.isNaN(startsAt.getTime())) {
      setError('Pick a day and a time.')
      return
    }
    const h = Number(hours)
    const endsAt = h > 0 ? new Date(startsAt.getTime() + h * 3_600_000) : null
    const values: EventValues = {
      nebulaId: where,
      title: title.trim(),
      description: description.trim() || null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt ? endsAt.toISOString() : null,
      voiceNebulaId: voice || null,
      timeZone: zone ?? null
    }
    setBusy(true)
    setError(null)
    const r = editing
      ? await community.updateEvent(c.id, editing.id, {
          title: values.title,
          description: values.description,
          startsAt: values.startsAt,
          endsAt: values.endsAt,
          voiceNebulaId: values.voiceNebulaId,
          timeZone: values.timeZone
        })
      : await community.createEvent(c.id, values)
    setBusy(false)
    if (r.ok) onSaved(r.data.event)
    else setError(r.message)
  }
  async function cancelIt(): Promise<void> {
    if (!editing) return
    setBusy(true)
    const r = await community.cancelEvent(c.id, editing.id)
    setBusy(false)
    if (r.ok) onSaved(null)
    else setError(r.message)
  }

  return (
    <div
      className="cx-dialog-backdrop"
      onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}
    >
      <form
        className="cx-dialog ev-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ev-dialog-title"
        onSubmit={(ev) => {
          ev.preventDefault()
          void save()
        }}
      >
        <header className="ev-dialog-head">
          <h2 id="ev-dialog-title">{editing ? 'Change event' : 'Plan an event'}</h2>
          <button type="button" className="cx-settings-close" aria-label="Close" onClick={onClose}>
            <CloseIcon size={20} />
          </button>
        </header>
        <label className="ev-field">
          <span>What&apos;s happening?</span>
          <input
            ref={titleRef}
            value={title}
            maxLength={EVENT_TITLE_MAX}
            placeholder="Game Night: Rocket League + Minecraft"
            onChange={(ev) => setTitle(ev.target.value)}
            required
          />
        </label>
        <label className="ev-field">
          <span>
            Details <em>(optional)</em>
          </span>
          <textarea
            value={description}
            maxLength={EVENT_DESCRIPTION_MAX}
            rows={3}
            placeholder="2v2 bracket first, then we build the castle. Bring snacks 🍿"
            onChange={(ev) => setDescription(ev.target.value)}
          />
        </label>
        <div className="ev-row">
          <label className="ev-field">
            <span>Day</span>
            <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} required />
          </label>
          <label className="ev-field">
            <span>Time</span>
            <input type="time" value={time} onChange={(ev) => setTime(ev.target.value)} required />
          </label>
          <label className="ev-field">
            <span>How long</span>
            <select value={hours} onChange={(ev) => setHours(ev.target.value)}>
              <option value="1">1 hour</option>
              <option value="2">2 hours</option>
              <option value="3">3 hours</option>
              <option value="4">4 hours</option>
              <option value="6">6 hours</option>
              <option value="0">Not sure</option>
            </select>
          </label>
        </div>
        <div className="ev-row">
          {!editing && (
            <label className="ev-field">
              <span>Post it in</span>
              <select value={where} onChange={(ev) => setWhere(ev.target.value)} required>
                {textNebulas.map((n) => (
                  <option key={n.id} value={n.id}>
                    # {n.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="ev-field">
            <span>Voice nebula</span>
            <select value={voice} onChange={(ev) => setVoice(ev.target.value)}>
              <option value="">None</option>
              {voiceNebulas.map((n) => (
                <option key={n.id} value={n.id}>
                  🔊 {n.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="ev-hint">
          Times show in each person&apos;s own time zone. Going and Maybe get a reminder 15 minutes
          before{voice ? ', and the voice nebula shows EVENT when it starts' : ''}.
        </p>
        {error && (
          <p className="cx-error" role="alert">
            {error}
          </p>
        )}
        <footer className="ev-dialog-foot">
          {editing &&
            (confirmCancel ? (
              <button
                type="button"
                className="ev-danger"
                disabled={busy}
                onClick={() => void cancelIt()}
              >
                Yes, cancel it
              </button>
            ) : (
              <button
                type="button"
                className="ev-quiet-danger"
                onClick={() => setConfirmCancel(true)}
              >
                Cancel event
              </button>
            ))}
          <span style={{ flex: 1 }} />
          <button type="button" className="cx-button" onClick={onClose}>
            Close
          </button>
          <button
            type="submit"
            className="cx-button cx-button--primary"
            disabled={busy || !title.trim() || !where}
          >
            {editing ? 'Save' : 'Post event'}
          </button>
        </footer>
      </form>
    </div>
  )
}
