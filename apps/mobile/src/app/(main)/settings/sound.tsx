import { useEffect } from 'react'
import { Pressable } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { DEFAULT_PHONE_CONSTELLATION_SOUND, PHONE_MESSAGE_SOUNDS, PHONE_RINGTONES, phoneMessageSound, phoneRingtone } from '@glofly/shared'
import { setPhonePref, usePhonePrefs } from '@/state/prefs'
import { previewSound, stopPreview } from '@/push/sounds'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { useTheme } from '@/ui/theme'

// Settings → Notifications → Message sound / Ringtone (Oct 13): tap one to hear it and pick it,
// like a phone's own ringtone list. Used in the app and for this phone's notifications (and the
// lock-screen ringing on iPhone).

export default function SoundPicker() {
  const { kind } = useLocalSearchParams<{ kind: string }>()
  const ringtone = kind === 'ringtone'
  const night = kind === 'constellation' // 0.7.0: the constellation message sound
  const { c } = useTheme()
  const p = usePhonePrefs()
  const current = ringtone
    ? phoneRingtone(p.ringtone).id
    : night
      ? (PHONE_MESSAGE_SOUNDS.find((s) => s.id === p.constellationSound) ?? phoneMessageSound(DEFAULT_PHONE_CONSTELLATION_SOUND)).id
      : phoneMessageSound(p.messageSound).id
  const list = ringtone ? PHONE_RINGTONES : PHONE_MESSAGE_SOUNDS

  useEffect(() => () => stopPreview(), [])

  async function pick(id: string) {
    // Saved first: on iPhone the preview plays the saved choice natively.
    await setPhonePref(ringtone ? 'ringtone' : night ? 'constellationSound' : 'messageSound', id)
    previewSound(ringtone ? 'ringtone' : night ? 'constellation' : 'message', id)
  }

  return (
    <Screen title={ringtone ? 'Ringtone' : night ? 'Constellation sound' : 'Message sound'}>
      <Text size={13} tone="muted" style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, lineHeight: 19 }}>
        {ringtone
          ? 'Plays when someone calls you, in Glofly and on your lock screen. Tap one to hear it.'
          : night
            ? 'Plays for messages in your constellations while Glofly is open. Tap one to hear it.'
            : 'Plays for new messages, in Glofly and in notifications on this phone. Tap one to hear it.'}
      </Text>
      {list.map((s) => {
        const on = s.id === current
        return (
          <Pressable
            key={s.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={s.label}
            onPress={() => void pick(s.id)}
            android_ripple={{ color: c.line }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, minHeight: 56 }}
          >
            <Icon name="play" size={18} color={c.faint} />
            <Text size={16} weight={on ? 'bold' : 'regular'} style={{ flex: 1 }}>
              {s.label}
            </Text>
            {on ? <Icon name="check" size={22} color={c.accent} /> : null}
          </Pressable>
        )
      })}
    </Screen>
  )
}
