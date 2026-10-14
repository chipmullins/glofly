import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { STRENGTH_LABELS, passwordProblem, strengthOf, type SignedInDevice } from '@glofly/shared'
import * as api from '@/api/glofly'
import { request } from '@/api/http'
import { logout } from '@/api/auth'
import { useSession, endSessionLocally } from '@/state/session'
import { refreshAccount, resendConfirm, useAccount } from '@/state/account'
import { longDate, listTime } from '@/lib/format'
import { Avatar } from '@/ui/Avatar'
import { BottomSheet, confirm, inform } from '@/ui/dialogs'
import { Button, Checkbox, Field, Notice, SectionLabel, Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { SettingsRow } from '@/ui/SettingsRow'
import { useTheme } from '@/ui/theme'

type Sheet = 'email' | 'password' | 'delete' | null

export default function Account() {
  const { c } = useTheme()
  const user = useSession((s) => s.user)
  const account = useAccount((s) => s.account)
  const [sessions, setSessions] = useState<SignedInDevice[]>([])
  const [sheet, setSheet] = useState<Sheet>(null)

  const loadSessions = () => void api.listSessions().then((r) => r.ok && setSessions(r.data))
  useEffect(() => {
    void refreshAccount()
    loadSessions()
  }, [])

  async function signOutDevice(d: SignedInDevice) {
    if (!(await confirm({ title: `Sign out ${d.deviceName ?? 'that device'}?`, confirmLabel: 'Sign out' }))) return
    const r = await request('DELETE', `/account/sessions/${d.id}`)
    if (!r.ok) void inform("Couldn't sign it out", r.message)
    loadSessions()
  }

  async function cancelEmailChange() {
    const r = await request('DELETE', '/account/email/pending')
    if (!r.ok) void inform("Couldn't cancel it", r.message)
    void refreshAccount()
  }

  if (!user) return null
  return (
    <Screen title="Account">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20 }}>
        <Avatar user={user} size={56} />
        <View style={{ flex: 1 }}>
          <Text size={18} weight="bold">
            @{user.username}
          </Text>
          <Text size={13} tone="muted">
            Usernames are permanent{account ? ` · Joined ${longDate(account.createdAt)}` : ''}
          </Text>
        </View>
      </View>

      <SectionLabel>Sign-in</SectionLabel>
      <SettingsRow
        icon="mail"
        label="Email"
        detail={account ? (account.pendingEmail ? `${account.email} · waiting for you to confirm ${account.pendingEmail}` : account.email) : '…'}
        right={
          account ? (
            <View style={{ paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: account.emailVerified ? c.onlineSoft : c.surface, justifyContent: 'center' }}>
              <Text size={12} weight="bold" style={{ color: account.emailVerified ? c.onlineText : c.muted }}>
                {account.emailVerified ? 'Confirmed' : 'Not confirmed'}
              </Text>
            </View>
          ) : undefined
        }
      />
      {account && !account.emailVerified ? <SettingsRow label="Resend confirm link" onPress={() => void resendConfirm()} /> : null}
      {account?.restricted ? null : account?.pendingEmail ? (
        <SettingsRow label="Cancel email change" onPress={() => void cancelEmailChange()} />
      ) : (
        <SettingsRow label="Change email" onPress={() => setSheet('email')} />
      )}
      <SettingsRow icon="key" label="Change password" onPress={() => setSheet('password')} />

      <SectionLabel>Devices</SectionLabel>
      <Text size={13} tone="muted" style={{ paddingHorizontal: 20, paddingBottom: 6 }}>
        Where you're signed in
      </Text>
      {sessions.map((d) => (
        <SettingsRow
          key={d.id}
          label={d.current ? `This phone${d.deviceName ? ` · ${d.deviceName}` : ''}` : (d.deviceName ?? 'Unknown device')}
          detail={d.online ? 'Online now' : `Active ${listTime(d.lastUsedAt)}`}
          right={d.current ? undefined : <Button label="Sign out" kind="secondary" compact onPress={() => void signOutDevice(d)} />}
        />
      ))}

      <SectionLabel>Danger zone</SectionLabel>
      <SettingsRow icon="logout" label="Log out" onPress={() => void logout()} />
      {account?.restricted ? (
        <Text size={13} tone="muted" style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
          Your account is managed by your family, so they take care of changing your email or deleting the account.
        </Text>
      ) : (
        <SettingsRow icon="trash" label="Delete account" detail="Hidden right away, removed for good after 30 days" danger onPress={() => setSheet('delete')} />
      )}

      {sheet === 'email' ? <ChangeEmail onClose={() => setSheet(null)} /> : null}
      {sheet === 'password' ? <ChangePassword onClose={() => setSheet(null)} /> : null}
      {sheet === 'delete' ? <DeleteAccount onClose={() => setSheet(null)} /> : null}
    </Screen>
  )
}

