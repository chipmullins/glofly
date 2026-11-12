import { useEffect, useRef, useState } from 'react'
import type { Point, Scene, Token, TokenBar } from '@glofly/shared/campfire/types'
import { DEFAULT_GRID, EMPTY_FOG } from '@glofly/shared/campfire/map'
import MapView from './MapView'
import type { HitFx, PingFx } from './useTable'
import { FlameIcon } from './icons'
import './roundA.css'

// Round A polish: the tour's practice table (approved board "Tour"). Just you and three sample
// goblins on a small built room; everything happens in this window and nothing is saved or sent.
// Each step waits for you to try it (move, target, attack), with Next to skip ahead.

const CELL = 70
const STEPS = [
  {
    title: 'Your sheet and portrait',
    text: 'This is Lyra, a sample ranger. On a real table your character’s portrait is on your token, in the turn order and on your rolls.',
    try: null
  },
  {
    title: 'Move your token',
    text: 'Drag Lyra toward the goblins. The ruler counts the feet as you drag; release to move.',
    try: 'move'
  },
  {
    title: 'Target a goblin',
    text: 'Double-click a goblin (or select it and press T). Attacks you roll go at your target.',
    try: 'target'
  },
  {
    title: 'Attack and roll damage',
    text: 'Press Attack. Campfire rolls to hit against the goblin’s armor class, then the damage. On a real table the game master approves the hit.',
    try: 'attack'
  },
  {
    title: 'The turn order',
    text: 'In a fight you roll your own initiative when the game master asks, then everyone takes turns. On your turn the top bar says so; press “End my turn” when you’re done.',
    try: null
  },
  {
    title: 'Dice and secret rolls',
    text: 'Roll any dice from the tray, or type /roll 1d20+5 in the call’s chat. “Only the GM” makes a roll secret.',
    try: null
  },
  {
    title: 'Handouts and music',
    text: 'Letters, maps and pictures the game master shares show up in Handouts; music plays for everyone. That’s it: you’re ready.',
    try: null
  }
] as const

const bar = (value: number, max: number, color: string): TokenBar => ({
  value,
  max,
  color,
  show: 'all'
})
const now = new Date().toISOString()
const tok = (
  id: string,
  name: string,
  x: number,
  y: number,
  hp: number | null,
  mine = false
): Token => ({
  id,
  sceneId: 'practice',
  layer: 'tokens',
  characterId: mine ? 'practice-lyra' : null,
  name,
  imageFileId: null,
  x: x * CELL,
  y: y * CELL,
  w: 1,
  h: 1,
  rotation: 0,
  bars: [hp === null ? null : bar(hp, mine ? 36 : 7, mine ? '#57c27a' : '#ef5a4a'), null, null],
  conditions: [],
  aura: null,
  showName: true,
  controlledBy: mine ? ['me'] : [],
  z: 0,
  updatedAt: now
})

const SCENE: Scene = {
  id: 'practice',
  campaignId: 'practice',
  name: 'Practice room',
  position: 0,
  widthPx: 14 * CELL,
  heightPx: 9 * CELL,
  grid: { ...DEFAULT_GRID, size: CELL },
  backgroundFileId: null,
  theme: 'stone',
  built: {
    floors: [
      {
        id: 'f',
        material: 'stone',
        points: [
          [CELL, CELL],
          [13 * CELL, CELL],
          [13 * CELL, 8 * CELL],
          [CELL, 8 * CELL]
        ]
      }
    ],
    walls: [
      {
        id: 'w',
        points: [
          [CELL, CELL],
          [13 * CELL, CELL],
          [13 * CELL, 8 * CELL],
          [CELL, 8 * CELL],
          [CELL, CELL]
        ]
      }
    ],
    objects: [],
    notes: []
  },
  fog: EMPTY_FOG,
  musicTrackId: null,
  updatedAt: now
}

