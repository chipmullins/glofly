import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { STATUS_LABEL, dotFor, type PrivacySettings } from '@glofly/shared'
import * as api from '@/api/glofly'
import { logout } from '@/api/auth'
import { useSession } from '@/state/session'
import { useStore } from '@/state/store'
import { prefs } from '@/lib/storage'
import { Avatar } from '@/ui/Avatar'
import { chooseFrom, confirm, inform } from '@/ui/dialogs'
import { SectionLabel, Text } from '@/ui/kit'
import { SettingsRow } from '@/ui/SettingsRow'
import { refreshSocial, useSocial } from '@/state/social'
import { ACCENTS, useTheme, useThemeChoice, type AccentChoice, type ThemeChoice } from '@/ui/theme'

const THEMES: { key: ThemeChoice; label: string }[] = [
  { key: 'system', label: 'Match system' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
]

export default function Settings() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const user = useSession((s) => s.user)
  const myStatus = useStore((s) => s.myStatus)
  const theme = useThemeChoice((s) => s.choice)
  const accent = useThemeChoice((s) => s.accent)
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null)
  const shareBirthday = useSocial((x) => x.shareBirthday)

  useEffect(() => {
    void api.getPrivacy().then((r) => r.ok && setPrivacy(r.data))
  }, [])

  async function changePrivacy(patch: Partial<PrivacySettings>) {
    if (!privacy) return
    const before = privacy
    setPrivacy({ ...privacy, ...patch })
    const r = await api.setPrivacy(patch)
    if (r.ok) setPrivacy(r.data)
    else {
      setPrivacy(before)
      void inform("Couldn't change that", r.message)
    }
  }

  async function pickTheme() {
    const pick = await chooseFrom(THEMES.map((t) => ({ key: t.key, label: t.label, checked: t.key === theme })), 'Theme')
    if (!pick) return
    useThemeChoice.getState().set(pick as ThemeChoice)
    void prefs.set('theme', pick)
  }

  async function pickAccent() {
    const pick = await chooseFrom(ACCENTS.map((a) => ({ key: a.key, label: a.label, checked: a.key === accent, swatch: a.swatch })), 'Accent color')
    if (!pick) return
    useThemeChoice.getState().setAccent(pick as AccentChoice)
    void prefs.set('accent', pick)
  }

  async function friendRequests() {
    const pick = await chooseFrom(
      [
        { key: 'everyone', label: 'Everyone', checked: privacy?.friendRequests === 'everyone' },
        { key: 'nobody', label: 'No one', detail: 'You can still send requests yourself', checked: privacy?.friendRequests === 'nobody' },
      ],
      'Who can send you friend requests',
    )
    if (pick) void changePrivacy({ friendRequests: pick as 'everyone' | 'nobody' })
  }

  if (!user) return null
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}>
      <Text display size={28} style={{ marginHorizontal: 20, marginBottom: 8 }} accessibilityRole="header">
        Settings
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${user.displayName}, @${user.username}. Edit profile`}
        onPress={() => router.push('/edit-profile')}
        style={{ marginHorizontal: 16, padding: 14, borderRadius: 20, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 14 }}
      >
        <Avatar user={user} size={56} status={dotFor(myStatus?.status ?? 'online')} ring={c.surface} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text size={18} weight="bold" numberOfLines={1}>
            {user.displayName}
          </Text>
          <Text size={14} tone="muted" numberOfLines={1}>
            @{user.username} · {STATUS_LABEL[myStatus?.status ?? 'online']}
          </Text>
        </View>
        <Text size={14} weight="bold" tone="accent">
          Edit
        </Text>
      </Pressable>

      <SectionLabel>Appearance</SectionLabel>
      <SettingsRow icon="palette" label="Theme" value={THEMES.find((t) => t.key === theme)?.label} onPress={() => void pickTheme()} />
      <SettingsRow icon="palette" label="Accent color" value={ACCENTS.find((a) => a.key === accent)?.label} onPress={() => void pickAccent()} />

      <SectionLabel>Notifications & sounds</SectionLabel>
      <SettingsRow icon="bell" label="Notifications" detail="Messages, friend requests and calls" onPress={() => router.push('/settings/notifications')} />

      <SectionLabel>Privacy</SectionLabel>
      <SettingsRow
        icon="checkDouble"
        label="Read receipts"
        detail="Off means you won't see others' either"
        toggle={{ value: privacy?.readReceipts ?? true, onChange: (v) => void changePrivacy({ readReceipts: v }) }}
        disabled={!privacy}
      />
      <SettingsRow icon="clock" label="Show last seen" toggle={{ value: privacy?.showLastSeen ?? true, onChange: (v) => void changePrivacy({ showLastSeen: v }) }} disabled={!privacy} />
      <SettingsRow icon="pencil" label="Show when I'm typing" toggle={{ value: privacy?.showTyping ?? true, onChange: (v) => void changePrivacy({ showTyping: v }) }} disabled={!privacy} />
      <SettingsRow icon="addPerson" label="Friend requests from" value={privacy?.friendRequests === 'nobody' ? 'No one' : 'Everyone'} onPress={() => void friendRequests()} disabled={!privacy} />
      <SettingsRow
        icon="gift"
        label="Share my birthday with friends"
        detail="A 🎂 by your name on the day (never the year)"
        toggle={{
          value: shareBirthday,
          onChange: (v) => {
            useSocial.setState({ shareBirthday: v })
            void api.shareBirthday(v).then((r) => {
              if (!r.ok) useSocial.setState({ shareBirthday: !v })
              void refreshSocial()
            })
          },
        }}
      />

      <SectionLabel>Fun</SectionLabel>
      <SettingsRow icon="sparkles" label="Year in Glow" detail="Your year on Glofly: friends, glows, calls, emoji" onPress={() => router.push('/year')} />

      <SectionLabel>Account</SectionLabel>
      <SettingsRow icon="user" label="Account" detail="Email, password, devices, delete account" onPress={() => router.push('/settings/account')} />
      <SettingsRow icon="info" label="About Glofly" onPress={() => router.push('/settings/about')} />
      <SettingsRow
        icon="logout"
        label="Log out"
        danger
        onPress={async () => {
          if (await confirm({ title: 'Log out of Glofly?', message: "You'll stop getting notifications on this phone.", confirmLabel: 'Log out' })) void logout()
        }}
      />
    </ScrollView>
  )
}
