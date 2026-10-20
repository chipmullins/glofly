import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { STATUS_TEXT_MAX } from '@glofly/shared'
import * as api from '@/api/glofly'
import { refreshMe } from '@/api/auth'
import { useSession } from '@/state/session'
import { refreshFriends, refreshStatus } from '@/state/sync'
import { pickSquarePhoto } from '@/lib/photos'
import { prefs } from '@/lib/storage'
import { APP_SETTINGS } from '@/lib/config'
import { finishWelcome, resumeWelcome, useWelcome } from '@/lib/welcome'
import { Avatar } from './Avatar'
import { chooseFrom, inform } from './dialogs'
import { Button, Field, Notice, Text } from './kit'
import { ACCENTS, useTheme, useThemeChoice, type AccentChoice, type ThemeChoice } from './theme'
import { riseIn } from './motion'

// 0.7.5 welcome flow on phones (Welcome.dc.html, approved Oct 20): the same three steps as the
// desktop app, full screen after a new account is made: a photo and what you're up to, your look
// (applied as you pick), and your first friend. Skip for now on every step. Every button follows
// the accent you pick. (No QR card here: you're already on your phone.)

const THEMES: { key: ThemeChoice; label: string }[] = [
  { key: 'system', label: 'Match my phone' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
]
const FIVE = ACCENTS.filter((a) => a.key !== 'graphite')

type Note = { tone: 'good' | 'danger'; text: string } | null

/** Mounted once in the signed-in layout; shows itself for a new account. */
export function WelcomeFlowHost() {
  const user = useSession((s) => s.user)
  const waiting = useWelcome((s) => s.userId)
  useEffect(() => {
    if (user) void resumeWelcome(user.id)
  }, [user?.id])
  if (!user || waiting !== user.id || user.restricted) return null
  return <WelcomeFlow />
}

function WelcomeFlow() {
  const { c, dark } = useTheme()
  const insets = useSafeAreaInsets()
  const user = useSession((s) => s.user)!
  const theme = useThemeChoice((s) => s.choice)
  const accent = useThemeChoice((s) => s.accent)
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const first = user.displayName.trim().split(/\s+/)[0] || user.username

  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoNote, setPhotoNote] = useState<Note>(null)
  const [statusText, setStatusText] = useState('')
  const [username, setUsername] = useState('')
  const [adding, setAdding] = useState(false)
  const [friendNote, setFriendNote] = useState<Note>(null)
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteNote, setInviteNote] = useState<Note>(null)

  const done = () => void finishWelcome(user.id)
  useEffect(() => {
    if (step !== 4) return
    const t = setTimeout(done, 1600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  async function photo() {
    const pick = await chooseFrom(
      [
        { key: 'library', label: 'Choose a photo', icon: 'photo' },
        { key: 'camera', label: 'Take a photo', icon: 'camera' },
      ],
      'Profile photo',
    )
    if (pick !== 'library' && pick !== 'camera') return
    const picked = await pickSquarePhoto(pick)
    if (picked === 'denied') return void inform('Camera not allowed', `Allow Glofly to use the camera in ${APP_SETTINGS}.`)
    if (!picked) return
    setPhotoBusy(true)
    const r = await api.setAvatar(picked)
    if (r.ok) await refreshMe()
    setPhotoBusy(false)
    setPhotoNote(r.ok ? { tone: 'good', text: 'Looking good!' } : { tone: 'danger', text: r.message })
  }

  function next() {
    if (step === 1 && statusText.trim()) {
      // Saved quietly: a problem here never stops the welcome.
      void api.setMyStatus({ statusText: statusText.trim() }).then(() => refreshStatus())
    }
    setStep((s) => (s < 4 ? ((s + 1) as 2 | 3 | 4) : s))
  }

  function pickTheme(t: ThemeChoice) {
    useThemeChoice.getState().set(t)
    void prefs.set('theme', t)
  }
  function pickAccent(a: AccentChoice) {
    useThemeChoice.getState().setAccent(a)
    void prefs.set('accent', a)
  }

  async function addFriend() {
    const name = username.trim().replace(/^@/, '')
    if (!name || adding) return
    setAdding(true)
    setFriendNote(null)
    const r = await api.sendFriendRequest(name)
    setAdding(false)
    if (r.ok) {
      setFriendNote({ tone: 'good', text: r.data.status === 'accepted' ? `You and @${name} are friends now!` : `Request sent to @${name}. They’ll show up once they accept.` })
      setUsername('')
      void refreshFriends()
    } else setFriendNote({ tone: 'danger', text: r.message })
  }

  async function invite() {
    const address = email.trim()
    if (!address || inviting) return
    setInviting(true)
    setInviteNote(null)
    const r = await api.inviteFriend(address)
    setInviting(false)
    if (r.ok) {
      setInviteNote({ tone: 'good', text: `Invite sent to ${address}.` })
      setEmail('')
    } else setInviteNote({ tone: 'danger', text: r.message })
  }

  const note = (n: Note) => (n ? <Notice tone={n.tone === 'good' ? 'good' : 'danger'}>{n.text}</Notice> : null)

  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.bg, zIndex: 50 }} accessibilityViewIsModal>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', gap: 8 }} accessible accessibilityLabel={`Step ${Math.min(step, 3)} of 3`}>
            {[1, 2, 3].map((n) => (
              <View key={n} style={{ height: 8, width: n === step ? 28 : 8, borderRadius: 4, backgroundColor: n <= step ? c.accent : c.line }} />
            ))}
          </View>
          {step < 4 ? (
            <Pressable accessibilityRole="button" onPress={done} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text tone="muted" weight="medium" size={15}>
                Skip for now
              </Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingTop: 20, gap: 20, flexGrow: 1 }}>
          <Animated.View key={step} entering={riseIn} style={{ gap: 20 }}>
            {step === 1 ? (
              <>
                <View style={{ gap: 6 }}>
                  <Text display size={30} accessibilityRole="header">
                    Welcome to Glofly, {first}!
                  </Text>
                  <Text tone="muted" size={16}>
                    Let’s make it feel like you. This takes about a minute.
                  </Text>
                </View>
                <View style={{ alignItems: 'center', gap: 12 }}>
                  <View style={{ borderRadius: 60, padding: 4, backgroundColor: c.accentSoft }}>
                    <Avatar user={user} size={104} />
                  </View>
                  <Button compact label={photoBusy ? 'Saving…' : user.avatarVersion ? 'Change profile photo' : 'Add a profile photo'} busy={photoBusy} icon="camera" onPress={() => void photo()} />
                  <Text tone="muted" size={14} style={{ textAlign: 'center' }}>
                    Friends see it in chats and calls. You can change it any time.
                  </Text>
                  {note(photoNote)}
                </View>
                <Field label="What are you up to? (optional)" value={statusText} onChangeText={setStatusText} placeholder="Grinding ranked tonight" maxLength={STATUS_TEXT_MAX} returnKeyType="next" onSubmitEditing={next} />
              </>
            ) : null}

            {step === 2 ? (
              <>
                <View style={{ gap: 6 }}>
                  <Text display size={30} accessibilityRole="header">
                    Pick your look
                  </Text>
                  <Text tone="muted" size={16}>
                    Change it later in Settings.
                  </Text>
                </View>
                <View accessibilityRole="radiogroup" accessibilityLabel="Theme" style={{ flexDirection: 'row', gap: 10 }}>
                  {THEMES.map((t) => {
                    const on = theme === t.key
                    const art = t.key === 'dark' ? ['#1D1715', '#161110', '#3A302A'] : t.key === 'light' ? ['#FFFFFF', '#F7F0E9', '#EFE4DA'] : ['#FFFFFF', '#F7F0E9', '#3A302A']
                    return (
                      <Pressable key={t.key} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t.label} onPress={() => pickTheme(t.key)} style={{ flex: 1, borderWidth: 2, borderColor: on ? c.accent : c.line, borderRadius: 16, padding: 8, gap: 8, backgroundColor: dark ? c.surface : '#FFFFFF' }}>
                        <View style={{ height: 70, borderRadius: 10, overflow: 'hidden', backgroundColor: art[0], borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' }}>
                          {t.key === 'system' ? <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', backgroundColor: '#1D1715' }} /> : null}
                          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '30%', backgroundColor: art[1] }} />
                          <View style={{ position: 'absolute', right: 8, top: 14, width: '42%', height: 10, borderRadius: 5, backgroundColor: art[2] }} />
                          <View style={{ position: 'absolute', right: 8, top: 32, width: '28%', height: 10, borderRadius: 5, backgroundColor: c.accent }} />
                        </View>
                        <Text size={13} weight="bold" style={{ color: dark ? c.ink : '#24170F' }}>
                          {t.label}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
                <View style={{ gap: 10 }}>
                  <Text size={14} weight="bold" tone="ink2">
                    Accent
                  </Text>
                  <View accessibilityRole="radiogroup" accessibilityLabel="Accent color" style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
                    {FIVE.map((a) => {
                      const on = accent === a.key
                      return (
                        <Pressable key={a.key} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={a.label} onPress={() => pickAccent(a.key)} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: a.swatch, borderWidth: 3, borderColor: on ? c.ink : c.bg, boxShadow: on ? undefined : `0 0 0 1px ${c.line}` }} />
                      )
                    })}
                  </View>
                </View>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <View style={{ gap: 6 }}>
                  <Text display size={30} accessibilityRole="header">
                    Find your friends
                  </Text>
                  <Text tone="muted" size={16}>
                    Glofly is only about the people you add. Start with one.
                  </Text>
                </View>
                <View style={{ gap: 10 }}>
                  <Field label="Their username" value={username} onChangeText={setUsername} placeholder="Like @maya" autoCapitalize="none" autoCorrect={false} returnKeyType="send" onSubmitEditing={() => void addFriend()} />
                  <Button compact label="Add friend" icon="addPerson" busy={adding} disabled={!username.trim()} onPress={() => void addFriend()} />
                  {note(friendNote)}
                </View>
                <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: 18, padding: 16, gap: 10 }}>
                  <Text weight="bold" size={16}>
                    Not on Glofly yet?
                  </Text>
                  <Text tone="muted" size={14}>
                    Send your invite link. You’ll automatically be friends as soon as they join.
                  </Text>
                  <Field label="Their email" value={email} onChangeText={setEmail} placeholder="friend@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} returnKeyType="send" onSubmitEditing={() => void invite()} />
                  <Button compact kind="secondary" label="Email an invite link" icon="send" busy={inviting} disabled={!email.trim()} onPress={() => void invite()} />
                  {note(inviteNote)}
                </View>
              </>
            ) : null}

            {step === 4 ? (
              <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 18 }} accessibilityLiveRegion="polite">
                <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.accent, boxShadow: `0 0 26px 12px ${c.glow}` }} />
                <Text display size={28} style={{ textAlign: 'center' }}>
                  You’re all set. Glow on!
                </Text>
              </View>
            ) : null}
          </Animated.View>
        </ScrollView>

        {step < 4 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 12, paddingBottom: insets.bottom + 16, borderTopWidth: 1, borderTopColor: c.line }}>
            <Pressable accessibilityRole="button" onPress={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))} disabled={step === 1} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 6, opacity: step === 1 ? 0 : 1 }}>
              <Text weight="bold" size={16} tone="ink2">
                Back
              </Text>
            </Pressable>
            <Button compact label={step === 3 ? 'Start chatting' : 'Next'} onPress={next} />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Animated.View>
  )
}
