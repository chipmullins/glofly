import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { create } from 'zustand'
import { type ConstellationDetail, type ConstellationMember, type PublicUser } from '@glofly/shared'
import * as api from '@/api/glofly'
import { cx } from '@/api/constellations'
import { useSession } from '@/state/session'
import { useStore } from '@/state/store'
import { cxSay, putDetail, useCx } from '@/state/constellations'
import { startCallWith } from '@/calls/controller'
import { Icon, type IconName } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { openMini } from './dock'
import { haptic } from './motion'
import { endTimeout, kickOrBan, pickTimeout, voiceDisconnect, voiceMute } from './moderation'
import { activityOf, can, memberGroups, outranks, roleColor, STATUS_WORD } from './roles'
import { NightModal } from './sheet'
import { MemberExtras } from './community'
import { Card, Face, Glyph, N, Row, SpeakerGlyph } from './ui'

// Members, grouped by role (canvas board 4), and the member actions sheet (you outrank them).

const STATUS_COLOR = { online: N.online, away: N.away, dnd: N.red, offline: 'transparent' } as const

function MemberFace({ m, size, ring }: { m: ConstellationMember; size: number; ring: string }) {
  const dot = Math.round(size * 0.32)
  const meId = useSession((s) => s.user?.id)
  return (
    <View style={{ width: size, height: size }}>
      <Face user={m.user} size={size} me={m.user.id === meId} />
      {m.status !== 'offline' ? (
        <View style={{ position: 'absolute', right: -1, bottom: -1, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: STATUS_COLOR[m.status], borderWidth: size >= 56 ? 3 : 2, borderColor: ring }} />
      ) : null}
    </View>
  )
}

