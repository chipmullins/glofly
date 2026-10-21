import { useEffect, useRef, useState } from 'react'
import { AppState, KeyboardAvoidingView, Pressable, ScrollView, View, type TextInput } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Button, Field, Gradient, Text } from '@/ui/kit'
import { Icon, Logo } from '@/ui/icons'
import { c } from '@/ui/theme'
import { signedIn, transport, unlockKey, useSession } from '@/state/session'
import { keystore } from '@/lib/keystore'
import { haptic } from '@/lib/haptics'
import { registerForAlerts, routeFor } from '@/lib/alerts'
import { useQuickNotes } from '@/lib/hooks'

// Sign in (Main.dc.html): Face ID unlocks the approved iPhone's key, then the admin password and
// the authenticator code, as on desktop. Every request here is signed with the key.

export default function SignIn() {
  const insets = useSafeAreaInsets()
  const approved = useSession((s) => s.approved)
  const notice = useSession((s) => s.notice)
  const [unlocked, setUnlocked] = useState(transport.unlocked)
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [editName, setEditName] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [backup, setBackup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwordSent = useRef<string | null>(null)
  const codeRef = useRef<TextInput>(null)

  useEffect(() => {
    void keystore.username().then((u) => {
      setUsername(u)
      if (!u) setEditName(true)
    })
    void unlock()
    // Back from a long time in the background: the key was forgotten, so ask Face ID again.
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && !transport.unlocked) setUnlocked(false)
    })
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function unlock() {
    setUnlockError(null)
    const r = await unlockKey()
    if (r.ok) setUnlocked(true)
    else setUnlockError(r.message)
  }

  const digits = code.replace(/\D/g, '')
  const ready = unlocked && username.trim() && password && (backup ? code.trim().length >= 6 : digits.length === 6)

  async function submit() {
    if (!ready) return
    setBusy(true)
    setError(null)
    // A wrong code keeps the first step (the challenge allows a few tries); a new password starts over.
    if (!transport.hasChallenge || passwordSent.current !== `${username}\n${password}`) {
      const p = await transport.signInPassword(username.trim().replace(/^@/, ''), password)
      if (!p.ok) {
        setBusy(false)
        haptic.error()
        if (p.error !== 'phone_not_approved') setError(p.message)
        return
      }
      passwordSent.current = `${username}\n${password}`
    }
    const r = await transport.signInCode(backup ? 'backupCode' : 'code', backup ? code.trim() : digits)
    setBusy(false)
    if (!r.ok) {
      haptic.error()
      if (r.error !== 'phone_not_approved') setError(r.message)
      setCode('')
      if (r.error === 'start_over') passwordSent.current = null
      return
    }
    haptic.success()
    await keystore.setUsername(username.trim().replace(/^@/, ''))
    signedIn(r)
    void useQuickNotes.getState().load(true)
    void registerForAlerts(true)
    const pending = useSession.getState().pendingOpen
    if (pending) {
      useSession.getState().setPendingOpen(null)
      setTimeout(() => router.navigate(routeFor(pending) as never), 300)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.violetDeep }}>
      <Gradient from="#2a1a55" to={c.violetDeep} stop={0.7} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 20, paddingHorizontal: 24, paddingBottom: insets.bottom + 20, gap: 22 }}
        >
          <View style={{ alignItems: 'center', gap: 12 }}>
            <Logo size={84} />
            <View style={{ alignItems: 'center' }}>
              <Text display weight="bold" size={26} color={c.white} accessibilityRole="header">
                Glofly
              </Text>
              <Text display weight="semi" size={13} color={c.gold} style={{ letterSpacing: 1.8, textTransform: 'uppercase' }}>
                Control
              </Text>
            </View>
          </View>

          {notice ? (
            <View style={{ padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,194,74,0.12)', borderWidth: 1, borderColor: 'rgba(255,194,74,0.4)' }}>
              <Text size={13.5} color={c.gold}>
                {notice}
              </Text>
            </View>
          ) : null}

          <View
            accessibilityLabel="Already checked"
            style={{ gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: c.tabBorder }}
          >
            <CheckRow
              ok={unlocked}
              label="Face ID"
              value={editName ? '' : username || ''}
              onPress={editName ? undefined : () => setEditName(true)}
              hint="Change the admin username"
            />
            <CheckRow ok={unlocked} label="Approved iPhone key" value={approved?.phoneName ?? ''} />
            {!unlocked ? (
              <View style={{ gap: 8, marginTop: 6 }}>
                {unlockError ? (
                  <Text size={13} color="#ff9b92">
                    {unlockError}
                  </Text>
                ) : null}
                <Button label="Unlock with Face ID" icon="faceId" kind="secondary" height={46} onPress={() => void unlock()} />
              </View>
            ) : null}
          </View>

          <View style={{ gap: 14 }}>
            {editName ? (
              <Field dark label="Admin username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} textContentType="username" autoComplete="username" />
            ) : null}
            <Field
              dark
              label="Admin password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              returnKeyType="next"
              onSubmitEditing={() => codeRef.current?.focus()}
            />
            <Field
              ref={codeRef}
              dark
              label={backup ? 'Backup code' : '6-digit code from your authenticator'}
              value={code}
              onChangeText={(t) => setCode(backup ? t : t.replace(/\D/g, '').slice(0, 6).replace(/^(\d{3})(\d)/, '$1 $2'))}
              keyboardType={backup ? 'default' : 'number-pad'}
              autoCapitalize={backup ? 'characters' : 'none'}
              autoCorrect={false}
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={backup ? 40 : 7}
              inputStyle={backup ? undefined : { fontFamily: 'Outfit_500Medium', fontSize: 22, letterSpacing: 4, minHeight: 50 }}
              onSubmitEditing={() => void submit()}
            />
            {error ? (
              <Text size={13.5} color="#ff9b92" accessibilityLiveRegion="assertive">
                {error}
              </Text>
            ) : null}
            <Button label="Open Control" kind="gold" busy={busy} disabled={!ready} onPress={() => void submit()} />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setBackup(!backup)
                setCode('')
              }}
              style={{ alignSelf: 'center', padding: 10, minHeight: 44, justifyContent: 'center' }}
            >
              <Text size={14} weight="semi" color={c.gold}>
                {backup ? 'Use the 6-digit code' : 'Use a backup code'}
              </Text>
            </Pressable>
          </View>

          <View style={{ flex: 1 }} />
          <Text size={12.5} color={c.onVioletMuted} style={{ textAlign: 'center', lineHeight: 19 }}>
            Works from anywhere, only on this approved iPhone.{'\n'}Signs out after 30 minutes, or 5 minutes in the background.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

function CheckRow({ ok, label, value, onPress, hint }: { ok: boolean; label: string; value: string; onPress?: () => void; hint?: string }) {
  const body = (
    <>
      {ok ? <Icon name="check" size={18} color={c.onlineBright} width={2.4} /> : <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: c.onVioletMuted }} />}
      <Text size={14} color={c.onViolet} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text size={13} color={c.onVioletMuted} numberOfLines={1} style={{ maxWidth: '55%' }}>
        {value}
      </Text>
    </>
  )
  const style = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, minHeight: 28 }
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityHint={hint} onPress={onPress} style={style}>
      {body}
    </Pressable>
  ) : (
    <View style={style} accessibilityLabel={`${label}${ok ? ', checked' : ''}${value ? `, ${value}` : ''}`}>
      {body}
    </View>
  )
}
