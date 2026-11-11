import { BAN_DELETE_WINDOWS, QUICK_BAN_REASONS, TIMEOUT_LENGTHS, type BanAppeals, type BanDeleteWindow, type ConstellationDetail, type PublicUser, type TimeoutLength } from '@glofly/shared'
import { nightWatch } from '@/api/nightwatch'
import { cx } from '@/api/constellations'
import { cxSay, putDetail, refreshCardsSoon } from '@/state/constellations'
import { firstName } from '@/lib/format'
import { chooseFrom, confirm } from '@/ui/dialogs'
import { askText } from './ask'
import { haptic } from './motion'

// What moderators can do to someone (the server checks every one: rank, permission, and that the
// person is below you). Each answers with the constellation's newer copy, and is saved to the
// moderation log by the server.

const nameOf = (u: PublicUser) => firstName(u.displayName, u.username)

export async function pickTimeout(c: ConstellationDetail, user: PublicUser): Promise<boolean> {
  const pick = await chooseFrom(
    TIMEOUT_LENGTHS.map((l) => ({ key: l.id, label: l.name, icon: 'clock' as const })),
    `Time out ${nameOf(user)}`,
  )
  if (!pick) return false
  const r = await cx.timeout(c.id, user.id, pick as TimeoutLength)
  if (!r.ok) {
    cxSay(r.message)
    return false
  }
  haptic.success()
  putDetail(r.data.constellation)
  const l = TIMEOUT_LENGTHS.find((x) => x.id === pick)
  cxSay(`${nameOf(user)} is timed out for ${l?.name ?? 'a while'}.`)
  return true
}

export async function endTimeout(c: ConstellationDetail, user: PublicUser) {
  const r = await cx.endTimeout(c.id, user.id)
  if (!r.ok) return cxSay(r.message)
  putDetail(r.data.constellation)
  cxSay(`${nameOf(user)} can post again.`)
}

/**
 * Communities round 2 (board 1c): a ban with a reason they see, deleting their recent messages,
 * and whether they can appeal. True when banned.
 */
export async function banWithOptions(c: ConstellationDetail, user: PublicUser): Promise<boolean> {
  const ok = await confirm({
    title: `Ban ${user.displayName}?`,
    message: `They're removed and can't come back to ${c.name} until they're unbanned.`,
    confirmLabel: 'Ban',
    danger: true,
  })
  if (!ok) return false
  const reason = await askText(`Why ban ${nameOf(user)}? (they see this)`, QUICK_BAN_REASONS.join(', '), '', true)
  if (reason === null) return false
  const window = await chooseFrom(
    BAN_DELETE_WINDOWS.map((w) => ({ key: w.id, label: w.name, icon: 'trash' as const })),
    'Delete their messages from',
  )
  if (!window) return false
  const appeals = await chooseFrom(
    [
      { key: 'now', label: 'Can appeal right away', icon: 'mail' as const },
      { key: 'later', label: 'Can appeal after 7 days', icon: 'clock' as const },
      { key: 'never', label: 'No appeals', icon: 'block' as const },
    ],
    'Appeals',
  )
  if (!appeals) return false
  const r = await nightWatch.ban(c.id, user.id, { reason: reason || undefined, appeals: appeals as BanAppeals, deleteWindow: window as BanDeleteWindow })
  if (!r.ok) {
    cxSay(r.message)
    return false
  }
  haptic.success()
  putDetail(r.data.constellation)
  refreshCardsSoon()
  cxSay(`${nameOf(user)} is banned.`)
  return true
}

export async function kickOrBan(c: ConstellationDetail, user: PublicUser, ban: boolean): Promise<boolean> {
  if (ban) return banWithOptions(c, user)
  const ok = await confirm({
    title: ban ? `Ban ${user.displayName}?` : `Kick ${user.displayName} from ${c.name}?`,
    message: ban ? `They're removed and can't come back to ${c.name} until they're unbanned.` : 'They can join again with an invite.',
    confirmLabel: ban ? 'Ban' : 'Kick',
    danger: true,
  })
  if (!ok) return false
  const reason = await askText(ban ? `Why ban ${nameOf(user)}? (optional)` : `Why kick ${nameOf(user)}? (optional)`, 'Saved to the moderation log', '', true)
  if (reason === null) return false
  const r = ban ? await cx.ban(c.id, user.id, reason || undefined) : await cx.kick(c.id, user.id, reason || undefined)
  if (!r.ok) {
    cxSay(r.message)
    return false
  }
  haptic.success()
  putDetail(r.data.constellation)
  refreshCardsSoon()
  cxSay(ban ? `${nameOf(user)} is banned.` : `${nameOf(user)} was removed.`)
  return true
}

export async function voiceMute(c: ConstellationDetail, nebulaId: string, user: PublicUser, muted: boolean) {
  const r = await cx.voiceMute(c.id, nebulaId, user.id, muted)
  if (!r.ok) return cxSay(r.message)
  cxSay(muted ? `${nameOf(user)} is muted in voice.` : `${nameOf(user)} can talk again.`)
}

export async function voiceDisconnect(c: ConstellationDetail, nebulaId: string, user: PublicUser) {
  const r = await cx.voiceDisconnect(c.id, nebulaId, user.id)
  if (!r.ok) return cxSay(r.message)
  cxSay(`${nameOf(user)} was disconnected from voice.`)
}
