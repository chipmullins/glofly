import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { PublicUser, YearInGlow } from '@glofly/shared'
import * as api from '@/api/glofly'
import { Avatar } from '@/ui/Avatar'
import { Text } from '@/ui/kit'

// Year in Glow (0.5.0): a recap of your year on Glofly, a few slides like stories.

const GOLD = '#FFD27A'
const SOFT = 'rgba(255,247,236,0.8)'

export default function YearScreen() {
  const insets = useSafeAreaInsets()
  const [year, setYear] = useState<YearInGlow | null>(null)
  const [problem, setProblem] = useState('')
  const [slide, setSlide] = useState(0)
  useEffect(() => {
    void api.yearInGlow().then((r) => (r.ok ? setYear(r.data) : setProblem(r.message)))
  }, [])
  const close = () => (router.canGoBack() ? router.back() : router.replace('/settings'))
  const slides = year ? slidesFor(year) : []

  return (
    <View style={{ flex: 1, backgroundColor: '#1A1030', paddingTop: insets.top, paddingBottom: insets.bottom + 12, experimental_backgroundImage: 'linear-gradient(180deg, #1A1030 0%, #2B1840 50%, #5A2A2F 100%)' } as object}>
      <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 16, paddingTop: 10, alignItems: 'center' }}>
        {slides.map((_, i) => (
          <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= slide ? GOLD : 'rgba(255,255,255,0.22)' }} />
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={{ marginLeft: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
          <Text size={20} style={{ color: '#FFFFFF' }}>
            ×
          </Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next"
        onPress={() => (slide < slides.length - 1 ? setSlide(slide + 1) : close())}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 14 }}
      >
        {year ? (
          slides[slide]
        ) : (
          <>
            <Text size={13} weight="bold" style={{ color: '#FFC98A', letterSpacing: 1.5 }}>
              YEAR IN GLOW
            </Text>
            <Text display size={22} style={{ color: '#FFFFFF', textAlign: 'center' }}>
              {problem || 'Gathering your year…'}
            </Text>
          </>
        )}
      </Pressable>
      {year ? (
        <Text size={13} style={{ color: 'rgba(255,255,255,0.55)', textAlign: 'center' }}>
          {slide < slides.length - 1 ? 'Tap for more' : 'Tap to close'}
        </Text>
      ) : null}
    </View>
  )
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <Text size={13} weight="bold" style={{ color: '#FFC98A', letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'center' }}>
      {children}
    </Text>
  )
}
function Big({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text display weight="bold" size={56} style={{ color: GOLD, textShadowColor: 'rgba(255,166,60,0.6)', textShadowRadius: 18 }}>
        {value}
      </Text>
      <Text display size={22} style={{ color: '#FFFFFF' }}>
        {label}
      </Text>
    </View>
  )
}
function Small({ children }: { children: ReactNode }) {
  return (
    <Text size={15} style={{ color: SOFT, textAlign: 'center', lineHeight: 22 }}>
      {children}
    </Text>
  )
}

function slidesFor(y: YearInGlow): ReactNode[] {
  const person = (id: string): PublicUser | undefined => y.people.find((p) => p.id === id)
  const out: ReactNode[] = [
    <>
      <Kicker>{y.soFar ? `Your ${y.year} so far` : `Your ${y.year}`}</Kicker>
      <Text display weight="bold" size={40} style={{ color: '#FFFFFF', textAlign: 'center' }}>
        Year in Glow
      </Text>
      <Big value={y.messagesSent.toLocaleString()} label="messages sent" />
      {y.busiestDay ? <Small>Your busiest day: {new Date(`${y.busiestDay.day}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} ({y.busiestDay.messages} messages)</Small> : null}
    </>,
  ]
  if (y.topFriends.length) {
    out.push(
      <>
        <Kicker>Who you glowed with most</Kicker>
        {y.topFriends.map((f, i) => {
          const p = person(f.userId)
          return p ? (
            <View key={f.userId} style={{ alignItems: 'center', gap: 4 }}>
              <View style={{ borderRadius: 60, borderWidth: i === 0 ? 3 : 0, borderColor: GOLD, boxShadow: i === 0 ? '0 0 26px rgba(255,166,60,0.7)' : undefined }}>
                <Avatar user={p} size={i === 0 ? 76 : 52} />
              </View>
              <Text size={16} weight="bold" style={{ color: '#FFFFFF' }}>
                {p.displayName}
              </Text>
              <Text size={13} style={{ color: SOFT }}>
                {f.messages.toLocaleString()} messages
              </Text>
            </View>
          ) : null
        })}
        {y.topGroup ? <Small>Favorite group: {y.topGroup.name}</Small> : null}
      </>,
    )
  }
  if (y.longestGlow) {
    const p = person(y.longestGlow.userId)
    out.push(
      <>
        <Kicker>Your longest glow</Kicker>
        <View style={{ width: 86, height: 86, borderRadius: 43, backgroundColor: GOLD, boxShadow: '0 0 60px 20px rgba(255,166,60,0.5)' }} />
        <Big value={`${y.longestGlow.days}`} label="days in a row" />
        <Small>with {p?.displayName ?? 'a friend'}</Small>
      </>,
    )
  }
  out.push(
    <>
      <Kicker>On calls</Kicker>
      <Big value={y.callMinutes >= 120 ? `${Math.round(y.callMinutes / 60)}` : `${y.callMinutes}`} label={y.callMinutes >= 120 ? 'hours' : 'minutes'} />
      <Small>
        {y.calls} {y.calls === 1 ? 'call' : 'calls'} · {y.photosSent} photos · {y.gifsSent} GIFs
      </Small>
    </>,
  )
  if (y.topEmoji.length) {
    out.push(
      <>
        <Kicker>Your top emoji</Kicker>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
          {y.topEmoji.map((e, i) => (
            <Text key={e.emoji} size={i === 0 ? 60 : 38}>
              {e.emoji}
            </Text>
          ))}
        </View>
        <Small>
          {y.topEmoji[0].emoji} {y.topEmoji[0].count.toLocaleString()} times
        </Small>
      </>,
    )
  }
  out.push(
    <>
      <Kicker>Thanks for glowing</Kicker>
      <Text display weight="bold" size={30} style={{ color: '#FFFFFF', textAlign: 'center' }}>
        See you in {y.soFar ? 'December' : y.year + 1} ✨
      </Text>
    </>,
  )
  return out
}
