import { AppState, Platform } from 'react-native'
import { create } from 'zustand'
import * as Native from 'glofly-native'
import type { SharedItem } from 'glofly-native'

// 0.8.0 "Share to Glofly": something shared from another app (a photo, video, file, link or text)
// waits here until the "Send to…" screen (app/(main)/share.tsx) sends it or it's cancelled.
//
// Android: the share arrives at the main activity; the native side copies it and says so ("share"
// event), or it's waiting when Glofly starts (takePendingShare). iPhone / iPad: the Share
// Extension saves it in the App Group and opens glofly://share?id=<id> (app/+native-intent.tsx).
// Signed out: it waits until you've signed in (ShareGate in app/_layout.tsx).

type State = {
  item: SharedItem | null
  /** Bumped for each new share, so the screen starts fresh. */
  seq: number
}

export const useShareInbox = create<State>(() => ({ item: null, seq: 0 }))

function put(item: SharedItem | null) {
  if (!item) return
  const old = useShareInbox.getState().item
  if (old && old.id !== item.id) Native.discardShare(old.id)
  useShareInbox.setState((s) => ({ item, seq: s.seq + 1 }))
}

let fetching: Promise<void> | null = null
/** Picks up the waiting share (the id from glofly://share?id=… on iPhone). */
export function fetchShare(id: string | null = null): Promise<void> {
  const run = async () => put(await Native.takePendingShare(id))
  fetching = (fetching ?? Promise.resolve()).then(run, run)
  return fetching
}

/** Sent or cancelled: its copies go. */
export function finishShare() {
  const item = useShareInbox.getState().item
  if (item) Native.discardShare(item.id)
  useShareInbox.setState({ item: null })
}

/** The browser preview has no share sheet: /share?text=… stands in for one there (testing only). */
export function putWebTestShare(text: string) {
  if (Platform.OS !== 'web' || !text) return
  put({ id: `web-${Date.now()}`, text, files: [], skipped: 0 })
}

let started = false
/** Once, when Glofly starts (signed in or not). */
export function startShareInbox() {
  if (started || !Native.canReceiveShares()) return
  started = true
  Native.onNativeEvent('share', () => void fetchShare())
  // Glofly was started by a share (Android), or the iPhone extension saved one but couldn't open
  // Glofly ("Open Glofly to choose where to send it"): it's waiting.
  void fetchShare()
  if (Platform.OS === 'ios') {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void fetchShare()
    })
  }
}

/** "glofly://share?id=…" (or the path expo-router passes on) → the share's id, or undefined if it isn't one. */
export function shareIdFromLink(path: string): string | null | undefined {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?\/?share(?:\/)?(?:\?(.*))?$/i.exec(path.trim())
  if (!m) return undefined
  const id = new URLSearchParams(m[1] ?? '').get('id')
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null
}
