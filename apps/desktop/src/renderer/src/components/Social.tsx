// 0.5.0 social extras on the computer (desktop app and browser): glows by friends' names,
// "Want to hang?", birthdays, who's live, and the Year in Glow recap.
import { useEffect, useMemo, useState } from 'react'
import {
  glowDetail,
  glowLabel,
  HANG_MINUTES,
  type Glow,
  type YearInGlow
} from '@glofly/shared/social'
import type { PublicUser } from '../../../preload/api-types'
import { patchSocial, refreshSocial, useSocial } from '../lib/social'
import Avatar from './Avatar'
import EmojiText from './EmojiText'
import { PhoneIcon } from './icons'
import './Social.css'

// ---------------------------------------------------------------------------------------------
// Glows

/** The little firefly by a friend's name: brighter each day you both write. */
export function GlowMark({ glow, name }: { glow: Glow; name: string }): React.JSX.Element {
  return (
    <span
      className={`glow-mark glow-mark--l${glow.level}${glow.litToday ? ' glow-mark--lit' : ''}`}
      title={`${glowLabel(glow)} with ${name}. ${glowDetail(glow, name.split(/\s+/)[0])}`}
      aria-label={`${glowLabel(glow)}${glow.litToday ? ', lit today' : ''}`}
      role="img"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8.5" r="4" className="glow-mark-body" />
        <path
          d="M5.2 5.4C3.6 3.6 3 2.6 3.4 2.1c.6-.6 2.3.8 3.3 2.6M10.8 5.4c1.6-1.8 2.2-2.8 1.8-3.3-.6-.6-2.3.8-3.3 2.6"
          className="glow-mark-wings"
        />
      </svg>
      <span className="glow-mark-days">{glow.days}</span>
    </span>
  )
}

/** "🎂" by a friend's name on their birthday. */
export function BirthdayMark({ name }: { name: string }): React.JSX.Element {
  return (
    <span
      className="birthday-mark"
      title={`It's ${name}'s birthday today!`}
      role="img"
      aria-label="Birthday today"
    >
      🎂
    </span>
  )
}

// ---------------------------------------------------------------------------------------------
// Want to hang? and Go live: the two buttons under your name

function minutesLeft(until: string, now: number): number {
  const left = Math.ceil((new Date(until).getTime() - now) / 60_000)
  return Math.min(HANG_MINUTES, Math.max(1, left))
}

export function SocialActions({
  friends,
  now,
  live,
  onGoLive,
  onManageLive
}: {
  friends: PublicUser[]
  now: number
  /** You're broadcasting: how many are watching */
  live: { viewers: number } | null
  onGoLive: () => void
  onManageLive: () => void
}): React.JSX.Element {
  const social = useSocial()
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const hang = social.myHang && new Date(social.myHang.until).getTime() > now ? social.myHang : null

  async function stop(): Promise<void> {
    setBusy(true)
    patchSocial({ myHang: null })
    await window.glofly.social.stopHang()
    setBusy(false)
    void refreshSocial()
  }

  return (
    <div className="social-actions">
      {hang ? (
        <span
          className="social-pill social-pill--hang"
          role="status"
          title={`You're free to hang for ${minutesLeft(hang.until, now)} more minutes`}
        >
          <span className="social-pill-dot" aria-hidden="true" />
          Free · {minutesLeft(hang.until, now)} min
          <button
            type="button"
            aria-label="Stop being free to hang"
            title="Stop"
            disabled={busy}
            onClick={() => void stop()}
          >
            ×
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="social-button"
          title={`Tell friends you're free for a call for the next ${HANG_MINUTES} minutes`}
          onClick={() => setPicking(true)}
        >
          <HangIcon />
          Want to hang?
        </button>
      )}
      {live ? (
        <button
          type="button"
          className="social-pill social-pill--live"
          onClick={onManageLive}
          title="Your broadcast"
        >
          <span className="live-dot" aria-hidden="true" />
          Live · {live.viewers} watching
        </button>
      ) : (
        <button
          type="button"
          className="social-button"
          onClick={onGoLive}
          title="Share your screen for any friend to drop in and watch"
        >
          <LiveIcon />
          Go live
        </button>
      )}
      {picking && <HangDialog friends={friends} onClose={() => setPicking(false)} />}
    </div>
  )
}

export function HangIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
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
      <path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" />
      <path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17" />
      <path d="M8 2.5c-.6.8-.6 1.7 0 2.5M12 2.5c-.6.8-.6 1.7 0 2.5" />
    </svg>
  )
}

export function LiveIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
    </svg>
  )
}

