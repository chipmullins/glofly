import type { DiagonalRule } from '@glofly/shared/campfire/map'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Point, Scene, Token, TokenBar } from '@glofly/shared/campfire/types'
import {
  pieceHidden,
  shownToPlayers,
  simplifyLasso,
  tokenCenter
} from '@glofly/shared/campfire/map'
import { pathCost } from '@glofly/shared/campfire/roundB'
import { checkRange, type AttackReach } from './attackFlow'
import BuiltLayer, { BuiltDefs } from './BuiltLayer'
import {
  feetBetween,
  hexPattern,
  hpColor,
  Pinch,
  ringFor,
  snapToken,
  THEMES,
  usePanZoom
} from './geometry'
import { fileUrl, reducedMotion } from './api'
import type { HitFx, PingFx } from './useTable'

// The table's map: an SVG with pan and zoom (wheel, drag, pinch), the grid, the background picture
// or built map, tokens (portrait, three bars, conditions, aura, name), dragging with snap, the
// ruler, pings, fog (hatched for GMs, black for players), and the Round board's hit animations
// (bump / arrow / spell, shake, flash, the floating number, the bar dropping).

export type Tool = 'select' | 'measure' | 'ping' | 'fog' | 'template'
/** How the GM draws fog: a box, freehand (lasso), or by clicking corners */
export type FogBrush = 'box' | 'lasso' | 'points'

type Props = {
  scene: Scene
  tokens: Token[]
  isGm: boolean
  /** A GM looking at it as players do (fog black, GM layer and notes hidden) */
  asPlayer?: boolean
  /** Tokens drawn with party colors (PCs, or tokens someone controls) */
  isParty: (t: Token) => boolean
  canMove: (t: Token) => boolean
  /** Pressing a token you control that can't move now ("Players move only on their turn") */
  onLocked?: (t: Token) => void
  tool: Tool
  fogMode: 'reveal' | 'hide'
  fogBrush?: FogBrush
  selectedId: string | null
  onSelect: (id: string | null) => void
  targetId: string | null
  onTarget: (id: string | null) => void
  /** 0.11.2: a double-click on a token you can manage opens its card (others: targets it) */
  canOpen?: (t: Token) => boolean
  onOpen?: (id: string) => void
  activeTokenId: string | null
  onDragLive: (id: string, x: number, y: number) => void
  onDrop: (id: string, x: number, y: number, path?: Point[]) => void
  onPing: (x: number, y: number) => void
  onFogShape: (shape: { kind: 'rect' | 'poly'; points: Point[] }, mode: 'reveal' | 'hide') => void
  hits: HitFx[]
  pings: PingFx[]
  nameOf: (userId: string) => string
  prevBars: React.MutableRefObject<Map<string, (TokenBar | null)[]>>
  /** Template tool radius in feet */
  templateFt: number
  /** How the ruler counts a diagonal square (campaign setting) */
  diagonal?: DiagonalRule
  /** Things drawn over the map (approval box, roll card) */
  children?: React.ReactNode
  /** Gets "the middle of what's showing" (new tokens go there) */
  centerRef?: React.MutableRefObject<(() => Point) | null>
  /** Round B: the token taking its turn, how far it may still go (ft) and what Dash would add */
  movement?: { tokenId: string; left: number; dashExtra: number } | null
  /** Round B: tokens whose player is talking right now */
  speaking?: ReadonlySet<string>
  /** Round B: a creature's reach in feet, shown while hovering it (null: don't show) */
  reachOf?: (t: Token) => number | null
  /** 0.11.3: an attack waiting for its target: its reach/range around the attacker, others dimmed */
  aim?: { attackerId: string; reach: AttackReach; name: string } | null
  /** Round B (game masters): tokens picked together (Shift-click or Shift-drag a box) */
  multi?: ReadonlySet<string>
  onMulti?: (ids: string[]) => void
  /** Round B: the game master moved everyone's view here */
  focus?: { x: number; y: number; key: number } | null
}

type Drag = {
  id: string
  dx: number
  dy: number
  x: number
  y: number
  moved: boolean
  x0: number
  y0: number
  path: Point[]
}
type Pop = { id: number; x: number; y: number; text: string; color: string; big?: boolean }
type Shot = { id: number; kind: 'arrow' | 'flame'; from: Point; to: Point }

const BIG = 100_000
let popId = 1

function barPct(b: TokenBar): number {
  if (b.value !== null && b.max) return Math.max(0, Math.min(100, (b.value / b.max) * 100))
  if (b.state === 'defeated') return 0
  if (b.state === 'bloodied') return 45
  return 100
}

const initial = (name: string): string => (name.trim()[0] ?? '?').toUpperCase()

