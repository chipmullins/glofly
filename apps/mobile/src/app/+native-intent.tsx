import { fetchShare, shareIdFromLink } from '@/share/inbox'

// Links that open Glofly (expo-router asks here first). 0.8.0: glofly://share?id=<id> comes from
// the iPhone Share Extension: the share is picked up and the app stays where it is; ShareGate
// (app/_layout.tsx) opens "Send to…" as soon as you're signed in.

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    const share = shareIdFromLink(path)
    if (share !== undefined) {
      void fetchShare(share)
      return null
    }
  } catch {
    // never stop a link over this
  }
  return path
}
