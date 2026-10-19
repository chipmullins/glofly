import { useEffect, useRef, useState } from 'react'
import { Pressable, View, type TextInput } from 'react-native'
import { cleanCode, TWO_STEP_CODE_LENGTH, type TwoStepMethod } from '@glofly/shared'
import { loginWithCode, resendLoginCode, type TwoStepAsk } from '@/api/auth'
import { Button, Field, Notice, Text } from '@/ui/kit'
import { confirm } from '@/ui/dialogs'
import { longDate } from '@/lib/format'

// 0.7.3 two-step sign-in: after the right password, the 6-digit code sent by text or email
// (or one of the backup codes). Fills itself in from a text where the phone offers it.

const RESEND_AFTER = 30

const howSent = (m: TwoStepMethod) => (m === 'sms' ? 'texted' : 'emailed')
const otherWay = (m: TwoStepMethod) => (m === 'sms' ? 'Text it to me instead' : 'Email it to me instead')

export function TwoStepCode({ ask: first, keepSignedIn, onBack }: { ask: TwoStepAsk; keepSignedIn: boolean; onBack: () => void }) {
  const [ask, setAsk] = useState(first)
  const [code, setCode] = useState('')
  const [backup, setBackup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [wait, setWait] = useState(RESEND_AFTER)
  const input = useRef<TextInput>(null)
  const submitted = useRef('')

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  async function submit(value = code) {
    const clean = cleanCode(value)
    if (!backup && clean.length !== TWO_STEP_CODE_LENGTH) {
      setError(`Enter the ${TWO_STEP_CODE_LENGTH}-digit code.`)
      return
    }
    if (backup && clean.replace('-', '').length !== 8) {
      setError('Backup codes look like k7qp-2mzx.')
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    const r = await loginWithCode(ask.challenge, clean, keepSignedIn)
    setBusy(false)
    if (r.ok) return // the layout moves to the app
    if (r.reason === 'deletion_scheduled') {
      await confirm({
        title: 'This account is set to be deleted',
        message: `It will be deleted on ${r.deleteAfter ? longDate(r.deleteAfter) : 'soon'}. Go back and log in again, then choose Restore.`,
        confirmLabel: 'OK',
      })
      onBack()
      return
    }
    if (r.expired) {
      setError(r.message)
      setTimeout(onBack, 2500)
      return
    }
    setError(r.message)
    setCode('')
    submitted.current = ''
    input.current?.focus()
  }

  async function resend(method?: TwoStepMethod) {
    setError(null)
    setInfo(null)
    const r = await resendLoginCode(ask.challenge, method)
    if (!r.ok) {
      setError(r.message)
      if (r.expired) setTimeout(onBack, 2500)
      return
    }
    setAsk(r.twoStep)
    setWait(RESEND_AFTER)
    setCode('')
    setInfo(`New code ${howSent(r.twoStep.method)} to ${r.twoStep.sentTo}.`)
  }

  return (
    <View style={{ gap: 18 }}>
      <View style={{ gap: 6 }}>
        <Text display size={28} accessibilityRole="header">
          {backup ? 'Use a backup code' : 'Enter your code'}
        </Text>
        <Text size={15} tone="muted">
          {backup
            ? 'Type one of the backup codes you saved when you turned on two-step sign-in. Each one works once.'
            : `We ${howSent(ask.method)} a ${TWO_STEP_CODE_LENGTH}-digit code to ${ask.sentTo}. It works for 10 minutes.`}
        </Text>
      </View>
      {error ? <Notice>{error}</Notice> : info ? <Notice tone="good">{info}</Notice> : null}
      <Field
        ref={input}
        key={backup ? 'backup' : 'code'}
        label={backup ? 'Backup code' : 'Code'}
        value={code}
        autoFocus
        onChangeText={(t) => {
          const v = backup ? t.trim().slice(0, 9) : t.replace(/\D/g, '').slice(0, TWO_STEP_CODE_LENGTH)
          setCode(v)
          // The whole code (typed, pasted or filled in from the text): go straight on.
          if (!backup && v.length === TWO_STEP_CODE_LENGTH && submitted.current !== v && !busy) {
            submitted.current = v
            void submit(v)
          }
        }}
        placeholder={backup ? 'xxxx-xxxx' : '123456'}
        keyboardType={backup ? 'default' : 'number-pad'}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType={backup ? 'none' : 'oneTimeCode'}
        autoComplete={backup ? 'off' : 'sms-otp'}
        maxLength={backup ? 9 : TWO_STEP_CODE_LENGTH}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        style={backup ? undefined : { fontSize: 24, letterSpacing: 8 }}
      />
      <Button label="Sign in" onPress={() => void submit()} busy={busy} />
      <View style={{ gap: 4, alignItems: 'center' }}>
        {!backup ? (
          <Pressable accessibilityRole="button" disabled={wait > 0} onPress={() => void resend()} style={{ paddingVertical: 10 }}>
            <Text size={15} weight="bold" tone={wait > 0 ? 'faint' : 'accent'}>
              {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
            </Text>
          </Pressable>
        ) : null}
        {!backup
          ? ask.alternatives.map((m) => (
              <Pressable key={m} accessibilityRole="button" onPress={() => void resend(m)} style={{ paddingVertical: 10 }}>
                <Text size={15} weight="bold" tone="accent">
                  {otherWay(m)}
                </Text>
              </Pressable>
            ))
          : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setBackup((b) => !b)
            setCode('')
            setError(null)
            setInfo(null)
          }}
          style={{ paddingVertical: 10 }}
        >
          <Text size={15} weight="bold" tone="accent">
            {backup ? 'Use the code we sent instead' : 'Use a backup code'}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onBack} style={{ paddingVertical: 10 }}>
          <Text size={15} tone="muted">
            Back to log in
          </Text>
        </Pressable>
      </View>
    </View>
  )
}
