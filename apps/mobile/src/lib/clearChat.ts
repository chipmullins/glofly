import { create } from 'zustand'
import { chatTitle, type ConversationSummary } from '@glofly/shared'
import * as api from '@/api/glofly'
import { confirm, inform } from '@/ui/dialogs'
import { patchConversation } from '@/state/store'
import { startChatOver } from '@/state/sync'

// 0.12.0 "Clear chat (just for you)" on phones (approved board 8 on the sidebar canvas): the chat
// menu's last choice, one "are you sure?", then a few seconds of Undo in the chat. Nothing is
// deleted and everyone else still sees every message.

type Pending = { id: string; clearedAt: string; previous: string | null }
export const useClearUndo = create<{ pending: Pending | null }>(() => ({ pending: null }))
let timer: ReturnType<typeof setTimeout> | null = null

export function othersStillSee(c: ConversationSummary): string {
  return c.kind === 'group' ? 'Everyone in the group still sees' : `${c.partner.displayName.split(/\s+/)[0]} still sees`
}

export async function clearChat(c: ConversationSummary): Promise<void> {
  const ok = await confirm({
    title: `Clear this ${c.kind === 'group' ? 'group' : 'chat'} for you?`,
    message: `It’ll start empty for you, on all your devices. ${othersStillSee(c)} every message.`,
    confirmLabel: 'Clear',
    danger: true,
  })
  if (!ok) return
  const r = await api.clearChat(c.id)
  if (!r.ok) return inform(`Couldn't clear ${chatTitle(c)}`, r.message)
  patchConversation(c.id, { clearedAt: r.data.clearedAt, unreadCount: 0, mentionCount: 0, lastMessage: null })
  void startChatOver(c.id)
  useClearUndo.setState({ pending: { id: c.id, ...r.data } })
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => useClearUndo.setState({ pending: null }), 8000)
}

export async function undoClear(): Promise<void> {
  const p = useClearUndo.getState().pending
  useClearUndo.setState({ pending: null })
  if (!p) return
  const r = await api.undoClearChat(p.id, p.clearedAt, p.previous)
  if (!r.ok) return inform("Couldn't bring the chat back", r.message)
  patchConversation(p.id, { clearedAt: r.data.clearedAt })
  void startChatOver(p.id)
}
