import { ROLE_COLORS, playingFor, type ConstellationDetail, type ConstellationMember, type ConstellationPermission, type ConstellationRole, type Nebula } from '@glofly/shared'
import { hexA, roleNight } from './ui'
import type { RoleLook } from './NebulaRow'

// What someone can do in a constellation, read from what the server sent (the server checks every
// action again; this only decides what to show). The same rules as the desktop app.

/**
 * The highest role someone has (Owner first, Member last). 0.7.5: roles people pick themselves
 * are labels and never count here (like the server).
 */
export function topRole(c: ConstellationDetail, userId: string): ConstellationRole {
  if (c.ownerId === userId) return c.roles.find((r) => r.kind === 'owner') ?? c.roles[0]
  const held = c.members.find((m) => m.user.id === userId)?.roleIds ?? []
  const roles = c.roles.filter((r) => r.kind === 'member' || (held.includes(r.id) && !r.selfAssign))
  return roles.sort((a, b) => b.position - a.position)[0] ?? c.roles[c.roles.length - 1]
}

export const rankOf = (c: ConstellationDetail, userId: string): number => topRole(c, userId).position

export const can = (c: ConstellationDetail, p: ConstellationPermission): boolean => c.me.owner || c.me.permissions.includes(p)

/** Can I act on this person (kick, time out, roles)? Only people ranked below me. */
export function outranks(c: ConstellationDetail, meId: string, userId: string): boolean {
  if (userId === meId || userId === c.ownerId) return false
  return c.me.owner || c.me.rank > rankOf(c, userId)
}

/** A name's color and badge in a nebula (plain members have neither). */
export function roleLook(c: ConstellationDetail, userId: string): RoleLook {
  const member = c.members.find((m) => m.user.id === userId)
  if (!member) return null
  // Communities round: a constellation's bot always shows BOT.
  if (member.user.tool) return { name: 'TOOL', color: '#ffb36b', badgeBg: hexA('#ffb36b', 0.16) }
  if (member.user.bot) return { name: 'BOT', color: '#7fd4e8', badgeBg: hexA('#7fd4e8', 0.16) }
  const role = topRole(c, userId)
  if (role.kind === 'member') return { name: null, color: '#f5ede6', badgeBg: 'transparent' }
  const colors = role.kind === 'owner' ? ROLE_COLORS.ember : (ROLE_COLORS[role.color] ?? ROLE_COLORS.gray)
  return { name: role.name, color: colors.dark, badgeBg: hexA(colors.dark, 0.16) }
}

/** The color a role's name is drawn in on the night side. */
export function roleColor(role: ConstellationRole): string {
  return role.kind === 'owner' ? ROLE_COLORS.ember.dark : (ROLE_COLORS[role.color] ?? ROLE_COLORS.gray).dark
}

/** Members grouped by their highest role: Owner, then each role (highest first), then Member. */
export function memberGroups(c: ConstellationDetail, query = ''): { key: string; title: string; color: string; members: ConstellationMember[] }[] {
  const q = query.trim().toLowerCase().replace(/^@/, '')
  const match = (m: ConstellationMember) => !q || m.user.displayName.toLowerCase().includes(q) || m.user.username.toLowerCase().includes(q)
  const order = (a: ConstellationMember, b: ConstellationMember) => {
    const on = (m: ConstellationMember) => (m.status === 'offline' ? 1 : 0)
    return on(a) - on(b) || a.user.displayName.localeCompare(b.user.displayName)
  }
  const out: { key: string; title: string; color: string; members: ConstellationMember[] }[] = []
  const placed = new Set<string>()
  const owner = c.members.find((m) => m.user.id === c.ownerId)
  if (owner) {
    placed.add(owner.user.id)
    if (match(owner)) out.push({ key: 'owner', title: 'Owner', color: ROLE_COLORS.ember.dark, members: [owner] })
  }
  const roles = [...c.roles].filter((r) => r.kind !== 'owner' && r.kind !== 'member' && !r.selfAssign).sort((a, b) => b.position - a.position)
  for (const role of roles) {
    const list = c.members.filter((m) => !placed.has(m.user.id) && topRole(c, m.user.id).id === role.id)
    list.forEach((m) => placed.add(m.user.id))
    const shown = list.filter(match).sort(order)
    if (shown.length) out.push({ key: role.id, title: role.name, color: roleColor(role), members: shown })
  }
  const memberRole = c.roles.find((r) => r.kind === 'member')
  const rest = c.members.filter((m) => !placed.has(m.user.id)).filter(match).sort(order)
  if (rest.length) out.push({ key: 'member', title: memberRole?.name ?? 'Member', color: memberRole ? roleColor(memberRole) : '#f5ede6', members: rest })
  return out
}

