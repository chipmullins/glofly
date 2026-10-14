import { BUILD } from './config'

// "A new version of Glofly is ready": a browser always loads the newest Glofly when the page is
// opened, but a tab left open for days doesn't. This looks at version.json now and then (and
// when the tab comes back into view) and offers Reload once a newer build is live.

let ready: string | null = null
const listeners = new Set<(version: string) => void>()
const CHECK_MS = 15 * 60 * 1000

async function check(): Promise<void> {
  if (ready || !import.meta.env.PROD) return
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    const body = (await response.json()) as { version?: unknown; build?: unknown }
    if (
      typeof body.build === 'string' &&
      body.build !== BUILD &&
      typeof body.version === 'string'
    ) {
      ready = body.version.slice(0, 20)
      for (const listener of [...listeners]) listener(ready)
    }
  } catch {
    // Offline or the site is restarting: next time.
  }
}

export function startUpdateChecks(): void {
  setInterval(() => void check(), CHECK_MS)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check()
  })
}

export const updateReady = (): string | null => ready

export function onUpdateReady(listener: (version: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function checkNow(): Promise<'checking'> {
  void check()
  return 'checking'
}

export function reload(): void {
  location.reload()
}
