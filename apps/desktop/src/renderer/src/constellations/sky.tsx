import { useEffect, useMemo, useRef } from 'react'
import { afterSwarm, DASHBOARD_STARS, prefersReducedMotion, seeded, type SwarmFly } from './skyData'

// The night sky (approved Oct 13, docs/design/constellations/Transition.dc.html and
// Dashboard.dc.html): Glofly fireflies (a vector redraw of the logo so the wings can flap),
// twinkling stars with softly pulsing orange ones, and five small fireflies wandering about.
// The numbers here are the approved ones; keep them exactly.

/** The Glofly firefly: wings (two outlined ellipses each), antennae, head, body, and the light. */
export function Firefly({
  width,
  flap,
  className
}: {
  width: number
  /** Wing beat in ms (the mockup's --flap) */
  flap?: number
  className?: string
}): React.JSX.Element {
  const height = Math.round((width * 190) / 256)
  return (
    <svg
      className={className ? `ff ${className}` : 'ff'}
      viewBox="0 0 256 190"
      width={width}
      height={height}
      aria-hidden="true"
      style={flap ? ({ '--flap': `${flap}ms` } as React.CSSProperties) : undefined}
    >
      <g className="wl">
        <ellipse
          cx="80"
          cy="62"
          rx="66"
          ry="24"
          transform="rotate(22 80 62)"
          fill="none"
          stroke="#f7841f"
          strokeWidth="10"
        />
        <ellipse
          cx="118"
          cy="128"
          rx="19"
          ry="42"
          transform="rotate(-25 118 128)"
          fill="none"
          stroke="#f7841f"
          strokeWidth="10"
        />
      </g>
      <g className="wr">
        <ellipse
          cx="184"
          cy="120"
          rx="64"
          ry="22"
          transform="rotate(32 184 120)"
          fill="none"
          stroke="#f7841f"
          strokeWidth="10"
        />
        <ellipse
          cx="160"
          cy="72"
          rx="16"
          ry="30"
          transform="rotate(40 160 72)"
          fill="none"
          stroke="#f7841f"
          strokeWidth="10"
        />
      </g>
      <path
        d="M136 24 L128 6 M150 24 L162 9"
        stroke="#fbbf24"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="143" cy="38" r="17" fill="#fbbf24" />
      <ellipse cx="151" cy="74" rx="29" ry="27" fill="#f9a825" />
      <g className="light">
        <rect x="34" y="112" width="80" height="54" rx="23" fill="#ff9a2e" />
        <path d="M46 158 L36 184 L70 164 Z" fill="#ff9a2e" />
      </g>
    </svg>
  )
}

/** The small firefly mark (Home, Back to Glofly). */
export function FireflyMark({ size }: { size: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <ellipse
        cx="12"
        cy="11"
        rx="5.5"
        ry="3.2"
        transform="rotate(-28 12 11)"
        fill="#e9d5c4"
        opacity=".55"
      />
      <ellipse
        cx="20"
        cy="11"
        rx="5.5"
        ry="3.2"
        transform="rotate(28 20 11)"
        fill="#e9d5c4"
        opacity=".55"
      />
      <ellipse cx="16" cy="15" rx="3" ry="5" fill="#4a372b" />
      <circle cx="16" cy="22" r="5" fill="#ffb347" opacity=".35" />
      <circle cx="16" cy="21.5" r="3.2" fill="#ffb347" />
    </svg>
  )
}

/** The galaxy icon (the Constellations button and the strip's "all constellations"). */
export function GalaxyIcon({
  size = 20,
  color = '#ffb347',
  sparkles = false
}: {
  size?: number
  color?: string
  sparkles?: boolean
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {/* A few stars joined, ending in a bright one (Oct 17: replaces the four-armed galaxy). */}
      <path
        d="M3.5 19 8.5 12.5 13 16 17.5 8.5"
        strokeWidth="1.3"
        strokeLinejoin="round"
        opacity="0.75"
      />
      <circle cx="3.5" cy="19" r="1.6" fill={color} stroke="none" />
      <circle cx="8.5" cy="12.5" r="1.5" fill={color} stroke="none" />
      <circle cx="13" cy="16" r="1.5" fill={color} stroke="none" />
      <path d="M18.5 2.5l1.1 3 3 1.1-3 1.1-1.1 3-1.1-3-3-1.1 3-1.1z" fill={color} stroke="none" />
      {sparkles && <circle cx="21" cy="20" r=".8" fill={color} stroke="none" />}
    </svg>
  )
}

type Orbiter = {
  x: number
  y: number
  w: number
  flap: number
  wx: number[]
  wy: number[]
  fx: number[]
  fy: number[]
  px: number[]
  py: number[]
  rot?: number
}

/**
 * Five small fireflies wandering the sky on lazy, never-repeating paths (each axis the sum of two
 * slow sine waves), turning smoothly to face the way they fly: never mirrored, never snapping.
 */
