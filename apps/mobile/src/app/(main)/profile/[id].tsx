import { useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NICKNAME_MAX, STATUS_LABEL, activityLine, mobileLabel, onMobile, playing, siteName, type Profile } from '@glofly/shared'
import { useFriendsLive } from '@/state/friendsLive'
import { LivePill } from '@/ui/LivePill'
import * as api from '@/api/glofly'
import { useStore } from '@/state/store'
import { useSession } from '@/state/session'
import { refreshFriends } from '@/state/sync'
import { openDmWith } from '@/lib/chatActions'
import { GamesCard } from '@/constellations/games'
import { flyIn } from '@/constellations/transition'
import { cxAvailable } from '@/state/constellations'
import { block, removeFriend } from '@/lib/friendActions'
import { longDate } from '@/lib/format'
import { startCallWith } from '@/calls/controller'
import { Avatar } from '@/ui/Avatar'
import { DialogHost, SHEET_MAX_WIDTH, inform } from '@/ui/dialogs'
import { Icon, type IconName } from '@/ui/icons'
import { Button, Field, IconButton, Spinner, Switch, Text } from '@/ui/kit'
import { SheetHost, openReport } from '@/ui/sheets'
import { useTheme } from '@/ui/theme'
import { ActivityFeed, BoardTiles, MutualsList, ProfileHeaderImage } from '@/profiles/Board'

// A person's profile card (from the design): photo, name, status, what they're playing,
// Message / Voice / Video, About me, when they joined, and Remove friend / Block / Report.

