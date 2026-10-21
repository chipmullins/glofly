import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View, type TextInput } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { login, type TwoStepAsk } from '@/api/auth'
import { TwoStepCode } from '@/ui/TwoStepCode'
import { AuthHero, LoginHeroContent } from '@/ui/AuthHero'
import { Button, Checkbox, Field, Notice, Text } from '@/ui/kit'
import { confirm } from '@/ui/dialogs'
import { useTheme } from '@/ui/theme'
import { useSession } from '@/state/session'
import { longDate } from '@/lib/format'
import { useShareInbox } from '@/share/inbox'

export default function Login() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const note = useSession((s) => s.signedOutNote)
  // 0.8.0: something shared to Glofly waits for you to sign in
  const sharing = useShareInbox((s) => !!s.item)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [keep, setKeep] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwordRef = useRef<TextInput>(null)
  // 0.7.3: the account uses two-step sign-in: the code step
  const [ask, setAsk] = useState<TwoStepAsk | null>(null)

  async function submit(restore = false) {
    if (!identifier.trim() || !password) {
      setError('Enter your username or email and password.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await login({ identifier: identifier.trim(), password, keepSignedIn: keep, restore })
    setBusy(false)
    if (result.ok) return // the layout moves to the app
    if (result.reason === 'two_step') {
      setAsk(result.twoStep)
      return
    }
    if (result.reason === 'deletion_scheduled') {
      const when = result.deleteAfter ? longDate(result.deleteAfter) : 'soon'
      const ok = await confirm({
        title: 'Restore your account?',
        message: `This account is set to be deleted on ${when}. Log in to keep it: everything stays as it was.`,
        confirmLabel: 'Restore and log in',
      })
      if (ok) void submit(true)
      return
    }
    if (result.reason !== 'update_required') setError(result.message)
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 24 }}>
        <AuthHero tall>
          <LoginHeroContent />
        </AuthHero>
        {ask ? (
          <View style={{ paddingHorizontal: 24, paddingTop: 26 }}>
            <TwoStepCode
              ask={ask}
              keepSignedIn={keep}
              onBack={() => {
                setAsk(null)
                setPassword('')
              }}
            />
          </View>
        ) : (
        <View style={{ paddingHorizontal: 24, paddingTop: 26, gap: 18 }}>
          <View style={{ gap: 4 }}>
            <Text display size={28} accessibilityRole="header">
              Welcome back!
            </Text>
            <Text size={15} tone="muted">
              We knew you couldn't stay away.
            </Text>
          </View>
          {error ? <Notice>{error}</Notice> : note ? <Notice tone="info">{note}</Notice> : null}
          {sharing && !error ? <Notice tone="info">Sign in to send what you shared. You'll pick the chat next.</Notice> : null}
          <Field
            label="Username or email"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            submitBehavior="submit"
          />
          <View style={{ gap: 2 }}>
            <Field
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={setPassword}
              secure
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
            <Pressable accessibilityRole="link" onPress={() => router.push('/forgot')} style={{ alignSelf: 'flex-end', paddingVertical: 8 }}>
              <Text size={14} weight="bold" tone="accent">
                Forgot password?
              </Text>
            </Pressable>
          </View>
          <Checkbox value={keep} onChange={setKeep}>
            <Text size={16}>Keep me signed in</Text>
          </Checkbox>
          <Button label="Log in" onPress={() => void submit()} busy={busy} />
          <Text size={15} tone="muted" style={{ textAlign: 'center' }}>
            New here?{' '}
            <Text size={15} weight="bold" tone="accent" onPress={() => router.push('/register')} accessibilityRole="link">
              Create an account
            </Text>
          </Text>
        </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
