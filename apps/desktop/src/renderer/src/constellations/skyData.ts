// The night sky's numbers (approved Oct 13, Transition.dc.html and Dashboard.dc.html): the seeded
// star field, the swarm, and the dashboard's star spots. Keep them exactly.

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** A small seeded random, so the sky is the same every time (like the mockup's). */
export function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

export type Star = { x: number; y: number; size: number; delay: number; gold: boolean }

/** The 112 stars of the swipe (1 in 6 orange), seeded like the mockup. */
export function makeStars(rnd = seeded(7)): Star[] {
  return Array.from({ length: 112 }, (_, i) => {
    const gold = i % 6 === 0
    return {
      x: Math.round(rnd() * 1000) / 10,
      y: Math.round(rnd() * 1000) / 10,
      size: gold ? (rnd() < 0.4 ? 4 : 3) : rnd() < 0.12 ? 2.5 : rnd() < 0.5 ? 2 : 1.5,
      delay: Math.round(rnd() * 380),
      gold
    }
  })
}

export type SwarmFly = {
  w: number
  y: number
  delay: number
  dur: number
  drift: string
  bob: number
  flap: number
}

/**
 * The swarm that carries you home: 30 fireflies of many sizes, each in its own lane (shuffled,
 * spread over 2–92% of the height), staggered starts, the big (near) ones faster.
 */
export function makeSwarm(rnd = afterStars()): SwarmFly[] {
  const lanes = Array.from({ length: 30 }, (_, i) => i).sort(() => rnd() - 0.5)
  const drifts = ['drift', 'drift down', 'drift flat']
  return lanes.map((lane, i) => {
    const w = Math.round(22 + rnd() * rnd() * 110)
    return {
      w,
      y: Math.round(2 + (lane / 30) * 88 + rnd() * 2),
      delay: Math.round((i / 30) * 600 + rnd() * 60),
      dur: Math.round(1250 - w * 3 + rnd() * 150),
      drift: drifts[i % 3],
      bob: Math.round(rnd() * 400),
      flap: Math.round(110 + rnd() * 120)
    }
  })
}

/** The random sequence just after the stars were drawn (the swarm comes next). */
function afterStars(): () => number {
  const rnd = seeded(7)
  makeStars(rnd)
  return rnd
}

/** …and just after the swarm (the wandering fireflies come next). */
export function afterSwarm(): () => number {
  const rnd = afterStars()
  makeSwarm(rnd)
  return rnd
}

/** The dashboard's still sky (exact star spots from Dashboard.dc.html), twinkling. */
export const DASHBOARD_STARS: {
  left: string
  top: string
  size?: number
  color?: string
  glow?: boolean
  gold?: 'gold' | 'big'
}[] = [
  { left: '8%', top: '14%', size: 2, color: '#e9d5c4' },
  { left: '22%', top: '9%', size: 3, color: '#ffb347', glow: true },
  { left: '47%', top: '6%', size: 2, color: '#e9d5c4' },
  { left: '63%', top: '12%', size: 2, color: '#f9b26b' },
  { left: '81%', top: '7%', size: 3, color: '#ffb347', glow: true },
  { left: '92%', top: '22%', size: 2, color: '#e9d5c4' },
  { left: '4%', top: '58%', size: 2, color: '#e9d5c4' },
  { left: '96%', top: '66%', size: 2, color: '#f9b26b' },
  { left: '55%', top: '94%', size: 3, color: '#ffb347', glow: true },
  { left: '91.6%', top: '46.7%', size: 2, color: '#e9d5c4' },
  { left: '79.8%', top: '47.7%', size: 2, color: '#e9d5c4' },
  { left: '53.8%', top: '87.5%', size: 1.5, color: '#f9b26b' },
  { left: '97.3%', top: '94.6%', size: 2, color: '#f9b26b' },
  { left: '2.5%', top: '52.7%', gold: 'big' },
  { left: '6.8%', top: '20.3%', size: 2, color: '#f9b26b' },
  { left: '3.9%', top: '46.5%', size: 2.5, color: '#f9b26b' },
  { left: '83.6%', top: '51.8%', gold: 'gold' },
  { left: '63.7%', top: '50.0%', size: 1.5, color: '#f5ede6' },
  { left: '65.2%', top: '41.1%', size: 1.5, color: '#f9b26b' },
  { left: '25.9%', top: '74.8%', gold: 'big' },
  { left: '51.3%', top: '4.9%', size: 1.5, color: '#f5ede6' },
  { left: '11.6%', top: '29.9%', size: 1.5, color: '#e9d5c4' },
  { left: '84.0%', top: '2.1%', gold: 'gold' },
  { left: '21.6%', top: '89.4%', size: 2.5, color: '#f5ede6' },
  { left: '97.1%', top: '40.2%', size: 1.5, color: '#f9b26b' },
  { left: '62.7%', top: '76.7%', gold: 'big' },
  { left: '27.4%', top: '10.4%', size: 2, color: '#e9d5c4' },
  { left: '95.5%', top: '74.8%', size: 1.5, color: '#e9d5c4' },
  { left: '25.1%', top: '11.7%', gold: 'gold' },
  { left: '6.9%', top: '78.5%', size: 2, color: '#f9b26b' },
  { left: '55.8%', top: '45.0%', size: 2, color: '#f9b26b' },
  { left: '76.4%', top: '42.2%', gold: 'big' },
  { left: '38.6%', top: '39.9%', size: 2, color: '#e9d5c4' }
]
