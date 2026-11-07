import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { PERMISSIONS, ROLE_COLOR_CHOICES, ROLE_COLORS, ROLE_NAME_MAX, type ConstellationDetail, type ConstellationPermission, type ConstellationRole, type RoleColor } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { confirm } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { haptic } from '@/constellations/motion'
import { can } from '@/constellations/roles'
import { runDetail, SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { Caps, Card, N, NightField, Toggle } from '@/constellations/ui'

// The role editor (canvas board 7): name, color, and what the role lets people do. You can only
// give permissions you have, and only change roles below yours.

export default function RoleScreen() {
  const { cid, rid } = useLocalSearchParams<{ cid: string; rid: string }>()
  const c = useSettingsDetail(cid)
  const role = c?.roles.find((r) => r.id === rid)
  if (!c || !role) return <SettingsScreen title="Role" c={c && !role ? c : null}>{c && !role ? <Text style={{ color: N.muted }}>That role is gone.</Text> : null}</SettingsScreen>
  return <RoleEditor key={role.id} c={c} role={role} />
}

function RoleEditor({ c, role }: { c: ConstellationDetail; role: ConstellationRole }) {
  const mine = role.kind !== 'owner' && (c.me.owner || role.position < c.me.rank) && can(c, 'manageRoles')
  const [name, setName] = useState(role.name)
  const [color, setColor] = useState<RoleColor>(role.color)
  const [perms, setPerms] = useState<ConstellationPermission[]>(role.permissions)
  // 4.2 (board 24): anyone can @mention it
  const [mentionable, setMentionable] = useState(!!role.mentionable)
  const [busy, setBusy] = useState(false)
  const dirty = name.trim() !== role.name || color !== role.color || perms.slice().sort().join() !== role.permissions.slice().sort().join() || mentionable !== !!role.mentionable
  const plural = role.kind === 'owner' ? 'the Owner' : role.name.endsWith('s') ? role.name : `${role.name}s`

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    const ok = await runDetail(() => cx.updateRole(c.id, role.id, { name: name.trim(), ...(role.kind === 'member' ? {} : { color, mentionable }), permissions: perms }))
    setBusy(false)
    if (ok) {
      haptic.success()
      router.back()
    }
  }

  async function remove() {
    const ok = await confirm({ title: `Delete ${role.name}?`, message: `${role.memberCount} ${role.memberCount === 1 ? 'person loses' : 'people lose'} this role.`, confirmLabel: 'Delete', danger: true })
    if (ok && (await runDetail(() => cx.removeRole(c.id, role.id)))) router.back()
  }

  return (
    <SettingsScreen
      title={role.name}
      c={c}
      right={
        mine ? (
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !dirty || busy }} disabled={!dirty || busy} onPress={() => void save()} style={{ height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: N.amber, justifyContent: 'center', opacity: !dirty || busy ? 0.45 : 1 }}>
            <Text size={14} weight="bold" style={{ color: N.amberInk }}>
              Save
            </Text>
          </Pressable>
        ) : null
      }
    >
      {role.kind === 'owner' ? null : <NightField label="Role name" value={name} onChangeText={setName} max={ROLE_NAME_MAX} editable={mine} />}
      {role.kind === 'owner' || role.kind === 'member' ? null : (
        <View style={{ gap: 8 }}>
          <Caps>Color</Caps>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 12 }}>
            {ROLE_COLOR_CHOICES.map((rc) => {
              const on = color === rc
              return (
                <Pressable key={rc} accessibilityRole="radio" accessibilityLabel={ROLE_COLORS[rc].name} accessibilityState={{ checked: on, disabled: !mine }} disabled={!mine} onPress={() => { haptic.select(); setColor(rc) }} hitSlop={6} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: ROLE_COLORS[rc].dark, alignItems: 'center', justifyContent: 'center', boxShadow: on ? `0 0 0 2px ${N.bg}, 0 0 0 4px ${ROLE_COLORS[rc].dark}` : undefined }}>
                  {on ? <Icon name="check" size={18} color={N.bg} strokeWidth={3} /> : null}
                </Pressable>
              )
            })}
          </View>
        </View>
      )}
      <Caps>{role.kind === 'owner' ? 'What the Owner can do' : `What ${plural} can do`}</Caps>
      {role.kind === 'owner' ? (
        <Text size={14} style={{ color: N.ink2 }}>
          Everything, including transferring ownership and deleting the constellation.
        </Text>
      ) : (
        <Card>
          {PERMISSIONS.map((p, i) => {
            const on = perms.includes(p.id)
            const grantable = c.me.owner || c.me.permissions.includes(p.id)
            return (
              <View key={p.id} style={{ minHeight: 56, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: i === PERMISSIONS.length - 1 ? 0 : 1, borderBottomColor: N.line }}>
                <View style={{ flex: 1 }}>
                  <Text size={15}>{p.name}</Text>
                  {p.what ? (
                    <Text size={12} style={{ color: N.muted }}>
                      {p.what}
                    </Text>
                  ) : null}
                </View>
                <Toggle value={on} label={p.name} disabled={!mine || !grantable} onChange={(v) => setPerms((l) => (v ? [...l, p.id] : l.filter((x) => x !== p.id)))} />
              </View>
            )
          })}
        </Card>
      )}
      {role.kind !== 'owner' && role.kind !== 'member' ? (
        <Card>
          <View style={{ minHeight: 56, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text size={15}>Anyone can mention this role</Text>
              <Text size={12} style={{ color: N.muted }}>
                Lets members ping @{role.name} (people with “Mention @everyone, @here and all roles” always can)
              </Text>
            </View>
            <Toggle value={mentionable} label="Anyone can mention this role" disabled={!mine} onChange={setMentionable} />
          </View>
        </Card>
      ) : null}
      {!mine && role.kind !== 'owner' ? (
        <Text size={12} style={{ color: N.faint }}>
          Only people ranked above {role.name} who can manage roles can change it.
        </Text>
      ) : null}
      {mine && role.kind === 'custom' ? (
        <Pressable accessibilityRole="button" onPress={() => void remove()} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="trash" size={18} color={N.redText} />
          <Text size={15} weight="bold" style={{ color: N.redText }}>
            Delete this role
          </Text>
        </Pressable>
      ) : null}
    </SettingsScreen>
  )
}