function TokenGlyph({
  t,
  size,
  feet,
  party,
  isGm,
  selected,
  target,
  active,
  bars,
  dragging,
  canMove,
  fxRef,
  onKey,
  picked,
  speaking,
  far
}: {
  t: Token
  size: number
  feet: number
  party: boolean
  isGm: boolean
  selected: boolean
  target: boolean
  active: boolean
  bars: (TokenBar | null)[]
  dragging: boolean
  canMove: boolean
  /** Stable (by token id): keeps memo working with 200+ tokens */
  fxRef: (id: string, el: SVGGElement | null) => void
  onKey: (id: string, e: React.KeyboardEvent) => void
  picked?: boolean
  speaking?: boolean
  /** Out of the waiting attack's range */
  far?: boolean
}): React.JSX.Element {
  const w = t.w * size
  const h = t.h * size
  const r = Math.min(w, h) / 2 - 3
  const { ring, fill } = ringFor(t.characterId ?? t.id, party)
  const hidden = t.layer === 'gm'
  const mapLayer = t.layer === 'map'
  const defeated = t.conditions.includes('defeated') || t.conditions.includes('dead')
  const hp = bars[0]
  const label = `${t.name || 'Token'}${hp && hp.value !== null && hp.max ? `, ${hp.value} of ${hp.max} hit points` : hp?.state ? `, ${hp.state}` : ''}${hidden ? ', hidden from players' : ''}`
  return (
    <g
      className={`cf-token${dragging ? ' cf-token--drag' : ''}${hidden ? ' cf-token--hidden' : ''}${far ? ' cf-token--far' : ''}`}
      data-token={t.id}
      style={{ transform: `translate(${t.x}px, ${t.y}px)`, cursor: canMove ? 'grab' : 'pointer' }}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onKeyDown={(e) => onKey(t.id, e)}
    >
      <g
        ref={(el) => fxRef(t.id, el)}
        className="cf-token-fx"
        style={{
          opacity: defeated ? 0.4 : hidden ? 0.6 : 1,
          filter: defeated ? 'grayscale(1)' : undefined
        }}
      >
        {t.aura && t.aura.radiusFt > 0 && (
          <circle
            cx={w / 2}
            cy={h / 2}
            r={r + 3 + (t.aura.radiusFt / feet) * size}
            fill={t.aura.color}
            fillOpacity={0.14}
            stroke={t.aura.color}
            strokeOpacity={0.8}
            strokeWidth={2}
            strokeDasharray="7 5"
            pointerEvents="none"
          />
        )}
        {speaking && (
          <circle
            cx={w / 2}
            cy={h / 2}
            r={r + 5}
            fill="none"
            stroke="#57c27a"
            strokeWidth={4}
            className="cf-speaking"
            pointerEvents="none"
          />
        )}
        {active && (
          <circle
            cx={w / 2}
            cy={h / 2}
            r={r + 9}
            fill="none"
            stroke="rgba(255,179,71,0.6)"
            strokeWidth={8}
            className="cf-active-glow"
          />
        )}
        {mapLayer ? (
          t.imageFileId ? (
            <image
              href={fileUrl(t.imageFileId)}
              width={w}
              height={h}
              preserveAspectRatio="xMidYMid slice"
            />
          ) : (
            <rect width={w} height={h} rx={6} fill={fill} opacity={0.7} />
          )
        ) : (
          <>
            <circle
              cx={w / 2}
              cy={h / 2}
              r={r + 1}
              fill={fill}
              stroke={ring}
              strokeWidth={3}
              strokeDasharray={hidden ? '6 4' : undefined}
            />
            {t.imageFileId ? (
              <image
                href={fileUrl(t.imageFileId)}
                x={w / 2 - r}
                y={h / 2 - r}
                width={r * 2}
                height={r * 2}
                clipPath="url(#cf-round)"
                preserveAspectRatio="xMidYMid slice"
              />
            ) : (
              <text
                x={w / 2}
                y={h / 2 + r * 0.32}
                textAnchor="middle"
                fontSize={r * 0.95}
                fontWeight={700}
                fill="#fff"
                fontFamily="Outfit, sans-serif"
              >
                {initial(t.name)}
              </text>
            )}
          </>
        )}
        {selected && (
          <circle
            cx={w / 2}
            cy={h / 2}
            r={r + 6}
            fill="none"
            stroke="#ffb347"
            strokeWidth={2.5}
            strokeDasharray="5 4"
          />
        )}
        {picked && (
          <circle cx={w / 2} cy={h / 2} r={r + 7} fill="none" stroke="#6f9cff" strokeWidth={3} />
        )}
        {target && (
          <g stroke="#ff6b5a" strokeWidth={2.5} fill="none">
            <circle cx={w / 2} cy={h / 2} r={r + 6} />
            <path
              d={`M${w / 2} ${h / 2 - r - 12}v10M${w / 2} ${h / 2 + r + 2}v10M${w / 2 - r - 12} ${h / 2}h10M${w / 2 + r + 2} ${h / 2}h10`}
            />
          </g>
        )}
        {!mapLayer &&
          bars.map((b, i) => {
            if (!b) return null
            const bw = Math.max(26, w * 0.72)
            const pct = barPct(b)
            const color = i === 0 ? hpColor(pct) : b.color
            return (
              <g key={i} transform={`translate(${(w - bw) / 2} ${h - 2 + i * 7})`}>
                <rect width={bw} height={5} rx={2.5} fill="rgba(0,0,0,0.75)" />
                <rect
                  className="cf-bar-fill"
                  height={5}
                  rx={2.5}
                  fill={color}
                  style={{ width: (bw * pct) / 100 }}
                />
              </g>
            )
          })}
        {!mapLayer && t.conditions.length > 0 && (
          <g transform={`translate(${w - 6} ${4})`}>
            {t.conditions.slice(0, 4).map((c, i) => (
              <g key={c} transform={`translate(0 ${i * 15})`}>
                <circle r={7} fill="#2a1406" stroke="#ffb347" strokeWidth={1.5} />
                <text y={3.5} textAnchor="middle" fontSize={9} fontWeight={800} fill="#ffd08a">
                  {c.slice(0, 2).toUpperCase()}
                </text>
                {t.conditionTimers?.[c] ? (
                  <g transform="translate(-14 0)">
                    <circle r={6} fill="#2a1f33" stroke="#cfa8ff" strokeWidth={1.2} />
                    <text y={3} textAnchor="middle" fontSize={8} fontWeight={800} fill="#e7d4ff">
                      {t.conditionTimers[c]}
                    </text>
                  </g>
                ) : null}
                <title>
                  {c}
                  {t.conditionTimers?.[c]
                    ? ` · ${t.conditionTimers[c]} round${t.conditionTimers[c] === 1 ? '' : 's'} left`
                    : ''}
                </title>
              </g>
            ))}
          </g>
        )}
        {!mapLayer && (t.showName || isGm) && t.name && (
          <g
            transform={`translate(${w / 2} ${h + 4 + bars.filter(Boolean).length * 7})`}
            opacity={t.showName ? 1 : 0.6}
          >
            <rect
              x={-(t.name.length * 3.4 + 6)}
              y={0}
              width={t.name.length * 6.8 + 12}
              height={16}
              rx={5}
              fill="rgba(20,15,13,0.85)"
            />
            <text y={12} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
              {t.name}
            </text>
          </g>
        )}
        {hidden && isGm && (
          <text x={w / 2} y={-6} textAnchor="middle" fontSize={10} fontWeight={700} fill="#9fd3ff">
            Hidden
          </text>
        )}
        {!mapLayer && !!t.elevation && (
          <g transform={`translate(${w - 4} ${-8})`}>
            <rect
              x={-2}
              y={-10}
              width={50}
              height={16}
              rx={8}
              fill="#1a2333"
              stroke="rgba(111,156,255,0.6)"
            />
            <text x={23} y={2} textAnchor="middle" fontSize={10} fontWeight={800} fill="#9cc0ff">
              {t.elevation > 0 ? '↑' : '↓'} {Math.abs(t.elevation)} ft
            </text>
          </g>
        )}
        {!mapLayer && t.locked && isGm && (
          <g transform="translate(2 2)" pointerEvents="none">
            <rect width={14} height={14} rx={4} fill="rgba(20,15,13,0.85)" />
            <path
              d="M4 7V5.5a3 3 0 0 1 6 0V7M3.5 7h7v5h-7z"
              fill="none"
              stroke="#ffd08a"
              strokeWidth={1.4}
            />
            <title>Locked</title>
          </g>
        )}
      </g>
    </g>
  )
}

const Token_ = memo(TokenGlyph)

