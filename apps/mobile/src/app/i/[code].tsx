import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { FRIEND_LINK_DEAD, FRIEND_LINK_PATTERN, type FriendLinkPreview } from '@glofly/shared'
import * as api from '@/api/glofly'
import { openDmWith } from '@/lib/chatActions'
import { refreshFriends } from '@/state/sync'
import { useSession } from '@/state/session'
import { Avatar } from '@/ui/Avatar'
import { Screen } from '@/ui/Screen'
import { Button, Notice, Spinner, Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'

// 0.8.0: a friend's invite link opened on this phone (glofly://i/<code> from "Open in Glofly" on
// glofly.app/i/<code>). Signed in: "Add Chip as a friend?" (nothing happens until you say yes).
// Signed out: sign up from the link (you'll be friends right away) or log in first.

type State =
  | { kind: 'loading' }
  | { kind: 'ask'; preview: FriendLinkPreview }
  | { kind: 'busy'; preview: FriendLinkPreview }
  | { kind: 'done'; preview: FriendLinkPreview }
  | { kind: 'gone'; message: string }

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

/** One route for signed in and signed out (like qr-login). */
export default function FriendLinkRoute() {
  const signedIn = useSession((s) => s.status === 'signedIn')
  const { code } = useLocalSearchParams<{ code: string }>()
  const valid = typeof code === 'string' && FRIEND_LINK_PATTERN.test(code)
  if (!valid) return <Gone message={FRIEND_LINK_DEAD} />
  return signedIn ? <AddThroughLink code={code} /> : <SignedOut code={code} />
}

const close = () => (router.canGoBack() ? router.back() : router.replace('/'))

function Gone({ message }: { message: string }) {
  return (
    <Screen title="Invite link" onBack={close}>
      <View style={{ paddingHorizontal: 24, paddingTop: 20, gap: 20 }}>
        <Notice tone="info">{message}</Notice>
        <Button label="OK" onPress={close} />
      </View>
    </Screen>
  )
}

function SignedOut({ code }: { code: string }) {
  const [name, setName] = useState<string | null>(null)
  const [dead, setDead] = useState(false)
  useEffect(() => {
    void api.friendLinkInfo(code).then((r) => {
      if (r.ok) setName(r.data.displayName)
      else setDead(true)
    })
  }, [code])
  if (dead) return <Gone message={FRIEND_LINK_DEAD} />
  return (
    <Screen title="Invite link" onBack={() => router.replace('/login')}>
      <View style={{ paddingHorizontal: 24, paddingTop: 20, gap: 16 }}>
        <Text display size={26} accessibilityRole="header">
          {name ? `Join ${firstName(name)} on Glofly` : 'You’re invited'}
        </Text>
        <Text size={16} tone="muted" style={{ lineHeight: 22 }}>
          {name ? `Sign up and you and ${firstName(name)} are friends right away. Already have an account? Log in, then open the link again.` : ' '}
        </Text>
        <Button label="Sign up" onPress={() => router.push({ pathname: '/register', params: { friend: code } })} />
        <Button label="Log in" kind="secondary" onPress={() => router.replace('/login')} />
      </View>
    </Screen>
  )
}

function AddThroughLink({ code }: { code: string }) {
  const { c } = useTheme()
  const restricted = useSession((s) => s.user?.restricted === true)
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    if (restricted) {
      setState({ kind: 'gone', message: 'Your account is managed by your family, so they add your friends for you.' })
      return
    }
    void api.previewFriendLink(code).then((r) => {
      if (r.ok) setState({ kind: r.data.relationship === 'friends' ? 'done' : 'ask', preview: r.data })
      else setState({ kind: 'gone', message: r.message || FRIEND_LINK_DEAD })
    })
  }, [code, restricted])

  async function add() {
    if (state.kind !== 'ask') return
    const preview = state.preview
    setState({ kind: 'busy', preview })
    const r = await api.acceptFriendLink(code)
    if (r.ok) {
      setState({ kind: 'done', preview: { ...preview, relationship: 'friends' } })
      void refreshFriends()
    } else setState({ kind: 'gone', message: r.message })
  }

  if (state.kind === 'gone') return <Gone message={state.message} />
  const preview = state.kind === 'loading' ? null : state.preview
  const who = preview?.user
  const self = preview?.relationship === 'self'
  return (
    <Screen title="Invite link" onBack={close}>
      {!who ? (
        <View style={{ paddingTop: 80, alignItems: 'center' }}>
          <Spinner />
        </View>
      ) : (
        <View style={{ paddingHorizontal: 24, paddingTop: 28, gap: 14, alignItems: 'center' }}>
          <View style={{ borderRadius: 60, shadowColor: c.accent, shadowOpacity: 0.45, shadowRadius: 22, shadowOffset: { width: 0, height: 0 }, elevation: 6 }}>
            <Avatar user={who} size={96} />
          </View>
          <Text display size={26} style={{ textAlign: 'center' }} accessibilityRole="header">
            {self ? 'This is your invite link' : state.kind === 'done' ? `You and ${firstName(who.displayName)} are friends` : `Add ${firstName(who.displayName)} as a friend?`}
          </Text>
          <Text size={15} tone="muted" style={{ textAlign: 'center' }}>
            {self ? 'Share it with friends. You’ll automatically be friends as soon as they join.' : `${who.displayName} · @${who.username}`}
          </Text>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 10 }}>
            {self ? (
              <Button label="OK" onPress={close} />
            ) : state.kind === 'done' ? (
              <>
                <Button label="Say hi" icon="chatsLine" onPress={() => void openDmWith(who.id)} />
                <Button label="Done" kind="secondary" onPress={close} />
              </>
            ) : (
              <>
                <Button label="Add friend" icon="addPerson" busy={state.kind === 'busy'} onPress={() => void add()} />
                <Button label="Not now" kind="secondary" disabled={state.kind === 'busy'} onPress={close} />
              </>
            )}
          </View>
        </View>
      )}
    </Screen>
  )
}
