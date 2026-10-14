/// <reference types="vite/client" />

/** The Glofly server's address (vite.config.ts: GLOFLY_API_URL). */
declare const __GLOFLY_API_URL__: string
/** The version shown in Settings (the desktop app's version: the web app is built from its screens). */
declare const __GLOFLY_VERSION__: string
/** Tells one build of the web app from the next (version.json has the newest). */
declare const __GLOFLY_BUILD__: string

/** Chromium only. */
interface NavigatorUAData {
  brands: { brand: string; version: string }[]
  mobile: boolean
  platform: string
}
interface Navigator {
  userAgentData?: NavigatorUAData
  brave?: unknown
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}
