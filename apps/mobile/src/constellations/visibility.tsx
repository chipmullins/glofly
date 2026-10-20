import { Pressable, View } from 'react-native'
import { ROLE_COLORS, type ConstellationDetail, type NebulaVisibility } from '@glofly/shared'
import { chooseFrom } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { haptic } from './motion'
import { N } from './ui'

// 0.8.0 role-only nebulas (approved RoleNebulas board), the phone version: "Who can see this
// nebula" (or category) in the edit sheet. Everyone, or only these roles; the Owner and admins
// always see it. The server enforces everything.

export function WhoCanSee({
  c,
  what,
  visibility,
  roleIds,
  onChange,
}: {
  c: ConstellationDetail
  what: 'nebula' | 'category'
  visibility: NebulaVisibility
  roleIds: string[]
  onChange: (visibility: NebulaVisibility, roleIds: string[]) => void
}) {
  const roles = c.roles.filter((r) => r.kind !== 'owner' && r.kind !== 'member')
  const chosen = roleIds.map((id) => roles.find((r) => r.id === id)).filter((r): r is (typeof roles)[number] => !!r)
  const left = roles.filter((r) => !roleIds.includes(r.id))

  async function add() {
    const pick = await chooseFrom(
      left.map((r) => ({ key: r.id, label: r.name, detail: r.selfAssign ? 'Members pick it' : undefined })),
      'Add a role',
    )
    if (pick) onChange(visibility, [...roleIds, pick])
  }

  const option = (id: NebulaVisibility, title: string, what2: string) => {
    const on = visibility === id
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        accessibilityLabel={`${title}. ${what2}`}
        onPress={() => {
          haptic.select()
          onChange(id, roleIds)
        }}
        style={{ flex: 1, minHeight: 64, padding: 12, borderRadius: 14, borderWidth: 2, borderColor: on ? N.amber : N.edge, backgroundColor: N.card2, gap: 3 }}
      >
        <Text size={15} weight="bold">
          {title}
        </Text>
        <Text size={12} style={{ color: N.muted }}>
          {what2}
        </Text>
      </Pressable>
    )
  }

  return (
    <View style={{ gap: 10 }}>
      <Text size={15} weight="bold">
        Who can see this {what}
      </Text>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
        {option('everyone', 'Everyone', `All members of ${c.name}`)}
        {option('roles', 'Only these roles', what === 'category' ? 'Hides every nebula inside' : "Everyone else won't know it's here")}
      </View>
      {visibility === 'roles' ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {chosen.map((r) => (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${r.name}`}
                onPress={() => onChange(visibility, roleIds.filter((id) => id !== r.id))}
                style={{ minHeight: 36, paddingLeft: 12, paddingRight: 8, borderRadius: 18, borderWidth: 1, borderColor: N.amber, backgroundColor: '#3a2617', flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: (ROLE_COLORS[r.color] ?? ROLE_COLORS.gray).dot }} />
                <Text size={14} weight="bold" style={{ color: '#ffd8a8' }}>
                  {r.name}
                </Text>
                {r.selfAssign ? (
                  <Text size={11} style={{ color: '#c9a47e' }}>
                    (members pick it)
                  </Text>
                ) : null}
                <Icon name="close" size={12} color="#ffd8a8" strokeWidth={2.4} />
              </Pressable>
            ))}
            {left.length ? (
              <Pressable accessibilityRole="button" onPress={() => void add()} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: N.edge2, justifyContent: 'center' }}>
                <Text size={14} style={{ color: N.muted }}>
                  + Add role
                </Text>
              </Pressable>
            ) : null}
          </View>
          {!chosen.length ? (
            <Text size={12} style={{ color: N.amber }}>
              Add a role, or only the Owner and admins will see it.
            </Text>
          ) : null}
          <Text size={12} style={{ color: N.muted }}>
            Owner and admins can always see it.
          </Text>
        </View>
      ) : null}
    </View>
  )
}
