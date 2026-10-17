import { useEffect, useMemo } from 'react'
import { AppState } from 'react-native'
import { continuesGroup, dayLabel, isSameDay, mentionsMe, type ConstellationDetail, type Nebula, type PublicUser } from '@glofly/shared'
import * as api from '@/api/glofly'
import { isAppActive } from '@/api/realtime'
import { useSession } from '@/state/session'
import { useStore } from '@/state/store'
import { loadLatest } from '@/state/sync'
import { patchNebula, refreshCardsSoon, refreshPins, useCx } from '@/state/constellations'
import { useOutbox } from '@/chat/send'
import { chatOpened } from '@/push'
import type { NebulaRowInfo } from './NebulaRow'

// A nebula's messages on screen: loading, the rows (newest first, for an upside-down list), and
// keeping it read while you look at it. Nebulas are conversations, so the chat store holds them.

/** Marks a nebula read (here, on your other devices, and in the dock's counts). */
export async function markNebulaRead(constellationId: string, nebula: Pick<Nebula, 'id' | 'conversationId'>) {
  patchNebula(constellationId, nebula.id, { unreadCount: 0, mentionCount: 0 })
  await api.markRead(nebula.conversationId)
  refreshCardsSoon()
  if (useCx.getState().pins.some((p) => p.nebula.id === nebula.id)) void refreshPins()
}

export function useNebulaChat(detail: ConstellationDetail | null, nebula: Nebula | null, opts: { visible?: boolean } = {}) {
  const meId = useSession((s) => s.user?.id ?? '')
  const conversationId = nebula?.conversationId ?? ''
  const messages = useStore((s) => (conversationId ? s.messages[conversationId] : undefined))
  const outbox = useOutbox((s) => s.items)
  const visible = opts.visible ?? true

  useEffect(() => {
    if (conversationId) void loadLatest(conversationId)
  }, [conversationId])

  // On screen: no sound for it, its notification goes, and it stays read.
  useEffect(() => {
    if (!conversationId || !visible) return
    useCx.setState({ viewing: conversationId })
    useStore.setState({ viewing: conversationId })
    chatOpened(conversationId)
    return () => {
      if (useCx.getState().viewing === conversationId) useCx.setState({ viewing: null })
      if (useStore.getState().viewing === conversationId) useStore.setState({ viewing: null })
    }
  }, [conversationId, visible])
  const unread = (nebula?.unreadCount ?? 0) + (nebula?.mentionCount ?? 0)
  const newest = messages?.list.at(-1)?.id
  useEffect(() => {
    if (!detail || !nebula || !visible || !isAppActive()) return
    if (unread > 0 || newest) void markNebulaRead(detail.id, nebula)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, nebula?.id, unread, newest, visible])
  useEffect(() => {
    if (!detail || !nebula || !visible) return
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void markNebulaRead(detail.id, nebula)
    })
    return () => sub.remove()
  }, [detail, nebula, visible])

  const people = useStore((s) => s.people)
  const members: PublicUser[] = useMemo(() => (detail ? detail.members.map((m) => m.user) : []), [detail])

  const rows: NebulaRowInfo[] = useMemo(() => {
    const ms = messages?.list ?? []
    const out: NebulaRowInfo[] = []
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i]
      const prev = ms[i - 1]
      const sameDay = !!prev && isSameDay(prev.createdAt, m.createdAt)
      out.push({
        message: m,
        joined: !!prev && sameDay && !prev.event && !m.event && !prev.deleted && continuesGroup(prev, m),
        day: !prev || !sameDay ? dayLabel(m.createdAt) : null,
        mentionsMe: mentionsMe(m, meId) && m.senderId !== meId,
        outgoing: outbox[m.id]?.status ?? null,
      })
    }
    return out.reverse()
  }, [messages?.list, meId, outbox])

  return { rows, messages, people, members, meId }
}