/** Pick who to tell: every friend, or just some. */
function HangDialog({
  friends,
  onClose
}: {
  friends: PublicUser[]
  onClose: () => void
}): React.JSX.Element {
  const [everyone, setEveryone] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? friends.filter(
          (f) => f.displayName.toLowerCase().includes(q) || f.username.toLowerCase().includes(q)
        )
      : friends
  }, [friends, query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function tell(): Promise<void> {
    setBusy(true)
    setProblem('')
    const r = await window.glofly.social.hang(everyone ? null : [...picked])
    setBusy(false)
    if (!r.ok) return setProblem(r.message)
    patchSocial({ myHang: { until: r.data.until, with: r.data.with } })
    void refreshSocial()
    onClose()
  }

  const ready = everyone ? friends.length > 0 : picked.size > 0
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hang-title"
        className="dialog hang-dialog"
      >
        <div className="hang-hero" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1 id="hang-title">Want to hang?</h1>
        <p className="hang-sub">
          Friends you pick get a gentle ping that you&apos;re free for a call for the next hour,
          with a button to call you.
        </p>
        <div className="hang-choice" role="radiogroup" aria-label="Who to tell">
          <button
            type="button"
            role="radio"
            aria-checked={everyone}
            className={everyone ? 'hang-option hang-option--on' : 'hang-option'}
            onClick={() => setEveryone(true)}
          >
            All friends <span>{friends.length}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!everyone}
            className={!everyone ? 'hang-option hang-option--on' : 'hang-option'}
            onClick={() => setEveryone(false)}
          >
            Pick friends {picked.size > 0 && <span>{picked.size}</span>}
          </button>
        </div>
        {!everyone && (
          <>
            <input
              className="hang-search"
              placeholder="Find a friend"
              value={query}
              maxLength={40}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Find a friend"
              autoFocus
            />
            <div className="hang-list" role="group" aria-label="Friends">
              {shown.map((f) => {
                const on = picked.has(f.id)
                return (
                  <label key={f.id} className={on ? 'hang-person hang-person--on' : 'hang-person'}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setPicked((set) => {
                          const next = new Set(set)
                          if (on) next.delete(f.id)
                          else next.add(f.id)
                          return next
                        })
                      }
                    />
                    <Avatar
                      id={f.id}
                      name={f.displayName}
                      avatarVersion={f.avatarVersion}
                      size={32}
                    />
                    <span className="hang-person-name">
                      <EmojiText text={f.displayName} />
                    </span>
                  </label>
                )
              })}
              {shown.length === 0 && <p className="hang-empty">No friends match.</p>}
            </div>
          </>
        )}
        {problem && <p className="dialog-message">{problem}</p>}
        <div className="confirm-actions">
          <button type="button" className="small-button small-button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="small-button small-button--primary"
            disabled={!ready || busy}
            onClick={() => void tell()}
          >
            {busy
              ? 'Telling them…'
              : everyone
                ? 'Tell all my friends'
                : `Tell ${picked.size || ''} ${picked.size === 1 ? 'friend' : 'friends'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// The strip above the chat list: who's live, who's free to hang, birthdays today

export function SocialStrip({
  people,
  meId,
  now,
  onWatch,
  onCall,
  onMessage
}: {
  /** Friends by id */
  people: Map<string, PublicUser>
  meId: string
  now: number
  onWatch: (userId: string) => void
  onCall: (userId: string) => void
  onMessage: (userId: string) => void
}): React.JSX.Element | null {
  const social = useSocial()
  const live = social.broadcasts.filter((b) => b.userId !== meId && people.has(b.userId))
  const hanging = social.hanging.filter(
    (h) => new Date(h.until).getTime() > now && people.has(h.userId)
  )
  const birthdays = social.birthdays.filter((id) => people.has(id))
  if (!live.length && !hanging.length && !birthdays.length) return null
  return (
    <div className="social-strip" aria-label="Friends right now">
      {live.map((b) => {
        const p = people.get(b.userId)!
        return (
          <button
            key={`live-${b.userId}`}
            type="button"
            className="social-row social-row--live"
            onClick={() => onWatch(b.userId)}
            title={b.title ?? `Watch ${p.displayName}`}
          >
            <span className="social-face social-face--live">
              <Avatar id={p.id} name={p.displayName} avatarVersion={p.avatarVersion} size={32} />
            </span>
            <span className="social-row-text">
              <span className="social-row-name">
                <EmojiText text={p.displayName} />
              </span>
              <span className="social-row-sub">
                <span className="live-badge">LIVE</span>
                {b.title ? <EmojiText text={b.title} /> : `${b.viewers} watching`}
              </span>
            </span>
            <span className="social-row-go">Watch</span>
          </button>
        )
      })}
      {hanging.map((h) => {
        const p = people.get(h.userId)!
        return (
          <div key={`hang-${h.userId}`} className="social-row social-row--hang">
            <button
              type="button"
              className="social-row-main"
              onClick={() => onMessage(h.userId)}
              title={`Message ${p.displayName}`}
            >
              <span className="social-face social-face--hang">
                <Avatar id={p.id} name={p.displayName} avatarVersion={p.avatarVersion} size={32} />
              </span>
              <span className="social-row-text">
                <span className="social-row-name">
                  <EmojiText text={p.displayName} />
                </span>
                <span className="social-row-sub">
                  Free to hang · {minutesLeft(h.until, now)} min
                </span>
              </span>
            </button>
            <button
              type="button"
              className="social-row-call"
              aria-label={`Call ${p.displayName}`}
              title="Call"
              onClick={() => onCall(h.userId)}
            >
              <PhoneIcon size={16} />
            </button>
          </div>
        )
      })}
      {birthdays.map((id) => {
        const p = people.get(id)!
        return (
          <button
            key={`bday-${id}`}
            type="button"
            className="social-row social-row--birthday"
            onClick={() => onMessage(id)}
            title={`Wish ${p.displayName} a happy birthday`}
          >
            <span className="social-face">
              <Avatar id={p.id} name={p.displayName} avatarVersion={p.avatarVersion} size={32} />
              <span className="social-face-cake" aria-hidden="true">
                🎂
              </span>
            </span>
            <span className="social-row-text">
              <span className="social-row-name">
                <EmojiText text={p.displayName} />
              </span>
              <span className="social-row-sub">Birthday today</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** "Maya is free to hang" with Call and Message, when a ping arrives. */
export function HangToast({
  person,
  onCall,
  onMessage,
  onClose
}: {
  person: PublicUser
  onCall: () => void
  onMessage: () => void
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
    const t = setTimeout(onClose, 30_000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className="hang-toast" role="status">
      <Avatar
        id={person.id}
        name={person.displayName}
        avatarVersion={person.avatarVersion}
        size={40}
      />
      <span className="hang-toast-text">
        <strong>
          <EmojiText text={person.displayName} />
        </strong>
        is free to hang for the next hour
      </span>
      <button type="button" className="small-button small-button--primary" onClick={onCall}>
        <PhoneIcon size={16} /> Call
      </button>
      <button type="button" className="small-button small-button--quiet" onClick={onMessage}>
        Message
      </button>
      <button type="button" className="hang-toast-close" aria-label="Dismiss" onClick={onClose}>
        ×
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Birthday confetti (once a day, the first time you open their chat)

export function BirthdayConfetti({
  userId,
  name
}: {
  userId: string
  name: string
}): React.JSX.Element | null {
  const [show] = useState(() => {
    const key = `glofly.bday.${userId}.${new Date().toDateString()}`
    try {
      if (localStorage.getItem(key)) return false
      localStorage.setItem(key, '1')
    } catch {
      // No storage: show it (once per opening is fine).
    }
    return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  })
  const [done, setDone] = useState(false)
  const [pieces] = useState(() =>
    Array.from({ length: 60 }, (_, i) => ({
      x: Math.random() * 100,
      delay: Math.random() * 600,
      drift: (Math.random() - 0.5) * 160,
      spin: (Math.random() - 0.5) * 720,
      color: ['#F47A1F', '#FFD27A', '#E0353F', '#4FB3BF', '#9B5DE5', '#2E9E5B'][i % 6],
      w: 6 + Math.random() * 6
    }))
  )
  useEffect(() => {
    const t = setTimeout(() => setDone(true), 4200)
    return () => clearTimeout(t)
  }, [])
  if (!show || done) return null
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={
            {
              left: `${p.x}%`,
              width: p.w,
              height: p.w * 0.45,
              background: p.color,
              animationDelay: `${p.delay}ms`,
              '--drift': `${p.drift}px`,
              '--spin': `${p.spin}deg`
            } as React.CSSProperties
          }
        />
      ))}
      <div className="confetti-banner">
        🎂 It&apos;s {name.split(/\s+/)[0]}&apos;s birthday today!
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Year in Glow

export function YearInGlowDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [year, setYear] = useState<YearInGlow | null>(null)
  const [problem, setProblem] = useState('')
  const [slide, setSlide] = useState(0)

  useEffect(() => {
    let cancelled = false
    void window.glofly.social.year().then((r) => {
      if (cancelled) return
      if (r.ok) setYear(r.data)
      else setProblem(r.message)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const slides = year ? yearSlides(year) : []
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setSlide((s) => Math.min(s + 1, slides.length - 1))
      if (e.key === 'ArrowLeft') setSlide((s) => Math.max(s - 1, 0))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, slides.length])

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Year in Glow" className="year-glow">
        <button type="button" className="year-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="year-sky" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <span
              key={i}
              style={{
                left: `${(i * 37) % 100}%`,
                top: `${(i * 53) % 100}%`,
                animationDelay: `${(i % 6) * 0.5}s`
              }}
            />
          ))}
        </div>
        {!year ? (
          <div className="year-slide">
            <p className="year-kicker">Year in Glow</p>
            <p className="year-big">{problem || 'Gathering your year…'}</p>
          </div>
        ) : (
          <>
            <div className="year-progress" aria-hidden="true">
              {slides.map((_, i) => (
                <span key={i} className={i <= slide ? 'year-progress-on' : undefined} />
              ))}
            </div>
            <div className="year-slide" key={slide} aria-live="polite">
              {slides[slide]}
            </div>
            <div className="year-nav">
              <button
                type="button"
                disabled={slide === 0}
                onClick={() => setSlide((s) => s - 1)}
                aria-label="Back"
              >
                ‹
              </button>
              {slide < slides.length - 1 ? (
                <button type="button" className="year-next" onClick={() => setSlide((s) => s + 1)}>
                  Next
                </button>
              ) : (
                <button type="button" className="year-next" onClick={onClose}>
                  Done
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function yearSlides(y: YearInGlow): React.ReactNode[] {
  const person = (id: string): PublicUser | undefined => y.people.find((p) => p.id === id)
  const out: React.ReactNode[] = []
  out.push(
    <>
      <p className="year-kicker">{y.soFar ? `Your ${y.year} so far` : `Your ${y.year}`}</p>
      <p className="year-title">Year in Glow</p>
      <p className="year-big">
        <b>{y.messagesSent.toLocaleString()}</b> messages sent
      </p>
      {y.busiestDay && (
        <p className="year-small">
          Your busiest day was{' '}
          {new Date(`${y.busiestDay.day}T12:00:00`).toLocaleDateString(undefined, {
            month: 'long',
            day: 'numeric'
          })}{' '}
          with {y.busiestDay.messages} messages.
        </p>
      )}
    </>
  )
  if (y.topFriends.length) {
    out.push(
      <>
        <p className="year-kicker">Who you glowed with most</p>
        <ol className="year-people">
          {y.topFriends.map((f, i) => {
            const p = person(f.userId)
            return p ? (
              <li key={f.userId} style={{ animationDelay: `${i * 150}ms` }}>
                <Avatar
                  id={p.id}
                  name={p.displayName}
                  avatarVersion={p.avatarVersion}
                  size={i === 0 ? 72 : 52}
                />
                <span className="year-person-name">
                  <EmojiText text={p.displayName} />
                </span>
                <span className="year-person-sub">{f.messages.toLocaleString()} messages</span>
              </li>
            ) : null
          })}
        </ol>
        {y.topGroup && (
          <p className="year-small">
            Favorite group:{' '}
            <b>
              <EmojiText text={y.topGroup.name} />
            </b>{' '}
            ({y.topGroup.messages.toLocaleString()} messages)
          </p>
        )}
      </>
    )
  }
  if (y.longestGlow) {
    const p = person(y.longestGlow.userId)
    out.push(
      <>
        <p className="year-kicker">Your longest glow</p>
        <div className="year-glow-big" aria-hidden="true" />
        <p className="year-big">
          <b>{y.longestGlow.days} days</b>
        </p>
        <p className="year-small">with {p ? <EmojiText text={p.displayName} /> : 'a friend'}</p>
      </>
    )
  }
  out.push(
    <>
      <p className="year-kicker">On calls</p>
      <p className="year-big">
        <b>
          {y.callMinutes >= 120
            ? `${Math.round(y.callMinutes / 60)} hours`
            : `${y.callMinutes} minutes`}
        </b>
      </p>
      <p className="year-small">
        across {y.calls} {y.calls === 1 ? 'call' : 'calls'} · {y.photosSent} photos · {y.gifsSent}{' '}
        GIFs
      </p>
    </>
  )
  if (y.topEmoji.length) {
    out.push(
      <>
        <p className="year-kicker">Your top emoji</p>
        <div className="year-emoji">
          {y.topEmoji.map((e, i) => (
            <span
              key={e.emoji}
              style={{ animationDelay: `${i * 120}ms`, fontSize: i === 0 ? 64 : 40 }}
              title={`${e.count} times`}
            >
              {e.emoji}
            </span>
          ))}
        </div>
        <p className="year-small">
          {y.topEmoji[0].emoji} {y.topEmoji[0].count.toLocaleString()} times
        </p>
      </>
    )
  }
  out.push(
    <>
      <p className="year-kicker">Thanks for glowing</p>
      <p className="year-title">See you in {y.soFar ? 'December' : y.year + 1} ✨</p>
    </>
  )
  return out
}
