import { Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { CUSTOM_ROLES_MAX, type ConstellationRole } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { cxSay, putDetail } from '@/state/constellations'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { haptic } from '@/constellations/motion'
import { can, roleColor } from '@/constellations/roles'
import { ReorderList, runDetail, SettingsScreen, useSettingsDetail, type ReorderItem } from '@/constellations/settingsKit'
import { Glyph, N } from '@/constellations/ui'

// Roles, highest first (canvas board 7): hold a role and drag it to reorder (only roles below
// yours move); tap one to edit it.

const ROW = 56

export default function RolesScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  if (!c) return <SettingsScreen title="Roles" c={null}>{null}</SettingsScreen>
  const roles = [...c.roles].sort((a, b) => b.position - a.position)
  const editable = can(c, 'manageRoles')
  const movable = (r: ConstellationRole) => editable && r.kind !== 'owner' && r.kind !== 'member' && (c.me.owner || r.position < c.me.rank)
  const custom = c.roles.filter((r) => r.kind === 'custom').length

  async function newRole() {
    if (custom >= CUSTOM_ROLES_MAX) return cxSay(`Up to ${CUSTOM_ROLES_MAX} roles of your own.`)
    const r = await cx.addRole(c!.id, { name: 'New role', color: 'green', permissions: c!.me.owner || c!.me.permissions.includes('invite') ? ['invite'] : [] })
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    putDetail(r.data.constellation)
    const made = r.data.constellation.roles.filter((x) => x.kind === 'custom' && !c!.roles.some((o) => o.id === x.id))[0]
    if (made) router.push({ pathname: '/constellations/[cid]/settings/role/[rid]', params: { cid: c!.id, rid: made.id } })
  }

  async function reorder(ids: string[]) {
    const order = ids.filter((id) => {
      const r = roles.find((x) => x.id === id)
      return r && movable(r)
    })
    // Shows right away (positions count down from the top); the server's copy replaces it.
    const top = Math.max(...roles.filter(movable).map((r) => r.position))
    putDetail({ ...c!, roles: c!.roles.map((r) => (order.includes(r.id) ? { ...r, position: top - order.indexOf(r.id) } : r)) })
    await runDetail(() => cx.orderRoles(c!.id, order))
  }

  const items: ReorderItem[] = roles.map((r) => ({
    id: r.id,
    movable: movable(r),
    render: () => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${r.name}, ${r.memberCount} ${r.memberCount === 1 ? 'person' : 'people'}${movable(r) ? '. Hold to move' : ''}`}
        onPress={() => router.push({ pathname: '/constellations/[cid]/settings/role/[rid]', params: { cid: c.id, rid: r.id } })}
        style={{ height: ROW - 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2, flexDirection: 'row', alignItems: 'center', gap: 12 }}
      >
        {r.kind === 'owner' ? <Glyph name="crown" size={16} color={roleColor(r)} /> : movable(r) ? <Glyph name="grip" size={16} color={N.dim} /> : <Glyph name="lock" size={14} color={N.dim} />}
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: roleColor(r) }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text size={15} weight="bold" numberOfLines={1} style={{ color: roleColor(r) }}>
            {r.name}
          </Text>
          {r.kind === 'member' ? (
            <Text size={11} style={{ color: N.faint }}>
              Everyone gets this
            </Text>
          ) : null}
        </View>
        <Text size={13} style={{ color: N.muted }}>
          {r.kind === 'member' ? (c.memberCount ?? c.members.length) : r.memberCount}
        </Text>
        {r.kind !== 'owner' ? <Icon name="chevronRight" size={16} color={N.faint} /> : null}
      </Pressable>
    ),
  }))

  return (
    <SettingsScreen
      title="Roles"
      c={c}
      right={
        editable ? (
          <Pressable accessibilityRole="button" onPress={() => void newRole()} style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: N.amber, justifyContent: 'center' }}>
            <Text size={14} weight="bold" style={{ color: N.amber }}>
              New role
            </Text>
          </Pressable>
        ) : null
      }
    >
      <Text size={13} style={{ color: N.muted, lineHeight: 19 }}>
        Higher roles outrank lower ones. People can only act on members ranked below them.
      </Text>
      <ReorderList key={roles.map((r) => r.id).join()} items={items} rowHeight={ROW} onReorder={(ids) => void reorder(ids)} />
    </SettingsScreen>
  )
}