export function WanderingFireflies({
  spots = [
    { x: 76, y: 24, w: 18 },
    { x: 20, y: 70, w: 14 },
    { x: 56, y: 84, w: 16 },
    { x: 38, y: 32, w: 12 },
    { x: 88, y: 56, w: 15 }
  ],
  seed = 7
}: {
  spots?: { x: number; y: number; w: number }[]
  seed?: number
}): React.JSX.Element {
  const els = useRef<(HTMLDivElement | null)[]>([])
  const orbiters = useMemo<Orbiter[]>(() => {
    // The transition's sky (seed 7) draws its stars and swarm first, like the approved canvas.
    const rnd = seed === 7 ? afterSwarm() : seeded(seed)
    return spots.map((o, i) => ({
      ...o,
      flap: 130 + i * 15,
      wx: [70 + rnd() * 90, 20 + rnd() * 30],
      wy: [45 + rnd() * 55, 12 + rnd() * 25],
      fx: [0.16 + rnd() * 0.18, 0.3 + rnd() * 0.2],
      fy: [0.14 + rnd() * 0.18, 0.28 + rnd() * 0.2],
      px: [rnd() * 6.28, rnd() * 6.28],
      py: [rnd() * 6.28, rnd() * 6.28]
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  useEffect(() => {
    if (prefersReducedMotion()) return
    const t0 = performance.now()
    let last = t0
    let raf = 0
    const step = (now: number): void => {
      const t = (now - t0) / 1000
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      orbiters.forEach((o, i) => {
        const el = els.current[i]
        if (!el) return
        const x =
          o.wx[0] * Math.sin(t * o.fx[0] + o.px[0]) + o.wx[1] * Math.sin(t * o.fx[1] + o.px[1])
        const y =
          o.wy[0] * Math.sin(t * o.fy[0] + o.py[0]) + o.wy[1] * Math.sin(t * o.fy[1] + o.py[1])
        const vx =
          o.wx[0] * o.fx[0] * Math.cos(t * o.fx[0] + o.px[0]) +
          o.wx[1] * o.fx[1] * Math.cos(t * o.fx[1] + o.px[1])
        const vy =
          o.wy[0] * o.fy[0] * Math.cos(t * o.fy[0] + o.py[0]) +
          o.wy[1] * o.fy[1] * Math.cos(t * o.fy[1] + o.py[1])
        // The logo points up and to the right (about -35°), hence the +35. Always turn the
        // shortest way round, easing a little each frame.
        const heading = (Math.atan2(vy, vx) * 180) / Math.PI + 35
        if (o.rot === undefined) o.rot = heading
        const diff = ((heading - o.rot + 540) % 360) - 180
        o.rot += diff * Math.min(1, dt * 2.5)
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${o.rot.toFixed(1)}deg)`
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [orbiters])

  return (
    <div className="cx-wanderers" aria-hidden="true">
      {orbiters.map((o, i) => (
        <div
          key={i}
          className="wander"
          ref={(el) => {
            els.current[i] = el
          }}
          style={{ left: `${o.x}%`, top: `${o.y}%` }}
        >
          <div className="ffbox">
            <Firefly width={o.w} flap={o.flap} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function Swarm({ flies }: { flies: SwarmFly[] }): React.JSX.Element {
  return (
    <div className="cx-swarm" aria-hidden="true">
      {flies.map((f, i) => (
        <div
          key={i}
          className="fly"
          style={{
            top: `${f.y}%`,
            animationDelay: `${f.delay}ms`,
            animationDuration: `${f.dur}ms`
          }}
        >
          <div
            className={f.drift}
            style={{ animationDelay: `${f.delay}ms`, animationDuration: `${f.dur}ms` }}
          >
            <div className="bob" style={{ animationDelay: `${f.bob}ms` }}>
              <div className="face">
                <Firefly width={f.w} flap={f.flap} />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** The dashboard's sky: its stars and its five wanderers (positions from Dashboard.dc.html). */
export function DashboardSky(): React.JSX.Element {
  return (
    <>
      <div className="sky" aria-hidden="true">
        {DASHBOARD_STARS.map((s, i) =>
          s.gold ? (
            <span
              key={i}
              className={s.gold === 'big' ? 'gold big' : 'gold'}
              style={{ left: s.left, top: s.top }}
            />
          ) : (
            <span
              key={i}
              style={{
                left: s.left,
                top: s.top,
                width: s.size,
                height: s.size,
                borderRadius: (s.size ?? 2) >= 3 ? 2 : '50%',
                background: s.color,
                boxShadow: s.glow ? '0 0 8px 2px rgba(255,165,74,.4)' : undefined
              }}
            />
          )
        )}
      </div>
      <WanderingFireflies
        seed={23}
        spots={[
          { x: 72, y: 18, w: 18 },
          { x: 10, y: 76, w: 14 },
          { x: 90, y: 84, w: 16 },
          { x: 40, y: 12, w: 12 },
          { x: 60, y: 62, w: 15 }
        ]}
      />
    </>
  )
}
