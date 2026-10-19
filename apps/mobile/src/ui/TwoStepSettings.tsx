import { useEffect, useState } from 'react'
import { Platform, Share, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { cleanCode, TWO_STEP_CODE_LENGTH, type TwoStepMethod, type TwoStepStatus } from '@glofly/shared'
import { request } from '@/api/http'
import { BottomSheet, confirm, inform } from '@/ui/dialogs'
import { Button, Field, Notice, SectionLabel, Text } from '@/ui/kit'
import { SettingsRow } from '@/ui/SettingsRow'
import { useTheme } from '@/ui/theme'

// 0.7.3 Settings → Account → Two-step sign-in: a code by email (and by text once a phone is
// added) after the password. Backup codes for when neither can be reached, shown once.

type Sheet = { kind: 'start'; method: TwoStepMethod } | { kind: 'password'; action: 'off' | 'remove-phone' | 'backup-codes' } | { kind: 'codes'; codes: string[] } | null

export function TwoStepSection({ restricted }: { restricted?: boolean }) {
  const [status, setStatus] = useState<TwoStepStatus | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const load = () => void request<TwoStepStatus>('GET', '/account/two-step').then((r) => r.ok && setStatus(r.data))
  useEffect(load, [])
  if (!status || restricted) return null

  return (
    <>
      <SectionLabel>Two-step sign-in</SectionLabel>
      <Text size={13} tone="muted" style={{ paddingHorizontal: 20, paddingBottom: 6, lineHeight: 18 }}>
        {status.enabled
          ? "After your password, Glofly asks for a code sent to you. Someone who learns your password still can't get in."
          : "Add a code by email or text after your password, so a stolen password isn't enough to get into your account."}
      </Text>
      {status.enabled ? (
        <>
          <SettingsRow icon="shield" label="Two-step sign-in is on" detail={`Codes by email to ${status.email}${status.phone ? ` or by text to ${status.phone}` : ''}`} />
          {status.phone ? (
            <SettingsRow label="Stop texting codes" detail={`Codes go by email only (${status.email})`} onPress={() => setSheet({ kind: 'password', action: 'remove-phone' })} />
          ) : status.smsAvailable ? (
            <SettingsRow label="Get codes by text too" detail="Add a mobile number" onPress={() => setSheet({ kind: 'start', method: 'sms' })} />
          ) : null}
          <SettingsRow
            label="Backup codes"
            detail={`${status.backupCodesLeft} left · for when email and texts can't reach you`}
            onPress={() => setSheet({ kind: 'password', action: 'backup-codes' })}
          />
          <SettingsRow label="Turn off two-step sign-in" danger onPress={() => setSheet({ kind: 'password', action: 'off' })} />
        </>
      ) : (
        <SettingsRow
          icon="shield"
          label="Turn on two-step sign-in"
          detail={status.emailVerified ? `Codes by email to ${status.email}` : 'Confirm your email first'}
          disabled={!status.emailVerified}
          onPress={() => setSheet({ kind: 'start', method: 'email' })}
        />
      )}

      {sheet?.kind === 'start' ? (
        <StartSheet
          method={sheet.method}
          smsAvailable={status.smsAvailable}
          onClose={() => setSheet(null)}
          onDone={(s, codes) => {
            setStatus(s)
            setSheet(codes ? { kind: 'codes', codes } : null)
            if (!codes) void inform(sheet.method === 'sms' ? 'Codes by text are on' : 'Two-step sign-in is on')
          }}
        />
      ) : null}
      {sheet?.kind === 'password' ? (
        <PasswordSheet
          action={sheet.action}
          onClose={() => setSheet(null)}
          onDone={(s, codes) => {
            setStatus(s)
            setSheet(codes ? { kind: 'codes', codes } : null)
          }}
        />
      ) : null}
      {sheet?.kind === 'codes' ? <CodesSheet codes={sheet.codes} onClose={() => setSheet(null)} /> : null}
    </>
  )
}

function SheetForm({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  return (
    <BottomSheet onClose={onClose}>
      <View
        style={{
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 20,
          gap: 14,
        }}
      >
        <Text display size={22}>
          {title}
        </Text>
        {children}
      </View>
    </BottomSheet>
  )
}

/** Turning it on (email), or adding a phone: password → code → on. */
function StartSheet({ method, smsAvailable, onClose, onDone }: { method: TwoStepMethod; smsAvailable: boolean; onClose: () => void; onDone: (s: TwoStepStatus, codes: string[] | null) => void }) {
  const [step, setStep] = useState<'details' | 'code'>('details')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setBusy(true)
    setError(null)
    const r = await request<{ sentTo: string }>('POST', '/account/two-step/start', { method, password, ...(method === 'sms' ? { phone } : {}) })
    setBusy(false)
    if (!r.ok) return setError(r.message)
    setSentTo(r.data.sentTo)
    setStep('code')
  }
  async function confirmCode(value = code) {
    setBusy(true)
    setError(null)
    const r = await request<{
      status: TwoStepStatus
      backupCodes: string[] | null
    }>('POST', '/account/two-step/confirm', { code: cleanCode(value) })
    setBusy(false)
    if (!r.ok) {
      setCode('')
      return setError(r.message)
    }
    onDone(r.data.status, r.data.backupCodes)
  }

  return (
    <SheetForm title={method === 'sms' ? 'Get codes by text' : 'Turn on two-step sign-in'} onClose={onClose}>
      {error ? <Notice>{error}</Notice> : null}
      {step === 'details' ? (
        <>
          <Text size={15} tone="ink2" style={{ lineHeight: 22 }}>
            {method === 'sms'
              ? 'Codes will be texted to this number when you sign in. Standard text rates may apply.'
              : "Each time you sign in on a new device, we'll email you a 6-digit code to enter after your password."}
          </Text>
          {method === 'sms' ? (
            <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="(502) 555-0123" />
          ) : null}
          <Field label="Your password" value={password} onChangeText={setPassword} secure autoCapitalize="none" autoComplete="current-password" />
          <Button label="Send code" busy={busy} disabled={!password || (method === 'sms' && (!phone.trim() || !smsAvailable))} onPress={() => void send()} />
        </>
      ) : (
        <>
          <Text size={15} tone="ink2" style={{ lineHeight: 22 }}>
            We {method === 'sms' ? 'texted' : 'emailed'} a code to {sentTo}. Enter it to finish.
          </Text>
          <Field
            label="Code"
            value={code}
            autoFocus
            onChangeText={(t) => {
              const v = t.replace(/\D/g, '').slice(0, TWO_STEP_CODE_LENGTH)
              setCode(v)
              if (v.length === TWO_STEP_CODE_LENGTH && !busy) void confirmCode(v)
            }}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={TWO_STEP_CODE_LENGTH}
            style={{ fontSize: 24, letterSpacing: 8 }}
          />
          <Button label="Confirm" busy={busy} disabled={code.length !== TWO_STEP_CODE_LENGTH} onPress={() => void confirmCode()} />
          <Button label="Send it again" kind="ghost" onPress={() => setStep('details')} />
        </>
      )}
    </SheetForm>
  )
}

/** Turning it off, stopping texts, new backup codes: the password first. */
function PasswordSheet({ action, onClose, onDone }: { action: 'off' | 'remove-phone' | 'backup-codes'; onClose: () => void; onDone: (s: TwoStepStatus, codes: string[] | null) => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = action === 'off' ? 'Turn off two-step sign-in?' : action === 'remove-phone' ? 'Stop texting codes?' : 'New backup codes'
  const text =
    action === 'off'
      ? 'Your password alone will sign you in again. Your backup codes stop working.'
      : action === 'remove-phone'
        ? 'Your number is removed. Codes go to your email only.'
        : 'You get 10 new codes. The old ones stop working.'
  async function go() {
    setBusy(true)
    setError(null)
    const r = await request<TwoStepStatus | { status: TwoStepStatus; backupCodes: string[] }>('POST', `/account/two-step/${action}`, { password })
    setBusy(false)
    if (!r.ok) return setError(r.message)
    if ('backupCodes' in r.data) onDone(r.data.status, r.data.backupCodes)
    else onDone(r.data, null)
  }
  return (
    <SheetForm title={title} onClose={onClose}>
      <Text size={15} tone="ink2" style={{ lineHeight: 22 }}>
        {text}
      </Text>
      {error ? <Notice>{error}</Notice> : null}
      <Field label="Your password" value={password} onChangeText={setPassword} secure autoCapitalize="none" autoComplete="current-password" />
      <Button
        label={action === 'backup-codes' ? 'Make new codes' : action === 'off' ? 'Turn off' : 'Stop texting'}
        kind={action === 'off' ? 'danger' : 'primary'}
        busy={busy}
        disabled={!password}
        onPress={() => void go()}
      />
    </SheetForm>
  )
}

/** The backup codes, shown once. */
function CodesSheet({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const { c } = useTheme()
  const [copied, setCopied] = useState(false)
  const text = `Glofly backup codes (each works once):\n\n${codes.join('\n')}`
  async function close() {
    if (
      await confirm({
        title: 'Saved your codes?',
        message: "You won't see these again. If you lose them, you can make new ones in Settings.",
        confirmLabel: "I've saved them",
      })
    )
      onClose()
  }
  return (
    <SheetForm title="Save your backup codes" onClose={() => void close()}>
      <Text size={15} tone="ink2" style={{ lineHeight: 22 }}>
        If a code by email or text can't reach you, sign in with one of these instead. Each works once. Keep them somewhere safe, like a password manager.
      </Text>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          padding: 14,
          borderRadius: 14,
          backgroundColor: c.surface,
        }}
        accessibilityLabel={`Backup codes: ${codes.join(', ')}`}
      >
        {codes.map((code) => (
          <Text
            key={code}
            selectable
            size={17}
            weight="bold"
            style={{
              width: '46%',
              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              letterSpacing: 1,
            }}
          >
            {code}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button
          label={copied ? 'Copied' : 'Copy'}
          kind="secondary"
          icon="copy"
          style={{ flex: 1 }}
          onPress={() => {
            void Clipboard.setStringAsync(text)
            setCopied(true)
          }}
        />
        {Platform.OS !== 'web' ? <Button label="Share" kind="secondary" icon="share" style={{ flex: 1 }} onPress={() => void Share.share({ message: text })} /> : null}
      </View>
      <Button label="Done" onPress={() => void close()} />
    </SheetForm>
  )
}
