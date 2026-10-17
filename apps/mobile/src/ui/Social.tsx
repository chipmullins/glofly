import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { glowLabel, HANG_MINUTES, type Glow, type PublicUser } from '@glofly/shared'
import * as api from '@/api/glofly'
import { startCallIn } from '@/calls/controller'
import { openDmWith } from '@/lib/chatActions'
import { useNow } from '@/lib/hooks'
import { refreshSocial, useSocial } from '@/state/social'
import { useStore } from '@/state/store'
import { useSession } from '@/state/session'
import { Avatar } from './Avatar'
import { BottomSheet, inform } from './dialogs'
import { Icon } from './icons'
import { Button, Checkbox, Text, webNoOutline } from './kit'
import { font, useTheme } from './theme'

// 0.5.0 social extras on phones: glows by friends' names, "Want to hang?", birthdays and who's
// live (a row of faces at the top of Chats), and birthday confetti in a friend's chat.

const GLOW = '#FFC65A'
const LIVE = '#D33A2C'

/** The little firefly by a friend's name: brighter each day you both write. */
export function GlowMark({ glow, big }: { glow: Glow; big?: boolean }) {
  const d = big ? 12 : 10
  const blur = 2 + glow.level * 2
  return (
    <View accessible accessibilityLabel={`${glowLabel(glow)}${glow.litToday ? ', lit today' : ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: glow.level >= 5 ? '#FFE08A' : GLOW, opacity: 0.55 + glow.level * 0.09, boxShadow: `0 0 ${blur}px rgba(255,160,50,${0.4 + glow.level * 0.1})` }} />
      <Text size={big ? 13 : 12} weight="bold" style={{ color: '#C4700A' }}>
        {big ? glowLabel(glow) : glow.days}
      </Text>
    </View>
  )
}

export function BirthdayMark() {
  return (
    <Text size={14} accessibilityLabel="Birthday today">
      🎂
    </Text>
  )
}

function minutesLeft(until: string, now: number): number {
  return Math.min(HANG_MINUTES, Math.max(1, Math.ceil((new Date(until).getTime() - now) / 60_000)))
}

/** The row of faces at the top of Chats: Want to hang?, who's live, free to hang, birthdays. */
export function SocialStrip() {
  const { c } = useTheme()
  const now = useNow(30_000)
  const social = useSocial()
  const friends = useStore((s) => s.friends.friends)
  const meId = useSession((s) => s.user?.id ?? '')
  const [picking, setPicking] = useState(false)
  const byId = useMemo(() => new Map(friends.map((f) => [f.id, f])), [friends])
  const live = social.broadcasts.filter((b) => b.userId !== meId && byId.has(b.userId))
  const hanging = social.hanging.filter((h) => new Date(h.until).getTime() > now && byId.has(h.userId))
  const birthdays = social.birthdays.filter((id) => byId.has(id))
  const mine = social.myHang && new Date(social.myHang.until).getTime() > now ? social.myHang : null

  const face = (key: string, p: PublicUser, ring: string, label: string, sub: string | null, onPress: () => void, badge?: string) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${p.displayName}, ${label}`} onPress={onPress} style={{ width: 70, alignItems: 'center', gap: 4 }}>
      <View style={{ padding: 2.5, borderRadius: 34, borderWidth: 2.5, borderColor: ring }}>
        <Avatar user={p} size={50} />
      </View>
      {badge ? (
        <View style={{ position: 'absolute', top: 44, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: ring }}>
          <Text size={10} weight="bold" style={{ color: '#FFFFFF', letterSpacing: 0.6 }}>
            {badge}
          </Text>
        </View>
      ) : null}
      <Text size={12} numberOfLines={1} style={{ maxWidth: 70, marginTop: badge ? 4 : 0, lineHeight: 17 }}>
        {p.displayName.split(/\s+/)[0]}
      </Text>
      {sub ? (
        <Text size={11} tone="muted" numberOfLines={1} style={{ marginTop: -5, lineHeight: 15 }}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  )

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 10, gap: 6 }} style={{ flexGrow: 0 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={mine ? `Free to hang for ${minutesLeft(mine.until, now)} more minutes. Tap to stop` : 'Want to hang? Tell friends you are free for a call'}
          onPress={async () => {
            if (!mine) return setPicking(true)
            useSocial.setState({ myHang: null })
            await api.stopHang()
            void refreshSocial()
          }}
          style={{ width: 70, alignItems: 'center', gap: 4 }}
        >
          <View style={{ width: 59, height: 59, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: mine ? c.onlineSoft : c.surface, borderWidth: 2.5, borderColor: mine ? c.online : c.line, borderStyle: mine ? 'solid' : 'dashed' }}>
            <Icon name={mine ? 'check' : 'coffee'} size={24} color={mine ? c.onlineText : c.accentText} />
          </View>
          <Text size={12} numberOfLines={1} weight={mine ? 'bold' : 'regular'} style={{ color: mine ? c.onlineText : c.ink, lineHeight: 17 }}>
            {mine ? `Free · ${minutesLeft(mine.until, now)}m` : 'Hang?'}
          </Text>
        </Pressable>
        {live.map((b) => face(`live-${b.userId}`, byId.get(b.userId)!, LIVE, 'live now. Watch', null, () => router.push({ pathname: '/live/[id]', params: { id: b.userId } }), 'LIVE'))}
        {hanging.map((h) =>
          face(`hang-${h.userId}`, byId.get(h.userId)!, c.online, `free to hang for ${minutesLeft(h.until, now)} minutes. Call`, `free · ${minutesLeft(h.until, now)}m`, async () => {
            const r = await api.openDm(h.userId)
            if (r.ok) void startCallIn(r.data.id, false)
            else void inform("Couldn't call", r.message)
          }),
        )}
        {birthdays.map((id) => face(`bday-${id}`, byId.get(id)!, GLOW, 'birthday today. Open chat', '🎂 today', () => void openDmWith(id)))}
      </ScrollView>
      {picking ? <HangSheet friends={friends} onDone={() => setPicking(false)} /> : null}
    </>
  )
}

function HangSheet({ friends, onDone }: { friends: PublicUser[]; onDone: () => void }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [everyone, setEveryone] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const shown = query.trim() ? friends.filter((f) => f.displayName.toLowerCase().includes(query.trim().toLowerCase())) : friends

  async function tell() {
    setBusy(true)
    const r = await api.hang(everyone ? null : [...picked])
    setBusy(false)
    if (!r.ok) return void inform("Couldn't tell them", r.message)
    useSocial.setState({ myHang: { until: r.data.until, with: r.data.with } })
    void refreshSocial()
    onDone()
  }

  return (
    <BottomSheet onClose={onDone}>
      <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 16, gap: 12, maxHeight: 620 }}>
        <Text display size={22} style={{ lineHeight: 30 }}>
          Want to hang?
        </Text>
        <Text size={14} tone="muted" style={{ lineHeight: 20 }}>
          Friends you pick get a gentle ping that you're free for a call for the next hour, with a button to call you.
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: 14, backgroundColor: c.surface }} accessibilityRole="radiogroup">
          {[
            { on: everyone, label: `All friends (${friends.length})`, set: () => setEveryone(true) },
            { on: !everyone, label: picked.size ? `Pick friends (${picked.size})` : 'Pick friends', set: () => setEveryone(false) },
          ].map((o) => (
            <Pressable key={o.label} accessibilityRole="radio" accessibilityState={{ checked: o.on }} onPress={o.set} style={{ flex: 1, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: o.on ? c.sheet : 'transparent' }}>
              <Text size={14} weight="bold" tone={o.on ? 'ink' : 'muted'}>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {!everyone ? (
          <>
            <TextInput value={query} onChangeText={setQuery} placeholder="Find a friend" placeholderTextColor={c.faint} accessibilityLabel="Find a friend" style={[{ height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: c.fieldLine, paddingHorizontal: 12, color: c.ink, fontFamily: font.body, fontSize: 16 }, webNoOutline]} />
            <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled">
              {shown.map((f) => (
                <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                  <Avatar user={f} size={36} />
                  <View style={{ flex: 1 }}>
                    <Checkbox
                      value={picked.has(f.id)}
                      onChange={(on) =>
                        setPicked((s) => {
                          const next = new Set(s)
                          if (on) next.add(f.id)
                          else next.delete(f.id)
                          return next
                        })
                      }
                    >
                      <Text size={15}>{f.displayName}</Text>
                    </Checkbox>
                  </View>
                </View>
              ))}
            </ScrollView>
          </>
        ) : null}
        <Button label={everyone ? 'Tell all my friends' : `Tell ${picked.size} ${picked.size === 1 ? 'friend' : 'friends'}`} busy={busy} disabled={everyone ? friends.length === 0 : picked.size === 0} onPress={() => void tell()} />
      </View>
    </BottomSheet>
  )
}

/** Confetti the first time you open a friend's chat on their birthday (once a day). */
const confettiShown = new Set<string>()
export function BirthdayConfetti({ userId, name }: { userId: string; name: string }) {
  const { width, height } = useWindowDimensions()
  const key = `${userId}:${new Date().toDateString()}`
  const [show] = useState(() => {
    if (confettiShown.has(key)) return false
    confettiShown.add(key)
    return true
  })
  const [pieces] = useState(() =>
    Array.from({ length: 36 }, (_, i) => ({
      x: Math.random() * width,
      delay: Math.random() * 500,
      drift: (Math.random() - 0.5) * 140,
      spin: (Math.random() - 0.5) * 3,
      color: ['#F47A1F', '#FFD27A', '#E0353F', '#4FB3BF', '#9B5DE5', '#2E9E5B'][i % 6],
      y: new Animated.Value(0),
    })),
  )
  const banner = useRef(new Animated.Value(0)).current
  const [done, setDone] = useState(!show)
  useEffect(() => {
    if (!show) return
    for (const p of pieces) Animated.timing(p.y, { toValue: 1, duration: 3000, delay: p.delay, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
    Animated.sequence([Animated.timing(banner, { toValue: 1, duration: 300, useNativeDriver: true }), Animated.delay(2600), Animated.timing(banner, { toValue: 0, duration: 400, useNativeDriver: true })]).start()
    const t = setTimeout(() => setDone(true), 3800)
    return () => clearTimeout(t)
  }, [show, pieces, banner])
  if (done) return null
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: -12,
            width: 9,
            height: 5,
            borderRadius: 2,
            backgroundColor: p.color,
            transform: [
              { translateY: p.y.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.9] }) },
              { translateX: p.y.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
              { rotate: p.y.interpolate({ inputRange: [0, 1], outputRange: ['0rad', `${p.spin * 6}rad`] }) },
            ],
            opacity: p.y.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
          }}
        />
      ))}
      <Animated.View style={{ position: 'absolute', alignSelf: 'center', top: 90, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, backgroundColor: 'rgba(28,18,16,0.82)', opacity: banner }}>
        <Text size={15} weight="bold" style={{ color: '#FFFFFF' }}>
          🎂 It's {name.split(/\s+/)[0]}'s birthday today!
        </Text>
      </Animated.View>
    </View>
  )
}