function SheetForm({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  return (
    <BottomSheet onClose={onClose}>
      <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 20, gap: 14 }}>
        <Text display size={22}>
          {title}
        </Text>
        {children}
      </View>
    </BottomSheet>
  )
}

function ChangeEmail({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    setBusy(true)
    setError(null)
    const r = await request('POST', '/account/email', { newEmail: email.trim(), password })
    setBusy(false)
    if (!r.ok) return setError(r.fields ? Object.values(r.fields)[0] : r.message)
    void refreshAccount()
    onClose()
    void inform('Check your new email', `We sent a confirm link to ${email.trim()}. Your email changes when you click it.`)
  }
  return (
    <SheetForm title="Change email" onClose={onClose}>
      {error ? <Notice>{error}</Notice> : null}
      <Field label="New email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Field label="Your password" value={password} onChangeText={setPassword} secure autoCapitalize="none" />
      <Button label="Send confirm link" busy={busy} disabled={!email.trim() || !password} onPress={() => void save()} />
    </SheetForm>
  )
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [others, setOthers] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const strength = strengthOf(next)
  async function save() {
    const problem = passwordProblem(next)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const r = await api.changePassword(current, next, others)
    setBusy(false)
    if (!r.ok) return setError(r.fields ? Object.values(r.fields)[0] : r.message)
    onClose()
    void inform('Password changed', others ? 'Your other devices were signed out.' : undefined)
  }
  return (
    <SheetForm title="Change password" onClose={onClose}>
      {error ? <Notice>{error}</Notice> : null}
      <Field label="Current password" value={current} onChangeText={setCurrent} secure autoCapitalize="none" autoComplete="current-password" />
      <Field label="New password" value={next} onChangeText={setNext} secure autoCapitalize="none" autoComplete="new-password" />
      {next ? (
        <Text size={13} weight="bold" style={{ color: strength >= 3 ? c.onlineText : c.muted }}>
          {STRENGTH_LABELS[strength]}
        </Text>
      ) : null}
      <Checkbox value={others} onChange={setOthers}>
        <Text size={15}>Sign out of all other devices</Text>
      </Checkbox>
      <Button label="Change password" busy={busy} disabled={!current || !next} onPress={() => void save()} />
    </SheetForm>
  )
}

function DeleteAccount({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function del() {
    setBusy(true)
    setError(null)
    const r = await api.deleteAccount(password)
    setBusy(false)
    if (!r.ok) return setError(r.fields ? Object.values(r.fields)[0] : r.message)
    onClose()
    await endSessionLocally(`Your account is set to be deleted on ${longDate(r.data.deleteAfter)}. Log in before then to keep it.`)
  }
  return (
    <SheetForm title="Delete your account?" onClose={onClose}>
      <Text size={15} tone="ink2" style={{ lineHeight: 22 }}>
        Your account is hidden right away and you're signed out everywhere. After 30 days it's removed for good: your profile, photo, friends and chats. Log in before then to keep it.
      </Text>
      {error ? <Notice>{error}</Notice> : null}
      <Field label="Your password" value={password} onChangeText={setPassword} secure autoCapitalize="none" />
      <Button label="Delete account" kind="danger" busy={busy} disabled={!password} onPress={() => void del()} />
    </SheetForm>
  )
}
