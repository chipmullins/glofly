// The pure parts of the taskbar / Dock extras and notification replies (no Electron here, so
// they can be tested on their own).

/** What a Jump List task (Windows) or Dock menu item (Mac) asks the window to do. */
export type ShortcutAction =
  'new-message' | 'status:online' | 'status:away' | 'status:dnd' | 'quiet-hours'

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  'new-message',
  'status:online',
  'status:away',
  'status:dnd',
  'quiet-hours'
]

/** The command-line switch a Jump List task starts Glofly with. */
export const TASK_SWITCH = '--glofly-task='

/** The words on each Jump List task / Dock menu item. */
export const SHORTCUT_LABELS: Record<ShortcutAction, { title: string; description: string }> = {
  'new-message': { title: 'New message', description: 'Start a chat' },
  'status:online': { title: 'Set status: Online', description: 'Show friends you’re around' },
  'status:away': { title: 'Set status: Away', description: 'Show friends you’re away' },
  'status:dnd': { title: 'Set status: Do not disturb', description: 'Silence alerts' },
  'quiet-hours': { title: 'Quiet hours…', description: 'Turn quiet hours on or off' }
}

/**
 * The task in a second launch's command line ("--glofly-task=status:away"), or null. Only the
 * known actions count: anything else on the command line is ignored.
 */
export function taskFromArgv(argv: readonly string[]): ShortcutAction | null {
  for (const arg of argv) {
    if (typeof arg !== 'string' || !arg.startsWith(TASK_SWITCH)) continue
    const action = arg.slice(TASK_SWITCH.length)
    if ((SHORTCUT_ACTIONS as readonly string[]).includes(action)) return action as ShortcutAction
  }
  return null
}

/** The text on the Mac Dock badge for this many unread chats ("" = no badge). */
export function badgeText(count: number): string {
  const n = badgeNumber(count)
  return n === 0 ? '' : n > 99 ? '99+' : String(n)
}

/** A safe count: a whole number from 0 to 999 (anything odd counts as 0). */
export function badgeNumber(count: unknown): number {
  return typeof count === 'number' && Number.isInteger(count) && count > 0
    ? Math.min(count, 999)
    : 0
}

/**
 * The chat a notification's Reply box sends to, or null when it has none. Message notifications
 * are keyed by their chat's id (a DM or group), nebula ones by "nebula:<chat id>"; calls, friend
 * requests, "is online" and the like can't be answered.
 */
export function replyTarget(n: {
  key: string
  conversationId: string | null
  call?: boolean
}): string | null {
  if (n.call || !n.conversationId) return null
  if (n.key === n.conversationId || n.key === `nebula:${n.conversationId}`) return n.conversationId
  return null
}

const MAX_REPLY = 4000

/** A typed reply, tidied: null when there's nothing to send. */
export function cleanReply(text: unknown): string | null {
  if (typeof text !== 'string') return null
  // Stray Enters (Windows' reply box adds a line on Enter) never send blank lines.
  const trimmed = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return trimmed ? trimmed.slice(0, MAX_REPLY) : null
}
