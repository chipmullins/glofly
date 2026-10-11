import { useEffect, useState } from 'react'
import { AppState, View } from 'react-native'
import { usePhonePrefs, setPhonePref } from '@/state/prefs'
import { notificationStatus, openNotificationSettings, fullScreenCallsAllowed, openFullScreenCallSettings, type PermissionState } from '@/push/permissions'
import { Notice, SectionLabel, Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { SettingsRow } from '@/ui/SettingsRow'

// Settings → Notifications & sounds (this phone).

export default function NotificationSettings() {
  const p = usePhonePrefs()
  const [perm, setPerm] = useState<PermissionState>('unknown')
  const [fullScreen, setFullScreen] = useState<boolean | null>(null)

  useEffect(() => {
    const check = () => {
      void notificationStatus().then(setPerm)
      void fullScreenCallsAllowed().then(setFullScreen)
    }
    check()
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check())
    return () => sub.remove()
  }, [])

  return (
    <Screen title="Notifications">
      {perm === 'denied' ? (
        <View style={{ padding: 16 }}>
          <Notice tone="info">Android has notifications turned off for Glofly. Turn them on in Android Settings to get messages and calls.</Notice>
        </View>
      ) : null}
      <SectionLabel>This phone</SectionLabel>
      <SettingsRow label="Notifications on this phone" detail="Messages, friend requests and calls" toggle={{ value: p.notifications, onChange: (v) => void setPhonePref('notifications', v) }} />
      <SettingsRow label="Show message preview" detail='Off: "New message" instead of the text' toggle={{ value: p.preview, onChange: (v) => void setPhonePref('preview', v) }} disabled={!p.notifications} />
      {perm === 'denied' ? <SettingsRow label="Open Android notification settings" onPress={() => void openNotificationSettings()} /> : null}
      <SectionLabel>Sounds</SectionLabel>
      <SettingsRow label="Sounds in Glofly" detail="Message sound while the app is open" toggle={{ value: p.sounds, onChange: (v) => void setPhonePref('sounds', v) }} />
      <SettingsRow label="Vibrate" toggle={{ value: p.vibrate, onChange: (v) => void setPhonePref('vibrate', v) }} />
      <SettingsRow label="Notification sound and ringtone" detail="Firefly chime and Firefly dance. Change them in Android's settings for Glofly." onPress={() => void openNotificationSettings()} />
      <Text size={13} tone="muted" style={{ paddingHorizontal: 20, paddingVertical: 12, lineHeight: 19 }}>
        In Do not disturb you get no message notifications; calls still show, silently. Muted chats only notify you when someone @mentions you.
      </Text>
      <SectionLabel>Calls</SectionLabel>
      <SettingsRow
        label="Full-screen incoming calls"
        detail="Lets Glofly ring on your lock screen"
        value={fullScreen === null ? '' : fullScreen ? 'Allowed' : 'Off'}
        onPress={() => void openFullScreenCallSettings()}
      />
    </Screen>
  )
}
