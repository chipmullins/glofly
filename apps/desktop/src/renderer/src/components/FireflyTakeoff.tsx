import { useMemo } from 'react'
import fireflyImg from '../assets/firefly.png'
import './FireflyTakeoff.css'

type FireflyTakeoffProps = {
  /** Big line on the welcome screen, e.g. "Welcome back, Chip" */
  title: string
  /** Small line under it, next to the loading dots */
  status?: string
}

/**
 * The flight curve from the design, which was drawn for a 1280×800 window,
 * scaled to whatever size the window is right now.
 * Design path: M 120 660 C 420 780, 640 120, 1480 110
 */
function flightPath(w: number, h: number): string {
  const x = (v: number): number => Math.round((v / 1280) * w)
  const y = (v: number): number => Math.round((v / 800) * h)
  return `path('M ${x(120)} ${y(660)} C ${x(420)} ${y(780)}, ${x(640)} ${y(120)}, ${x(1480)} ${y(110)}')`
}

export default function FireflyTakeoff({
  title,
  status = 'Loading your chats'
}: FireflyTakeoffProps): React.JSX.Element {
  // Measured once when the animation starts.
  const style = useMemo(
    () =>
      ({ '--tk-path': flightPath(window.innerWidth, window.innerHeight) }) as React.CSSProperties,
    []
  )

  return (
    <div className="takeoff" style={style} role="status" aria-live="polite">
      <div className="tk-app">
        <img src={fireflyImg} alt="" draggable={false} />
        <span className="tk-app-title">{title}</span>
        <span className="tk-app-status">
          <span className="tk-dots" aria-hidden="true">
            <span className="tk-dot" />
            <span className="tk-dot" />
            <span className="tk-dot" />
          </span>
          {status}
        </span>
      </div>

      <span className="tk-path tk-spark tk-spark--1" />
      <span className="tk-path tk-spark tk-spark--2" />
      <span className="tk-path tk-spark tk-spark--3" />
      <span className="tk-path tk-spark tk-spark--4" />
      <span className="tk-path tk-spark tk-spark--5" />

      <div className="tk-path tk-flyer" aria-hidden="true">
        <div className="tk-glow">
          <svg viewBox="120 220 800 600" width="220" height="165">
            <defs>
              <linearGradient id="tk-body" x1="0" y1="0" x2="0.3" y2="1">
                <stop offset="0" stopColor="#FFC21A" />
                <stop offset="1" stopColor="#F5A800" />
              </linearGradient>
              <linearGradient id="tk-bubble" x1="1" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#FFD21F" />
                <stop offset="0.55" stopColor="#FF9A10" />
                <stop offset="1" stopColor="#FF6A00" />
              </linearGradient>
            </defs>
            {/* antennae */}
            <path
              d="M520 352 C524 332 520 316 506 304"
              fill="none"
              stroke="#F5B000"
              strokeWidth="20"
              strokeLinecap="round"
            />
            <circle cx="505" cy="301" r="13" fill="#F5B000" />
            <path
              d="M596 398 C616 380 640 374 662 382"
              fill="none"
              stroke="#F5B000"
              strokeWidth="20"
              strokeLinecap="round"
            />
            <circle cx="664" cy="382" r="13" fill="#F5B000" />
            {/* body */}
            <ellipse
              cx="455"
              cy="528"
              rx="78"
              ry="52"
              transform="rotate(-38 455 528)"
              fill="url(#tk-body)"
            />
            <circle cx="540" cy="428" r="74" fill="url(#tk-body)" />
            {/* wings (each pair flaps on its own) */}
            <g
              className="tk-wa"
              fill="none"
              stroke="#FF7A12"
              strokeWidth="22"
              strokeLinejoin="round"
            >
              <path d="M490 490 C420 380 268 222 182 238 C124 250 136 330 200 382 C280 444 400 470 490 490 Z" />
              <path d="M490 490 C400 456 262 432 192 456 C142 474 150 536 222 546 C302 556 410 520 490 490 Z" />
            </g>
            <g
              className="tk-wb"
              fill="none"
              stroke="#FF7A12"
              strokeWidth="22"
              strokeLinejoin="round"
            >
              <path d="M490 490 C620 500 800 520 860 580 C905 626 870 690 780 680 C680 668 572 560 490 490 Z" />
              <path d="M490 490 C500 600 540 705 598 768 C632 804 694 796 676 736 C658 672 566 566 490 490 Z" />
            </g>
            {/* glowing chat-bubble tail */}
            <rect x="282" y="588" width="216" height="154" rx="50" fill="url(#tk-bubble)" />
            <path d="M322 722 L318 778 Q320 794 336 784 L392 738 Z" fill="#FF7000" />
          </svg>
        </div>
      </div>
    </div>
  )
}
