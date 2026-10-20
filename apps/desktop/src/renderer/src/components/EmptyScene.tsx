import { useId } from 'react'
import './EmptyScene.css'

// 0.7.5 "Empty screens with personality" (EmptyStates.dc.html): instead of a plain line, a small
// firefly scene, one friendly line and a button that helps. The fireflies drift slowly (still
// with Reduce Motion). Colors come from the theme, so the same scene works light and dark;
// `night` is for the always-dark Constellations panels. Buttons are the app's own, so they
// follow the accent color.

export type SceneKind =
  | 'search'
  | 'friends'
  | 'constellation'
  | 'caughtUp'
  | 'hello'
  | 'group'
  | 'pins'
  | 'scheduled'
  | 'games'

function Firefly({
  x,
  y,
  r,
  glow,
  variant = 1,
  faint
}: {
  x: number
  y: number
  r: number
  glow: string
  variant?: 1 | 2 | 3
  faint?: boolean
}): React.JSX.Element {
  return (
    <g opacity={faint ? 0.55 : 1}>
      <g className={`es-fly es-fly${variant}`}>
        <circle cx={x} cy={y} r={r} fill={`url(#${glow})`} />
        <circle cx={x} cy={y} r={Math.max(1.6, r / 5)} fill="#fff4cf" />
      </g>
    </g>
  )
}

