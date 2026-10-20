import { useEffect, useRef, useState } from 'react'
import { milestoneText } from '@glofly/shared/groups'
import type { Message } from '../../../preload/api-types'
import { clockTime } from '../lib/time'
import EmojiText from './EmojiText'
import './CxEventLine.css'

// 0.7.5 Constellations polish, "Little celebrations" (the approved Celebrations board): the line
// a constellation posts when someone joins ("Priya joined Firefly Guild. Say hi!", with a Say hi
// button that waves 👋 at them) and its member milestones / birthdays (a card with a firefly
// burst, Replay to see it again).

const WAVE = '👋'

/** 18 fireflies flying out from the card (fixed spots, so it looks the same every time). */
const SPARKS = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2 + (((i * 37) % 11) - 5) * 0.03
  const d = 70 + ((i * 53) % 100)
  return { x: Math.round(Math.cos(a) * d * 1.6), y: Math.round(Math.sin(a) * d * 0.7), t: 1.2 + ((i * 7) % 8) / 10, delay: ((i * 13) % 25) / 100 }
})

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function CxJoinLine({
  message,
  meId,
  nameOf,
  canWave,
  onWave
}: {
  message: Message
  meId: string
  nameOf: (userId: string) => string
  /** Can post here (not timed out, not read-only) */
  canWave: boolean
  /** Say hi: a 👋 on the line and a 👋 message in the chat */
  onWave: () => void
}): React.JSX.Element {
  const event = message.event?.type === 'cxJoined' ? message.event : null
  const mine = message.senderId === meId
  const who = mine ? 'You' : nameOf(message.senderId)
  const wavers = message.reactions.find((r) => r.emoji === WAVE)?.userIds ?? []
  const waved = wavers.includes(meId)
  const others = wavers.filter((id) => id !== meId)
  const [justWaved, setJustWaved] = useState(false)
  const first = (id: string): string => nameOf(id).trim().split(/\s+/)[0] || nameOf(id)
  const names = [...(waved ? ['You'] : []), ...others.slice(0, waved ? 1 : 1).map(first)]
  const rest = wavers.length - names.length
  // The button already says "You waved": the line only adds others who waved too.
  const wavedText = !others.length
    ? null
    : rest > 0
      ? `${names.join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'} waved`
      : names.length === 2
        ? `${names[0]} and ${names[1]} waved`
        : `${names[0]} waved`
  const place = event?.name ?? 'the constellation'
  return (
    <div className="cx-join-line" data-message-id={message.id}>
      <span className="cx-join-arrow" aria-hidden="true">
        →
      </span>
      <span>
        <b>{who}</b> joined <EmojiText text={place} />
        {mine ? '' : '. Say hi!'} <time dateTime={message.createdAt}>{clockTime(message.createdAt)}</time>
      </span>
      {!mine && canWave && (
        <button
          type="button"
          className={waved ? 'cx-wave cx-wave--on' : 'cx-wave'}
          aria-pressed={waved}
          disabled={waved}
          aria-label={waved ? `You waved at ${who}` : `Say hi to ${who} with a wave`}
          onClick={() => {
            setJustWaved(true)
            onWave()
          }}
        >
          <span className={justWaved ? 'cx-wave-hand cx-wave-hand--go' : 'cx-wave-hand'} aria-hidden="true">
            {WAVE}
          </span>
          {waved ? 'You waved' : 'Say hi'}
        </button>
      )}
      {wavedText && <span className="cx-wave-count">{wavedText}</span>}
    </div>
  )
}

export function CxMilestoneCard({
  message,
  icon
}: {
  message: Message
  /** The constellation's icon (inside Constellations) */
  icon?: React.ReactNode
}): React.JSX.Element {
  const event = message.event?.type === 'cxMilestone' ? message.event : null
  // A burst plays when it's brand new on screen (posted in the last two minutes), and on Replay.
  const fresh = Date.now() - new Date(message.createdAt).getTime() < 2 * 60_000
  const [burst, setBurst] = useState(fresh && !reducedMotion() ? 1 : 0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  if (!event) return <></>
  const name = event.name
  const big = event.years ? `turns ${event.years} today!` : `${event.members ?? 0} members!`
  const when = new Date(message.createdAt)
  const today = new Date().toDateString() === when.toDateString()
  const replay = (): void => {
    if (reducedMotion()) return
    setBurst(0)
    timer.current = setTimeout(() => setBurst((b) => b + 1), 30)
  }
  return (
    <div className="cx-milestone-wrap" data-message-id={message.id}>
      <div className="cx-milestone" role="note" aria-label={milestoneText(event)}>
        {burst > 0 && (
          <span key={burst} className="cx-burst" aria-hidden="true">
            {SPARKS.map((s, i) => (
              <span
                key={i}
                className="cx-burst-spark"
                style={
                  {
                    ['--dx' as string]: `${s.x}px`,
                    ['--dy' as string]: `${s.y}px`,
                    animationDuration: `${s.t}s`,
                    animationDelay: `${s.delay}s`
                  } as React.CSSProperties
                }
              />
            ))}
          </span>
        )}
        <span className="cx-milestone-icon" aria-hidden="true">
          {icon ?? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="#ffb347">
              <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
            </svg>
          )}
        </span>
        <span className="cx-milestone-text">
          <strong>
            <EmojiText text={name} /> {event.years ? '' : 'just reached '}
            <span className="cx-milestone-big">{big}</span>
          </strong>
          <span>
            Thanks for making it glow. {today ? 'Today' : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })},{' '}
            {clockTime(message.createdAt)}
          </span>
        </span>
        <button type="button" className="cx-milestone-replay" onClick={replay}>
          Replay
        </button>
      </div>
    </div>
  )
}
