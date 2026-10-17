// Windows only: Windows draws minimize / maximize / close over the page's top-right corner. A few
// times a second this looks at what's actually under them (a banner, the Constellations night sky,
// a dialog's dimming…) and paints the buttons to match, so they never sit in an odd-colored box.

type Rgba = [number, number, number, number]

function parse(css: string): Rgba | null {
  const m = css.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const parts = m[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number)
  if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null
  return [parts[0], parts[1], parts[2], parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1]
}

/** The color you see at a point: the element there and everything behind it, blended. */
function colorAt(x: number, y: number): [number, number, number] | null {
  const layers: Rgba[] = []
  for (const el of document.elementsFromPoint(x, y)) {
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || Number(style.opacity) < 0.05) continue
    const c = parse(style.backgroundColor)
    if (!c || c[3] === 0) continue
    const alpha = c[3] * Number(style.opacity)
    layers.push([c[0], c[1], c[2], alpha])
    if (alpha >= 0.99) break
  }
  if (layers.length === 0) return null
  // Paint from the back to the front.
  let out: [number, number, number] = [
    layers[layers.length - 1][0],
    layers[layers.length - 1][1],
    layers[layers.length - 1][2]
  ]
  for (let i = layers.length - 2; i >= 0; i--) {
    const [r, g, b, a] = layers[i]
    out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)]
  }
  return out
}

const hex = (n: number): string =>
  Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0')

export function startTitleBarColor(): void {
  let last = ''
  const check = (): void => {
    if (document.hidden) return
    const c = colorAt(window.innerWidth - 60, 14)
    if (!c) return
    const color = `#${hex(c[0])}${hex(c[1])}${hex(c[2])}`
    // Light background → dark symbols, and the other way round.
    const light = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 > 0.55
    const key = `${color}|${light}`
    if (key === last) return
    last = key
    window.glofly.window.setTitleBarColor(color, light ? '#4A372B' : '#E8DCD2')
  }
  // Four times a second while Glofly is in front, once a second behind other windows (an incoming
  // call's dimming still shows), and not at all while minimized or in the tray.
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (document.hidden) return
    timer = setTimeout(
      () => {
        timer = null
        check()
        schedule()
      },
      document.hasFocus() ? 250 : 1000
    )
  }
  const wake = (): void => {
    check()
    schedule()
  }
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)
  window.addEventListener('blur', schedule)
  window.addEventListener('resize', check)
  schedule()
}