export default function ProfileCard() {
  const { id, invite } = useLocalSearchParams<{ id: string; invite?: string }>()
  // 0.7.1: a constellation invite's notification (glofly://profile/<inviter>?invite=<id>, so every
  // phone build can open it) goes to your Constellations dashboard, where the invite waits.
  useEffect(() => {
    if (!invite || !/^[0-9a-f-]{36}$/i.test(invite) || !cxAvailable()) return
    if (router.canGoBack()) router.back()
    else router.replace('/chats')
    setTimeout(() => flyIn(null), 80)
  }, [invite])
  const { c } = useTheme()
  // A restricted (family-managed) account: their family removes friends.
  const meRestricted = useSession((s) => s.user?.restricted === true)
  const insets = useSafeAreaInsets()
  const meId = useSession((s) => s.user?.id)
  const [profile, setProfile] = useState<Profile | null>(null)
  const stream = useFriendsLive((st) => st.live[id as string]) ?? null
  const [gone, setGone] = useState(false)
  const live = useStore((s) => s.presence[id])
  const friends = useStore((s) => s.friends)
  const isFriend = friends.friends.some((f) => f.id === id)
  // Oct 30, 2026: with "Friends coming online" set to All friends, every friend is covered: no bell.
  const [alertsMode, setAlertsMode] = useState<string | undefined>(undefined)
  useEffect(() => {
    void api.getPrivacy().then((r) => r.ok && setAlertsMode(r.data.onlineAlertsMode))
  }, [])
  const onlineAlert = alertsMode === 'all' ? undefined : friends.friends.find((f) => f.id === id)?.onlineAlert
  const incoming = friends.incoming.some((f) => f.id === id)
  const outgoing = friends.outgoing.some((f) => f.id === id)
  const blocked = friends.blocked.some((f) => f.id === id)

  const [nickEdit, setNickEdit] = useState<string | null>(null) // the nickname being typed, or null
  const [nickBusy, setNickBusy] = useState(false)
  // 0.9.1: your own card is a preview of what others see (a friend, or anyone else).
  const [viewAs, setViewAs] = useState<'friend' | 'everyone'>('friend')
  const load = () =>
    (id === meId ? api.getMyProfile(viewAs) : api.getProfile(id)).then((r) => {
      if (r.ok) setProfile(r.data)
      else setGone(true)
    })
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isFriend, viewAs])

  // Nicknames: only you see them; the server puts them everywhere for you (lists refresh by themselves).
  async function saveNickname(next: string | null) {
    setNickBusy(true)
    const r = await api.setNickname(id, next)
    setNickBusy(false)
    if (!r.ok) return void inform("Couldn't save the nickname", r.message)
    setNickEdit(null)
    void load()
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/chats'))
  const presence = live ?? profile?.presence ?? null
  const game = presence ? playing(presence) : null
  const first = profile?.displayName.split(/\s+/)[0] ?? ''
  const isMe = id === meId
  // 0.9.1 tabs: only the ones with something you may see.
  const mutualCount = (profile?.counts?.mutualFriends ?? 0) + (profile?.counts?.mutualConstellations ?? 0)
  const tabs: { id: 'board' | 'mutuals' | 'activity'; label: string }[] = [
    ...(profile?.board?.length ? [{ id: 'board' as const, label: 'Board' }] : []),
    ...(!isMe && mutualCount ? [{ id: 'mutuals' as const, label: 'Mutuals' }] : []),
    ...(profile?.activityShown ? [{ id: 'activity' as const, label: 'Activity' }] : []),
  ]
  const [tabChoice, setTab] = useState<'board' | 'mutuals' | 'activity' | null>(null)
  const [tabsMin, setTabsMin] = useState(0)
  const tab = tabs.find((t) => t.id === tabChoice)?.id ?? tabs[0]?.id ?? null

  // The bell: "Notify me when they come online" (0.3.0 servers send onlineAlert).
  async function toggleOnlineAlert(on: boolean) {
    const flip = (value: boolean) =>
      useStore.setState((s) => ({ friends: { ...s.friends, friends: s.friends.friends.map((f) => (f.id === id ? { ...f, onlineAlert: value } : f)) } }))
    flip(on)
    const r = await api.setOnlineAlert(id, on)
    if (!r.ok) {
      flip(!on)
      void inform("Couldn't change that", r.message)
    } else if (r.data.mode) setAlertsMode(r.data.mode) // the bell switched None to Selected friends
  }

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
      <View
        style={{ maxHeight: '92%', backgroundColor: c.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', width: '100%', maxWidth: SHEET_MAX_WIDTH, alignSelf: 'center' }}
        accessibilityViewIsModal
      >
        {!profile ? (
          <View style={{ padding: 40, paddingTop: 96, alignItems: 'center', paddingBottom: insets.bottom + 40 }}>
            {gone ? <Text tone="muted">This profile isn't available.</Text> : <Spinner />}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 14 }}>
            {isMe ? (
              <View style={{ marginHorizontal: -20, paddingLeft: 16, paddingRight: 64, paddingVertical: 12, backgroundColor: c.accentSoft, gap: 8 }}>
                <Text size={13.5} weight="bold">
                  Preview: how {viewAs === 'friend' ? 'a friend sees' : 'anyone else on Glofly sees'} your profile
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(
                    [
                      ['friend', 'A friend'],
                      ['everyone', 'Anyone else'],
                    ] as const
                  ).map(([v, label]) => (
                    <Pressable
                      key={v}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: viewAs === v }}
                      onPress={() => setViewAs(v)}
                      style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', backgroundColor: viewAs === v ? c.accent : c.bg }}
                    >
                      <Text size={13} weight="bold" style={{ color: viewAs === v ? c.accentInk : c.ink2 }}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                  <View style={{ flex: 1 }} />
                  <Pressable accessibilityRole="button" onPress={() => router.replace('/edit-profile')} style={{ minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', backgroundColor: c.ink }}>
                    <Text size={13} weight="bold" style={{ color: c.bg }}>
                      Edit
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            <View style={{ marginHorizontal: -20, marginBottom: -14 }}>
              <ProfileHeaderImage userId={profile.id} header={profile.header} height={profile.header ? 150 : 96} />
            </View>
            <View style={{ marginTop: -52, borderRadius: 60, borderWidth: 5, borderColor: c.sheet, alignSelf: 'flex-start' }}>
              <Avatar user={profile} size={96} status={isFriend || (isMe && viewAs === 'friend') ? (presence?.status ?? 'offline') : null} mobile={onMobile(presence ?? undefined)} ring={c.sheet} />
            </View>
            <View style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <Text display size={26} accessibilityRole="header">
                  {profile.displayName}
                </Text>
                {profile.pronouns ? (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9, backgroundColor: c.surface }}>
                    <Text size={12.5} weight="medium" tone="muted">
                      {profile.pronouns}
                    </Text>
                  </View>
                ) : null}
                {stream ? <LivePill /> : null}
              </View>
              <Text size={15} tone="muted">
                @{profile.username}
                {profile.realName ? ` · their name is ${profile.realName}` : ''}
                {!isMe && profile.counts?.mutualFriends
                  ? ` · ${profile.counts.mutualFriends} mutual ${profile.counts.mutualFriends === 1 ? 'friend' : 'friends'}`
                  : ''}
              </Text>
            </View>
            {!isMe && nickEdit !== null ? (
              <View style={{ gap: 10, padding: 14, borderRadius: 16, backgroundColor: c.surface }}>
                <Field
                  label="Nickname · only you see it"
                  value={nickEdit}
                  onChangeText={setNickEdit}
                  maxLength={NICKNAME_MAX}
                  placeholder={profile.realName ?? profile.displayName}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => void saveNickname(nickEdit.trim() || null)}
                  accessibilityLabel="Nickname"
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {profile.realName ? <Button label="Remove" kind="secondary" compact disabled={nickBusy} onPress={() => void saveNickname(null)} style={{ flex: 1 }} /> : null}
                  <Button label="Cancel" kind="secondary" compact disabled={nickBusy} onPress={() => setNickEdit(null)} style={{ flex: 1 }} />
                  <Button label="Save" compact busy={nickBusy} onPress={() => void saveNickname(nickEdit.trim() || null)} style={{ flex: 1 }} />
                </View>
              </View>
            ) : null}
            {presence && (isFriend || (isMe && viewAs === 'friend')) ? (
              <View style={{ gap: 6 }}>
                <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: presence.status === 'online' ? c.onlineSoft : c.surface }}>
                  <Text size={14} weight="medium" style={{ color: presence.status === 'online' ? c.onlineText : c.ink2 }}>
                    {presence.status === 'offline' ? (presence.lastSeenAt ? `Last seen ${longDate(presence.lastSeenAt)}` : 'Offline') : (mobileLabel(presence) ?? STATUS_LABEL[presence.status])}
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
            {/* 0.9.3 (board 9): live on Twitch or Kick */}
            {stream && !isMe ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: c.surface }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text size={15} weight="bold">
                    Live on {siteName(stream.source)}
                  </Text>
                  <Text size={13} tone="muted" numberOfLines={2}>
                    {[stream.title, stream.game].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {/^https:\/\/(www\.twitch\.tv|kick\.com)\//.test(stream.url) ? <Button compact label="Watch" onPress={() => void Linking.openURL(stream.url)} /> : null}
              </View>
            ) : null}
            {/* 0.9.3: their Steam page (they chose to show it) */}
            {profile.steamUrl && /^https:\/\/steamcommunity\.com\//.test(profile.steamUrl) ? (
              <Button compact kind="secondary" label="Steam profile" onPress={() => void Linking.openURL(profile.steamUrl!)} />
            ) : null}
            {/* Glofly 2.0: My games (hidden when they keep it private or haven't played anything). */}
            {(isMe || isFriend) && !blocked && profile.gamesShown !== false ? <GamesCard userId={id} isMe={isMe} onOpen={close} /> : null}
            {!isMe && isFriend && onlineAlert !== undefined ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.surface }}>
                <Icon name={onlineAlert ? 'bell' : 'bellOff'} size={20} color={onlineAlert ? c.accentText : c.ink2} />
                <View style={{ flex: 1 }}>
                  <Text size={15} weight="medium">
                    Notify me when {first || 'they'} comes online
                  </Text>
                  <Text size={13} tone="muted">
                    At most once every 30 minutes.
                  </Text>
                </View>
                <Switch value={onlineAlert} onChange={(on) => void toggleOnlineAlert(on)} label={`Notify me when ${first || 'they'} comes online`} />
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
            {tabs.length ? (
              <View style={{ gap: 12 }}>
                <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 2, borderBottomWidth: 1, borderColor: c.line }}>
                  {tabs.map((t) => (
                    <Pressable
                      key={t.id}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: tab === t.id }}
                      onPress={() => setTab(t.id)}
                      style={{ height: 44, paddingHorizontal: 10, justifyContent: 'center', borderBottomWidth: 3, borderColor: tab === t.id ? c.accent : 'transparent' }}
                    >
                      <Text size={14} weight={tab === t.id ? 'bold' : 'medium'} tone={tab === t.id ? 'ink' : 'muted'}>
                        {t.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {/* 0.9.1: keeps the tallest tab's height so far, so the sheet doesn't jump between tabs */}
                <View style={{ minHeight: tabsMin || undefined }} onLayout={(e) => {
                  const h = Math.ceil(e.nativeEvent.layout.height)
                  if (h > tabsMin) setTabsMin(h)
                }}>
                {tab === 'board' && profile.board ? (
                  <BoardTiles tiles={profile.board} userId={profile.id} />
                ) : tab === 'mutuals' ? (
                  <MutualsList userId={profile.id} name={profile.displayName} />
                ) : tab === 'activity' ? (
                  <ActivityFeed userId={profile.id} name={profile.displayName} as={isMe ? viewAs : undefined} />
                ) : null}
                </View>
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
                {nickEdit === null && !blocked ? (
                  <LinkRow icon="pencil" label={profile.realName ? 'Change nickname' : 'Give them a nickname'} onPress={() => setNickEdit(profile.realName ? profile.displayName : '')} />
                ) : null}
                {isFriend && !meRestricted ? <LinkRow icon="close" label="Remove friend" onPress={() => void removeFriend(profile)} /> : null}
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
        <IconButton name="close" label="Close" onPress={close} color="#FFFFFF" style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(28,18,16,0.5)', borderRadius: 22 }} />
      </View>
      {/* This card lies over the app (transparentModal): its dialogs must be drawn from here on iPhone. */}
      <SheetHost />
      <DialogHost />
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