/** "In Campfire", "Streaming in Campfire", "Playing …" or the custom status, for a member row. */
export function activityOf(c: ConstellationDetail, m: ConstellationMember): { text: string; voice: boolean } | null {
  const v = c.voice.find((x) => x.userIds.includes(m.user.id))
  if (v) {
    const n = c.nebulas.find((x) => x.id === v.nebulaId)
    if (v.sharing.includes(m.user.id)) return { text: `Streaming in ${n?.name ?? 'voice'}`, voice: true }
    return { text: `In ${n?.name ?? 'voice'}`, voice: true }
  }
  // 0.7.5: the game and how long ("Rocket League · 42 min")
  if (m.playing) return { text: `${m.playing.name} · ${playingFor(m.playing.since)}`, voice: false }
  return m.activity ? { text: m.activity, voice: false } : null
}

export const STATUS_WORD = { online: 'Online', away: 'Away', dnd: 'Do not disturb', offline: 'Offline' } as const

/** Muted right now (a timed mute that hasn't run out). */
export const isQuiet = (n: Nebula): boolean => !!n.mutedUntil && new Date(n.mutedUntil).getTime() > Date.now()

/** "until 3:40 PM", "until Sat 9:00 AM", or "until you turn it back on". */
export function mutedUntilText(iso: string): string {
  const d = new Date(iso)
  if (d.getFullYear() >= 2099) return 'until you turn it back on'
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return sameDay ? `until ${time}` : `until ${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

/** Why I can't post in a nebula right now (null = I can). */
export function cantPost(c: ConstellationDetail, n: Nebula): { kind: 'timeout' | 'readonly'; text: string } | null {
  if (c.me.timedOutUntil && new Date(c.me.timedOutUntil).getTime() > Date.now()) return { kind: 'timeout', text: "You're timed out for now, so you can read but not post." }
  if (n.readOnly && !can(c, 'manageNebulas') && !can(c, 'deleteMessages')) {
    const roles = c.roles.filter((r) => r.kind !== 'member' && r.kind !== 'owner' && (r.permissions.includes('manageNebulas') || r.permissions.includes('deleteMessages')))
    const top = roles.sort((a, b) => b.position - a.position)
    const who = top.length ? `${top[top.length - 1].name}s` : 'moderators'
    return { kind: 'readonly', text: `Only ${who} can post in #${n.name}` }
  }
  // Communities round 2 (Night watch → Safety): the verification level.
  if (c.me.verification) return { kind: 'readonly', text: c.me.verification }
  return null
}

/** The nebulas in their sections: loose ones first, then each category. */
export function sectionsOf(c: ConstellationDetail): { id: string; name: string | null; nebulas: Nebula[] }[] {
  const categories = [...c.categories].sort((a, b) => a.position - b.position)
  const byPos = (a: Nebula, b: Nebula) => a.position - b.position
  const loose = c.nebulas.filter((n) => !n.categoryId || !c.categories.some((x) => x.id === n.categoryId)).sort(byPos)
  return [
    ...(loose.length ? [{ id: 'none', name: null, nebulas: loose }] : []),
    ...categories
      .map((cat) => ({ id: cat.id, name: cat.name, nebulas: c.nebulas.filter((n) => n.categoryId === cat.id).sort(byPos) }))
      // 0.7.1: a category with no nebulas (or none you can see) isn't shown
      .filter((s) => s.nebulas.length > 0),
  ]
}

/** 0.8.0 ⌥↑ / ⌥↓: the nebula before or after this one, in sidebar order (wrapping round). */
export function stepNebula(c: ConstellationDetail, currentId: string | null | undefined, dir: -1 | 1): Nebula | null {
  const order = sectionsOf(c).flatMap((s) => s.nebulas)
  if (!order.length) return null
  const at = order.findIndex((n) => n.id === currentId)
  if (at < 0) return order[dir > 0 ? 0 : order.length - 1]
  if (order.length === 1) return null
  return order[(at + dir + order.length) % order.length]
}

/** 0.8.0 role-only: "Valorant", "Valorant +1", or "Owner and admins" (the lock badge). */
export function gateLabel(c: ConstellationDetail, roleIds: string[] | undefined): string {
  const names = (roleIds ?? []).map((id) => c.roles.find((r) => r.id === id)?.name).filter((n): n is string => !!n)
  if (!names.length) return 'Owner and admins'
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`
}

// ───────────── 4.2: @everyone, @here and @Role (approved board 30) ─────────────

export type MentionGroupRole = { id: string; name: string; kind: string; mentionable?: boolean; color: string; count: number }
/** What a nebula's @ list and its messages need to know about group mentions. */
export type MentionGroups = { roles: MentionGroupRole[]; myRoleIds: string[]; canEveryone: boolean; onlineIds: string[] }

export function mentionGroupsOf(c: ConstellationDetail, meId: string): MentionGroups {
  return {
    roles: c.roles
      .filter((r) => r.kind !== 'member' && r.kind !== 'owner')
      .map((r) => ({ id: r.id, name: r.name, kind: r.kind, mentionable: r.mentionable, color: roleNight(r.color).text, count: r.memberCount }))
      // Bigger roles first, like the board's list.
      .sort((a, b) => b.count - a.count),
    myRoleIds: c.members.find((m) => m.user.id === meId)?.roleIds ?? [],
    canEveryone: c.me.owner || c.me.permissions.includes('mentionEveryone'),
    onlineIds: c.members.filter((m) => m.status !== 'offline').map((m) => m.user.id),
  }
}
