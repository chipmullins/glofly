import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { STATUS_LABEL, activityLine, playing, type Profile } from '@glofly/shared'
import * as api from '@/api/glofly'
import { useStore } from '@/state/store'
import { useSession } from '@/state/session'
import { refreshFriends } from '@/state/sync'
import { openDmWith } from '@/lib/chatActions'
import { block, removeFriend } from '@/lib/friendActions'
import { longDate } from '@/lib/format'
import { startCallWith } from '@/calls/controller'
import { Avatar } from '@/ui/Avatar'
import { inform } from '@/ui/dialogs'
import { Icon, type IconName } from '@/ui/icons'
import { Button, IconButton, Spinner, Text } from '@/ui/kit'
import { openReport } from '@/ui/sheets'
import { useTheme } from '@/ui/theme'

// A person's profile card (from the design): photo, name, status, what they're playing,
// Message / Voice / Video, About me, when they joined, and Remove friend / Block / Report.

export default function ProfileCard() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const meId = useSession((s) => s.user?.id)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [gone, setGone] = useState(false)
  const live = useStore((s) => s.presence[id])
  const friends = useStore((s) => s.friends)
  const isFriend = friends.friends.some((f) => f.id === id)
  const incoming = friends.incoming.some((f) => f.id === id)
  const outgoing = friends.outgoing.some((f) => f.id === id)
  const blocked = friends.blocked.some((f) => f.id === id)

  useEffect(() => {
    void api.getProfile(id).then((r) => {
      if (r.ok) setProfile(r.data)
      else setGone(true)
    })
  }, [id, isFriend])

  const close = () => (router.canGoBack() ? router.back() : router.replace('/chats'))
  const presence = live ?? profile?.presence ?? null
  const game = presence ? playing(presence) : null
  const first = profile?.displayName.split(/\s+/)[0] ?? ''
  const isMe = id === meId

  async function request(fn: () => Promise<{ ok: boolean; message?: string }>, fail: string) {
    const r = await fn()
    if (!r.ok) void inform(fail, r.message)
    void refreshFriends()
  }

  const action = (icon: IconName, label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ flex: 1, height: 64, borderRadius: 16, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      <Icon name={icon} size={22} color={c.accentText} />
      <Text size={13} weight="bold">
        {label}
      </Text>
    </Pressable>
  )

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable accessibilityLabel="Close" onPress={close} style={{ position: 'absolute', inset: 0, backgroundColor: c.backdrop }} />
      <View style={{ maxHeight: '92%', backgroundColor: c.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }} accessibilityViewIsModal>
        {!profile ? (
          <View style={{ padding: 40, paddingTop: 96, alignItems: 'center', paddingBottom: insets.bottom + 40 }}>
            {gone ? <Text tone="muted">This profile isn't available.</Text> : <Spinner />}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 14 }}>
            <View style={{ height: 96, backgroundColor: c.accentSoft, marginHorizontal: -20, marginBottom: -14 }} />
            <View style={{ marginTop: -52, borderRadius: 60, borderWidth: 5, borderColor: c.sheet, alignSelf: 'flex-start' }}>
              <Avatar user={profile} size={96} status={isFriend || isMe ? (presence?.status ?? 'offline') : null} ring={c.sheet} />
            </View>
            <View style={{ gap: 2 }}>
              <Text display size={26} accessibilityRole="header">
                {profile.displayName}
              </Text>
              <Text size={15} tone="muted">
                @{profile.username}
              </Text>
            </View>
            {presence && (isFriend || isMe) ? (
              <View style={{ gap: 6 }}>
                <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: presence.status === 'online' ? c.onlineSoft : c.surface }}>
                  <Text size={14} weight="medium" style={{ color: presence.status === 'online' ? c.onlineText : c.ink2 }}>
                    {presence.status === 'offline' ? (presence.lastSeenAt ? `Last seen ${longDate(presence.lastSeenAt)}` : 'Offline') : STATUS_LABEL[presence.status]}
                    {presence.statusText && presence.status !== 'offline' ? ` · ${presence.statusText}` : ''}
                  </Text>
                </View>
                {game ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Icon name="gamepad" size={18} color={c.muted} />
                    <Text size={14} tone="ink2">
                      {activityLine(game)}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {!isMe && isFriend ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {action('chatsLine', 'Message', () => {
                  close()
                  void openDmWith(id)
                })}
                {action('phone', 'Voice', () => void startCallWith(id, false))}
                {action('video', 'Video', () => void startCallWith(id, true))}
              </View>
            ) : null}
            {!isMe && !isFriend && !blocked ? (
              incoming ? (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button label="Accept" onPress={() => void request(() => api.acceptFriendRequest(id), "Couldn't accept")} style={{ flex: 1 }} compact />
                  <Button label="Decline" kind="secondary" onPress={() => void request(() => api.removeFriendRequest(id), "Couldn't decline")} style={{ flex: 1 }} compact />
                </View>
              ) : outgoing ? (
                <Button label="Cancel request" kind="secondary" compact onPress={() => void request(() => api.removeFriendRequest(id), "Couldn't cancel")} />
              ) : (
                <Button label="Add friend" icon="addPerson" compact onPress={() => void request(() => api.sendFriendRequest(profile.username), "Couldn't send the request")} />
              )
            ) : null}
            {profile.bio ? (
              <View style={{ gap: 4, padding: 14, borderRadius: 16, backgroundColor: c.surface }}>
                <Text size={12} weight="bold" tone="muted" style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>
                  About me
                </Text>
                <Text size={15} style={{ lineHeight: 21 }}>
                  {profile.bio}
                </Text>
              </View>
            ) : null}
            {profile.joinedAt ? (
              <Text size={14} tone="muted">
                Joined Glofly {longDate(profile.joinedAt)}
              </Text>
            ) : null}
            {isMe ? (
              <Button label="Edit profile" kind="secondary" compact icon="pencil" onPress={() => router.replace('/edit-profile')} />
            ) : (
              <View style={{ gap: 4, marginTop: 4 }}>
                {isFriend ? <LinkRow icon="close" label="Remove friend" onPress={() => void removeFriend(profile)} /> : null}
                {blocked ? (
                  <LinkRow icon="block" label={`Unblock ${first}`} onPress={() => void request(() => api.unblockUser(id), "Couldn't unblock")} />
                ) : (
                  <LinkRow icon="block" label="Block" danger onPress={() => void block(profile).then((ok) => ok && close())} />
                )}
                <LinkRow icon="flag" label={`Report @${profile.username}`} danger onPress={() => void openReport({ userId: id, name: profile.displayName })} />
              </View>
            )}
          </ScrollView>
        )}
        <IconButton name="close" label="Close" onPress={close} color={c.ink} style={{ position: 'absolute', top: 8, right: 8 }} />
      </View>
    </View>
  )
}

function LinkRow({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const { c } = useTheme()
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <Icon name={icon} size={20} color={danger ? c.danger : c.ink2} />
      <Text size={16} tone={danger ? 'danger' : 'ink'} weight="medium">
        {label}
      </Text>
    </Pressable>
  )
}
