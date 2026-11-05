import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Animated, Pressable, View } from 'react-native'
import { router, usePathname } from 'expo-router'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { chatTitle, presenceLine, type PublicUser } from '@glofly/shared'
import * as Native from 'glofly-native'
import { useStore } from '@/state/store'
import { timer } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { answer, decline, hangUp, setMic, useCall } from './controller'
import { flyIn } from '@/constellations/transition'

// Over every screen: the incoming call card, the "call in progress" strip (when the call screen
// isn't showing), and short call messages ("Jacob didn't pick up.").

const QUICK_REPLIES = ["Can't talk right now. I'll call you back soon.", 'On my way!', 'Call you later?']

export function CallOverlay() {
  const incoming = useCall((s) => s.incoming)
  const toast = useCall((s) => s.toast)
  return (
    <>
      {incoming ? <IncomingCard /> : null}
      {toast ? <Toast text={toast} /> : null}
    </>
  )
}

function Rings() {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1600, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [v])
  return (
    <>
      {[0, 1].map((i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 60,
            borderWidth: 2,
            borderColor: '#FFA54A',
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.7 - i * 0.25, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1 + i * 0.15, 1.5 + i * 0.15] }) }],
          }}
        />
      ))}
    </>
  )
}

function IncomingCard() {
  const insets = useSafeAreaInsets()
  const incoming = useCall((s) => s.incoming)!
  const people = useStore((s) => s.people)
  const chat = useStore((s) => s.conversations[incoming.call.conversationId])
  const presence = useStore((s) => s.presence[incoming.call.callerId])
  const caller: PublicUser = incoming.caller ?? people[incoming.call.callerId] ?? { id: incoming.call.callerId, username: '', displayName: 'Someone', avatarVersion: null }
  const video = incoming.call.video
  const group = chat?.kind === 'group'
  // Ringing can turn the screen on over the lock screen (when it came from a notification).
  useEffect(() => () => Native.showOverLockScreen(false), [])
  const label = group ? `Incoming group ${video ? 'video' : 'voice'} call` : `Incoming ${video ? 'video' : 'voice'} call`
  return (
    <View style={{ position: 'absolute', inset: 0, zIndex: 50 }} accessibilityViewIsModal>
      <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(28,18,16,0.55)' }} />
      <View
        accessibilityLabel={`${label} from ${caller.displayName}`}
        style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 16, padding: 22, paddingTop: 30, borderRadius: 32, backgroundColor: '#1C1210', alignItems: 'center', gap: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}
      >
        <View style={{ width: 104, height: 104 }}>
          <Rings />
          <Avatar user={caller} size={104} />
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text size={13} weight="bold" style={{ color: '#F9B26B', letterSpacing: 1, textTransform: 'uppercase' }}>
            {label}
          </Text>
          <Text display size={28} style={{ color: '#FFF', textAlign: 'center' }}>
            {caller.displayName}
          </Text>
          <Text size={14} style={{ color: '#D9C2B1', textAlign: 'center' }}>
            {group && chat ? `${chatTitle(chat)} · ${caller.displayName.split(' ')[0]} is calling the group` : presenceLine(presence)}
          </Text>
        </View>
        <View style={{ alignSelf: 'stretch', gap: 10 }}>
          {video ? (
            <>
              <Pressable accessibilityRole="button" onPress={() => void answer(true)} style={{ height: 52, borderRadius: 26, backgroundColor: '#2E9E5B', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <Icon name="video" size={20} color="#FFF" />
                <Text size={16} weight="bold" style={{ color: '#FFF' }}>
                  Answer with video
                </Text>
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable accessibilityRole="button" onPress={() => void answer(false)} style={{ flex: 1, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: 'rgba(46,158,91,0.7)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text size={15} weight="bold" style={{ color: '#7DDBA3' }}>
                    Voice only
                  </Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => void decline()} style={{ flex: 1, height: 48, borderRadius: 24, backgroundColor: '#D33A2C', alignItems: 'center', justifyContent: 'center' }}>
                  <Text size={15} weight="bold" style={{ color: '#FFF' }}>
                    Decline
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable accessibilityRole="button" onPress={() => void decline()} style={{ flex: 1, height: 52, borderRadius: 26, backgroundColor: '#D33A2C', alignItems: 'center', justifyContent: 'center' }}>
                <Text size={16} weight="bold" style={{ color: '#FFF' }}>
                  Decline
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void answer(false)} style={{ flex: 1, height: 52, borderRadius: 26, backgroundColor: '#2E9E5B', alignItems: 'center', justifyContent: 'center' }}>
                <Text size={16} weight="bold" style={{ color: '#FFF' }}>
                  Answer
                </Text>
              </Pressable>
            </View>
          )}
        </View>
        {!group ? (
          <View style={{ alignSelf: 'stretch', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 10, gap: 8, alignItems: 'center' }}>
            <Text size={13} style={{ color: '#D9C2B1' }}>
              Decline with a message
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
              {QUICK_REPLIES.map((m) => (
                <Pressable key={m} accessibilityRole="button" accessibilityLabel={`Decline and send: ${m}`} onPress={() => void decline(m)} style={{ minHeight: 36, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: '#33231C' }}>
                  <Text size={13} style={{ color: '#F3E6DC' }}>
                    {m}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  )
}

/** The bar above every screen while you're in a call (it takes the status bar's space). */
export function CallStrip() {
  const insets = useSafeAreaInsets()
  const call = useCall((s) => s.call)!
  const micOn = useCall((s) => s.micOn)
  const voice = useCall((s) => s.voice)
  const chat = useStore((s) => s.conversations[call.conversationId])
  const now = useNow(1000)
  const title = voice ? `${voice.nebulaName} · ${voice.constellationName}` : chat ? chatTitle(chat) : 'Call'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={voice ? `In ${voice.nebulaName}. Tap to go back to it` : `Call with ${title}. Tap to go back to it`}
      // Glofly 2.0: a voice nebula's stage is on the night side.
      onPress={() => (voice ? flyIn(null, ['/constellations', '/constellations/voice']) : router.push('/call'))}
      style={{ paddingTop: insets.top + 4, paddingBottom: 6, height: insets.top + 58, backgroundColor: '#1C1210', flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 8, gap: 10 }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#3DBA6E', boxShadow: '0 0 8px 2px rgba(61,186,110,0.7)' }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={14} weight="bold" numberOfLines={1} style={{ color: '#FFF' }}>
          {title}
        </Text>
        <Text size={12} style={{ color: 'rgba(255,255,255,0.7)' }}>
          {voice ? 'Voice nebula' : call.answeredAt ? timer(call.answeredAt, now) : 'Ringing…'}
        </Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={micOn ? 'Mute microphone' : 'Unmute microphone'} onPress={() => void setMic(!micOn)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: micOn ? 'rgba(255,255,255,0.14)' : '#F3E6DC', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={micOn ? 'mic' : 'micOff'} size={18} color={micOn ? '#FFF' : '#1C1210'} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Hang up" onPress={() => void hangUp()} style={{ width: 52, height: 40, borderRadius: 20, backgroundColor: '#D33A2C', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="hangup" size={20} color="#FFF" fill="#FFF" />
      </Pressable>
    </Pressable>
  )
}

function Toast({ text }: { text: string }) {
  const insets = useSafeAreaInsets()
  return (
    <View pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: 'absolute', left: 24, right: 24, bottom: insets.bottom + 96, alignItems: 'center', zIndex: 60 }}>
      <View style={{ paddingHorizontal: 18, paddingVertical: 12, borderRadius: 22, backgroundColor: '#1C1210', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
        <Text size={14} weight="medium" style={{ color: '#FFF', textAlign: 'center' }}>
          {text}
        </Text>
      </View>
    </View>
  )
}

/** Puts the call strip above the app while a call goes on (and not on the call screen itself). */
// Nov 5, 2026 (Chip: typing in a chat during a call on iPhone, the keyboard covered the message
// box's buttons, so sending a lantern meant tapping empty space first): the call strip pushes the
// screen down, but KeyboardAvoidingView measures itself from its parent, not the screen's top, so it
// left out the strip's height and the box sat that much behind the keyboard. Screens with a message
// box pass this as their keyboardVerticalOffset.
const StripHeight = createContext(0)
/** How far the call strip pushes the screens down (0 without a call). */
export const useCallStripHeight = (): number => useContext(StripHeight)

export function WithCallStrip({ children }: { children: React.ReactNode }) {
  const call = useCall((s) => s.call)
  const voice = useCall((s) => !!s.voice)
  const path = usePathname()
  const insets = useSafeAreaInsets()
  // Glofly 2.0: on the night side a voice nebula has its own green bar (and its stage).
  const night = path === '/constellations' || path.startsWith('/constellations/')
  const [stripH, setStripH] = useState(0)
  if (!call || path === '/call' || (voice && night)) return <>{children}</>
  return (
    <View style={{ flex: 1 }}>
      <View onLayout={(e) => setStripH(Math.round(e.nativeEvent.layout.height))}>
        <CallStrip />
      </View>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <StripHeight.Provider value={stripH}>
          <View style={{ flex: 1 }}>{children}</View>
        </StripHeight.Provider>
      </SafeAreaInsetsContext.Provider>
    </View>
  )
}
