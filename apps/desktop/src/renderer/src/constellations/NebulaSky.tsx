import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { prefersReducedMotion } from './skyData'
import {
  isGoldStar,
  SHOOTING_STAR_GAP_MS,
  skyLines,
  skyPoints,
  SKY_MAX,
  type SkyStar
} from './nebulaSky'
import './Feel.css'

// 0.7.5 living sky (canvas board 4, approved): a constellation's nebulas as stars on its banner.
// News makes a star brighten (with a little burst when it arrives), people chatting make it pulse
// slowly, and someone joining a voice nebula sends a shooting star to it. Calm by design: one
// shooting star at a time, at most one every 30 seconds per constellation, never while you're
// typing. With Reduce Motion, stars just brighten and nothing flies.

/** When each constellation last had a shooting star (shared by every sky showing it). */
const lastShot = new Map<string, number>()

function typingNow(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return el.value.length > 0
  if (el instanceof HTMLInputElement) return el.type === 'text' && el.value.length > 0
  return el.isContentEditable
}

type Look = { size: number; bg: string; glow: string; anim: string | undefined; lit: boolean }

function lookOf(star: SkyStar, gold: boolean): Look {
  if (star.news)
    return {
      size: 12,
      bg: '#ffd27a',
      glow: '0 0 18px 8px rgba(255,179,71,.65)',
      anim: undefined,
      lit: true
    }
  if (star.voice > 0)
    return {
      size: 11,
      bg: '#ffd27a',
      glow: '0 0 16px 7px rgba(255,210,122,.6)',
      anim: undefined,
      lit: true
    }
  if (star.chatting)
    return {
      size: 9,
      bg: '#ffb347',
      glow: '0 0 6px 2px rgba(255,179,71,.35)',
      anim: 'cx-sky-chat 2.4s ease-in-out infinite',
      lit: true
    }
  if (gold)
    return {
      size: 6,
      bg: '#f9b26b',
      glow: '0 0 6px 2px rgba(255,179,71,.3)',
      anim: undefined,
      lit: false
    }
  return {
    size: 5,
    bg: '#e9d5c4',
    glow: '0 0 4px 1px rgba(233,213,196,.35)',
    anim: undefined,
    lit: false
  }
}