function MapView(p: Props): React.JSX.Element {
  const { scene, isGm } = p
  const g = scene.grid
  const W = scene.widthPx
  const H = scene.heightPx
  const {
    box,
    center,
    fit,
    panBy,
    toWorld,
    view,
    zoomAt,
    setView: setViewPZ
  } = usePanZoom(W, H, scene.id)
  const { centerRef } = p
  useEffect(() => {
    if (centerRef) centerRef.current = center
  }, [centerRef, center])
  const pinch = useRef(new Pinch())
  const [drag, setDrag] = useState<Drag | null>(null)
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null)
  const [ruler, setRuler] = useState<{ a: Point; b: Point; circle: boolean } | null>(null)
  const [fogBox, setFogBox] = useState<{ a: Point; b: Point } | null>(null)
  // Freehand (lasso) line while the button is held, and clicked corners (points brush).
  const [lasso, setLasso] = useState<Point[] | null>(null)
  const [corners, setCorners] = useState<Point[] | null>(null)
  const [hover, setHover] = useState<Point | null>(null)
  const [hoverTok, setHoverTok] = useState<string | null>(null)
  const [selBox, setSelBox] = useState<{ a: Point; b: Point } | null>(null)
  // The game master moved everyone's view: center it there.
  useEffect(() => {
    if (!p.focus) return
    const el = box.current
    const r = el?.getBoundingClientRect()
    if (!r) return
    setViewPZ((v) => ({
      ...v,
      x: r.width / 2 - p.focus!.x * v.z,
      y: r.height / 2 - p.focus!.y * v.z
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focus?.key])
  const brush: FogBrush = p.fogBrush ?? 'box'
  const fogOn = p.tool === 'fog' && isGm
  // Leaving the fog tool (or switching brush) drops a half-drawn shape.
  const toolKey = `${p.tool}|${brush}`
  const [lastTool, setLastTool] = useState(toolKey)
  if (lastTool !== toolKey) {
    setLastTool(toolKey)
    setCorners(null)
    setLasso(null)
  }
  const finishCorners = useCallback(
    (pts: Point[] | null, flip: boolean): void => {
      setCorners(null)
      if (!pts || pts.length < 3) return
      const clean = simplifyLasso(pts, 200, 2)
      if (clean)
        p.onFogShape(
          { kind: 'poly', points: clean },
          flip ? (p.fogMode === 'reveal' ? 'hide' : 'reveal') : p.fogMode
        )
    },
    [p]
  )
  // Points brush: Enter closes the shape, Escape (or Backspace for the last corner) takes it back.
  useEffect(() => {
    if (!corners) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return
      if (e.key === 'Enter') {
        e.preventDefault()
        finishCorners(corners, e.shiftKey)
      } else if (e.key === 'Escape') {
        e.stopPropagation()
        setCorners(null)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        setCorners(corners.length > 1 ? corners.slice(0, -1) : null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [corners, finishCorners])
  const [pops, setPops] = useState<Pop[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [barHold, setBarHold] = useState<Map<string, (TokenBar | null)[]>>(new Map())
  const fxEls = useRef(new Map<string, SVGGElement>())
  const done = useRef(new Set<number>())
  const lastSent = useRef(0)
  const longPress = useRef<number | null>(null)
  const asPlayer = !isGm || !!p.asPlayer
  // 0.11.2: "See as a player" leaves out what the game master hid (players never receive it).
  const playerBuilt = useMemo(() => shownToPlayers(scene.built), [scene.built])
  const theme = THEMES[scene.theme] ?? THEMES.stone

  const byId = useMemo(() => new Map(p.tokens.map((t) => [t.id, t])), [p.tokens])
  const sorted = useMemo(() => {
    const order = { map: 0, tokens: 1, gm: 2 }
    return [...p.tokens]
      .filter((t) => !(p.asPlayer && t.layer === 'gm'))
      .sort((a, b) => order[a.layer] - order[b.layer] || a.z - b.z)
  }, [p.tokens, p.asPlayer])

  // ───── Hit animations (Round board) ─────
  useEffect(() => {
    const calm = reducedMotion()
    for (const fx of p.hits) {
      if (done.current.has(fx.id)) continue
      done.current.add(fx.id)
      if (Date.now() - fx.at > 4000) continue
      const hit = fx.hit
      const target = byId.get(hit.targetTokenId)
      if (!target) continue
      const attacker = hit.attackerTokenId ? byId.get(hit.attackerTokenId) : undefined
      const tc = tokenCenter(target, g)
      const ac = attacker ? tokenCenter(attacker, g) : null
      const popAt = (text: string, color: string, delay: number, big = false): void => {
        window.setTimeout(() => {
          const id = popId++
          const y = tc[1] - (target.h * g.size) / 2 - 6
          setPops((list) => [...list, { id, x: tc[0], y, text, color, big }])
          window.setTimeout(() => setPops((list) => list.filter((x) => x.id !== id)), 1200)
        }, delay)
      }
      const el = (id: string | undefined): SVGGElement | undefined =>
        id ? fxEls.current.get(id) : undefined
      // The bar shows its old value until the blow lands.
      const before = p.prevBars.current.get(target.id)
      const travel = calm ? 0 : hit.kind === 'melee' ? 170 : 330
      if (before && !hit.miss) {
        // An animation for a live event (outside React): the bar waits for the blow.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setBarHold((m) => new Map(m).set(target.id, before))
        window.setTimeout(
          () =>
            setBarHold((m) => {
              const next = new Map(m)
              next.delete(target.id)
              return next
            }),
          travel + 30
        )
      }
      if (!calm && attacker && ac) {
        if (hit.kind === 'melee') {
          const dx = tc[0] - ac[0]
          const dy = tc[1] - ac[1]
          const d = Math.max(1, Math.hypot(dx, dy))
          el(attacker.id)?.animate(
            [
              { transform: 'translate(0,0)' },
              { transform: `translate(${(dx / d) * 26}px, ${(dy / d) * 26}px)` },
              { transform: 'translate(0,0)' }
            ],
            { duration: 340, easing: 'ease-out' }
          )
        } else if (hit.kind === 'ranged') {
          const wide: Point = hit.miss ? [tc[0] + 50, tc[1] - 40] : tc
          const id = popId++
          setShots((s) => [...s, { id, kind: 'arrow', from: ac, to: wide }])
          window.setTimeout(() => setShots((s) => s.filter((x) => x.id !== id)), 380)
        }
      }
      if (!calm && hit.kind === 'spell' && !hit.miss) {
        const id = popId++
        setShots((s) => [...s, { id, kind: 'flame', from: [tc[0], tc[1] - 140], to: tc }])
        window.setTimeout(() => setShots((s) => s.filter((x) => x.id !== id)), 380)
      }
      const tEl = el(target.id)
      if (hit.miss) {
        window.setTimeout(() => {
          if (!calm)
            tEl?.animate(
              [
                { transform: 'translate(0,0)' },
                { transform: 'translate(10px,-6px)', offset: 0.4 },
                { transform: 'translate(0,0)' }
              ],
              { duration: 400 }
            )
        }, travel)
        popAt('Miss', '#e5d6ca', travel)
        continue
      }
      window.setTimeout(() => {
        if (calm) {
          tEl?.animate(
            [
              { filter: 'drop-shadow(0 0 0 rgba(255,107,90,0))' },
              { filter: 'drop-shadow(0 0 14px rgba(255,107,90,0.95))' },
              { filter: 'drop-shadow(0 0 0 rgba(255,107,90,0))' }
            ],
            { duration: 900 }
          )
          return
        }
        tEl?.animate(
          [
            { transform: 'translate(0,0)' },
            { transform: 'translate(-7px,0)', offset: 0.2 },
            { transform: 'translate(6px,0)', offset: 0.4 },
            { transform: 'translate(-4px,0)', offset: 0.6 },
            { transform: 'translate(3px,0)', offset: 0.8 },
            { transform: 'translate(0,0)' }
          ],
          { duration: 380 }
        )
        tEl?.animate([{ filter: 'brightness(2.2) saturate(0.3)' }, { filter: 'none' }], {
          duration: 450
        })
      }, travel)
      const amountText = hit.amountHidden ? 'Hit!' : `−${hit.amount}`
      popAt(
        hit.crit ? `${amountText} Critical!` : amountText,
        hit.kind === 'spell' ? '#ffd08a' : '#ff6b5a',
        travel,
        hit.crit
      )
      if (hit.defeated) popAt('Defeated', '#ef8a7a', travel + 1000)
      else if (hit.bloodied) popAt('Bloodied', '#ffb08a', travel + 1000)
      if (hit.concentrationDc)
        popAt(`Concentration: DC ${hit.concentrationDc}`, '#cfa8ff', travel + 1800)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.hits])

  // ───── Pointer handling ─────
  const worldOf = (e: React.PointerEvent | React.MouseEvent): Point => toWorld(e.clientX, e.clientY)

  const tokenAt = (target: EventTarget | null): Token | null => {
    const el = (target as Element | null)?.closest?.('[data-token]')
    const id = el?.getAttribute('data-token')
    return id ? (byId.get(id) ?? null) : null
  }

  const clearLongPress = (): void => {
    if (longPress.current) window.clearTimeout(longPress.current)
    longPress.current = null
  }

  // When the last release was handled: losing capture right after it is normal, not a lost release.
  const lastUpAt = useRef(0)
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    pinch.current.down(e)
    if (pinch.current.active) {
      setDrag(null)
      setPan(null)
      setRuler(null)
      setFogBox(null)
      setLasso(null)
      clearLongPress()
      return
    }
    // Round B: game masters pick several tokens with Shift (click to add or drop one, drag a box).
    if (e.button === 0 && e.shiftKey && p.tool === 'select' && isGm && p.onMulti) {
      const at0 = worldOf(e)
      const tk0 = tokenAt(e.target)
      if (tk0) {
        const next = new Set(p.multi ?? [])
        if (next.has(tk0.id)) next.delete(tk0.id)
        else next.add(tk0.id)
        p.onMulti([...next])
      } else {
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        setSelBox({ a: at0, b: at0 })
      }
      return
    }
    if (e.button === 1 || (e.button === 0 && e.shiftKey && p.tool === 'select')) {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      setPan({ x: e.clientX, y: e.clientY })
      return
    }
    if (e.button !== 0) return
    const at = worldOf(e)
    // Alt-click (or the ping tool) pings; a long press does on touch.
    if (e.altKey || p.tool === 'ping') {
      p.onPing(Math.round(at[0]), Math.round(at[1]))
      return
    }
    if (e.pointerType === 'touch') {
      longPress.current = window.setTimeout(() => {
        longPress.current = null
        setDrag(null)
        setPan(null)
        p.onPing(Math.round(at[0]), Math.round(at[1]))
      }, 600)
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    if (p.tool === 'measure' || p.tool === 'template') {
      setRuler({ a: at, b: at, circle: p.tool === 'template' })
      return
    }
    if (fogOn) {
      if (brush === 'lasso') setLasso([at])
      else if (brush === 'points') {
        const first = corners?.[0]
        // Clicking the first corner again (or a double-click) closes the shape.
        const near = first && Math.hypot(first[0] - at[0], first[1] - at[1]) < 12 / view.z
        const last = corners?.[corners.length - 1]
        if (near) finishCorners(corners, e.shiftKey)
        // The second click of a double-click lands on the same spot: the double-click finishes.
        else if (!last || Math.hypot(last[0] - at[0], last[1] - at[1]) * view.z > 4)
          setCorners([...(corners ?? []), [Math.round(at[0]), Math.round(at[1])]])
      } else setFogBox({ a: at, b: at })
      return
    }
    const tk = tokenAt(e.target)
    if (tk) {
      p.onSelect(tk.id)
      if (p.canMove(tk))
        setDrag({
          id: tk.id,
          dx: at[0] - tk.x,
          dy: at[1] - tk.y,
          x: tk.x,
          y: tk.y,
          moved: false,
          x0: tk.x,
          y0: tk.y,
          path: []
        })
      else p.onLocked?.(tk)
      if (p.multi?.size && !p.multi.has(tk.id)) p.onMulti?.([])
      return
    }
    p.onSelect(null)
    setPan({ x: e.clientX, y: e.clientY })
  }

  // 0.11.2: drags and panning draw at most once a frame. A gaming mouse sends hundreds of moves a
  // second; redrawing the whole map for each made dragging lag, and the drop landed late.
  const frame = useRef<number | null>(null)
  const nextDrag = useRef<{ x: number; y: number } | null>(null)
  const panLast = useRef<{ x: number; y: number } | null>(null)
  const panAcc = useRef<[number, number]>([0, 0])
  const flushFrame = (ts: number): void => {
    frame.current = null
    const [ax, ay] = panAcc.current
    if (ax || ay) {
      panAcc.current = [0, 0]
      panBy(ax, ay)
    }
    const nd = nextDrag.current
    // 0.11.3: the dragged token itself is
    // moved straight in the page every frame (placeLive); the map redraws (path, distance) only
    // about 12 times a second, so a big map never holds the token back.
    if (nd && (!dragStateAt.current || ts - dragStateAt.current > 80)) {
      nextDrag.current = null
      dragStateAt.current = ts
      setDrag((d) => (d ? { ...d, x: nd.x, y: nd.y, moved: true } : d))
    } else if (nd) scheduleFrame()
    placeLive()
  }
  const dragStateAt = useRef(0)
  const livePos = useRef<{ id: string; x: number; y: number } | null>(null)
  const placeLive = (): void => {
    const lp = livePos.current
    if (!lp) return
    const el = box.current?.querySelector<SVGGElement>(`[data-token="${CSS.escape(lp.id)}"]`)
    if (el) el.style.transform = `translate(${lp.x}px, ${lp.y}px)`
  }
  // A redraw while dragging would put the token back where the last drawn state had it.
  useLayoutEffect(placeLive)
  const scheduleFrame = (): void => {
    if (frame.current === null) frame.current = requestAnimationFrame(flushFrame)
  }
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    []
  )

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const pm = pinch.current.move(e)
    if (pm) {
      const r = box.current?.getBoundingClientRect()
      panBy(pm.dx, pm.dy)
      zoomAt(pm.factor, pm.c[0] - (r?.left ?? 0), pm.c[1] - (r?.top ?? 0))
      return
    }
    if (longPress.current && (Math.abs(e.movementX) > 3 || Math.abs(e.movementY) > 3))
      clearLongPress()
    if (pan) {
      const last = panLast.current ?? pan
      panAcc.current = [
        panAcc.current[0] + e.clientX - last.x,
        panAcc.current[1] + e.clientY - last.y
      ]
      panLast.current = { x: e.clientX, y: e.clientY }
      scheduleFrame()
      return
    }
    const at = worldOf(e)
    if (corners) setHover(at)
    if (selBox) {
      setSelBox({ ...selBox, b: at })
      return
    }
    if (!drag && p.reachOf) {
      const tk = tokenAt(e.target)
      const id = tk && !p.isParty(tk) ? tk.id : null
      if (id !== hoverTok) setHoverTok(id)
    }
    if (lasso) {
      const last = lasso[lasso.length - 1]
      if (Math.hypot(last[0] - at[0], last[1] - at[1]) * view.z >= 4) setLasso([...lasso, at])
      return
    }
    if (ruler) {
      setRuler({ ...ruler, b: at })
      return
    }
    if (fogBox) {
      setFogBox({ ...fogBox, b: at })
      return
    }
    if (drag) {
      const x = Math.round(at[0] - drag.dx)
      const y = Math.round(at[1] - drag.dy)
      nextDrag.current = { x, y }
      livePos.current = { id: drag.id, x, y }
      scheduleFrame()
      const now = performance.now()
      if (now - lastSent.current > 50) {
        lastSent.current = now
        p.onDragLive(drag.id, x, y)
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    lastUpAt.current = e.timeStamp
    pinch.current.up(e)
    clearLongPress()
    // Anything still waiting for the next frame is done now (a drop never waits for a redraw).
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    const [pax, pay] = panAcc.current
    if (pax || pay) panBy(pax, pay)
    panAcc.current = [0, 0]
    panLast.current = null
    const lateDrag = nextDrag.current
    nextDrag.current = null
    if (pan) setPan(null)
    if (ruler) setRuler(null)
    if (selBox) {
      const { a, b } = selBox
      setSelBox(null)
      const x0 = Math.min(a[0], b[0])
      const x1 = Math.max(a[0], b[0])
      const y0 = Math.min(a[1], b[1])
      const y1 = Math.max(a[1], b[1])
      const inside = p.tokens
        .filter((t) => t.layer !== 'map' && !(p.asPlayer && t.layer === 'gm'))
        .filter((t) => {
          const c = tokenCenter(t, g)
          return c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1
        })
        .map((t) => t.id)
      p.onMulti?.([...new Set([...(p.multi ?? []), ...inside])])
    }
    if (fogBox) {
      const { a, b } = fogBox
      setFogBox(null)
      if (Math.abs(a[0] - b[0]) > 4 && Math.abs(a[1] - b[1]) > 4) {
        p.onFogShape(
          {
            kind: 'rect',
            points: [
              [Math.round(a[0]), Math.round(a[1])],
              [Math.round(b[0]), Math.round(b[1])]
            ]
          },
          e.shiftKey ? (p.fogMode === 'reveal' ? 'hide' : 'reveal') : p.fogMode
        )
      }
    }
    if (lasso) {
      setLasso(null)
      const clean = simplifyLasso(lasso)
      if (clean)
        p.onFogShape(
          { kind: 'poly', points: clean },
          e.shiftKey ? (p.fogMode === 'reveal' ? 'hide' : 'reveal') : p.fogMode
        )
    }
    if (drag) {
      const tk = byId.get(drag.id)
      if (tk && (drag.moved || lateDrag)) {
        // Where the pointer let go (not where the last drawn frame was).
        const at = worldOf(e)
        const rx = Number.isFinite(at[0]) ? Math.round(at[0] - drag.dx) : (lateDrag?.x ?? drag.x)
        const ry = Number.isFinite(at[1]) ? Math.round(at[1] - drag.dy) : (lateDrag?.y ?? drag.y)
        const [x, y] = snapToken(rx, ry, tk.w, tk.h, g)
        livePos.current = null
        nextDrag.current = null
        dragStateAt.current = 0
        p.onDrop(tk.id, x, y, drag.path.length ? drag.path : undefined)
        // Shown where it was dropped until the server's answer arrives.
        setDrag({ ...drag, x, y, moved: false })
        window.setTimeout(() => setDrag((d) => (d && d.id === tk.id && !d.moved ? null : d)), 600)
      } else {
        livePos.current = null
        setDrag(null)
      }
    }
  }

  // 0.11.2: the mouse button is already up but the release never arrived (the window lost focus,
  // another window opened…): let go now instead of carrying the token around.
  const onMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (
      e.pointerType !== 'touch' &&
      e.buttons === 0 &&
      (drag?.moved || nextDrag.current || pan || selBox || ruler || fogBox || lasso)
    )
      onPointerUp(e)
    else onPointerMove(e)
  }
  // Capture gone without a release (Alt+Tab, a dialog): finish what was being dragged. Losing
  // capture right after a handled release is normal.
  const onLostCapture = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (e.timeStamp - lastUpAt.current < 250) return
    if (drag?.moved || pan || selBox || ruler || fogBox || lasso) onPointerUp(e)
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    if (fogOn) {
      if (corners) finishCorners(corners, e.shiftKey)
      return
    }
    // The map holds the pointer while it's pressed, so find the token under it by position.
    const under = document
      .elementsFromPoint(e.clientX, e.clientY)
      .find((el) => el.closest('[data-token]'))
    const tk = tokenAt(under ?? null)
    if (!tk) return
    if (p.onOpen && p.canOpen?.(tk)) p.onOpen(tk.id)
    else p.onTarget(p.targetId === tk.id ? null : tk.id)
  }

  const onTokenKey = (t: Token) => (e: React.KeyboardEvent) => {
    const step = g.size
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0]
    }
    const m = moves[e.key]
    if (m && p.canMove(t)) {
      e.preventDefault()
      const [x, y] = snapToken(t.x + m[0], t.y + m[1], t.w, t.h, g)
      p.onDrop(t.id, x, y)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      p.onSelect(t.id)
    } else if (e.key.toLowerCase() === 't') {
      p.onTarget(p.targetId === t.id ? null : t.id)
    }
  }

  // Round B: while dragging, Space (or W) adds a turn to the path at the square under the token.
  useEffect(() => {
    if (!drag || !drag.moved) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== ' ' && e.key.toLowerCase() !== 'w') return
      e.preventDefault()
      const tk = byId.get(drag.id)
      if (!tk) return
      const [x, y] = snapToken(drag.x, drag.y, tk.w, tk.h, g)
      const c = tokenCenter({ ...tk, x, y }, g)
      setDrag((d) => (d ? { ...d, path: [...d.path, c].slice(-20) } : d))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag, byId, g])

  // Stable callbacks for the (memoized) tokens; they read the latest props through a ref.
  const keyRef = useRef<(id: string, e: React.KeyboardEvent) => void>(() => undefined)
  useEffect(() => {
    keyRef.current = (id, e) => {
      const t = byId.get(id)
      if (t) onTokenKey(t)(e)
    }
  })
  const tokenKey = useCallback((id: string, e: React.KeyboardEvent) => keyRef.current(id, e), [])
  const registerFx = useCallback((id: string, el: SVGGElement | null) => {
    if (el) fxEls.current.set(id, el)
    else fxEls.current.delete(id)
  }, [])

  const hex = g.type === 'hex' ? hexPattern(g.size) : null
  const aimer = p.aim ? (byId.get(p.aim.attackerId) ?? null) : null
  const tokenShown = (t: Token): Token =>
    drag && drag.id === t.id ? { ...t, x: drag.x, y: drag.y } : t

  return (
    <div className={`cf-map cf-map--${p.tool}${aimer ? ' cf-map--aim' : ''}`} ref={box}>
      <svg
        className="cf-map-svg"
        role="application"
        aria-label={`Map: ${scene.name}. Tab to a token; arrow keys move it, T targets it.`}
        onPointerDown={onPointerDown}
        onPointerMove={onMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onLostCapture}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <clipPath id="cf-round" clipPathUnits="objectBoundingBox">
            <circle cx={0.5} cy={0.5} r={0.5} />
          </clipPath>
          <BuiltDefs grid={g} />
          {hex ? (
            <pattern
              id="cf-grid"
              width={hex.w}
              height={hex.h}
              patternUnits="userSpaceOnUse"
              x={g.offsetX}
              y={g.offsetY}
            >
              <path
                d={hex.d}
                fill="none"
                stroke={g.color}
                strokeOpacity={g.opacity}
                strokeWidth={1}
              />
            </pattern>
          ) : (
            <pattern
              id="cf-grid"
              width={g.size}
              height={g.size}
              patternUnits="userSpaceOnUse"
              x={g.offsetX}
              y={g.offsetY}
            >
              <path
                d={`M0 0H${g.size}M0 0V${g.size}`}
                fill="none"
                stroke={g.color}
                strokeOpacity={g.opacity}
                strokeWidth={1}
              />
            </pattern>
          )}
          <pattern
            id="cf-mud"
            width={12}
            height={12}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={12} height={12} fill="rgba(110,74,47,0.45)" />
            <line x1={0} y1={0} x2={0} y2={12} stroke="rgba(255,208,138,0.35)" strokeWidth={3} />
          </pattern>
          <pattern
            id="cf-hatch"
            width={14}
            height={14}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={14} height={14} fill="rgba(8,20,32,0.55)" />
            <line x1={0} y1={0} x2={0} y2={14} stroke="rgba(120,190,230,0.45)" strokeWidth={5} />
          </pattern>
          {scene.fog.enabled && (
            <mask
              id={`cf-fog-${scene.id}`}
              maskUnits="userSpaceOnUse"
              x={-BIG}
              y={-BIG}
              width={BIG * 2}
              height={BIG * 2}
            >
              <rect x={-BIG} y={-BIG} width={BIG * 2} height={BIG * 2} fill="white" />
              {scene.fog.revealed.map((s) =>
                s.kind === 'rect' ? (
                  <rect
                    key={s.id}
                    x={Math.min(s.points[0][0], s.points[1][0])}
                    y={Math.min(s.points[0][1], s.points[1][1])}
                    width={Math.abs(s.points[1][0] - s.points[0][0])}
                    height={Math.abs(s.points[1][1] - s.points[0][1])}
                    fill={s.mode === 'hide' ? 'white' : 'black'}
                  />
                ) : (
                  <polygon
                    key={s.id}
                    points={s.points.map((x) => x.join(',')).join(' ')}
                    fill={s.mode === 'hide' ? 'white' : 'black'}
                  />
                )
              )}
            </mask>
          )}
        </defs>
        <rect x={-BIG} y={-BIG} width={BIG * 2} height={BIG * 2} fill={theme.bg} />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
          {scene.backgroundFileId ? (
            <image
              href={fileUrl(scene.backgroundFileId)}
              width={W}
              height={H}
              preserveAspectRatio="none"
            />
          ) : null}
          <BuiltLayer
            built={asPlayer && isGm ? playerBuilt : scene.built}
            grid={g}
            theme={scene.theme}
            showNotes={!asPlayer}
            gmMarks={isGm && !asPlayer}
          />
          {(asPlayer && isGm ? playerBuilt : scene.built).terrain?.map((tr) => (
            <polygon
              key={tr.id}
              opacity={isGm && !asPlayer && pieceHidden(tr, scene.built.layers) ? 0.38 : undefined}
              points={tr.points.map((q) => q.join(',')).join(' ')}
              fill={tr.kind === 'water' ? 'rgba(70,130,190,0.42)' : 'url(#cf-mud)'}
              stroke={tr.kind === 'water' ? 'rgba(111,156,255,0.7)' : 'rgba(255,179,71,0.6)'}
              strokeWidth={2}
              strokeDasharray={tr.kind === 'water' ? undefined : '6 4'}
              pointerEvents="none"
            >
              <title>
                {tr.kind === 'water'
                  ? 'Deep water: costs double'
                  : 'Difficult terrain: costs double'}
              </title>
            </polygon>
          ))}
          {(() => {
            const mv = p.movement
            const tk = mv ? byId.get(mv.tokenId) : undefined
            if (!mv || !tk || (drag && drag.id !== tk.id)) return null
            const base = drag && drag.id === tk.id ? { ...tk, x: drag.x0, y: drag.y0 } : tk
            const c = tokenCenter(base, g)
            const rad = (ft: number): number => (ft / (g.feet || 5)) * g.size + (tk.w * g.size) / 2
            return (
              <g pointerEvents="none">
                {mv.left > 0 && (
                  <circle
                    cx={c[0]}
                    cy={c[1]}
                    r={rad(mv.left)}
                    fill="rgba(87,194,122,0.06)"
                    stroke="#57c27a"
                    strokeWidth={2 / view.z}
                    strokeDasharray="10 7"
                  />
                )}
                {mv.dashExtra > 0 && (
                  <circle
                    cx={c[0]}
                    cy={c[1]}
                    r={rad(mv.left + mv.dashExtra)}
                    fill="none"
                    stroke="rgba(207,168,255,0.6)"
                    strokeWidth={2 / view.z}
                    strokeDasharray="3 8"
                  />
                )}
              </g>
            )
          })()}
          {aimer &&
            (() => {
              // Reach (solid), normal range (dashed) and long range (faint) around the attacker.
              const r = p.aim!.reach
              const rings = [
                r.melee !== null ? { ft: r.melee, kind: 'reach' } : null,
                r.normal !== null && Number.isFinite(r.normal) && r.normal !== r.melee
                  ? { ft: r.normal, kind: 'normal' }
                  : null,
                r.long !== null && Number.isFinite(r.long) && r.long !== r.normal
                  ? { ft: r.long, kind: 'long' }
                  : null
              ].filter((x): x is { ft: number; kind: string } => !!x)
              return rings.map(({ ft, kind }) => {
                const cells = Math.round(ft / (g.feet || 5))
                return (
                  <rect
                    key={kind}
                    className={`cf-aim cf-aim--${kind}`}
                    x={aimer.x - cells * g.size}
                    y={aimer.y - cells * g.size}
                    width={(aimer.w + cells * 2) * g.size}
                    height={(aimer.h + cells * 2) * g.size}
                    rx={8}
                    strokeWidth={2 / view.z}
                    strokeDasharray={kind === 'reach' ? undefined : `${8 / view.z} ${6 / view.z}`}
                    pointerEvents="none"
                  />
                )
              })
            })()}
          {hoverTok &&
            (() => {
              const tk = byId.get(hoverTok)
              const ft = tk ? p.reachOf?.(tk) : null
              if (!tk || !ft) return null
              const cells = Math.round(ft / (g.feet || 5))
              return (
                <rect
                  x={tk.x - cells * g.size}
                  y={tk.y - cells * g.size}
                  width={(tk.w + cells * 2) * g.size}
                  height={(tk.h + cells * 2) * g.size}
                  rx={6}
                  fill="rgba(239,90,74,0.08)"
                  stroke="rgba(239,90,74,0.55)"
                  strokeWidth={2 / view.z}
                  strokeDasharray="5 4"
                  pointerEvents="none"
                />
              )
            })()}
          {g.opacity > 0 && <rect width={W} height={H} fill="url(#cf-grid)" pointerEvents="none" />}
          {sorted.map((t0) => {
            const t = tokenShown(t0)
            return (
              <Token_
                key={t.id}
                t={t}
                size={g.size}
                feet={g.feet}
                party={p.isParty(t)}
                isGm={isGm && !p.asPlayer}
                selected={p.selectedId === t.id}
                target={p.targetId === t.id}
                active={p.activeTokenId === t.id}
                bars={barHold.get(t.id) ?? t.bars}
                dragging={!!drag?.moved && drag.id === t.id}
                canMove={p.canMove(t)}
                fxRef={registerFx}
                onKey={tokenKey}
                picked={!!p.multi?.has(t.id)}
                speaking={!!p.speaking?.has(t.id)}
                far={
                  !!aimer &&
                  t.id !== aimer.id &&
                  t.layer !== 'map' &&
                  !checkRange(p.aim!.reach, aimer, t, g, p.aim!.name).ok
                }
              />
            )
          })}
          {scene.fog.enabled && (
            <rect
              x={asPlayer ? -BIG : 0}
              y={asPlayer ? -BIG : 0}
              width={asPlayer ? BIG * 2 : W}
              height={asPlayer ? BIG * 2 : H}
              fill={asPlayer ? '#000' : 'url(#cf-hatch)'}
              mask={`url(#cf-fog-${scene.id})`}
              pointerEvents="none"
              className="cf-fog"
            />
          )}
          {shots.map((s) => (
            <Projectile key={s.id} shot={s} />
          ))}
          {p.pings
            .filter((x) => x.sceneId === scene.id)
            .map((x) => (
              <g key={x.id} transform={`translate(${x.x} ${x.y})`} pointerEvents="none">
                <circle
                  r={18}
                  className="cf-ping-ring"
                  fill="none"
                  stroke="#ffb347"
                  strokeWidth={4}
                />
                <circle r={6} fill="#ffb347" />
                <text
                  y={-26}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={700}
                  fill="#fff"
                  stroke="rgba(0,0,0,0.8)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {p.nameOf(x.userId)}
                </text>
              </g>
            ))}
          {ruler && (
            <Ruler
              a={ruler.a}
              b={ruler.b}
              circle={ruler.circle}
              templateFt={p.templateFt}
              scene={scene}
              diagonal={p.diagonal}
            />
          )}
          {drag &&
            drag.moved &&
            p.movement?.tokenId === drag.id &&
            (() => {
              const tk = byId.get(drag.id)
              if (!tk) return null
              const [sx, sy] = snapToken(drag.x, drag.y, tk.w, tk.h, g)
              const start = tokenCenter({ ...tk, x: drag.x0, y: drag.y0 }, g)
              const end = tokenCenter({ ...tk, x: sx, y: sy }, g)
              const pts = [start, ...drag.path, end]
              const cost = pathCost(pts, g, scene.built.terrain ?? [], p.diagonal ?? '5')
              const left = p.movement!.left
              const over = cost > left
              const color = over ? '#ff6b5a' : '#ffb347'
              return (
                <g pointerEvents="none">
                  <polyline
                    points={pts.map((q) => q.join(',')).join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth={5 / view.z}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {pts.slice(1).map((q, i) => (
                    <circle key={i} cx={q[0]} cy={q[1]} r={6 / view.z} fill={color} />
                  ))}
                  <g
                    transform={`translate(${end[0] + 26 / view.z} ${end[1] - 40 / view.z}) scale(${1 / view.z})`}
                  >
                    <rect
                      width={150}
                      height={44}
                      rx={12}
                      fill="#241712"
                      stroke={over ? 'rgba(255,107,90,0.7)' : 'rgba(255,179,71,0.6)'}
                    />
                    <text
                      x={12}
                      y={19}
                      fontFamily="Outfit, sans-serif"
                      fontWeight={800}
                      fontSize={15}
                      fill="#f3e6da"
                    >
                      {cost} of {left} ft
                    </text>
                    <text x={12} y={35} fontSize={11} fill={over ? '#ffb0a8' : '#c9b6a8'}>
                      {over
                        ? p.movement!.dashExtra
                          ? 'Too far: Dash first'
                          : 'Too far this turn'
                        : 'Space adds a turn'}
                    </text>
                  </g>
                </g>
              )
            })()}
          {selBox && (
            <rect
              x={Math.min(selBox.a[0], selBox.b[0])}
              y={Math.min(selBox.a[1], selBox.b[1])}
              width={Math.abs(selBox.b[0] - selBox.a[0])}
              height={Math.abs(selBox.b[1] - selBox.a[1])}
              fill="rgba(111,156,255,0.1)"
              stroke="#6f9cff"
              strokeWidth={2 / view.z}
              strokeDasharray="6 4"
            />
          )}
          {(lasso || corners) && (
            <polyline
              className="cf-fog-draft"
              points={[...(lasso ?? corners ?? []), ...(corners && hover ? [hover] : [])]
                .map((q) => q.join(','))
                .join(' ')}
              fill={p.fogMode === 'reveal' ? 'rgba(255,179,71,0.15)' : 'rgba(8,20,32,0.5)'}
              stroke="#ffb347"
              strokeWidth={2 / view.z}
              strokeDasharray="8 6"
              strokeLinejoin="round"
            />
          )}
          {corners?.map((q, i) => (
            <circle
              key={i}
              cx={q[0]}
              cy={q[1]}
              r={(i === 0 ? 7 : 4) / view.z}
              fill={i === 0 ? '#ffb347' : '#fff3df'}
              stroke="#1a120d"
              strokeWidth={1.5 / view.z}
            />
          ))}
          {fogBox && (
            <rect
              x={Math.min(fogBox.a[0], fogBox.b[0])}
              y={Math.min(fogBox.a[1], fogBox.b[1])}
              width={Math.abs(fogBox.b[0] - fogBox.a[0])}
              height={Math.abs(fogBox.b[1] - fogBox.a[1])}
              fill={p.fogMode === 'reveal' ? 'rgba(255,179,71,0.15)' : 'rgba(8,20,32,0.5)'}
              stroke="#ffb347"
              strokeWidth={2 / view.z}
              strokeDasharray="8 6"
            />
          )}
          {pops.map((x) => (
            <text
              key={x.id}
              className="cf-pop"
              x={x.x}
              y={x.y}
              textAnchor="middle"
              fontSize={(x.big ? 32 : 26) / Math.min(1, Math.max(0.45, view.z))}
              fontWeight={800}
              fontFamily="Outfit, sans-serif"
              fill={x.color}
              stroke="rgba(0,0,0,0.85)"
              strokeWidth={4}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {x.text}
            </text>
          ))}
        </g>
      </svg>
      <div className="cf-zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25)}>
          −
        </button>
        <button
          type="button"
          className="cf-zoom-pct"
          aria-label="Fit the map"
          title="Fit the map"
          onClick={fit}
        >
          {Math.round(view.z * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.25)}>
          +
        </button>
      </div>
      {p.children}
    </div>
  )
}

function Ruler({
  a,
  b,
  circle,
  templateFt,
  scene,
  diagonal
}: {
  a: Point
  b: Point
  circle: boolean
  templateFt: number
  scene: Scene
  diagonal?: DiagonalRule
}): React.JSX.Element {
  const ft = feetBetween(a, b, scene.grid, diagonal)
  if (circle) {
    const r = (templateFt / scene.grid.feet) * scene.grid.size
    return (
      <g pointerEvents="none">
        <circle
          cx={b[0]}
          cy={b[1]}
          r={r}
          fill="rgba(239,90,74,0.18)"
          stroke="#ef5a4a"
          strokeWidth={2}
          strokeDasharray="6 5"
        />
        <g transform={`translate(${b[0]} ${b[1] + r + 6})`}>
          <rect x={-46} width={92} height={20} rx={6} fill="#3a1a14" />
          <text x={0} y={14} textAnchor="middle" fontSize={12} fontWeight={700} fill="#ffd08a">
            {templateFt} ft radius
          </text>
        </g>
      </g>
    )
  }
  return (
    <g pointerEvents="none">
      <line
        x1={a[0]}
        y1={a[1]}
        x2={b[0]}
        y2={b[1]}
        stroke="#ffb347"
        strokeWidth={3}
        strokeDasharray="10 7"
      />
      <circle cx={a[0]} cy={a[1]} r={4} fill="#ffb347" />
      <g transform={`translate(${b[0]} ${b[1] - 14})`}>
        <rect x={-26} y={-12} width={52} height={22} rx={7} fill="#ffb347" />
        <text y={4} textAnchor="middle" fontSize={13} fontWeight={800} fill="#2a1406">
          {ft} ft
        </text>
      </g>
    </g>
  )
}

/** An arrow flying, or a spell's flame falling, then gone (Round board: .32 s, linear). */
function Projectile({ shot }: { shot: Shot }): React.JSX.Element {
  const ref = useRef<SVGGElement>(null)
  const dx = shot.to[0] - shot.from[0]
  const dy = shot.to[1] - shot.from[1]
  useEffect(() => {
    ref.current?.animate(
      [{ transform: 'translate(0px,0px)' }, { transform: `translate(${dx}px,${dy}px)` }],
      { duration: 330, easing: 'linear', fill: 'forwards' }
    )
  }, [dx, dy])
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI
  return (
    <g transform={`translate(${shot.from[0]} ${shot.from[1]})`} pointerEvents="none">
      <g ref={ref}>
        {shot.kind === 'arrow' ? (
          <g transform={`rotate(${angle})`}>
            <rect x={-14} y={-2} width={28} height={4} rx={2} fill="#f3e6da" opacity={0.9} />
            <path d="M14 -5 L22 0 L14 5 Z" fill="#ffb347" />
          </g>
        ) : (
          <g>
            <ellipse cx={0} cy={-12} rx={14} ry={28} fill="#ffd08a" opacity={0.85} />
            <ellipse cx={0} cy={-6} rx={7} ry={16} fill="#fff6c8" />
          </g>
        )}
      </g>
    </g>
  )
}

export default memo(MapView)
