import { router } from 'expo-router'
import type { PublicUser } from '@glofly/shared'
import * as api from '@/api/glofly'
import { chooseFrom, confirm, inform } from '@/ui/dialogs'
import { openReport } from '@/ui/sheets'
import { useSession } from '@/state/session'
import { refreshConversations, refreshFriends } from '@/state/sync'
import { openDmWith } from './chatActions'
import { startCallWith } from '@/calls/controller'
import { setLiveAlertsMuted, useFriendsLive } from '@/state/friendsLive'

// What you can do with a friend (the ⋮ menu on Friends, and the profile card).

export async function removeFriend(p: PublicUser): Promise<boolean> {
  const first = p.displayName.split(/\s+/)[0]
  const ok = await confirm({
    title: `Remove ${first} as a friend?`,
    message: `You won't be able to message or call each other until one of you sends a new request. Your chat history stays.`,
    confirmLabel: 'Remove friend',
    danger: true,
  })
  if (!ok) return false
  const r = await api.removeFriend(p.id)
  if (!r.ok) void inform("Couldn't remove them", r.message)
  void refreshFriends()
  void refreshConversations()
  return r.ok
}

export async function block(p: PublicUser): Promise<boolean> {
  const first = p.displayName.split(/\s+/)[0]
  const ok = await confirm({
    title: `Block ${first}?`,
    message: `${first} won't be able to message you, call you or send friend requests. They aren't told.`,
    confirmLabel: 'Block',
    danger: true,
  })
  if (!ok) return false
  const r = await api.blockUser(p.id)
  if (!r.ok) void inform("Couldn't block them", r.message)
  void refreshFriends()
  void refreshConversations()
  return r.ok
}

export async function friendMenu(p: PublicUser) {
  const pick = await chooseFrom(
    [
      { key: 'message', label: 'Message', icon: 'chatsLine' },
      { key: 'voice', label: 'Voice call', icon: 'phone' },
      { key: 'video', label: 'Video call', icon: 'video' },
      { key: 'profile', label: 'View profile', icon: 'user' },
      // 0.9.3: friends who stream on Twitch or Kick
      ...(useFriendsLive.getState().live[p.id] || useFriendsLive.getState().muted.includes(p.id)
        ? [{ key: 'live', label: useFriendsLive.getState().muted.includes(p.id) ? `Unmute ${p.displayName.split(/\s+/)[0]}'s live alerts` : `Mute ${p.displayName.split(/\s+/)[0]}'s live alerts`, icon: 'bellOff' as const }]
        : []),
      // A restricted (family-managed) account: their family removes friends.
      ...(useSession.getState().user?.restricted ? [] : [{ key: 'remove', label: 'Remove friend', icon: 'close' as const, danger: true }]),
      { key: 'block', label: 'Block', icon: 'block', danger: true },
      { key: 'report', label: `Report @${p.username}`, icon: 'flag', danger: true },
    ],
    p.displayName,
  )
  if (pick === 'live') {
    const problem = await setLiveAlertsMuted(p.id, !useFriendsLive.getState().muted.includes(p.id))
    if (problem) void inform("Couldn't change that", problem)
    return
  }
  if (pick === 'message') void openDmWith(p.id)
  else if (pick === 'voice' || pick === 'video') void startCallWith(p.id, pick === 'video')
  else if (pick === 'profile') router.push({ pathname: '/profile/[id]', params: { id: p.id } })
  else if (pick === 'remove') void removeFriend(p)
  else if (pick === 'block') void block(p)
  else if (pick === 'report') void openReport({ userId: p.id, name: p.displayName })
}
