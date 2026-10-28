// Full screen that works in every browser Glofly runs in. Safari before 16.4 (and some embedded
// browsers) only has the webkit-prefixed versions, and iPhone Safari has no element full screen at
// all: calling el.requestFullscreen() there threw "requestFullscreen is not a function" (error
// report, Oct 27: Safari on macOS, double-clicking a call tile). These never throw; where full
// screen isn't possible they simply do nothing (enterFullscreen resolves false).

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitFullscreenEnabled?: boolean
  webkitExitFullscreen?: () => Promise<void> | void
}
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }

const doc = (): WebkitDocument => document as WebkitDocument

/** The element shown full screen right now, if any. */
export function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? doc().webkitFullscreenElement ?? null
}

/** Whether this browser can show an element full screen at all (not on iPhones). */
export function canFullscreen(): boolean {
  const d = doc()
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled)
}

/** Shows this element full screen. False if the browser can't or refused. */
export async function enterFullscreen(el: HTMLElement): Promise<boolean> {
  const e = el as WebkitElement
  try {
    if (typeof e.requestFullscreen === 'function') await e.requestFullscreen()
    else if (typeof e.webkitRequestFullscreen === 'function') await e.webkitRequestFullscreen()
    else return false
    return true
  } catch {
    return false
  }
}

/** Leaves full screen (nothing happens if nothing is full screen). */
export async function exitFullscreen(): Promise<void> {
  if (!fullscreenElement()) return
  const d = doc()
  try {
    if (typeof d.exitFullscreen === 'function') await d.exitFullscreen()
    else if (typeof d.webkitExitFullscreen === 'function') await d.webkitExitFullscreen()
  } catch {
    // Already out of full screen.
  }
}

/** Calls fn whenever full screen starts or ends. Returns the way to stop listening. */
export function onFullscreenChange(fn: () => void): () => void {
  document.addEventListener('fullscreenchange', fn)
  document.addEventListener('webkitfullscreenchange', fn)
  return () => {
    document.removeEventListener('fullscreenchange', fn)
    document.removeEventListener('webkitfullscreenchange', fn)
  }
}
