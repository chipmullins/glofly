import { shortBody } from '@glofly/shared/gifs'
import type { ConversationSummary, PublicUser } from '../../../preload/api-types'
import { attachmentSummary } from './attachments'
import { eventText } from './groups'

/** The sidebar's one-line preview of a chat's latest message. */
export function lastMessagePreview(c: ConversationSummary, me: PublicUser): string {
  const last = c.lastMessage
  if (!last) return 'No messages yet'
  const nameOf = (id: string): string =>
    c.members.find((m) => m.id === id)?.displayName.split(/\s+/)[0] ?? 'Someone'
  if (last.event) return eventText(last.event, last.senderId, me.id, nameOf)
  const text = last.deleted
    ? 'Message deleted'
    : shortBody(last.body).replace(/\s+/g, ' ') || attachmentSummary(last.attachments)
  // Groups say who sent it ("Maya: hi"); DMs only mark your own ("You: hi").
  const who =
    last.senderId === me.id ? 'You: ' : c.kind === 'group' ? `${nameOf(last.senderId)}: ` : ''
  return who + text
}
