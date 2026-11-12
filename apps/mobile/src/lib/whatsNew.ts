import { create } from 'zustand'
import { latestWhatsNew, whatsNewFor, type WhatsNewEntry } from '@glofly/shared'
import { prefs } from './storage'

// 0.11.3: "What's new" after an update, like the desktop app (ui/WhatsNew.tsx; the notes are in
// shared whatsNew.ts). Phones get JS updates without a new store version, so this goes by the
// notes' own Glofly version, not the app's. A brand-new account gets the welcome flow instead.

const KEY = 'whatsNew.seen'

export const useWhatsNew = create<{ notes: WhatsNewEntry[] }>(() => ({ notes: [] }))

/** On start (signed in): the notes this phone hasn't shown yet. */
export async function checkWhatsNew(newAccount: boolean): Promise<void> {
  if (newAccount) return markWhatsNewSeen()
  const seen = await prefs.get<string | null>(KEY, null)
  const notes = whatsNewFor('phone', seen)
  if (notes.length) useWhatsNew.setState({ notes })
  else if (seen !== latestWhatsNew()) await markWhatsNewSeen()
}

export async function markWhatsNewSeen(): Promise<void> {
  useWhatsNew.setState({ notes: [] })
  const latest = latestWhatsNew()
  if (latest) await prefs.set(KEY, latest)
}

/** Settings → About → What's new. */
export const showAllWhatsNew = (): void => useWhatsNew.setState({ notes: whatsNewFor('phone', null) })
