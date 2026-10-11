import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { GROUP_MAX, GROUP_NAME_MAX, isMuted, mutedLabel, type FriendEntry, type GroupSummary, type PublicUser } from '@glofly/shared'
import * as api from '@/api/glofly'
import { useStore, patchConversation } from '@/state/store'
import { useSession } from '@/state/session'
import { refreshConversations } from '@/state/sync'
import { chooseMute, leaveGroup } from '@/lib/chatActions'
import { pickSquarePhoto } from '@/lib/photos'
import { Avatar, GroupAvatar } from '@/ui/Avatar'
import { BottomSheet, confirm, inform } from '@/ui/dialogs'
import { FriendPicker } from '@/ui/FriendPicker'
import { Icon } from '@/ui/icons'
import { Button, Field, IconButton, SectionLabel, Spinner, Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { useTheme } from '@/ui/theme'

// Group settings (from the design): photo, name, notifications, members (owner can remove),
// Add people, Leave group.

export default function GroupSettings() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { c } = useTheme()
  const me = useSession((s) => s.user)
  const chat = useStore((s) => s.conversations[id]) as GroupSummary | undefined
  const [name, setName] = useState(chat?.name ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => setName(chat?.name ?? ''), [chat?.name])
  if (!chat || chat.kind !== 'group' || !me) {
    return (
      <Screen title="Group settings">
        <View style={{ padding: 32, alignItems: 'center' }}>{chat === undefined ? <Text tone="muted">You're not in this group any more.</Text> : <Spinner />}</View>
      </Screen>
    )
  }
  const owner = chat.createdBy === me.id
  const everyone: PublicUser[] = [me, ...chat.members]

  async function rename() {
    setBusy('name')
    const r = await api.renameGroup(id, name.trim() || null)
    setBusy(null)
    if (!r.ok) return void inform("Couldn't rename it", r.message)
    patchConversation(id, { name: name.trim() || null })
  }

  async function photo(remove: boolean) {
    if (remove) {
      setBusy('photo')
      const r = await api.deleteGroupPhoto(id)
      setBusy(null)
      if (!r.ok) return void inform("Couldn't remove the photo", r.message)
      patchConversation(id, { photoVersion: null })
      return
    }
    const picked = await pickSquarePhoto('library')
    if (!picked || picked === 'denied') return
    setBusy('photo')
    const r = await api.setGroupPhoto(id, picked)
    setBusy(null)
    if (!r.ok) return void inform("Couldn't change the photo", r.message)
    patchConversation(id, { photoVersion: r.data.photoVersion })
  }

  async function remove(p: PublicUser) {
    const ok = await confirm({ title: `Remove ${p.displayName}?`, message: "They'll stop getting this group's messages.", confirmLabel: 'Remove', danger: true })
    if (!ok) return
    const r = await api.removeMember(id, p.id)
    if (!r.ok) return void inform("Couldn't remove them", r.message)
    void refreshConversations()
  }

  async function add(ids: string[]) {
    setAdding(false)
    if (!ids.length) return
    const r = await api.addMembers(id, ids)
    if (!r.ok) return void inform("Couldn't add them", r.message)
    void refreshConversations()
  }

  const muted = isMuted(chat)
  return (
    <Screen title="Group settings" contentStyle={{ paddingTop: 8 }}>
      <View style={{ alignItems: 'center', gap: 12, paddingHorizontal: 20 }}>
        <GroupAvatar chat={chat} size={104} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label={chat.photoVersion ? 'Change photo' : 'Add photo'} kind="secondary" compact icon="camera" busy={busy === 'photo'} onPress={() => void photo(false)} />
          {chat.photoVersion ? <Button label="Remove" kind="ghost" compact onPress={() => void photo(true)} /> : null}
        </View>
      </View>
      <View style={{ padding: 20, gap: 10 }}>
        <Field label="Group name" value={name} onChangeText={setName} maxLength={GROUP_NAME_MAX} placeholder="No name: shown as the members' names" />
        {(name.trim() || null) !== (chat.name ?? null) ? <Button label="Save name" compact busy={busy === 'name'} onPress={() => void rename()} /> : null}
      </View>
      <Pressable accessibilityRole="button" onPress={() => void chooseMute(chat)} android_ripple={{ color: c.line }} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 12 }}>
        <Icon name={muted ? 'bellOff' : 'bell'} size={22} color={c.ink2} />
        <View style={{ flex: 1 }}>
          <Text size={16}>Notifications</Text>
          <Text size={13} tone="muted">
            {muted && chat.mutedUntil ? `${mutedLabel(chat.mutedUntil)} · @mentions still come through` : 'On'}
          </Text>
        </View>
        <Icon name="chevronRight" size={18} color={c.faint} />
      </Pressable>
      <SectionLabel>{`${chat.memberCount} members`}</SectionLabel>
      {chat.memberCount < GROUP_MAX ? (
        <Pressable accessibilityRole="button" onPress={() => setAdding(true)} android_ripple={{ color: c.line }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="addPerson" size={20} color={c.accentText} />
          </View>
          <Text size={16} weight="bold" tone="accent">
            Add people
          </Text>
        </Pressable>
      ) : null}
      {everyone.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/profile/[id]', params: { id: p.id } })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8 }}
        >
          <Avatar user={p} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text size={16} weight="bold" numberOfLines={1}>
              {p.displayName}
              {p.id === me.id ? (
                <Text size={14} tone="muted">
                  {' '}
                  (you)
                </Text>
              ) : null}
            </Text>
            <Text size={13} tone="muted">
              @{p.username}
            </Text>
          </View>
          {chat.createdBy === p.id ? (
            <View style={{ paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: c.accentSoft, justifyContent: 'center' }}>
              <Text size={12} weight="bold" tone="accent">
                Owner
              </Text>
            </View>
          ) : null}
          {owner && p.id !== me.id ? <IconButton name="close" label={`Remove ${p.displayName} from the group`} box={40} size={18} onPress={() => void remove(p)} /> : null}
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => void leaveGroup(chat).then((ok) => ok && router.replace('/groups'))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 16, marginTop: 8 }}
      >
        <Icon name="door" size={22} color={c.danger} />
        <Text size={16} weight="medium" tone="danger">
          Leave group
        </Text>
      </Pressable>
      {adding ? <AddPeople exclude={chat.members.map((m) => m.id)} max={GROUP_MAX - chat.memberCount} onDone={(ids) => void add(ids)} /> : null}
    </Screen>
  )
}

function AddPeople({ exclude, max, onDone }: { exclude: string[]; max: number; onDone: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (f: FriendEntry) => setPicked((p) => (p.includes(f.id) ? p.filter((x) => x !== f.id) : p.length >= max ? p : [...p, f.id]))
  return (
    <BottomSheet onClose={() => onDone([])}>
      <View style={{ height: 520 }}>
        <Text display size={20} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          Add people
        </Text>
        <View style={{ flex: 1 }}>
          <FriendPicker selected={picked} onToggle={toggle} exclude={exclude} />
        </View>
        <View style={{ padding: 16 }}>
          <Button label={picked.length ? `Add ${picked.length}` : 'Pick friends to add'} disabled={!picked.length} onPress={() => onDone(picked)} />
        </View>
      </View>
    </BottomSheet>
  )
}
