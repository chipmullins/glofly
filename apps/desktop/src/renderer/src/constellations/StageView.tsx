import { useEffect, useState } from 'react'
import {
  STAGE_SPEAKER_CHOICES,
  STAGE_TOPIC_MAX,
  stageLine,
  type MyStage,
  type StageState
} from '@glofly/shared/stages'
import type {
  ConstellationDetail,
  Nebula,
  PublicUser,
  SignedInUser
} from '../../../preload/api-types'
import { AvatarFace } from '../components/Avatar'
import { colorsFor } from '../lib/avatarColors'
import { can } from '../lib/constellations'
import { joinStage, leaveStage, setStageMic, stageApi, startStage, useOnStage } from '../lib/stage'
import { useCalls } from '../calls/callState'
import './Stage.css'

// Communities round 2, board 3a (approved): a stage nebula. Speakers big in the middle (the host
// tagged), the listening faces and count below, Raise hand / Leave quietly; managers get the raised
// hands with Invite and the stage controls on the right. "Riley invited you to speak" pops up for a
// listener who was asked up.

type Props = {
  c: ConstellationDetail
  nebula: Nebula
  me: SignedInUser
  people: Map<string, PublicUser>
  onOpenChat: () => void
  onProblem: (message: string) => void
}

function Face({
  id,
  person,
  size,
  ring,
  mine
}: {
  id: string
  person: PublicUser | undefined
  size: number
  ring?: boolean
  mine?: boolean
}): React.JSX.Element {
  const [bg, fg] = mine ? ['#f47a1f', '#2a1406'] : colorsFor(id)
  return (
    <span
      className={ring ? 'st-face st-face--talking' : 'st-face'}
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      <AvatarFace id={id} name={person?.displayName ?? '?'} avatarVersion={person?.avatarVersion} />
    </span>
  )
}

