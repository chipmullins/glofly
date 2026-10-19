import { useEffect, useState } from 'react'
import { AppState, Platform, View } from 'react-native'
import { router } from 'expo-router'
import { DEFAULT_PHONE_CONSTELLATION_SOUND, PHONE_MESSAGE_SOUNDS, phoneMessageSound, phoneRingtone } from '@glofly/shared'
import { usePhonePrefs, setPhonePref } from '@/state/prefs'
import { notificationStatus, openNotificationSettings, fullScreenCallsAllowed, openFullScreenCallSettings, requestNotifications, type PermissionState } from '@/push/permissions'
import { refreshPush } from '@/push'
import * as api from '@/api/glofly'
import { inform } from '@/ui/dialogs'
import { Notice, SectionLabel, Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { SettingsRow } from '@/ui/SettingsRow'
import { BottomSheet } from '@/ui/dialogs'
import { Button } from '@/ui/kit'
import { TimePicker } from '@/ui/TimePicker'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { QUIET_DEFAULT, inQuietHours, timeOfDayLabel, type QuietHours } from '@glofly/shared'
import { deviceTimeZone, refreshQuietHours, saveQuietHours, useQuietHours } from '@/state/quiet'

// Settings → Notifications & sounds (this phone).

const ios = Platform.OS === 'ios'
const OS = ios ? 'iOS' : 'Android'

export default function NotificationSettings() {
  const p = usePhonePrefs()
  const [perm, setPerm] = useState<PermissionState>('unknown')
  const [fullScreen, setFullScreen] = useState<boolean | null>(null)
  // "Friends coming online" lives on the server (every device), 0.3.0 servers only.
  const [onlineAlerts, setOnlineAlerts] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    void api.getPrivacy().then((r) => r.ok && setOnlineAlerts(r.data.onlineAlerts))
  }, [])
  async function changeOnlineAlerts(on: boolean) {
    setOnlineAlerts(on)
    const r = await api.setPrivacy({ onlineAlerts: on })
    if (!r.ok) {
      setOnlineAlerts(!on)
      void inform("Couldn't change that", r.message)
    }
  }

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
          <Notice tone="info">{`${OS} has notifications turned off for Glofly. Turn them on in ${ios ? 'Settings → Glofly → Notifications' : 'Android Settings'} to get messages and calls.`}</Notice>
        </View>
      ) : null}
      {ios && perm === 'unknown' ? (
        <View style={{ padding: 16, gap: 10 }}>
          <Notice tone="info">Glofly hasn't been allowed to send notifications on this iPhone yet.</Notice>
          <SettingsRow
            label="Allow notifications"
            onPress={async () => {
              await requestNotifications()
              setPerm(await notificationStatus())
              void refreshPush()
            }}
          />
        </View>
      ) : null}
      <SectionLabel>This phone</SectionLabel>
      <SettingsRow label="Notifications on this phone" detail="Messages, friend requests and calls" toggle={{ value: p.notifications, onChange: (v) => void setPhonePref('notifications', v) }} />
      <SettingsRow label="Show message preview" detail='Off: "New message" instead of the text' toggle={{ value: p.preview, onChange: (v) => void setPhonePref('preview', v) }} disabled={!p.notifications} />
      {perm === 'denied' ? <SettingsRow label={`Open ${OS} notification settings`} onPress={() => void openNotificationSettings()} /> : null}
      {onlineAlerts !== undefined ? (
        <>
          <SectionLabel>Friends</SectionLabel>
          <SettingsRow
            label="Friends coming online"
            detail="Pick who with the bell on their profile (everyone's off until you do). On every device."
            toggle={{ value: onlineAlerts, onChange: (v) => void changeOnlineAlerts(v) }}
          />
        </>
      ) : null}
      <QuietHoursSection />
      <SectionLabel>Sounds</SectionLabel>
      <SettingsRow label="Sounds in Glofly" detail="Message sound while the app is open" toggle={{ value: p.sounds, onChange: (v) => void setPhonePref('sounds', v) }} />
      <SettingsRow label="Vibrate" toggle={{ value: p.vibrate, onChange: (v) => void setPhonePref('vibrate', v) }} />
      <SettingsRow label="Message sound" value={phoneMessageSound(p.messageSound).label} onPress={() => router.push({ pathname: '/settings/sound', params: { kind: 'message' } })} />
      <SettingsRow label="Constellation sound" value={(PHONE_MESSAGE_SOUNDS.find((s) => s.id === p.constellationSound) ?? phoneMessageSound(DEFAULT_PHONE_CONSTELLATION_SOUND)).label} onPress={() => router.push({ pathname: '/settings/sound', params: { kind: 'constellation' } })} />
      <SettingsRow label="Ringtone" value={phoneRingtone(p.ringtone).label} onPress={() => router.push({ pathname: '/settings/sound', params: { kind: 'ringtone' } })} />
      <Text size={13} tone="muted" style={{ paddingHorizontal: 20, paddingVertical: 12, lineHeight: 19 }}>
        In Do not disturb you get no message notifications; calls still show, silently. Muted chats only notify you when someone @mentions you.
      </Text>
      {ios ? null : (
        <>
          <SectionLabel>Calls</SectionLabel>
          <SettingsRow
            label="Full-screen incoming calls"
            detail="Lets Glofly ring on your lock screen"
            value={fullScreen === null ? '' : fullScreen ? 'Allowed' : 'Off'}
            onPress={() => void openFullScreenCallSettings()}
          />
        </>
      )}
    </Screen>
  )
}

