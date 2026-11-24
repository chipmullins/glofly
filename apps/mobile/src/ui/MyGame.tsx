// 0.11.4 "See what you're playing" on phones (approved canvas "Glofly: See what you're playing"):
// your game in the Settings tab's profile card, exactly as friends see it. Tap it for a sheet with
// what friends see, the "Show what I'm playing" switch, a way to report a wrong game, and My games.
// Phones don't look for games themselves: this is what your computer (or Steam) shares. The switch
// and "Don't show this game" are sent to your open Glofly computer (the setting lives there).
import { useEffect, useState } from 'react'
import { Modal, Pressable, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { activityLine, gameKey, type Activity, type PublicUser } from '@glofly/shared'
import * as api from '@/api/glofly'
import { cx } from '@/api/constellations'
import { refreshStatus } from '@/state/sync'
import { reportError } from '@/lib/errorReports'
import { useStore } from '@/state/store'
import { GameArt } from '@/profiles/Board'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { Button, Switch, Text, webNoOutline } from './kit'
import { useTheme } from './theme'

/** Your game as friends see it right now (live from your own presence, else from your status). */
export function useMyActivity(userId: string): { activity: Activity | null; fromSteam: boolean } {
  const live = useStore((s) => s.presence[userId])
  const status = useStore((s) => s.myStatus)
  const activity = live ? (live.status === 'offline' ? null : (live.activity ?? null)) : (status?.activity ?? null)
  return { activity, fromSteam: !!activity && !!status?.activityFromSteam && status.activity?.name === activity.name }
}

function useCover(name: string | null): string | undefined {
  const [cover, setCover] = useState<{ name: string; id?: string } | null>(null)
  useEffect(() => {
    if (!name) return
    let alive = true
    void cx.myGames().then((r) => {
      if (alive && r.ok) setCover({ name, id: r.data.games.find((g) => g.key === gameKey(name))?.cover })
    })
    return () => {
      alive = false
    }
  }, [name])
  return cover?.name === name ? cover.id : undefined
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** The game line inside the profile card; opens the sheet. */
export function MyGameLine({ user, activity, fromSteam }: { user: PublicUser; activity: Activity; fromSteam: boolean }) {
  const { c } = useTheme()
  const now = useNow()
  const [open, setOpen] = useState(false)
  const line = activityLine(activity, now)
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`What friends see: ${line}`}
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}
      >
        <Icon name="gamepad" size={15} color={c.onlineText} />
        <Text size={14} numberOfLines={2} style={{ flex: 1, color: c.onlineText }}>
          {fromSteam ? `${line} · on Steam` : `${line} · on your computer`}
        </Text>
      </Pressable>
      {open ? <MyGameSheet user={user} activity={activity} fromSteam={fromSteam} line={line} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

/** The box art next to the card (once My games has it). */
export function MyGameCover({ name }: { name: string }) {
  const cover = useCover(name)
  return <GameArt name={name} width={42} radius={7} cover={cover} />
}

function MyGameSheet({ user, activity, fromSteam, line, onClose }: { user: PublicUser; activity: Activity; fromSteam: boolean; line: string; onClose: () => void }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const cover = useCover(activity.name)
  const [shared, setShared] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [right, setRight] = useState('')

  const send = async (change: { share?: boolean; hide?: string }) => {
    setBusy(true)
    setNote(null)
    const r = await api.setActivitySharing(change)
    setBusy(false)
    if (!r.ok) {
      setNote(r.message)
      return false
    }
    setNote(change.hide ? `Your computer won't show ${activity.name} anymore.` : 'Sent to your computer. It changes in a moment.')
    setTimeout(() => void refreshStatus(), 3000)
    return true
  }

  const report = async () => {
    const name = right.trim()
    if (!name) return
    // Reported to Glofly (Control → Errors, "game detection"), so the game list gets fixed.
    reportError(new Error(`Wrong game: found "${activity.name}" (${fromSteam ? 'steam' : 'computer'}), really "${name}"`), 'game detection')
    setFixing(false)
    setNote('Thanks! We’ll look into it.')
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: c.backdrop }} />
      <View
        accessibilityViewIsModal
        style={{ backgroundColor: c.bg, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 20, gap: 14 }}
      >
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: c.line }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <GameArt name={activity.name} width={60} radius={9} cover={cover} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text display size={20} accessibilityRole="header">
              {activity.name}
            </Text>
            <Text size={14} tone="muted">
              {line.replace(/^Playing [^·]*· /, 'Playing for ')} · {fromSteam ? 'from Steam' : 'from your computer'}
            </Text>
            {cover ? (
              <Text size={12} tone="faint">
                Game info by IGDB
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ gap: 6 }}>
          <Text size={12} weight="bold" tone="faint" style={{ letterSpacing: 1, textTransform: 'uppercase' }}>
            What friends see
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: c.surface }}>
            <Avatar user={user} size={42} status="online" ring={c.surface} />
            <View style={{ flex: 1 }}>
              <Text size={16} numberOfLines={1}>
                <Text size={16} weight="bold">
                  {user.displayName}
                </Text>{' '}
                <Text size={16} tone="faint">
                  @{user.username}
                </Text>
              </Text>
              <Text size={14} tone="muted" numberOfLines={1}>
                {shared ? line : 'Your normal status (not the game)'}
              </Text>
            </View>
          </View>
        </View>
        {fromSteam ? (
          <Text size={14} tone="muted">
            This comes from your linked Steam account. Change it in Settings → Connections.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 12 }}>
            <Text size={16} weight="bold" style={{ flex: 1 }}>
              Show what I’m playing
            </Text>
            <Switch
              label="Show what I’m playing"
              value={shared}
              onChange={(v) => {
                if (busy) return
                void send({ share: v }).then((ok) => ok && setShared(v))
              }}
            />
          </View>
        )}
        {note ? (
          <Text size={14} tone="muted" accessibilityLiveRegion="polite" style={{ padding: 10, borderRadius: 12, backgroundColor: c.surface }}>
            {note}
          </Text>
        ) : null}
        {fixing ? (
          <View style={{ gap: 8 }}>
            <Text size={14} tone="muted">
              What are you really playing?
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={right}
                onChangeText={setRight}
                placeholder="Game name"
                placeholderTextColor={c.faint}
                maxLength={64}
                accessibilityLabel="The right game"
                style={[{ flex: 1, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: c.line, color: c.ink, fontSize: 16 }, webNoOutline]}
              />
              <Button label="Send" compact disabled={busy || !right.trim()} onPress={() => void report()} />
            </View>
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setFixing(true)} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text size={16} weight="bold" style={{ color: c.accentText }}>
              Not {activity.name}? Tell us the right game
            </Text>
          </Pressable>
        )}
        {!fromSteam ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void send({ hide: activity.name })} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text size={16} weight="bold" style={{ color: c.accentText }}>
              Don’t show this game
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onClose()
            router.push({ pathname: '/profile/[id]', params: { id: user.id } })
          }}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text size={16} weight="bold" style={{ color: c.accentText }}>
            Open my profile
          </Text>
        </Pressable>
      </View>
    </Modal>
  )
}
