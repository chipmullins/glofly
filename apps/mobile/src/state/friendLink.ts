import { Share } from 'react-native'
import { create } from 'zustand'
import { friendLinkShareMessage, friendLinkUrl, type MyFriendLink } from '@glofly/shared'
import * as api from '@/api/glofly'
import { onLive } from '@/api/realtime'
import { onSignOut } from './session'

// 0.8.0 shareable friend invite links: your link, shared by every place that shows it (Add
// friend, Settings, the welcome flow, the empty Friends tab), so a reset shows everywhere.
// "Share your invite link" opens the phone's own share sheet (React Native's Share: no native code).

type State = { link: MyFriendLink | null; problem: string | null; loading: boolean }

export const useFriendLinkStore = create<State>(() => ({ link: null, problem: null, loading: false }))

export async function loadFriendLink(force = false): Promise<void> {
  const s = useFriendLinkStore.getState()
  if (s.loading || (s.link && !force)) return
  useFriendLinkStore.setState({ loading: true })
  const r = await api.myFriendLink()
  useFriendLinkStore.setState(r.ok ? { link: r.data, problem: null, loading: false } : { problem: r.message, loading: false })
}

/** A new link; the old one stops working right away. Null if it worked, else what went wrong. */
export async function resetFriendLink(): Promise<string | null> {
  const r = await api.resetFriendLink()
  if (!r.ok) return r.message
  useFriendLinkStore.setState({ link: r.data, problem: null })
  return null
}

/** Opens the share sheet with "Join me on Glofly" and the link. Null if it opened, else a problem. */
export async function shareFriendLink(): Promise<string | null> {
  await loadFriendLink()
  const { link, problem } = useFriendLinkStore.getState()
  if (!link) return problem ?? "Couldn't make your invite link. Try again in a moment."
  try {
    // iOS shows the url as a rich link; Android puts the message (with the link in it) in the text.
    await Share.share({ message: friendLinkShareMessage(link.code), url: friendLinkUrl(link.code), title: 'Join me on Glofly' }, { dialogTitle: 'Share your invite link', subject: 'Join me on Glofly' })
    return null
  } catch {
    return "Couldn't open sharing on this phone."
  }
}

// Someone joined or added you with your link: the "joined" count changed.
onLive((event) => {
  if (event === 'friend:joined' || event === 'friend:linked') {
    if (useFriendLinkStore.getState().link) void loadFriendLink(true)
  }
})
onSignOut(() => useFriendLinkStore.setState({ link: null, problem: null, loading: false }))
