// Where the Glofly server is, and what every request says about this app.

export const API_URL = __GLOFLY_API_URL__
export const VERSION = __GLOFLY_VERSION__
export const BUILD = __GLOFLY_BUILD__

/** Sent with every request: Control's "App versions in use" lists the web app as Web. */
export const APP_HEADERS: Record<string, string> = {
  'X-Glofly-Version': VERSION,
  'X-Glofly-Platform': 'web',
  // Communities round: this app knows threads and forum nebulas
  'X-Glofly-Features': 'threads, round2'
}

/** "Chrome", "Safari", "Edge"… for Settings → Account → Where you're signed in. */
export function browserName(): string {
  const ua = navigator.userAgent
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge'
  if (/OPR\/|Opera/.test(ua)) return 'Opera'
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet'
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox'
  if (navigator.brave) return 'Brave'
  if (/CriOS\/|Chrome\/|Chromium\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Browser'
}

/** Shown in Settings → Account → Where you're signed in, only to you: "Web · Chrome". */
export const DEVICE_NAME = `Web · ${browserName()}`

/** iPad (iPadOS Safari says it's a Mac), iPhone, or a Mac: ⌘ for shortcuts. */
export const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)

/** A touch screen without a mouse (iPad, tablets). */
export const isTouch = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches

export const UNREACHABLE = "Can't reach Glofly right now. Check your connection and try again."

export const isId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
