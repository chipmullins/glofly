import type { AccountStatus, ReportOutcome, ReportReason } from '@control/api'
import { tileColors, type ChipTone } from '@/ui/theme'

export const REASON_SHORT: Record<ReportReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  hate: 'Hate',
  sexual: 'Sexual content',
  violence: 'Violence',
  self_harm: 'Self-harm',
  other: 'Something else',
}
export const reasonName = (r: string) => REASON_SHORT[r as ReportReason] ?? r

export const REASON_TONE: Record<ReportReason, ChipTone> = {
  spam: 'warn',
  harassment: 'danger',
  hate: 'danger',
  sexual: 'danger',
  violence: 'danger',
  self_harm: 'hot',
  other: 'off',
}

export const OUTCOME: Record<ReportOutcome, [string, ChipTone]> = {
  dismissed: ['Dismissed', 'off'],
  removed: ['Message removed', 'warn'],
  warned: ['Warned', 'warn'],
  suspended: ['Suspended', 'danger'],
}

export const STATUS_CHIP: Record<AccountStatus, [string, ChipTone] | null> = {
  confirmed: null,
  unconfirmed: ['Email not confirmed', 'warn'],
  suspended: ['Suspended', 'danger'],
  deleting: ['Being deleted', 'danger'],
}

export function tileColor(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return tileColors[h % tileColors.length]
}

export function flagsFor(r: { openReports?: number; joinsToday?: number; frozenAt?: string | null; invitesOffAt?: string | null; takenDownAt: string | null }) {
  const out: [string, ChipTone][] = []
  if (r.takenDownAt) out.push(['Taken down', 'danger'])
  if ((r.joinsToday ?? 0) >= 10) out.push(['Growing', 'hot'])
  if (r.openReports) out.push([`${r.openReports} report${r.openReports === 1 ? '' : 's'}`, 'warn'])
  if (r.frozenAt) out.push(['Frozen', 'frozen'])
  if (r.invitesOffAt) out.push(['Invites off', 'off'])
  return out
}