/** 0.7.3: quiet hours (on every device; off until turned on). */
function QuietHoursSection() {
  const quiet = useQuietHours((s) => s.quiet)
  const loaded = useQuietHours((s) => s.loaded)
  const [editing, setEditing] = useState<'from' | 'to' | null>(null)
  useEffect(() => {
    void refreshQuietHours()
  }, [])
  async function save(next: QuietHours | null) {
    const problem = await saveQuietHours(next)
    if (problem) void inform("Couldn't change quiet hours", problem)
  }
  if (!loaded) return null
  const on = !!quiet
  const nowQuiet = quiet ? inQuietHours(quiet) : false
  return (
    <>
      <SectionLabel>Quiet hours</SectionLabel>
      <SettingsRow
        icon="moon"
        label="Quiet hours"
        detail={on ? `${timeOfDayLabel(quiet.from)} to ${timeOfDayLabel(quiet.to)} every day${nowQuiet ? ' · on now' : ''}` : 'No notification sounds or alerts overnight. On every device.'}
        toggle={{
          value: on,
          onChange: (v) => void save(v ? { from: QUIET_DEFAULT.from, to: QUIET_DEFAULT.to, tz: deviceTimeZone(), calls: false } : null),
        }}
      />
      {quiet ? (
        <>
          <SettingsRow label="Starts" value={timeOfDayLabel(quiet.from)} onPress={() => setEditing('from')} />
          <SettingsRow label="Ends" value={timeOfDayLabel(quiet.to)} onPress={() => setEditing('to')} />
          <SettingsRow label="Let calls ring" detail="Off: calls show silently, like Do not disturb" toggle={{ value: quiet.calls, onChange: (v) => void save({ ...quiet, calls: v }) }} />
          <Text size={13} tone="muted" style={{ paddingHorizontal: 20, paddingVertical: 8, lineHeight: 19 }}>
            Messages still arrive; you just aren't alerted until quiet hours end. Times are in {quiet.tz.replace(/_/g, ' ')}.
          </Text>
          {editing ? (
            <QuietTimeSheet
              title={editing === 'from' ? 'Quiet hours start' : 'Quiet hours end'}
              value={editing === 'from' ? quiet.from : quiet.to}
              onClose={() => setEditing(null)}
              onSave={(v) => {
                setEditing(null)
                void save({ ...quiet, [editing]: v, tz: deviceTimeZone() })
              }}
            />
          ) : null}
        </>
      ) : null}
    </>
  )
}

function QuietTimeSheet({ title, value, onSave, onClose }: { title: string; value: string; onSave: (v: string) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const [v, setV] = useState(value)
  return (
    <BottomSheet onClose={onClose}>
      <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 20, gap: 20 }}>
        <Text display size={22}>
          {title}
        </Text>
        <TimePicker value={v} onChange={setV} minuteStep={15} />
        <Button label="Save" onPress={() => onSave(v)} />
      </View>
    </BottomSheet>
  )
}
