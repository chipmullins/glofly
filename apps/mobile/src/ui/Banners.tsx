import { useEffect, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { Icon } from './icons'
import { Text } from './kit'
import { useTheme } from './theme'
import { useStore } from '@/state/store'
import { prefs } from '@/lib/storage'
import { useAccount, resendConfirm } from '@/state/account'
import { router } from 'expo-router'

// The strips above the chats list: the Glofly team's announcement, "Confirm your email", and
// "Connecting…" while the live connection is down.

export function Banners() {
  const { c } = useTheme()
  const announcement = useStore((s) => s.announcement)
  const connected = useStore((s) => s.connected)
  const account = useAccount((s) => s.account)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [emailLater, setEmailLater] = useState<number>(Date.now() + 1e12)
  const [showOffline, setShowOffline] = useState(false)

  useEffect(() => {
    void prefs.get<string | null>('announcementDismissed', null).then(setDismissed)
    void prefs.get<number>('confirmEmailLater', 0).then(setEmailLater)
  }, [])

  // Only say "Connecting…" if it lasts more than a moment.
  useEffect(() => {
    if (connected) return setShowOffline(false)
    const t = setTimeout(() => setShowOffline(true), 2500)
    return () => clearTimeout(t)
  }, [connected])

  const showAnnouncement = announcement && announcement.id !== dismissed
  const showEmail = account && account.emailVerified === false && Date.now() > emailLater
  if (!showAnnouncement && !showEmail && !showOffline) return null
  return (
    <View style={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
      {showOffline ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, backgroundColor: c.surface }} accessibilityLiveRegion="polite">
          <Icon name="refresh" size={16} color={c.muted} />
          <Text size={13} tone="muted">
            Connecting to Glofly…
          </Text>
        </View>
      ) : null}
      {showAnnouncement ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            padding: 12,
            borderRadius: 16,
            backgroundColor: announcement.tone === 'important' ? c.dangerSoft : c.accentSoft,
          }}
          accessibilityRole="alert"
        >
          <Icon name={announcement.tone === 'important' ? 'alert' : 'info'} size={18} color={announcement.tone === 'important' ? c.danger : c.accentText} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text size={14} style={{ lineHeight: 19 }}>
              {announcement.body}
            </Text>
            {announcement.linkUrl ? (
              <Text size={14} weight="bold" tone="accent" accessibilityRole="link" onPress={() => void Linking.openURL(announcement.linkUrl!)}>
                {announcement.linkLabel || 'Learn more'}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={10}
            onPress={() => {
              setDismissed(announcement.id)
              void prefs.set('announcementDismissed', announcement.id)
            }}
          >
            <Icon name="close" size={18} color={c.muted} />
          </Pressable>
        </View>
      ) : null}
      {showEmail ? (
        <View style={{ padding: 12, borderRadius: 16, backgroundColor: c.infoSoft, gap: 8 }}>
          <Text size={14} style={{ color: c.ink, lineHeight: 19 }}>
            Confirm your email ({account.pendingEmail ?? account.email}) so you can always get back into your account.
          </Text>
          <View style={{ flexDirection: 'row', gap: 18 }}>
            <Text size={14} weight="bold" style={{ color: c.info }} accessibilityRole="button" onPress={() => void resendConfirm()}>
              Resend link
            </Text>
            <Text size={14} weight="bold" style={{ color: c.info }} accessibilityRole="button" onPress={() => router.push('/settings/account')}>
              Change email
            </Text>
            <Text
              size={14}
              weight="bold"
              style={{ color: c.info }}
              accessibilityRole="button"
              onPress={() => {
                const later = Date.now() + 3 * 86_400_000
                setEmailLater(later)
                void prefs.set('confirmEmailLater', later)
              }}
            >
              Later
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  )
}
