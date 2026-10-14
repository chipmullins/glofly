import { router } from 'expo-router'
import { MUTE_CHOICES, chatTitle, isMuted, mutedLabel, muteUntil, type ConversationSummary, type MuteDuration } from '@glofly/shared'
import * as api from '@/api/glofly'
import { chooseFrom, confirm, inform, type SheetItem } from '@/ui/dialogs'
import { patchConversation, removeConversation, useStore } from '@/state/store'
import { refreshConversations } from '@/state/sync'
import { useSession } from '@/state/session'
import { isWideNow } from '@/lib/layout'

// The long-press menu for a chat (Chats list, Groups page, chat header ⋮), and what each does.

export async function openChat(id: string) {
  // iPad (two panes): the chat replaces whatever the right pane shows, rather than piling up.
  if (isWideNow()) {
    if (useStore.getState().viewing === id) return
    if (router.canDismiss()) router.dismissAll()
  }
  router.push({ pathname: '/chat/[id]', params: { id } })
}

/** Opens (or starts) the DM with a person. */
export async function openDmWith(userId: string): Promise<void> {
  const existing = Object.values(useStore.getState().conversations).find((c) => c.kind === 'dm' && c.partner.id === userId)
  if (existing) return openChat(existing.id)
  const r = await api.openDm(userId)
  if (!r.ok) return inform("Couldn't open the chat", r.message)
  useStore.setState({ conversations: { ...useStore.getState().conversations, [r.data.id]: r.data } })
  void openChat(r.data.id)
}

export async function setPinned(c: ConversationSummary, pinned: boolean) {
  const before = c.pinnedAt
  patchConversation(c.id, { pinnedAt: pinned ? new Date().toISOString() : null, ...(pinned ? { closedAt: null } : {}) })
  const r = await api.pinChat(c.id, pinned)
  if (!r.ok) {
    patchConversation(c.id, { pinnedAt: before })
    void inform(pinned ? "Couldn't pin it" : "Couldn't unpin it", r.message)
  }
}

export async function setMute(c: ConversationSummary, duration: MuteDuration | null) {
  const before = c.mutedUntil ?? null
  patchConversation(c.id, { mutedUntil: duration ? muteUntil(duration) : null })
  const r = await api.muteChat(c.id, duration)
  if (r.ok) patchConversation(c.id, { mutedUntil: r.data })
  else {
    patchConversation(c.id, { mutedUntil: before })
    void inform("Couldn't change that", r.message)
  }
}

/** The "Mute chat" sheet (1 h / 8 h / 24 h / until I turn it back on). */
export async function chooseMute(c: ConversationSummary) {
  const muted = isMuted(c)
  const items: SheetItem[] = [
    ...MUTE_CHOICES.map((m) => ({ key: m.duration, label: m.label, icon: 'bellOff' as const })),
    ...(muted ? [{ key: 'unmute', label: 'Unmute', icon: 'bell' as const }] : []),
  ]
  const title = muted && c.mutedUntil ? mutedLabel(c.mutedUntil) : `Mute ${chatTitle(c)}`
  const pick = await chooseFrom(items, title)
  if (!pick) return
  await setMute(c, pick === 'unmute' ? null : (pick as MuteDuration))
}

export async function closeChat(c: ConversationSummary) {
  patchConversation(c.id, { closedAt: new Date().toISOString(), unreadCount: 0, mentionCount: 0 })
  const r = await api.closeChat(c.id, true)
  if (!r.ok) {
    void refreshConversations()
    void inform("Couldn't close it", r.message)
  }
}

export async function leaveGroup(c: ConversationSummary): Promise<boolean> {
  const ok = await confirm({
    title: `Leave ${chatTitle(c)}?`,
    message: "You won't get its messages any more. Someone in it can add you back.",
    confirmLabel: 'Leave group',
    danger: true,
  })
  if (!ok) return false
  const me = useSession.getState().user?.id ?? ''
  const r = await api.removeMember(c.id, me)
  if (!r.ok) {
    void inform("Couldn't leave the group", r.message)
    return false
  }
  removeConversation(c.id)
  return true
}

export async function chatMenu(c: ConversationSummary, opts: { inChat?: boolean } = {}) {
  const muted = isMuted(c)
  const items: SheetItem[] = [
    c.pinnedAt ? { key: 'unpin', label: 'Unpin', icon: 'unpin' } : { key: 'pin', label: 'Pin to the top', icon: 'pin' },
    muted ? { key: 'unmute', label: 'Unmute', icon: 'bell', detail: c.mutedUntil ? mutedLabel(c.mutedUntil) : undefined } : { key: 'mute', label: 'Mute…', icon: 'bellOff' },
    ...(c.kind === 'dm'
      ? [{ key: 'profile', label: 'View profile', icon: 'user' as const }]
      : [{ key: 'settings', label: 'Group settings', icon: 'gear' as const }]),
    ...(!opts.inChat && !c.pinnedAt ? [{ key: 'close', label: 'Close chat', icon: 'close' as const, detail: 'Hidden until a new message. Nothing is deleted.' }] : []),
    ...(c.kind === 'group' ? [{ key: 'leave', label: 'Leave group', icon: 'door' as const, danger: true }] : []),
  ]
  const pick = await chooseFrom(items, chatTitle(c))
  switch (pick) {
    case 'pin':
      return setPinned(c, true)
    case 'unpin':
      return setPinned(c, false)
    case 'mute':
      return chooseMute(c)
    case 'unmute':
      return setMute(c, null)
    case 'profile':
      if (c.kind === 'dm') router.push({ pathname: '/profile/[id]', params: { id: c.partner.id } })
      return
    case 'settings':
      router.push({ pathname: '/group/[id]', params: { id: c.id } })
      return
    case 'close':
      return closeChat(c)
    case 'leave':
      if ((await leaveGroup(c)) && opts.inChat) router.back()
      return
  }
}