function Art({ kind }: { kind: SceneKind }): React.JSX.Element {
  const glow = `es-glow-${useId().replace(/:/g, '')}`
  const defs = (
    <defs>
      <radialGradient id={glow}>
        <stop offset="0" stopColor="#ffe9a8" />
        <stop offset=".35" stopColor="#ffb347" stopOpacity=".8" />
        <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
      </radialGradient>
    </defs>
  )
  switch (kind) {
    case 'search':
      return (
        <>
          {defs}
          <circle cx="72" cy="70" r="40" className="es-fill" strokeWidth="8" />
          <path d="M101 99l30 30" className="es-stroke" strokeWidth="12" strokeLinecap="round" />
          <path
            d="M48 76c10-14 30-14 44-4"
            className="es-dash"
            strokeWidth="3"
            fill="none"
            strokeDasharray="3 6"
            strokeLinecap="round"
          />
          <Firefly x={120} y={34} r={16} glow={glow} />
          <Firefly x={30} y={118} r={11} glow={glow} variant={2} />
        </>
      )
    case 'friends':
    case 'hello':
    case 'group':
      return (
        <>
          {defs}
          <path
            d="M10 128c30-10 60-10 75 0s45 10 75 0"
            className="es-stroke"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M44 110c18-40 62-40 82 0"
            className="es-dash"
            strokeWidth="2.5"
            fill="none"
            strokeDasharray="2 7"
            strokeLinecap="round"
          />
          <Firefly x={44} y={108} r={20} glow={glow} />
          {kind === 'friends' ? (
            <g className="es-fly es-fly3">
              <circle cx="126" cy="108" r="20" fill={`url(#${glow})`} opacity=".55" />
              <circle
                cx="126"
                cy="108"
                r="4"
                fill="none"
                stroke="#f0c48a"
                strokeWidth="1.6"
                strokeDasharray="2 2"
              />
            </g>
          ) : (
            <Firefly x={126} y={108} r={20} glow={glow} variant={3} />
          )}
          <Firefly x={86} y={40} r={10} glow={glow} variant={2} />
          {kind === 'group' && <Firefly x={146} y={56} r={9} glow={glow} variant={3} />}
        </>
      )
    case 'constellation':
      return (
        <>
          {defs}
          <path d="M30 110L64 52L110 70L140 30" className="es-line" strokeWidth="1.6" fill="none" />
          <path
            d="M110 70L128 116"
            className="es-line"
            strokeWidth="1.6"
            fill="none"
            strokeDasharray="3 5"
          />
          <circle cx="30" cy="110" r="3" className="es-star" />
          <circle cx="64" cy="52" r="3" className="es-star" />
          <circle cx="140" cy="30" r="3" className="es-star" />
          <Firefly x={110} y={70} r={20} glow={glow} />
          <Firefly x={128} y={116} r={9} glow={glow} variant={2} faint />
          <circle cx="16" cy="30" r="1.4" className="es-speck" />
          <circle cx="88" cy="18" r="1.2" className="es-speck" />
          <circle cx="156" cy="88" r="1.2" className="es-speck" />
        </>
      )
    case 'caughtUp':
      return (
        <>
          {defs}
          <path
            d="M58 52h54v62a14 14 0 0 1-14 14H72a14 14 0 0 1-14-14z"
            className="es-fill"
            strokeWidth="4"
          />
          <rect x="54" y="40" width="62" height="12" rx="5" className="es-lid" />
          <Firefly x={78} y={96} r={16} glow={glow} />
          <Firefly x={96} y={80} r={12} glow={glow} variant={2} />
          <Firefly x={90} y={110} r={10} glow={glow} variant={3} />
        </>
      )
    case 'pins':
      return (
        <>
          {defs}
          <rect x="40" y="46" width="90" height="70" rx="12" className="es-fill" strokeWidth="4" />
          <path d="M58 70h54M58 88h36" className="es-stroke" strokeWidth="5" strokeLinecap="round" />
          <path
            d="M118 30l14 14-8 4-10 10 2 10-4 4-22-22 4-4 10 2 10-10z"
            className="es-lid"
          />
          <Firefly x={36} y={36} r={14} glow={glow} />
          <Firefly x={140} y={112} r={10} glow={glow} variant={2} />
        </>
      )
    case 'scheduled':
      return (
        <>
          {defs}
          <circle cx="85" cy="78" r="44" className="es-fill" strokeWidth="6" />
          <path d="M85 50v30l18 12" className="es-stroke" strokeWidth="6" strokeLinecap="round" />
          <Firefly x={136} y={36} r={15} glow={glow} />
          <Firefly x={30} y={120} r={10} glow={glow} variant={2} />
        </>
      )
    case 'games':
      return (
        <>
          {defs}
          <path
            d="M50 62h70a26 26 0 0 1 26 26v2a20 20 0 0 1-36 12l-4-6H64l-4 6a20 20 0 0 1-36-12v-2a26 26 0 0 1 26-26z"
            className="es-fill"
            strokeWidth="4"
          />
          <path d="M54 82v14M47 89h14" className="es-stroke" strokeWidth="5" strokeLinecap="round" />
          <circle cx="112" cy="84" r="4" className="es-lid" />
          <circle cx="124" cy="94" r="4" className="es-lid" />
          <Firefly x={85} y={30} r={15} glow={glow} />
          <Firefly x={150} y={44} r={9} glow={glow} variant={2} />
        </>
      )
  }
}

export default function EmptyScene({
  kind,
  title,
  text,
  children,
  layout = 'page',
  night
}: {
  kind: SceneKind
  title: React.ReactNode
  text?: React.ReactNode
  /** Buttons (the app's own classes, so they follow the accent) */
  children?: React.ReactNode
  /** page: centered in a big empty area; card: picture beside the words; small: tight spaces */
  layout?: 'page' | 'card' | 'small'
  /** On the always-dark Constellations panels */
  night?: boolean
}): React.JSX.Element {
  return (
    <div
      className={`empty-scene empty-scene--${layout}${night ? ' empty-scene--night' : ''}`}
      role="status"
    >
      <svg
        className="empty-scene-art"
        viewBox="0 0 170 150"
        aria-hidden="true"
        focusable="false"
      >
        <Art kind={kind} />
      </svg>
      <div className="empty-scene-words">
        <h2 className="empty-scene-title">{title}</h2>
        {text && <p className="empty-scene-text">{text}</p>}
        {children && <div className="empty-scene-actions">{children}</div>}
      </div>
    </div>
  )
}
