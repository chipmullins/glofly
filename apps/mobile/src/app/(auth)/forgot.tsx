import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { forgotPassword } from '@/api/auth'
import { AuthHero } from '@/ui/AuthHero'
import { Button, Field, Notice, Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

export default function Forgot() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [identifier, setIdentifier] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    const id = identifier.trim()
    if (!id) return setError('Enter your username or email.')
    setBusy(true)
    setError(null)
    const r = await forgotPassword(id)
    setBusy(false)
    if (r.ok) setSent(id)
    else setError(r.message)
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/login'))

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      {sent ? (
        <>
          <AuthHero title="Check your email" subtitle="Almost there." onBack={back} />
          <View style={{ padding: 24, gap: 16, alignItems: 'center' }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
              <Icon name="mail" size={34} color={c.accentText} strokeWidth={1.8} />
            </View>
            <Text size={16} style={{ textAlign: 'center', lineHeight: 23 }}>
              If <Text weight="bold">{sent}</Text> has a Glofly account, we sent a link to its email. It works for 1 hour.
            </Text>
            <Text size={14} tone="muted" style={{ textAlign: 'center' }}>
              Nothing after a few minutes? Check spam, or send another.
            </Text>
            <Button label="Back to log in" onPress={back} style={{ alignSelf: 'stretch', marginTop: 8 }} />
            <Button label="Send another link" kind="ghost" onPress={() => void send()} busy={busy} style={{ alignSelf: 'stretch' }} />
          </View>
        </>
      ) : (
        <>
          <AuthHero title="Forgot your password?" subtitle="We'll email you a link to choose a new one." onBack={back} />
          <View style={{ padding: 24, gap: 18 }}>
            {error ? <Notice>{error}</Notice> : null}
            <Field
              label="Username or email"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              returnKeyType="send"
              onSubmitEditing={() => void send()}
              autoFocus
            />
            <Button label="Email me a link" onPress={() => void send()} busy={busy} />
            <Button label="Back to log in" kind="ghost" onPress={back} />
          </View>
        </>
      )}
    </ScrollView>
  )
}