/** The list (phone page and the iPad column). `compact`: the iPad's narrower rows. */
export function MemberList({ c, query, compact, onPick, trailing }: { c: ConstellationDetail; query: string; compact?: boolean; onPick: (m: ConstellationMember) => void; /** 0.7.2: something at the end of a row (Settings › Members: the Roles button) */ trailing?: (m: ConstellationMember) => ReactNode }) {
  const meId = useSession((s) => s.user?.id ?? '')
  const groups = memberGroups(c, query)
  if (!groups.length) {
    return (
      <Text size={14} style={{ color: N.muted, textAlign: 'center', padding: 24 }}>
        {query ? 'Nobody by that name.' : 'No members.'}
      </Text>
    )
  }
  return (
    <View>
      {groups.map((g) => {
        const total = g.key === 'owner' ? 1 : g.key === 'member' ? g.members.length : (c.roles.find((r) => r.id === g.key)?.memberCount ?? g.members.length)
        return (
          <View key={g.key}>
            <Text size={compact ? 11 : 12} weight="bold" style={{ color: g.color, letterSpacing: 0.96, textTransform: 'uppercase', paddingHorizontal: 8, paddingTop: 12, paddingBottom: 6 }} accessibilityRole="header">
              {g.title} — {query ? g.members.length : total}
            </Text>
            {g.members.map((m) => {
              const act = activityOf(c, m)
              const timedOut = !!m.timedOutUntil && new Date(m.timedOutUntil).getTime() > Date.now()
              const me = m.user.id === meId
              const sub = timedOut ? 'Timed out' : act ? act.text : m.status !== 'offline' ? STATUS_WORD[m.status] : null
              return (
                <Pressable
                  key={m.user.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.user.displayName}${me ? ', you' : ''}, ${g.title}${sub ? `, ${sub}` : ''}`}
                  accessibilityHint="Opens their actions"
                  onPress={() => onPick(m)}
                  onLongPress={() => {
                    haptic.medium()
                    onPick(m)
                  }}
                  style={({ pressed }) => ({ height: compact ? 44 : 52, paddingHorizontal: 8, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: compact ? 10 : 12, backgroundColor: pressed ? N.card2 : 'transparent', opacity: m.status === 'offline' && !me ? 0.6 : 1 })}
                >
                  <MemberFace m={m} size={compact ? 30 : 38} ring={compact ? N.side : N.bg} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text size={compact ? 14 : 15} weight="bold" numberOfLines={1} style={{ color: g.color }}>
                      {m.user.displayName}
                      {me ? (
                        <Text size={12} weight="medium" style={{ color: N.faint }}>
                          {'  you'}
                        </Text>
                      ) : null}
                    </Text>
                    {sub && !compact ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        {act?.voice ? <SpeakerGlyph size={12} color={N.greenText} /> : timedOut ? <Glyph name="timer" size={12} color={N.amber} /> : null}
                        <Text size={12} numberOfLines={1} style={{ color: act?.voice ? N.greenText : timedOut ? N.amber : N.muted, flex: 1 }}>
                          {sub}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {trailing ? trailing(m) : null}
                </Pressable>
              )
            })}
          </View>
        )
      })}
    </View>
  )
}

// ───────────── The member actions sheet ─────────────

const useMemberSheet = create<{ open: { constellationId: string; userId: string } | null }>(() => ({ open: null }))
export const openMemberSheet = (constellationId: string, userId: string) => useMemberSheet.setState({ open: { constellationId, userId } })
const closeSheet = () => useMemberSheet.setState({ open: null })

/** Message someone without leaving the night: their chat opens in the DM dock. */
export async function messageMember(user: PublicUser) {
  const existing = Object.values(useStore.getState().conversations).find((c) => c.kind === 'dm' && c.partner.id === user.id)
  if (existing) return openMini(existing.id)
  const r = await api.openDm(user.id)
  if (!r.ok) return cxSay(r.message)
  useStore.setState({ conversations: { ...useStore.getState().conversations, [r.data.id]: r.data } })
  openMini(r.data.id)
}

function joinedText(iso: string) {
  return `joined ${new Date(iso).toLocaleDateString([], { month: 'short', year: 'numeric' })}`
}

export function MemberSheetHost() {
  const open = useMemberSheet((s) => s.open)
  const c = useCx((s) => (open ? s.details[open.constellationId] : undefined))
  const meId = useSession((s) => s.user?.id ?? '')
  const isFriend = useStore((s) => !!open && s.friends.friends.some((f) => f.id === open.userId))
  const [roles, setRoles] = useState(false)
  const m = c?.members.find((x) => x.user.id === open?.userId)
  if (!open || !c || !m) return null
  const close = () => {
    setRoles(false)
    closeSheet()
  }
  const me = m.user.id === meId
  const above = outranks(c, meId, m.user.id)
  const voice = c.voice.find((v) => v.userIds.includes(m.user.id))
  const timedOut = !!m.timedOutUntil && new Date(m.timedOutUntil).getTime() > Date.now()
  const held = c.roles.filter((r) => m.roleIds.includes(r.id) || (r.kind === 'owner' && c.ownerId === m.user.id)).sort((a, b) => b.position - a.position)
  const memberRole = c.roles.find((r) => r.kind === 'member')
  const chips = [...held, ...(memberRole && c.ownerId !== m.user.id ? [memberRole] : [])]
  const canRoles = above && can(c, 'manageRoles')
  const canTimeout = above && can(c, 'timeoutKick')
  const canVoice = above && can(c, 'muteVoice') && !!voice
  const canBan = above && can(c, 'ban')

  if (roles) return <RolesSheet c={c} m={m} onClose={() => setRoles(false)} />

  return (
    <NightModal onClose={close} fit top={150} accessibilityLabel={`${m.user.displayName}'s actions`}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <MemberFace m={m} size={60} ring={N.card} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text display size={21} numberOfLines={1}>
              {m.user.displayName}
            </Text>
            <Text size={13} style={{ color: N.muted }} numberOfLines={1}>
              @{m.user.username} · {joinedText(m.joinedAt)}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {chips.map((r) => (
            <View key={r.id} style={{ height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: N.card2, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: roleColor(r) }} />
              <Text size={12} weight="bold">
                {r.name}
              </Text>
            </View>
          ))}
          {timedOut ? (
            <View style={{ height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(255,179,71,0.14)', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Glyph name="timer" size={12} color={N.amber} />
              <Text size={12} weight="bold" style={{ color: N.amber }}>
                Timed out
              </Text>
            </View>
          ) : null}
        </View>
        {/* 0.7.5: what they're playing and the friends you both have (the Members board) */}
        <MemberExtras c={c} userId={m.user.id} playing={m.playing} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!me ? (
            <>
              <BigButton icon="chatsLine" label="Message" onPress={() => { close(); void messageMember(m.user) }} />
              <BigButton icon="phone" label="Call" disabled={!isFriend} onPress={() => { close(); void startCallWith(m.user.id, false) }} />
            </>
          ) : null}
          <BigButton icon="user" label="Profile" onPress={() => { close(); router.push({ pathname: '/profile/[id]', params: { id: m.user.id } }) }} />
        </View>
        {canRoles || canTimeout || canVoice ? (
          <Card style={{ backgroundColor: N.bg }}>
            {canRoles ? <Row icon={<Glyph name="shield" size={18} />} label="Roles" detail={String(m.roleIds.length)} chevron onPress={() => setRoles(true)} /> : null}
            {canTimeout ? (
              timedOut ? (
                <Row icon={<Glyph name="timer" size={18} color={N.amber} />} label="End time-out" onPress={() => { close(); void endTimeout(c, m.user) }} />
              ) : (
                <Row icon={<Glyph name="timer" size={18} color={N.amber} />} label="Time out" detail="5 m · 1 h · 1 d · 1 w" onPress={() => { close(); void pickTimeout(c, m.user) }} />
              )
            ) : null}
            {canVoice && voice ? (
              <>
                <Row icon={<Glyph name="micSlash" size={18} />} label={voice.muted.includes(m.user.id) ? 'Unmute in voice' : 'Mute in voice'} onPress={() => { close(); void voiceMute(c, voice.nebulaId, m.user, !voice.muted.includes(m.user.id)) }} />
                <Row icon={<Icon name="hangup" size={18} color={N.ink} />} label="Disconnect from voice" last onPress={() => { close(); void voiceDisconnect(c, voice.nebulaId, m.user) }} />
              </>
            ) : null}
          </Card>
        ) : null}
        {canTimeout || canBan ? (
          <Card style={{ backgroundColor: N.bg }}>
            {canTimeout ? <Row icon={<Glyph name="kick" size={18} color={N.redText} />} label={`Kick from ${c.name}`} danger last={!canBan} onPress={() => { close(); void kickOrBan(c, m.user, false) }} /> : null}
            {canBan ? <Row icon={<Glyph name="ban" size={18} color={N.redText} />} label="Ban" danger last onPress={() => { close(); void kickOrBan(c, m.user, true) }} /> : null}
          </Card>
        ) : null}
        {canRoles || canTimeout || canVoice || canBan ? (
          <Text size={12} style={{ color: N.faint, textAlign: 'center' }}>
            Every action is saved to the moderation log
          </Text>
        ) : null}
      </View>
    </NightModal>
  )
}

function BigButton({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, height: 58, borderRadius: 14, backgroundColor: pressed ? N.raised : N.card2, alignItems: 'center', justifyContent: 'center', gap: 4, opacity: disabled ? 0.4 : 1 })}
    >
      <Icon name={icon} size={20} color={N.ink} />
      <Text size={12} weight="bold">
        {label}
      </Text>
    </Pressable>
  )
}

/** Which roles they hold (only roles below yours can be given or taken). */
export function RolesSheet({ c, m, onClose }: { c: ConstellationDetail; m: ConstellationMember; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>(m.roleIds)
  const [busy, setBusy] = useState(false)
  const roles = c.roles.filter((r) => r.kind !== 'owner' && r.kind !== 'member').sort((a, b) => b.position - a.position)
  async function save() {
    setBusy(true)
    const r = await cx.setMemberRoles(c.id, m.user.id, picked)
    setBusy(false)
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    putDetail(r.data.constellation)
    onClose()
  }
  return (
    <NightModal
      onClose={onClose}
      fit
      top={150}
      accessibilityLabel={`${m.user.displayName}'s roles`}
      footer={
        <Pressable accessibilityRole="button" onPress={() => void save()} disabled={busy} style={{ height: 50, borderRadius: 25, backgroundColor: N.amber, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>
          <Text size={16} weight="bold" style={{ color: N.amberInk }}>
            Save roles
          </Text>
        </Pressable>
      }
    >
      <View style={{ gap: 12, paddingBottom: 8 }}>
        <Text display size={20}>
          {m.user.displayName}'s roles
        </Text>
        <Card style={{ backgroundColor: N.bg }}>
          {roles.map((r, i) => {
            const allowed = c.me.owner || r.position < c.me.rank
            const on = picked.includes(r.id)
            return (
              <Pressable
                key={r.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: !allowed }}
                accessibilityLabel={`${r.name}${allowed ? '' : ', above you'}`}
                disabled={!allowed}
                onPress={() => {
                  haptic.select()
                  setPicked((p) => (on ? p.filter((x) => x !== r.id) : [...p, r.id]))
                }}
                style={{ minHeight: 50, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: i === roles.length - 1 ? 0 : 1, borderBottomColor: N.line, opacity: allowed ? 1 : 0.45 }}
              >
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: roleColor(r) }} />
                <Text size={15} weight="medium" style={{ flex: 1, color: roleColor(r) }}>
                  {r.name}
                </Text>
                <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: on ? 0 : 2, borderColor: N.edge2, backgroundColor: on ? N.amber : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on ? <Icon name="check" size={14} color={N.amberInk} strokeWidth={3} /> : null}
                </View>
              </Pressable>
            )
          })}
          {!roles.length ? (
            <Text size={14} style={{ color: N.muted, padding: 14 }}>
              No roles yet. Add them in Settings › Roles.
            </Text>
          ) : null}
        </Card>
      </View>
    </NightModal>
  )
}