const ago = (iso: string): string => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`
}
const minutes = (iso: string): string => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  return m < 1 ? 'now' : `${m} min`
}

function roleName(c: ConstellationDetail, userId: string): string {
  if (userId === c.ownerId) return 'Owner'
  const m = c.members.find((x) => x.user.id === userId)
  const roles = c.roles.filter((r) => m?.roleIds.includes(r.id) && !r.selfAssign)
  roles.sort((a, b) => b.position - a.position)
  return roles[0]?.name ?? 'Member'
}

export default function StageView({
  c,
  nebula,
  me,
  people,
  onOpenChat,
  onProblem
}: Props): React.JSX.Element {
  const stage: StageState | null = c.stages?.find((s) => s.nebulaId === nebula.id) ?? null
  const manage = can(c, 'manageStages')
  const on = useOnStage()
  const calls = useCalls()
  const here = on?.nebulaId === nebula.id ? on : null
  const [mine, setMine] = useState<MyStage | null>(null)
  const [busy, setBusy] = useState(false)
  const [topic, setTopic] = useState('')
  const [invitedBy, setInvitedBy] = useState<string | null>(null)

  // What I am on it (asked up, hand raised) comes from the server.
  useEffect(() => {
    let gone = false
    void stageApi.get(c.id, nebula.id).then((r) => {
      if (!gone && r.ok) setMine(r.data.me)
    })
    return () => {
      gone = true
    }
  }, [c.id, nebula.id, stage?.id, stage?.handCount, stage?.speakers.length, here?.role])
  useEffect(
    () =>
      window.glofly.onEvent((e) => {
        if (e.type === 'stage:invited' && e.nebulaId === nebula.id) {
          setInvitedBy(e.invited ? e.byName || 'A moderator' : null)
          setMine((m) => (m ? { ...m, role: e.invited ? 'invited' : m.role } : m))
        }
      }),
    [nebula.id]
  )

  const run = async (fn: () => Promise<string | null>): Promise<void> => {
    setBusy(true)
    const problem = await fn()
    setBusy(false)
    if (problem) onProblem(problem)
  }
  const ok = async (r: Promise<{ ok: boolean; message?: string }>): Promise<string | null> => {
    const x = (await r) as { ok: boolean; message?: string }
    return x.ok ? null : (x.message ?? "That didn't work.")
  }
  const leaveCallFirst = (): string | null =>
    calls.current ? 'Leave your call first, then join the stage.' : null

  if (!stage) {
    return (
      <main className="st-stage st-stage--quiet">
        <div className="st-quiet">
          <span className="st-quiet-icon" aria-hidden="true">
            <MegaphoneIcon size={28} />
          </span>
          <h2>#{nebula.name}</h2>
          <p>
            {nebula.topic || 'A stage for town halls, Q&As and events. Nobody’s on it right now.'}
          </p>
          {manage ? (
            <form
              className="st-start"
              onSubmit={(e) => {
                e.preventDefault()
                if (!topic.trim()) return
                void run(
                  async () => leaveCallFirst() ?? (await startStage(c.id, nebula.id, { topic }))
                )
              }}
            >
              <input
                type="text"
                value={topic}
                maxLength={STAGE_TOPIC_MAX}
                placeholder="What’s it about? (Season 3 town hall)"
                aria-label="Stage topic"
                onChange={(e) => setTopic(e.target.value)}
              />
              <button
                type="submit"
                className="st-button st-button--primary"
                disabled={busy || !topic.trim()}
              >
                Start the stage
              </button>
            </form>
          ) : (
            <p className="st-quiet-small">
              You’ll see it go LIVE in the sidebar when a stage starts.
            </p>
          )}
          <button type="button" className="st-link" onClick={onOpenChat}>
            Open the chat
          </button>
        </div>
      </main>
    )
  }

  const person = (id: string): PublicUser | undefined => (id === me.id ? me : people.get(id))
  const name = (id: string): string =>
    id === me.id ? 'You' : (person(id)?.displayName ?? 'Someone')
  const starter = person(stage.startedBy)?.displayName ?? 'someone'
  const speaking = new Set(here?.speaking ?? [])
  const muted = new Set(here?.muted ?? [])
  const imSpeaker = here?.role === 'speaker'
  const asked = mine?.role === 'invited' && !imSpeaker
  const listenersShown = stage.listeners.filter(
    (id) => !stage.speakers.some((s) => s.userId === id)
  )
  const more = Math.max(0, stage.listenerCount - listenersShown.length)

  return (
    <div className="st-wrap">
      <main className="st-stage">
        <header className="st-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{stage.topic}</h2>
            <div className="st-sub">
              Stage in #{nebula.name} · started {ago(stage.startedAt)} by {starter}
            </div>
          </div>
          <span className="st-pill">{stage.listenerCount.toLocaleString('en-US')} listening</span>
          <button type="button" className="st-pill st-pill--button" onClick={onOpenChat}>
            Chat
          </button>
        </header>
        <div className="st-speakers" aria-label={stageLine(stage)}>
          {stage.speakers.length === 0 && <p className="st-sub">Nobody’s speaking right now.</p>}
          {stage.speakers.map((s) => (
            <div key={s.userId} className="st-speaker">
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <Face
                  id={s.userId}
                  person={person(s.userId)}
                  size={80}
                  ring={speaking.has(s.userId) && !muted.has(s.userId)}
                  mine={s.userId === me.id}
                />
                {muted.has(s.userId) && (
                  <span className="st-muted" aria-label="Muted">
                    <MicOffIcon size={13} />
                  </span>
                )}
              </span>
              <b>{name(s.userId)}</b>
              <span className="st-role">
                {s.invited ? 'Invited speaker' : roleName(c, s.userId)}
              </span>
              {s.host && <span className="st-host">Host</span>}
            </div>
          ))}
        </div>
        <b className="st-label">LISTENING · {stage.listenerCount.toLocaleString('en-US')}</b>
        <div className="st-listeners">
          {listenersShown.map((id) => (
            <span key={id} title={name(id)}>
              <Face id={id} person={person(id)} size={34} mine={id === me.id} />
            </span>
          ))}
          {more > 0 && <span className="st-more">+{more.toLocaleString('en-US')}</span>}
        </div>
        <div className="st-actions">
          {!here ? (
            <>
              <button
                type="button"
                className="st-button st-button--primary"
                disabled={busy}
                onClick={() =>
                  void run(
                    async () => leaveCallFirst() ?? (await joinStage(c.id, nebula.id, 'listener'))
                  )
                }
              >
                <HeadphonesIcon size={18} />
                Listen in
              </button>
              {(manage || asked) && (
                <button
                  type="button"
                  className="st-button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      async () => leaveCallFirst() ?? (await joinStage(c.id, nebula.id, 'speaker'))
                    )
                  }
                >
                  Join as a speaker
                </button>
              )}
            </>
          ) : imSpeaker ? (
            <>
              <button
                type="button"
                className={here.micOn ? 'st-button' : 'st-button st-button--primary'}
                disabled={busy}
                onClick={() => void run(() => setStageMic(!here.micOn))}
              >
                {here.micOn ? <MicIcon size={18} /> : <MicOffIcon size={18} />}
                {here.micOn ? 'Mute' : 'Unmute'}
              </button>
              <button
                type="button"
                className="st-button"
                disabled={busy}
                onClick={() => void run(() => ok(stageApi.audience(c.id, nebula.id, me.id)))}
              >
                Move to the audience
              </button>
              <button type="button" className="st-button" onClick={() => void leaveStage()}>
                <LeaveIcon size={18} />
                Leave quietly
              </button>
            </>
          ) : (
            <>
              {stage.handsOn && (
                <button
                  type="button"
                  className={mine?.handUp ? 'st-button' : 'st-button st-button--primary'}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await stageApi.hand(c.id, nebula.id, !mine?.handUp)
                      if (r.ok) setMine(r.data.me)
                      return r.ok ? null : r.message
                    })
                  }
                >
                  <HandIcon size={18} />
                  {mine?.handUp ? 'Lower hand' : 'Raise hand'}
                </button>
              )}
              <button type="button" className="st-button" onClick={() => void leaveStage()}>
                <LeaveIcon size={18} />
                Leave quietly
              </button>
            </>
          )}
        </div>
        <span className="st-note">
          {imSpeaker
            ? 'You’re on stage. Everyone listening can hear you when you’re unmuted.'
            : here
              ? 'You’re listening. Your mic and camera aren’t used, so it’s light on data.'
              : here === null && on
                ? 'You’re on another stage. Joining this one leaves it.'
                : 'Listeners only receive: your mic and camera aren’t used.'}
        </span>
        {(asked || invitedBy) && !imSpeaker && (
          <div className="st-invite" role="dialog" aria-label="Invited to speak">
            <b>{invitedBy ?? 'A moderator'} invited you to speak</b>
            <span>You’ll join with your mic muted. Glofly asks for the microphone only now.</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="st-button st-button--primary st-button--small"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const p = leaveCallFirst() ?? (await joinStage(c.id, nebula.id, 'speaker'))
                    if (!p) setInvitedBy(null)
                    return p
                  })
                }
              >
                Join as a speaker
              </button>
              <button
                type="button"
                className="st-button st-button--small"
                onClick={() => {
                  setInvitedBy(null)
                  setMine((m) => (m ? { ...m, role: here ? 'listener' : null } : m))
                }}
              >
                Stay listening
              </button>
            </div>
          </div>
        )}
      </main>
      {manage && (
        <aside className="st-side" aria-label="Stage controls">
          <div className="st-side-head">
            <b>Raised hands · {stage.handCount}</b>
            <span className="st-pill st-pill--quiet">Moderators only</span>
          </div>
          {(stage.hands ?? []).length === 0 && <p className="st-sub">No hands up.</p>}
          {(stage.hands ?? []).map((h) => (
            <div key={h.userId} className="st-hand">
              <Face id={h.userId} person={person(h.userId)} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{name(h.userId)}</b>
                <div className="st-sub">{minutes(h.at)}</div>
              </div>
              <button
                type="button"
                className="st-button st-button--primary st-button--small"
                disabled={busy}
                onClick={() => void run(() => ok(stageApi.invite(c.id, nebula.id, h.userId)))}
              >
                Invite
              </button>
            </div>
          ))}
          <span className="st-rule" />
          <b>Stage controls</b>
          <Toggle
            label="Hands up allowed"
            on={stage.handsOn}
            onChange={(v) => void run(() => ok(stageApi.change(c.id, nebula.id, { handsOn: v })))}
          />
          <Toggle
            label={`Listeners can chat in #${nebula.name}`}
            on={stage.listenerChat}
            onChange={(v) =>
              void run(() => ok(stageApi.change(c.id, nebula.id, { listenerChat: v })))
            }
          />
          <label className="st-row">
            <span style={{ flex: 1 }}>Speaker limit</span>
            <select
              value={stage.speakerLimit}
              onChange={(e) =>
                void run(() =>
                  ok(stageApi.change(c.id, nebula.id, { speakerLimit: Number(e.target.value) }))
                )
              }
            >
              {[...new Set([...STAGE_SPEAKER_CHOICES, stage.speakerLimit])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
          </label>
          <div className="st-side-foot">
            {stage.speakers
              .filter((s) => s.userId !== me.id && s.userId !== c.ownerId)
              .slice(0, 3)
              .map((s) => (
                <button
                  key={s.userId}
                  type="button"
                  className="st-button st-button--small"
                  disabled={busy}
                  onClick={() => void run(() => ok(stageApi.audience(c.id, nebula.id, s.userId)))}
                >
                  Move {name(s.userId)} to audience
                </button>
              ))}
            <button
              type="button"
              className="st-button st-button--danger st-button--small"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const p = await ok(stageApi.end(c.id, nebula.id))
                  if (!p && here) await leaveStage(false)
                  return p
                })
              }
            >
              End the stage for everyone
            </button>
          </div>
        </aside>
      )}
    </div>
  )
}

