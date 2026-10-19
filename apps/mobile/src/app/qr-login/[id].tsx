import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { QR_ID_PATTERN, type QrLoginRequest } from '@glofly/shared'
import { request } from '@/api/http'
import { Screen } from '@/ui/Screen'
import { Button, Notice, Spinner, Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { useNow } from '@/lib/hooks'
import { useSession } from '@/state/session'

// 0.7.3 QR code sign-in: a computer's sign-in screen showed a QR code, this phone's camera opened
// it (glofly://qr-login/<id>). Approving signs that computer in as you. The phone always asks
// first, says which device is asking, and warns about codes sent by someone else.

type State =
  { kind: 'loading' } | { kind: 'ask'; req: QrLoginRequest } | { kind: 'busy'; req: QrLoginRequest } | { kind: 'done'; req: QrLoginRequest } | { kind: 'declined' } | { kind: 'gone'; message: string }

const appName = (app: QrLoginRequest['app']) => (app === 'web' ? 'Glofly in a browser' : 'Glofly Desktop')

/** One route for signed in and signed out (two routes at the same address confused the router). */
export default function QrLoginRoute() {
  const signedIn = useSession((s) => s.status === 'signedIn')
  return signedIn ? <QrLogin /> : <SignedOut />
}

function SignedOut() {
  return (
    <Screen title="Sign in on a computer" onBack={() => router.replace('/login')}>
      <View style={{ paddingHorizontal: 24, paddingTop: 20, gap: 20 }}>
        <Notice tone="info">Sign in to Glofly on this phone first, then scan the code on the computer again.</Notice>
        <Button label="Go to log in" onPress={() => router.replace('/login')} />
      </View>
    </Screen>
  )
}

function QrLogin() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { c } = useTheme()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const now = useNow(1000)

  useEffect(() => {
    if (!id || !QR_ID_PATTERN.test(id)) {
      setState({ kind: 'gone', message: "That isn't a Glofly sign-in code." })
      return
    }
    void request<QrLoginRequest>('GET', `/account/qr/${id}`).then((r) => {
      if (r.ok) setState({ kind: 'ask', req: r.data })
      else
        setState({
          kind: 'gone',
          message: r.message || 'That QR code has run out. Show a new one on the computer.',
        })
    })
  }, [id])

  const req = state.kind === 'ask' || state.kind === 'busy' || state.kind === 'done' ? state.req : null
  const left = req ? Math.max(0, Math.round((Date.parse(req.expiresAt) - now) / 1000)) : 0
  useEffect(() => {
    if (state.kind === 'ask' && left === 0)
      setState({
        kind: 'gone',
        message: 'That QR code has run out. Show a new one on the computer.',
      })
  }, [left, state.kind])

  async function decide(approve: boolean) {
    if (state.kind !== 'ask') return
    const asked = state.req
    if (approve) setState({ kind: 'busy', req: asked })
    const r = await request('POST', `/account/qr/${asked.id}/${approve ? 'approve' : 'decline'}`, {})
    if (!r.ok) {
      setState({
        kind: 'gone',
        message: r.message || 'That QR code has run out. Show a new one on the computer.',
      })
      return
    }
    setState(approve ? { kind: 'done', req: asked } : { kind: 'declined' })
    if (!approve) setTimeout(close, 1200)
  }
  const close = () => (router.canGoBack() ? router.back() : router.replace('/chats'))

  const device = req?.deviceName || (req ? appName(req.app) : '')
  return (
    <Screen title="Sign in on a computer" onBack={() => (state.kind === 'ask' ? void decide(false) : close())}>
      <View
        style={{
          paddingHorizontal: 24,
          paddingTop: 20,
          gap: 20,
          alignItems: 'stretch',
        }}
      >
        {state.kind === 'loading' ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            <Spinner />
          </View>
        ) : state.kind === 'gone' ? (
          <>
            <Notice>{state.message}</Notice>
            <Button label="OK" onPress={close} />
          </>
        ) : state.kind === 'declined' ? (
          <Notice tone="info">Cancelled. Nobody was signed in.</Notice>
        ) : state.kind === 'done' ? (
          <View style={{ alignItems: 'center', gap: 14, paddingTop: 24 }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: c.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" size={36} color={c.accent} />
            </View>
            <Text display size={24} style={{ textAlign: 'center' }} accessibilityRole="header">
              You're signed in
            </Text>
            <Text size={16} tone="muted" style={{ textAlign: 'center' }}>
              Glofly is open on {device}.
            </Text>
            <Button label="Done" onPress={close} style={{ alignSelf: 'stretch', marginTop: 10 }} />
          </View>
        ) : req ? (
          <>
            <View style={{ alignItems: 'center', gap: 12, paddingTop: 8 }}>
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 20,
                  backgroundColor: c.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="screen" size={34} color={c.accent} />
              </View>
              <Text display size={24} style={{ textAlign: 'center' }} accessibilityRole="header">
                Sign in on your computer?
              </Text>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text size={18} weight="bold" style={{ textAlign: 'center' }}>
                  {device}
                </Text>
                <Text size={14} tone="muted">
                  {appName(req.app)} · code works for {left}s
                </Text>
              </View>
            </View>
            <View
              style={{
                flexDirection: 'row',
                gap: 12,
                padding: 14,
                borderRadius: 14,
                backgroundColor: c.surface,
              }}
            >
              <Icon name="shield" size={22} color={c.danger} />
              <Text size={14} style={{ flex: 1, lineHeight: 20 }}>
                Only approve if you're signing in on a computer in front of you right now. If someone sent you this code or asked you to scan it, tap Cancel: they'd get into your account.
              </Text>
            </View>
            <Button label="Sign in" onPress={() => void decide(true)} busy={state.kind === 'busy'} />
            <Button label="Cancel" kind="secondary" onPress={() => void decide(false)} disabled={state.kind === 'busy'} />
          </>
        ) : null}
      </View>
    </Screen>
  )
}
