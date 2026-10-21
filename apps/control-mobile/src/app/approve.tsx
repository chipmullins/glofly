import { useState } from 'react'
import { KeyboardAvoidingView, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Device from 'expo-device'
import { Button, Field, Gradient, Text } from '@/ui/kit'
import { Logo } from '@/ui/icons'
import { c } from '@/ui/theme'
import { approvePhone, formatPairCode, useSession } from '@/state/session'
import { haptic } from '@/lib/haptics'

// First run: approve this iPhone with the code desktop Control shows at home.

const defaultName = (): string => {
  const n = (Device.deviceName ?? '').replace(/[^\p{L}\p{N} '’._-]/gu, '').trim().slice(0, 40)
  return n || "Chip's iPhone"
}

export default function Approve() {
  const insets = useSafeAreaInsets()
  const notice = useSession((s) => s.notice)
  const [code, setCode] = useState('')
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = code.replace('-', '').length === 6 && name.trim().length > 0

  async function submit() {
    setBusy(true)
    setError(null)
    const r = await approvePhone(code, name)
    setBusy(false)
    if (r.ok) haptic.success()
    else {
      haptic.error()
      setError(r.message)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.violetDeep }}>
      <Gradient from="#2a1a55" to={c.violetDeep} stop={0.7} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 36, paddingHorizontal: 24, paddingBottom: insets.bottom + 24, gap: 22 }}
        >
          <View style={{ alignItems: 'center', gap: 12 }}>
            <Logo size={84} />
            <View style={{ alignItems: 'center' }}>
              <Text display weight="bold" size={26} color={c.white}>
                Glofly
              </Text>
              <Text display weight="semi" size={13} color={c.gold} style={{ letterSpacing: 1.8, textTransform: 'uppercase' }}>
                Control
              </Text>
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Text display weight="bold" size={22} color={c.white} accessibilityRole="header">
              Approve this iPhone
            </Text>
            <Text size={14.5} color={c.onVioletSoft} style={{ lineHeight: 21 }}>
              At home on your Wi‑Fi, open desktop Control → Server → Approved phones → Approve a new iPhone, then type the code here.
            </Text>
          </View>

          {notice ? (
            <View style={{ padding: 14, borderRadius: 14, backgroundColor: 'rgba(255,194,74,0.12)', borderWidth: 1, borderColor: 'rgba(255,194,74,0.4)' }}>
              <Text size={13.5} color={c.gold} style={{ lineHeight: 19 }}>
                {notice}
              </Text>
            </View>
          ) : null}

          <View style={{ gap: 14 }}>
            <Field
              dark
              label="Code from desktop Control"
              value={code}
              onChangeText={(t) => setCode(formatPairCode(t))}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              placeholder="K7M-2QF"
              maxLength={7}
              inputStyle={{ fontFamily: 'Outfit_600SemiBold', fontSize: 22, letterSpacing: 4, minHeight: 50 }}
            />
            <Field dark label="Name for this iPhone" value={name} onChangeText={setName} maxLength={40} hint="Shown in desktop Control's list of approved phones." />
            {error ? (
              <Text size={13.5} color="#ff9b92" accessibilityLiveRegion="assertive" style={{ lineHeight: 19 }}>
                {error}
              </Text>
            ) : null}
            <Button label="Approve this iPhone" kind="gold" busy={busy} disabled={!ready} onPress={() => void submit()} />
          </View>

          <View style={{ flex: 1 }} />
          <Text size={12.5} color={c.onVioletMuted} style={{ textAlign: 'center', lineHeight: 19 }}>
            A key for Control is made on this iPhone and locked behind Face ID. It never leaves the phone.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}