function Toggle({
  label,
  on,
  onChange
}: {
  label: string
  on: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <label className="st-row st-toggle">
      <input
        type="checkbox"
        role="switch"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="st-switch" aria-hidden="true" />
      <span>{label}</span>
    </label>
  )
}

type IconProps = { size?: number }
const svg = (size: number, d: React.ReactNode): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {d}
  </svg>
)
export const MegaphoneIcon = ({ size = 16 }: IconProps): React.JSX.Element =>
  svg(
    size,
    <>
      <path d="M3 10v4h4l7 4V6L7 10z" />
      <path d="M17 9a4 4 0 0 1 0 6" />
    </>
  )
const HandIcon = ({ size = 16 }: IconProps): React.JSX.Element =>
  svg(
    size,
    <path d="M8 11V5a1.5 1.5 0 0 1 3 0v5M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14a1.5 1.5 0 0 1 2.5-1.6L8 15" />
  )
const LeaveIcon = ({ size = 16 }: IconProps): React.JSX.Element =>
  svg(size, <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" />)
const MicOffIcon = ({ size = 16 }: IconProps): React.JSX.Element =>
  svg(
    size,
    <path d="M9 9v2a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.5 5.3M19 11c0 .9-.2 1.8-.5 2.6M12 18v3M3 3l18 18" />
  )
const MicIcon = ({ size = 16 }: IconProps): React.JSX.Element =>
  svg(
    size,
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  )
const HeadphonesIcon = ({ size = 16 }: IconProps): React.JSX.Element =>
  svg(
    size,
    <>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="15" width="4" height="6" rx="1.5" />
      <rect x="17" y="15" width="4" height="6" rx="1.5" />
    </>
  )
