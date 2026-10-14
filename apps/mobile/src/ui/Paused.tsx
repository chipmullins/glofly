import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, View } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Text } from './kit'
import { useSession } from '@/state/session'
import { SERVER_URL } from '@/lib/config'

// "Glofly is paused" (0.4.0): Glofly Control paused everyone (Server → Pause Glofly). Covers the
// whole app, asks the server's /status every 30 seconds while Glofly is on screen, and goes away
// by itself once it's back (the live connection and everything else load again then).

const CHECK_MS = 30_000

/** Asks the server. 'back' once Glofly is running again; a new message if it changed. */
async function checkStatus(): Promise<{ back: true } | { back: false; message?: string; since?: string | null } | null> {
  try {
    const r = await fetch(`${SERVER_URL}/status`, { signal: AbortSignal.timeout(8_000) })
    const body = (await r.json().catch(() => null)) as { paused?: unknown; message?: unknown; since?: unknown } | null
    if (!r.ok || !body) return null
    if (body.paused === false) return { back: true }
    return {
      back: false,
      message: typeof body.message === 'string' ? body.message : undefined,
      since: typeof body.since === 'string' ? body.since : null,
    }
  } catch {
    return null // offline or restarting: try again later
  }
}

export function Paused() {
  const insets = useSafeAreaInsets()
  const paused = useSession((s) => s.paused)
  const [checking, setChecking] = useState(false)
  const [stillPaused, setStillPaused] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const check = useCallback(async (byHand: boolean) => {
    if (byHand) {
      setChecking(true)
      setStillPaused(false)
    }
    const result = await checkStatus()
    if (byHand) setChecking(false)
    const { paused: now, setPaused } = useSession.getState()
    if (!now) return
    if (result?.back) {
      setPaused(null)
      return
    }
    if (result && result.message && result.message !== now.message) setPaused({ message: result.message, since: result.since ?? now.since })
    if (byHand && result) setStillPaused(true)
  }, [])

  // Every 30 seconds while paused and Glofly is on screen (and straight away when it comes back on screen).
  useEffect(() => {
    if (!paused) return
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        if (AppState.currentState === 'active') void check(false)
        schedule()
      }, CHECK_MS)
    }
    schedule()
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void check(false)
    })
    return () => {
      if (timer.current) clearTimeout(timer.current)
      sub.remove()
    }
  }, [paused, check])

  if (!paused) return null
  return (
    <View
      style={{ position: 'absolute', inset: 0, backgroundColor: '#1C1210', paddingTop: insets.top, paddingBottom: insets.bottom + 24, zIndex: 99 }}
      accessibilityViewIsModal
    >
      <View style={{ position: 'absolute', left: '22%', top: '26%', width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFD27A', boxShadow: '0 0 16px 6px rgba(255,190,90,0.45)' }} />
      <View style={{ position: 'absolute', left: '76%', top: '60%', width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFC15E', boxShadow: '0 0 20px 7px rgba(255,170,70,0.4)' }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <Image source={require('../../assets/firefly.png')} style={{ width: 64, height: 47, opacity: 0.85 }} contentFit="contain" />
        <Text display size={30} style={{ color: '#FFFFFF', marginTop: 8, textAlign: 'center' }} accessibilityRole="header">
          Glofly is paused
        </Text>
        <Text size={16} style={{ color: '#D9C2B1', textAlign: 'center', lineHeight: 24 }}>
          {paused.message}
        </Text>
        <Text size={14} style={{ color: '#B9A294', textAlign: 'center', lineHeight: 21 }}>
          Your chats and sign-in are safe. Glofly comes back here by itself as soon as it's running again.
        </Text>
      </View>
      <View style={{ paddingHorizontal: 24, gap: 10, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
        <Button label={checking ? 'Checking…' : 'Try again now'} onPress={() => void check(true)} busy={checking} icon="refresh" />
        <Text size={13} style={{ color: '#B9A294', textAlign: 'center' }} accessibilityLiveRegion="polite">
          {stillPaused ? 'Still paused. ' : ''}Glofly checks again every 30 seconds.
        </Text>
      </View>
    </View>
  )
}