export function PracticeTable({
  onClose,
  onHelp
}: {
  onClose: () => void
  onHelp: () => void
}): React.JSX.Element {
  const [tokens, setTokens] = useState<Token[]>(() => [
    tok('lyra', 'Lyra', 2, 4, 36, true),
    tok('g1', 'Goblin', 10, 3, 7),
    tok('g2', 'Goblin', 11, 5, 7),
    tok('g3', 'Goblin', 10, 6, 7)
  ])
  const [step, setStep] = useState(0)
  const [tried, setTried] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>('lyra')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [hits, setHits] = useState<HitFx[]>([])
  const [line, setLine] = useState<string | null>(null)
  const prevBars = useRef(new Map<string, (TokenBar | null)[]>())
  const centerRef = useRef<(() => Point) | null>(null)
  const pings: PingFx[] = []
  const s = STEPS[step]
  const done = (k: string): void => setTried((x) => new Set(x).add(k))
  const ready = !s.try || tried.has(s.try)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const attack = (): void => {
    const target = tokens.find((t) => t.id === targetId)
    if (!target) return setLine('Target a goblin first (double-click it).')
    const d20 = 1 + Math.floor(Math.random() * 20)
    const toHit = d20 + 5
    const hit = d20 === 20 || (d20 !== 1 && toHit >= 15)
    const dmg = hit ? (1 + Math.floor(Math.random() * 8)) * (d20 === 20 ? 2 : 1) + 3 : 0
    const hp = target.bars[0]?.value ?? 7
    const left = Math.max(0, hp - dmg)
    prevBars.current.set(target.id, target.bars)
    setTokens((ts) =>
      ts.map((t) =>
        t.id === target.id ? { ...t, bars: [bar(left, 7, '#ef5a4a'), null, null] } : t
      )
    )
    setHits((h) => [
      ...h.slice(-4),
      {
        id: Date.now(),
        at: Date.now(),
        hit: {
          attackerTokenId: 'lyra',
          targetTokenId: target.id,
          amount: dmg,
          kind: 'ranged',
          crit: d20 === 20,
          defeated: left === 0,
          bloodied: left > 0 && left <= 3,
          ...(hit ? {} : { miss: true })
        }
      }
    ])
    setLine(
      hit
        ? `${d20 === 20 ? 'Natural 20! ' : ''}Longbow ${toHit} hits (AC 15): ${dmg} piercing${left === 0 ? '. The goblin falls.' : '.'}`
        : `Longbow ${toHit} misses (AC 15).`
    )
    done('attack')
  }

  return (
    <div
      className="cf-layer"
      role="dialog"
      aria-modal="true"
      aria-label="Practice table"
      style={{ zIndex: 70 }}
    >
      <div className="cf-table cf-table--player">
        <header className="cf-head">
          <span className="cf-head-mark" aria-hidden="true">
            <FlameIcon size={20} />
          </span>
          <div className="cf-head-title">
            <h1>Practice table</h1>
            <span>Just you and three sample goblins · nothing here is saved</span>
          </div>
          <span className="cf-spacer" />
          <button type="button" className="cf-ghost" onClick={onHelp}>
            How Campfire works
          </button>
          <button type="button" className="cf-leave" onClick={onClose}>
            Leave practice
          </button>
        </header>
        <div className="cf-body" style={{ gridTemplateColumns: '1fr' }}>
          <main className="cf-main" style={{ position: 'relative' }}>
            <MapView
              scene={SCENE}
              tokens={tokens}
              isGm={false}
              isParty={(t) => t.id === 'lyra'}
              canMove={(t) => t.id === 'lyra'}
              tool="select"
              fogMode="reveal"
              selectedId={selectedId}
              onSelect={setSelectedId}
              targetId={targetId}
              onTarget={(id) => {
                setTargetId(id)
                if (id && id !== 'lyra') done('target')
              }}
              activeTokenId="lyra"
              onDragLive={() => undefined}
              onDrop={(id, x, y) => {
                setTokens((ts) => ts.map((t) => (t.id === id ? { ...t, x, y } : t)))
                done('move')
              }}
              onPing={() => undefined}
              onFogShape={() => undefined}
              hits={hits}
              pings={pings}
              nameOf={() => 'You'}
              prevBars={prevBars}
              templateFt={20}
              centerRef={centerRef}
            >
              {line && (
                <div className="cf-toast" role="status">
                  <span className="cf-toast-dot" aria-hidden="true" />
                  {line}
                </div>
              )}
            </MapView>
            <div className="cfa-coach" style={{ position: 'absolute', left: 24, bottom: 24 }}>
              <div className="cfa-coach-top">
                <span className="cfa-kicker">
                  Step {step + 1} of {STEPS.length}
                </span>
                <span className="cfa-dots" aria-hidden="true">
                  {STEPS.map((_, n) => (
                    <span
                      key={n}
                      className={n < step ? 'cfa-dot-done' : n === step ? 'cfa-dot-on' : ''}
                    />
                  ))}
                </span>
              </div>
              <h2>{s.title}</h2>
              <p>{s.text}</p>
              {s.try && (
                <div className="cfa-try" role="status">
                  {ready
                    ? '✓ Nice. On to the next step.'
                    : 'Try it: the next step starts when you have.'}
                </div>
              )}
              {s.try === 'attack' && (
                <button type="button" className="cf-primary" onClick={attack}>
                  Attack with the longbow (+5)
                </button>
              )}
              <div className="cfa-coach-buttons">
                <button type="button" className="cf-link" onClick={onClose}>
                  Skip the tour
                </button>
                <span className="cfa-push" />
                <button
                  type="button"
                  className="cf-ghost"
                  disabled={step === 0}
                  onClick={() => setStep(step - 1)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="cf-primary"
                  onClick={() => (step === STEPS.length - 1 ? onClose() : setStep(step + 1))}
                >
                  {step === STEPS.length - 1 ? 'Done' : ready ? 'Next' : 'Skip this step'}
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