export default function NebulaSky({
  id,
  stars,
  scale = 1,
  lineWidth = 1,
  labels = false
}: {
  /** The constellation (its sky's shape) */
  id: string
  stars: SkyStar[]
  /** 1 = the big sky; the sidebar banner draws them at .55 */
  scale?: number
  lineWidth?: number
  /** Names under the stars (the big sky only) */
  labels?: boolean
}): React.JSX.Element {
  const shown = stars.slice(0, SKY_MAX)
  const points = useMemo(() => skyPoints(id, shown.length), [id, shown.length])
  const lines = useMemo(() => skyLines(id, shown.length), [id, shown.length])
  const box = useRef<HTMLDivElement>(null)
  // Bursts (news arriving) and the shooting star (someone joining voice), each with a nonce so
  // the same one can play again.
  const [bursts, setBursts] = useState<Record<string, number>>({})
  const [shot, setShot] = useState<{
    to: number
    nonce: number
    angle: number
    dx: number
    dy: number
  } | null>(null)
  const before = useRef<Map<string, SkyStar> | null>(null)

  // What changed since the last look (news arriving, someone joining voice)
  const sig = shown.map((s) => `${s.key}:${s.news ? 1 : 0}:${s.voice}`).join('|')
  useLayoutEffect(() => {
    const prev = before.current
    before.current = new Map(shown.map((s) => [s.key, s]))
    if (!prev || prefersReducedMotion()) return
    const newBursts: string[] = []
    let joined = -1
    shown.forEach((s, i) => {
      const was = prev.get(s.key)
      if (!was) return
      if (s.news && !was.news) newBursts.push(s.key)
      if (s.voice > was.voice && joined < 0) joined = i
    })
    if (newBursts.length)
      setBursts((b) => {
        const next = { ...b }
        for (const k of newBursts) next[k] = (next[k] ?? 0) + 1
        return next
      })
    if (joined >= 0) {
      const now = Date.now()
      if (now - (lastShot.get(id) ?? 0) < SHOOTING_STAR_GAP_MS || typingNow()) return
      lastShot.set(id, now)
      const rect = box.current?.getBoundingClientRect()
      const w = rect?.width || 264
      const h = rect?.height || 104
      const p = points[joined]
      const dx = ((p.x - 4) / 100) * w
      const dy = ((p.y - 4) / 100) * h
      setShot((s) => ({
        to: joined,
        nonce: (s?.nonce ?? 0) + 1,
        angle: (Math.atan2(dy, dx) * 180) / Math.PI,
        dx,
        dy
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, id])

  // The shooting star leaves once it has landed.
  useEffect(() => {
    if (!shot) return
    const t = setTimeout(() => setShot(null), 1700)
    return () => clearTimeout(t)
  }, [shot])

  return (
    <div className="cx-sky2" ref={box} aria-hidden="true">
      <svg className="cx-sky2-lines" width="100%" height="100%" preserveAspectRatio="none">
        {lines.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={`${points[a].x}%`}
            y1={`${points[a].y}%`}
            x2={`${points[b].x}%`}
            y2={`${points[b].y}%`}
            stroke="#ffb347"
            strokeOpacity=".35"
            strokeWidth={lineWidth}
          />
        ))}
      </svg>
      {shown.map((s, i) => {
        const look = lookOf(s, isGoldStar(id, i))
        const size = Math.max(2, Math.round(look.size * scale * 10) / 10)
        return (
          <div
            key={s.key}
            className="cx-sky2-star"
            style={{ left: `${points[i].x}%`, top: `${points[i].y}%` }}
          >
            {bursts[s.key] && s.news && (
              <span
                key={bursts[s.key]}
                className="cx-sky2-burst"
                style={{ width: 26 * scale, height: 26 * scale }}
              />
            )}
            {shot?.to === i && (
              <span
                key={`ping${shot.nonce}`}
                className="cx-sky2-ping"
                style={{ width: 26 * scale, height: 26 * scale }}
              />
            )}
            <span
              className="cx-sky2-core"
              style={{
                width: size,
                height: size,
                backgroundColor: look.bg,
                boxShadow: scale < 1 ? shrinkGlow(look.glow, scale) : look.glow,
                animation: look.anim
              }}
            />
            {labels && (
              <span className={look.lit ? 'cx-sky2-label cx-sky2-label--lit' : 'cx-sky2-label'}>
                {s.label}
                {s.news
                  ? ' · new'
                  : s.voice > 0
                    ? ` · ${s.voice} in voice`
                    : s.chatting
                      ? ' · chatting'
                      : ''}
              </span>
            )}
          </div>
        )
      })}
      {shot && (
        <div
          key={`shot${shot.nonce}`}
          className="cx-sky2-shoot"
          style={
            {
              '--dx': `${shot.dx}px`,
              '--dy': `${shot.dy}px`
            } as React.CSSProperties
          }
        >
          <span
            className="cx-sky2-tail"
            style={{
              width: Math.round(140 * Math.max(scale, 0.43)),
              transform: `rotate(${shot.angle}deg)`
            }}
          />
          <span className="cx-sky2-head" />
        </div>
      )}
    </div>
  )
}

/** The glow, smaller for small skies ("0 0 18px 8px …" → "0 0 10px 4px …" at .55). */
function shrinkGlow(glow: string, scale: number): string {
  return glow.replace(
    /(\d+(?:\.\d+)?)px/g,
    (_, n: string) => `${Math.round(Number(n) * scale * 10) / 10}px`
  )
}
