import { useEffect, useRef, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from './icons'
import { Text } from './kit'

// The night-sky panel at the top of the log in / sign up screens, with drifting fireflies.

const firefly = require('../../assets/firefly.png')

function Glow({ left, top, size }: { left: `${number}%`; top: `${number}%`; size: number }) {
  return (
    <View
      style={{
        position: 'absolute',
        left,
        top,
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: '#FFD27A',
        boxShadow: `0 0 ${size * 3}px ${size * 1.2}px rgba(255,190,90,0.55)`,
      }}
    />
  )
}

function Drifting({ left, top, width, rotate, delay }: { left: `${number}%`; top: `${number}%`; width: number; rotate: number; delay: number }) {
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return
      loop = Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(t, { toValue: 1, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(t, { toValue: 0, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      )
      loop.start()
    })
    return () => loop?.stop()
  }, [t, delay])
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left,
        top,
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, 6] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) },
          { rotate: `${rotate}deg` },
        ],
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }),
      }}
    >
      <Image source={firefly} style={{ width, height: width * 0.74 }} contentFit="contain" />
    </Animated.View>
  )
}

export function AuthHero({
  title,
  subtitle,
  onBack,
  backLabel = 'Back to log in',
  children,
  tall,
}: {
  title?: string
  subtitle?: string
  onBack?: () => void
  backLabel?: string
  children?: ReactNode
  tall?: boolean
}) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        backgroundColor: '#1C1210',
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28,
        overflow: 'hidden',
        paddingTop: insets.top,
        minHeight: (tall ? 300 : 170) + insets.top,
      }}
    >
      <Glow left="12%" top="34%" size={5} />
      <Glow left="88%" top="70%" size={6} />
      <Drifting left="78%" top="26%" width={26} rotate={-14} delay={0} />
      <Drifting left="64%" top="76%" width={18} rotate={10} delay={1300} />
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={onBack}
          style={{ width: 48, height: 48, marginLeft: 8, marginTop: 4, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="back" size={24} color="#FFFFFF" />
        </Pressable>
      ) : null}
      {children}
      {title ? (
        <View style={{ paddingHorizontal: 28, paddingTop: onBack ? 2 : 24, paddingBottom: 24, gap: 4 }}>
          <Text display size={30} style={{ color: '#FFFFFF', letterSpacing: -0.3 }} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text size={15} style={{ color: '#D9C2B1' }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** The big "Glofly" hero on the log in screen. */
export function LoginHeroContent() {
  return (
    <View style={{ paddingHorizontal: 28, paddingTop: 18, paddingBottom: 26, gap: 22 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Image source={firefly} style={{ width: 24, height: 18 }} contentFit="contain" />
        <Text display size={14} style={{ color: '#F9B26B', letterSpacing: 0.9, textTransform: 'uppercase' }}>
          Glofly
        </Text>
      </View>
      <Text display size={34} style={{ color: '#FFFFFF', lineHeight: 37, letterSpacing: -0.6 }} accessibilityRole="header">
        A little hello.{'\n'}
        <Text display size={34} style={{ color: '#FFA54A' }}>
          A lot of connection.
        </Text>
      </Text>
      <View style={{ gap: 8, maxWidth: 270 }}>
        <View style={{ alignSelf: 'flex-start', backgroundColor: '#33231C', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 16, borderBottomLeftRadius: 5 }}>
          <Text size={14} style={{ color: '#F3E6DC' }}>
            Hey! You on tonight?
          </Text>
        </View>
        <View style={{ alignSelf: 'flex-end', backgroundColor: '#F47A1F', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 16, borderBottomRightRadius: 5 }}>
          <Text size={14} weight="medium" style={{ color: '#2A1406' }}>
            Always. Calling you now.
          </Text>
        </View>
      </View>
    </View>
  )
}
