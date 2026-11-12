import type { QueueItem } from '@glofly/shared'

// Communities round 2: words for Night watch's queue on phones.

export const ago = (iso: string): string => {
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86_400)}d`
}

export function titleOf(q: QueueItem): string {
  if (q.kind === 'report') return `Report: ${q.reason}`
  if (q.kind === 'appeal') return `Appeal from @${q.target.username}`
  return q.reason === 'mentions' ? 'Mention cap' : q.reason === 'raid' ? 'Held: raid joiner' : q.reason === 'links' ? 'Link spam held' : 'AutoMod held a message'
}
export function metaOf(q: QueueItem): string {
  const who = q.target ? `@${q.target.username}` : 'someone'
  if (q.kind === 'report') return `${who}${q.nebula ? ` in #${q.nebula.name}` : ''} · ${q.reportCount} report${q.reportCount === 1 ? '' : 's'}`
  if (q.kind === 'appeal') return `Banned ${ago(q.bannedAt)} ago${q.banReason ? ` · “${q.banReason}”` : ''}`
  return `${who}${q.nebula ? ` in #${q.nebula.name}` : ''}${q.reason === 'mentions' && q.detail ? ` · ${q.detail} pings` : ''}`
}
export const TONE: Record<string, string> = { report: '#c7372f', held: '#b4530e', appeal: '#1679a0', mentions: '#7c3aed' }

