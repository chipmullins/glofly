import { memo } from 'react'
import type {
  BuiltMap,
  BuiltObject,
  BuiltWall,
  GridSettings,
  MapTheme
} from '@glofly/shared/campfire/types'
import { ALL_LAYERS, MATERIALS, materialOf, THEMES, type BuiltLayers } from './geometry'
export type { BuiltLayers }

// A built map (the map builder's rooms, walls with doors, objects and GM notes), drawn in SVG.
// The table and the builder both use it. Pieces carry data-piece="kind:id" for the builder.

/** <defs> the floors need (one grid-line pattern per material). Put once in the map's SVG. */
export function BuiltDefs({ grid }: { grid: GridSettings }): React.JSX.Element {
  const s = grid.size
  return (
    <>
      {MATERIALS.map((m) => (
        <pattern
          key={m.id}
          id={`cf-mat-${m.id}`}
          width={s}
          height={s}
          patternUnits="userSpaceOnUse"
          x={grid.offsetX}
          y={grid.offsetY}
        >
          <rect width={s} height={s} fill={m.fill} />
          {m.id === 'wood' &&
            [0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1={0}
                x2={s}
                y1={s * f}
                y2={s * f}
                stroke="rgba(0,0,0,0.18)"
                strokeWidth={1}
              />
            ))}
          {m.id === 'water' && (
            <path
              d={`M0 ${s * 0.35} q ${s / 4} -${s / 10} ${s / 2} 0 t ${s / 2} 0 M0 ${s * 0.75} q ${s / 4} -${s / 10} ${s / 2} 0 t ${s / 2} 0`}
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={1.5}
            />
          )}
          <path d={`M0 0H${s}M0 0V${s}`} stroke={m.line} strokeWidth={1} fill="none" />
        </pattern>
      ))}
    </>
  )
}

const pts = (p: [number, number][]): string => p.map((x) => `${x[0]},${x[1]}`).join(' ')

function Wall({ wall, color }: { wall: BuiltWall; color: string }): React.JSX.Element {
  const door = wall.door
  if (!door) {
    return (
      <g data-piece={`walls:${wall.id}`}>
        <polyline
          points={pts(wall.points)}
          fill="none"
          stroke="rgba(0,0,0,0.6)"
          strokeWidth={14}
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        <polyline
          points={pts(wall.points)}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </g>
    )
  }
  // A door: the wood, open (a gap with the leaf swung aside), closed, or locked (with a lock).
  const [a, b] = [wall.points[0], wall.points[wall.points.length - 1]]
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  return (
    <g data-piece={`walls:${wall.id}`}>
      {door.state === 'open' ? (
        <>
          <polyline
            points={pts(wall.points)}
            fill="none"
            stroke="rgba(0,0,0,0.35)"
            strokeWidth={10}
            strokeDasharray="4 6"
          />
          <line
            x1={a[0]}
            y1={a[1]}
            x2={a[0] + (b[1] - a[1]) * 0.9}
            y2={a[1] - (b[0] - a[0]) * 0.9}
            stroke="#8a5d3b"
            strokeWidth={6}
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <polyline
            points={pts(wall.points)}
            fill="none"
            stroke="rgba(0,0,0,0.6)"
            strokeWidth={12}
          />
          <polyline points={pts(wall.points)} fill="none" stroke="#8a5d3b" strokeWidth={8} />
          {door.state === 'locked' && (
            <circle
              cx={mid[0]}
              cy={mid[1]}
              r={4}
              fill="#ffd08a"
              stroke="#2a1406"
              strokeWidth={1.5}
            />
          )}
        </>
      )}
    </g>
  )
}

