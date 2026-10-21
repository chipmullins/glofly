import { Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { api } from '@control/api'
import { shortDate, when } from '@control/format'
import { Card, CardTitle, Chip, IconButton, Muted, Screen, Status, Text, VioletHeader } from '@/ui/kit'
import { Icon, type IconName } from '@/ui/icons'
import { c } from '@/ui/theme'
import { openSheet } from '@/ui/ConfirmSheet'
import { useLoad } from '@/lib/hooks'
import { flagsFor, tileColor } from '@/lib/labels'

// One constellation (Constellation.dc.html): counts only. Messages show up in Control only when
// someone reports them.

export default function Constellation() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, error, loading, refreshing, refresh, reload } = useLoad(() => api.constellation(id), [id])
  const k = data?.constellation

  if (!k)
    return (
      <Screen back title="Constellation">
        <Status loading={loading} error={error} onRetry={refresh} />
      </Screen>
    )

  const frozen = !!k.frozenAt
  const invitesOff = !!k.invitesOffAt
  const down = !!k.takenDownAt
  const flags = flagsFor(k)

  const actions: { label: string; danger?: boolean; onPress: () => void }[] = [
    {
      label: frozen ? 'Unfreeze' : 'Freeze',
      onPress: () =>
        openSheet({
          title: frozen ? `Unfreeze ${k.name}?` : `Freeze ${k.name}?`,
          explanation: frozen ? 'Members can post and people can join again.' : 'Members can still read, but nobody can post or join until you unfreeze it.',
          action: frozen ? 'Unfreeze' : 'Freeze',
          danger: !frozen,
          faceId: true,
          run: (note) => api.freezeConstellation(k.id, !frozen, note),
          done: frozen ? 'Unfrozen.' : 'Frozen.',
          onDone: reload,
        }),
    },
    {
      label: invitesOff ? 'Turn on invite links' : 'Turn off invite links',
      onPress: () =>
        openSheet({
          title: invitesOff ? 'Turn invite links back on?' : 'Turn off invite links?',
          explanation: invitesOff ? 'Members with permission can make invite links again.' : 'Every invite link stops working and no new ones can be made.',
          action: invitesOff ? 'Turn on' : 'Turn off',
          faceId: true,
          run: (note) => api.constellationInvites(k.id, !invitesOff, note),
          done: invitesOff ? 'Invite links are on.' : 'Invite links are off.',
          onDone: reload,
        }),
    },
    {
      label: 'Transfer owner',
      onPress: () =>
        openSheet({
          title: 'Transfer ownership',
          explanation: `The new owner must already be a member of ${k.name}.${k.owner ? ` @${k.owner.username} stays a member.` : ''}`,
          action: 'Transfer',
          faceId: true,
          fields: [{ kind: 'text', key: 'username', label: 'New owner’s username', autoCapitalize: 'none' }],
          validate: (v) => (String(v.username ?? '').trim().replace(/^@/, '').length < 2 ? 'Type the new owner’s username.' : null),
          run: (note, v) => api.transferConstellation(k.id, String(v.username).trim().replace(/^@/, ''), note),
          done: 'Owner changed.',
          onDone: reload,
        }),
    },
    down
      ? {
          label: 'Restore',
          onPress: () =>
            openSheet({
              title: `Restore ${k.name}?`,
              explanation: 'Members can see and use it again.',
              action: 'Restore',
              faceId: true,
              run: (note) => api.restoreConstellation(k.id, note),
              done: 'Restored.',
              onDone: reload,
            }),
        }
      : {
          label: 'Take down',
          danger: true,
          onPress: () =>
            openSheet({
              title: `Take down ${k.name}?`,
              explanation: 'It disappears for everyone; members see your reason. You can restore it later.',
              action: 'Take down',
              danger: true,
              faceId: true,
              fields: [{ kind: 'text', key: 'reason', label: 'Reason members see', multiline: true, maxLength: 200 }],
              validate: (v) => (String(v.reason ?? '').trim().length < 3 ? 'Write why it’s being taken down.' : null),
              run: (note, v) => api.takeDown(k.id, String(v.reason).trim(), note),
              done: 'Taken down.',
              onDone: reload,
            }),
        },
    {
      label: 'Delete',
      danger: true,
      onPress: () =>
        openSheet({
          title: `Delete ${k.name}?`,
          explanation: 'Every nebula, message and member list in it is deleted for good. This can’t be undone. Type the name to confirm.',
          action: 'Delete',
          danger: true,
          faceId: true,
          fields: [{ kind: 'text', key: 'confirm', label: `Type ${k.name}` }],
          validate: (v) => (String(v.confirm).trim() !== k.name.trim() ? 'Type the name exactly to confirm.' : null),
          run: (note, v) => api.deleteConstellation(k.id, String(v.confirm).trim(), note),
          done: 'Deleted.',
          onDone: () => router.back(),
        }),
    },
  ]

  const header = (
    <VioletHeader style={{ gap: 12 }}>
      <IconButton name="back" label="Back" color={c.onViolet} onPress={() => router.back()} style={{ marginLeft: -6 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 52, height: 52, borderRadius: 15, backgroundColor: tileColor(k.id), borderWidth: 2, borderColor: c.gold, alignItems: 'center', justifyContent: 'center' }}>
          <Text display weight="bold" size={22} color={c.white} maxFontSizeMultiplier={1.2}>
            {[...k.name.trim()][0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text display weight="bold" size={22} color={c.white} accessibilityRole="header">
            {k.name}
          </Text>
          <Text size={13} color={c.onVioletSoft}>
            {`${k.owner ? `Owner @${k.owner.username}` : 'No owner'} · made ${shortDate(k.createdAt)}`}
          </Text>
        </View>
      </View>
      {flags.length ? (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {flags.map(([l, t]) => (
            <Chip key={l} small label={l} tone={t} />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[
          [k.memberCount.toLocaleString('en-US'), `Members${k.joinsToday ? ` (+${k.joinsToday})` : ''}`],
          [(k.messagesToday ?? 0).toLocaleString('en-US'), 'Messages today'],
          [String(k.openReports ?? 0), 'Open reports'],
        ].map(([n, label]) => (
          <View key={label} accessible accessibilityLabel={`${label}: ${n}`} style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)' }}>
            <Text display weight="bold" size={18} color={c.white}>
              {n}
            </Text>
            <Text size={11.5} color={c.onVioletSoft}>
              {label}
            </Text>
          </View>
        ))}
      </View>
    </VioletHeader>
  )

  return (
    <Screen header={header} onRefresh={refresh} refreshing={refreshing} contentStyle={{ gap: 12 }}>
      {down && k.takedownReason ? (
        <Card style={{ paddingVertical: 12, backgroundColor: c.dangerSoft, borderColor: c.dangerBorder }}>
          <Text size={13.5} color={c.dangerText}>{`Taken down: “${k.takedownReason}”`}</Text>
        </Card>
      ) : null}
      <Card style={{ paddingBottom: 4, marginTop: 2 }}>
        <CardTitle>Nebulas</CardTitle>
        {k.nebulas.length ? (
          k.nebulas.map((n) => {
            const icon: IconName = n.kind === 'voice' ? 'voice' : n.visibility === 'roles' ? 'lockSmall' : 'text'
            const sub = n.kind === 'voice' ? 'Voice room' : `Text · ${n.visibility === 'roles' ? 'role-only' : 'everyone'}${n.readOnly ? ' · read-only' : ''}`
            const live = n.kind === 'voice' && (n.inVoice ?? 0) > 0
            return (
              <View key={n.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderTopWidth: 1, borderTopColor: c.divider, paddingVertical: 6 }}>
                <Icon name={icon} size={18} color={c.muted} />
                <View style={{ flex: 1 }}>
                  <Text size={14} weight="semi">
                    {n.kind === 'text' ? `#${n.name}` : n.name}
                  </Text>
                  <Muted size={12}>{sub}</Muted>
                </View>
                {live ? (
                  <Chip small label={`${n.inVoice} live`} tone="good" />
                ) : n.kind === 'text' ? (
                  <Muted>{`${(n.messagesToday ?? 0).toLocaleString('en-US')} today`}</Muted>
                ) : null}
              </View>
            )
          })
        ) : (
          <Muted style={{ paddingVertical: 10 }}>No nebulas.</Muted>
        )}
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            onPress={a.onPress}
            style={({ pressed }) => ({
              flexBasis: '47%',
              flexGrow: 1,
              minHeight: 46,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: a.danger ? c.dangerBorder : c.fieldBorder,
              backgroundColor: a.danger ? c.dangerSoft : c.card,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 8,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text size={13.5} weight="semi" color={a.danger ? c.dangerText : c.ink} style={{ textAlign: 'center' }}>
              {a.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Muted size={12} style={{ textAlign: 'center', lineHeight: 17 }}>
        Counts only. Messages show up in Control only when someone reports them.
      </Muted>

      {k.moderation.length ? (
        <Card style={{ paddingBottom: 6 }}>
          <CardTitle>Moderation log</CardTitle>
          {k.moderation.slice(0, 15).map((m, i) => (
            <View key={`${m.createdAt}${i}`} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.divider }}>
              <Text size={13.5} weight="semi">
                {m.action.replace(/_/g, ' ')}
              </Text>
              <Muted>{[when(m.createdAt), m.actor ? `by ${m.actor}` : null, m.target].filter(Boolean).join(' · ')}</Muted>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  )
}
