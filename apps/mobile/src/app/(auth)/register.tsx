import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  DISPLAY_NAME_MAX,
  PRIVACY_URL,
  STRENGTH_LABELS,
  TERMS_URL,
  birthdayProblem,
  colorsFor,
  displayNameProblem,
  initials,
  passwordProblem,
  strengthOf,
  usernameProblem,
  FRIEND_LINK_PATTERN,
  type SignupMode,
} from '@glofly/shared'
import { register, signupMode, usernameAvailable } from '@/api/auth'
import { friendLinkInfo, setAvatar } from '@/api/glofly'
import { AuthHero } from '@/ui/AuthHero'
import { Button, Checkbox, Field, Notice, Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { chooseFrom } from '@/ui/dialogs'
import { font, useTheme } from '@/ui/theme'
import { pickSquarePhoto } from '@/lib/photos'
import type { Upload } from '@/api/http'
import { BirthdayField } from '@/ui/BirthdayField'
import { APP_SETTINGS } from '@/lib/config'

type Check = { state: 'idle' | 'checking' | 'available' | 'taken'; message?: string }

export default function Register() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState<SignupMode>('open')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [birthday, setBirthday] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [terms, setTerms] = useState(false)
  const [photo, setPhoto] = useState<Upload | null>(null)
  const [check, setCheck] = useState<Check>({ state: 'idle' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const scroll = useRef<ScrollView>(null)
  const nameRef = useRef<TextInput>(null)
  const userRef = useRef<TextInput>(null)
  const passRef = useRef<TextInput>(null)

  useEffect(() => {
    void signupMode().then(setMode)
  }, [])

  // 0.8.0: signing up from a friend's invite link (glofly://i/<code> → Sign up): friends right away.
  const params = useLocalSearchParams<{ friend?: string }>()
  const friendCode = typeof params.friend === 'string' && FRIEND_LINK_PATTERN.test(params.friend) ? params.friend : null
  const [inviter, setInviter] = useState<{ name: string } | 'dead' | null>(null)
  useEffect(() => {
    if (!friendCode) return
    void friendLinkInfo(friendCode).then((r) => setInviter(r.ok ? { name: r.data.displayName } : 'dead'))
  }, [friendCode])

  // Live "Available" check, a moment after typing stops.
  useEffect(() => {
    const name = username.trim()
    if (!name) return setCheck({ state: 'idle' })
    const local = usernameProblem(name)
    if (local) return setCheck({ state: 'taken', message: local })
    setCheck({ state: 'checking' })
    const t = setTimeout(async () => {
      const r = await usernameAvailable(name)
      if (!r) return setCheck({ state: 'idle' })
      setCheck(r.available ? { state: 'available' } : { state: 'taken', message: r.reason ?? 'That username is taken.' })
    }, 400)
    return () => clearTimeout(t)
  }, [username])

  const strength = strengthOf(password)

  async function choosePhoto() {
    const choice = await chooseFrom(
      [
        { key: 'library', label: 'Choose a photo', icon: 'photo' },
        { key: 'camera', label: 'Take a photo', icon: 'camera' },
        ...(photo ? [{ key: 'remove', label: 'Remove photo', icon: 'trash' as const, danger: true }] : []),
      ],
      'Profile photo',
    )
    if (choice === 'remove') return setPhoto(null)
    if (choice !== 'library' && choice !== 'camera') return
    const picked = await pickSquarePhoto(choice)
    if (picked === 'denied') return setFormError(`Glofly needs camera access to take a photo. You can allow it in ${APP_SETTINGS}.`)
    if (picked) setPhoto(picked)
  }

  async function submit() {
    const e: Record<string, string> = {}
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) e.email = 'Enter your email address.'
    const u = usernameProblem(username.trim())
    if (u) e.username = u
    else if (check.state === 'taken') e.username = check.message ?? 'That username is taken.'
    const d = displayNameProblem(displayName.trim())
    if (d) e.displayName = d
    const p = passwordProblem(password)
    if (p) e.password = p
    const b = birthdayProblem(birthday)
    if (b) e.birthday = b
    if (mode === 'invite' && !inviteCode.trim()) e.inviteCode = 'Enter your invite code.'
    if (!terms) e.acceptTerms = 'Please agree to the Terms and Privacy Policy.'
    setErrors(e)
    setFormError(null)
    if (Object.keys(e).length) {
      scroll.current?.scrollTo({ y: 0, animated: true })
      return
    }
    setBusy(true)
    const result = await register({
      email: email.trim(),
      username: username.trim(),
      displayName: displayName.trim(),
      password,
      birthday,
      acceptTerms: true,
      ...(mode === 'invite' ? { inviteCode: inviteCode.trim() } : {}),
      ...(friendCode && inviter !== 'dead' ? { friendLink: friendCode } : {}),
    })
    if (!result.ok) {
      setBusy(false)
      setErrors(result.fields)
      if (result.message) setFormError(result.message)
      if (result.fields.form) setFormError(result.fields.form)
      scroll.current?.scrollTo({ y: 0, animated: true })
      return
    }
    // The photo goes up right after; if it fails, the account still works (add it later).
    if (photo) await setAvatar(photo).catch(() => null)
    setBusy(false)
  }

  const closed = mode === 'closed'
  const [bg, fg] = colorsFor(username || 'new')

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}>
        <AuthHero title="Join Glofly" subtitle="Your friends are a firefly away." onBack={() => router.back()} />
        <View style={{ paddingHorizontal: 24, paddingTop: 20, gap: 14 }}>
          {inviter && inviter !== 'dead' ? (
            <Notice tone="good">{`${inviter.name} invited you. Sign up and you'll be friends with ${inviter.name.trim().split(/\s+/)[0]} right away.`}</Notice>
          ) : inviter === 'dead' ? (
            <Notice tone="info">That invite link doesn't work anymore. You can still sign up and add your friend by username.</Notice>
          ) : null}
          {closed ? <Notice>Glofly isn't taking new sign-ups right now.</Notice> : null}
          {formError ? <Notice>{formError}</Notice> : null}
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => userRef.current?.focus()}
            submitBehavior="submit"
          />
          <Field
            ref={userRef}
            label="Username"
            prefix="@"
            value={username}
            onChangeText={(t) => setUsername(t.replace(/\s/g, ''))}
            error={errors.username ?? (check.state === 'taken' ? check.message : null)}
            good={check.state === 'available'}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username-new"
            maxLength={20}
            returnKeyType="next"
            onSubmitEditing={() => nameRef.current?.focus()}
            submitBehavior="submit"
            hint={
              check.state === 'available' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="check" size={15} color={c.onlineText} strokeWidth={3} />
                  <Text size={13} weight="bold" tone="online">
                    Available · it's yours forever
                  </Text>
                </View>
              ) : check.state === 'checking' ? (
                'Checking…'
              ) : (
                "Letters, numbers, periods and underscores. You can't change it later."
              )
            }
          />
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={photo ? 'Change profile photo' : 'Add a profile photo (optional)'}
              onPress={() => void choosePhoto()}
              style={{ marginTop: 22, width: 64, height: 64 }}
            >
              {photo ? (
                <Image source={{ uri: photo.uri }} style={{ width: 64, height: 64, borderRadius: 32 }} />
              ) : (
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: displayName.trim() ? bg : c.surface, alignItems: 'center', justifyContent: 'center' }}>
                  {displayName.trim() ? (
                    <Text style={{ color: fg, fontFamily: font.display, fontSize: 22 }}>{initials(displayName)}</Text>
                  ) : (
                    <Icon name="camera" size={24} color={c.muted} />
                  )}
                </View>
              )}
              <View style={{ position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: c.accent, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={photo ? 'pencil' : 'plus'} size={13} color={c.accentInk} strokeWidth={2.6} />
              </View>
            </Pressable>
            <Field
              ref={nameRef}
              label="Display name"
              value={displayName}
              onChangeText={setDisplayName}
              error={errors.displayName}
              maxLength={DISPLAY_NAME_MAX}
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              onSubmitEditing={() => passRef.current?.focus()}
              submitBehavior="submit"
              hint={photo ? 'Tap the photo to change it' : 'Add photo · optional'}
              containerStyle={{ flex: 1 }}
            />
          </View>
          <View style={{ gap: 8 }}>
            <Field
              ref={passRef}
              label="Password"
              value={password}
              onChangeText={setPassword}
              error={errors.password}
              secure
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
            />
            {password ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityLabel={`Password strength: ${STRENGTH_LABELS[strength]}`}>
                <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
                  {[1, 2, 3, 4].map((i) => (
                    <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= strength ? (strength >= 3 ? c.online : strength === 2 ? c.away : c.dnd) : c.line }} />
                  ))}
                </View>
                <Text size={13} weight="bold" style={{ color: strength >= 3 ? c.onlineText : strength === 2 ? c.ink2 : c.danger }}>
                  {STRENGTH_LABELS[strength]}
                </Text>
              </View>
            ) : null}
          </View>
          <BirthdayField value={birthday} onChange={setBirthday} error={errors.birthday} />
          {mode === 'invite' ? (
            <Field
              label="Invite code"
              value={inviteCode}
              onChangeText={(t) => setInviteCode(t.toUpperCase())}
              error={errors.inviteCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="GLOW-XXXX"
              hint="Glofly is invite only right now. Ask a friend who's on it."
            />
          ) : null}
          <View>
            <Checkbox value={terms} onChange={setTerms}>
              <Text size={14} tone="ink2" style={{ lineHeight: 20 }}>
                I agree to the{' '}
                <Text size={14} weight="bold" tone="accent" accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_URL)}>
                  Terms
                </Text>{' '}
                and{' '}
                <Text size={14} weight="bold" tone="accent" accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)}>
                  Privacy Policy
                </Text>
              </Text>
            </Checkbox>
            {errors.acceptTerms ? (
              <Text size={13} tone="danger" weight="medium">
                {errors.acceptTerms}
              </Text>
            ) : null}
          </View>
          <Button label="Create account" onPress={() => void submit()} busy={busy} disabled={closed} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