export function ObjectShape({
  o,
  grid
}: {
  o: BuiltObject
  grid: GridSettings
}): React.JSX.Element {
  const w = o.w
  const h = o.h
  let body: React.ReactNode
  switch (o.kind) {
    case 'door':
      body = <rect width={w} height={h} fill="#8a5d3b" stroke="#4a301d" strokeWidth={2} />
      break
    case 'table':
      body = <rect width={w} height={h} rx={4} fill="#6e4a2f" stroke="#4a301d" strokeWidth={3} />
      break
    case 'pillar':
      body = (
        <circle
          cx={w / 2}
          cy={h / 2}
          r={Math.min(w, h) / 2}
          fill="#8a7d72"
          stroke="#5b4f46"
          strokeWidth={2}
        />
      )
      break
    case 'chest':
      body = (
        <>
          <rect width={w} height={h} rx={3} fill="#a8761c" stroke="#5a3e0e" strokeWidth={3} />
          <rect x={w / 2 - 3} y={h / 2 - 4} width={6} height={8} fill="#ffd08a" />
        </>
      )
      break
    case 'stairs':
      body = (
        <>
          <rect width={w} height={h} fill="#5b4f46" stroke="#2b221d" strokeWidth={2} />
          {Array.from({ length: 7 }, (_, i) => (
            <line
              key={i}
              x1={(w / 8) * (i + 1)}
              x2={(w / 8) * (i + 1)}
              y1={2}
              y2={h - 2}
              stroke="#2b221d"
              strokeWidth={2}
            />
          ))}
        </>
      )
      break
    case 'tree':
      body = (
        <>
          <circle
            cx={w / 2}
            cy={h / 2}
            r={Math.min(w, h) / 2}
            fill="#3f7a35"
            stroke="#24451f"
            strokeWidth={3}
          />
          <circle cx={w * 0.4} cy={h * 0.4} r={Math.min(w, h) / 5} fill="#5a9a48" />
        </>
      )
      break
    case 'campfire':
      body = (
        <>
          <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2} fill="rgba(255,179,71,0.25)" />
          <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 4} fill="#ffb347" />
          <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 8} fill="#fff6c8" />
        </>
      )
      break
    case 'trap':
      body = (
        <rect
          width={w}
          height={h}
          fill="rgba(239,90,74,0.12)"
          stroke="#ef5a4a"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      )
      break
    case 'bed':
      body = (
        <>
          <rect width={w} height={h} rx={3} fill="#7a5a8a" stroke="#3a2a40" strokeWidth={2} />
          <rect x={4} y={4} width={w - 8} height={h * 0.2} rx={3} fill="#e6dccf" />
        </>
      )
      break
    case 'barrel':
      body = (
        <circle
          cx={w / 2}
          cy={h / 2}
          r={Math.min(w, h) / 2}
          fill="#7a5230"
          stroke="#3a2414"
          strokeWidth={3}
        />
      )
      break
    case 'rock':
      body = (
        <path
          d={`M${w * 0.1} ${h * 0.6} L${w * 0.3} ${h * 0.15} L${w * 0.75} ${h * 0.1} L${w * 0.95} ${h * 0.55} L${w * 0.6} ${h * 0.95} Z`}
          fill="#6a625c"
          stroke="#3a3430"
          strokeWidth={2}
        />
      )
      break
    case 'statue':
      body = (
        <>
          <rect width={w} height={h} fill="#4c4542" />
          <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 3} fill="#b9b2aa" />
        </>
      )
      break
    default:
      body = <rect width={w} height={h} fill="rgba(255,255,255,0.1)" stroke="#c9b6a8" />
  }
  void grid
  return (
    <g
      data-piece={`objects:${o.id}`}
      transform={`translate(${o.x} ${o.y}) rotate(${o.rotation} ${w / 2} ${h / 2})`}
    >
      {body}
    </g>
  )
}

function BuiltLayer({
  built,
  grid,
  theme,
  layers = ALL_LAYERS,
  showNotes
}: {
  built: BuiltMap
  grid: GridSettings
  theme: MapTheme
  layers?: BuiltLayers
  showNotes: boolean
}): React.JSX.Element {
  const wall = THEMES[theme]?.wall ?? THEMES.stone.wall
  return (
    <g className="cf-built">
      {layers.floor &&
        built.floors.map((f) => (
          <polygon
            key={f.id}
            data-piece={`floors:${f.id}`}
            points={pts(f.points)}
            fill={`url(#cf-mat-${materialOf(f.material).id})`}
            stroke={wall}
            strokeWidth={6}
            strokeLinejoin="round"
          />
        ))}
      {layers.objects && built.objects.map((o) => <ObjectShape key={o.id} o={o} grid={grid} />)}
      {layers.walls && built.walls.map((w) => <Wall key={w.id} wall={w} color={wall} />)}
      {showNotes &&
        layers.notes &&
        built.notes.map((n) => (
          <g key={n.id} data-piece={`notes:${n.id}`} transform={`translate(${n.x} ${n.y})`}>
            <rect
              x={-12}
              y={-12}
              width={24}
              height={24}
              rx={6}
              fill="#ffd08a"
              stroke="#2a1406"
              strokeWidth={1.5}
            />
            <text x={0} y={5} textAnchor="middle" fontSize={15} fontWeight={800} fill="#2a1406">
              !
            </text>
            <title>{n.text}</title>
          </g>
        ))}
    </g>
  )
}

export default memo(BuiltLayer)
