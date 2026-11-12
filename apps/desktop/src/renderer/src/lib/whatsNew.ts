import { latestWhatsNew, whatsNewFor, type WhatsNewEntry } from '@glofly/shared/whatsNew'
import { isWeb } from './platform'

// 0.11.3: "What's new" after an update (components/WhatsNew.tsx; the notes are in shared
// whatsNew.ts). This device remembers the newest notes it has shown.

const KEY = 'glofly.whatsNew.seen'

function read(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** The notes to show now (nothing new: an empty list). */
export const pendingWhatsNew = (): WhatsNewEntry[] => whatsNewFor(isWeb ? 'web' : 'desktop', read())

/** Shown (or a brand-new account, whose welcome flow comes instead): don't show these again. */
export function markWhatsNewSeen(): void {
  const latest = latestWhatsNew()
  try {
    if (latest) localStorage.setItem(KEY, latest)
  } catch {
    // just for now
  }
}

/** Settings → About → What's new: the newest notes, whatever's been seen. */
export const allWhatsNew = (): WhatsNewEntry[] => whatsNewFor(isWeb ? 'web' : 'desktop', null)
