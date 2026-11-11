import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { moveBudget, type TableState } from '@glofly/shared'
import { Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { Avatar } from '@/ui/Avatar'
import { inform } from '@/ui/dialogs'
import { haptic } from '@/constellations/motion'
import { campfireApi } from './api'
import { patchTable } from './store'
import { setFx, setPlan, useFx, useMovePlan, type Movement } from './roundB'
import { FireButton } from './ui'
import { useFire, useStill } from './lib'

// Round B in the phone's table (the approved PhoneMove and PhonePaused boards): the movement row in
// the bottom sheet, the "table is paused" cover over the map, and the cards for the spotlight, a
// moved view, a whisper and short notices.

/** Your turn's movement: the budget bar, Undo, Dash and "Move here" for a planned move. */
export function MovementRow({ campaignId, mv }: { campaignId: string; mv: Movement }) {
  const fire = useFire()
  const planAll = useMovePlan((s) => s.plan)
  const plan = planAll && planAll.campaignId === campaignId && planAll.tokenId === mv.tokenId ? planAll : null
  const [busy, setBusy] = useState<string | null>(null)
  const budget = moveBudget(mv.speed, mv.dashed)
  const planned = plan?.cost ?? 0
  const over = !!plan && plan.cost > mv.left
  const pct = (n: number) => `${budget ? Math.max(0, Math.min(100, (n / budget) * 100)) : 100}%` as const

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }
  const op = (o: 'dash' | 'undoMove') =>
    run(o, async () => {
      const r = await campfireApi.combat(campaignId, { op: o })
      if (!r.ok) return void inform(o === 'dash' ? "Couldn't dash" : "Couldn't undo", r.message)
      haptic.select()
      patchTable(campaignId, () => ({ combat: r.data.combat }))
    })
  const commit = () =>
    run('move', async () => {
      if (!plan) return
      const r = await campfireApi.moveToken(plan.tokenId, plan.x, plan.y, plan.path)
      if (!r.ok) {
        setPlan(null)
        return void inform("Couldn't move there", r.message)
      }
      haptic.medium()
      patchTable(campaignId, (t) => ({ tokens: t.tokens.map((k) => (k.id === r.data.id ? r.data : k)) }))
      setPlan(null)
    })

  const left = Math.max(0, mv.left)
  const status = plan
    ? over
      ? `${plan.cost} ft is ${plan.cost - left} ft too far`
      : `Moving ${plan.cost} ft · ${left - plan.cost} ft left after`
    : left > 0
      ? `${left} of ${budget} ft left`
      : 'No movement left'
  return (
    <View style={{ gap: 10 }} accessible={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: fire.amberSoft, justifyContent: 'center' }}>
          <Text size={12} weight="bold" style={{ color: fire.amber }}>
            {mv.dashed ? 'Dashing' : 'Movement'}
          </Text>
        </View>
        <Text size={12} numberOfLines={1} style={{ flex: 1, textAlign: 'right', color: over ? fire.redText : fire.muted }} accessibilityLiveRegion="polite">
          {status}
        </Text>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Movement this turn"
        accessibilityValue={{ min: 0, max: budget, now: Math.min(budget, mv.moved + planned), text: status }}
        style={{ height: 8, borderRadius: 4, backgroundColor: fire.track, overflow: 'hidden', flexDirection: 'row' }}
      >
        <View style={{ width: pct(mv.moved), backgroundColor: fire.amber }} />
        {planned ? <View style={{ width: pct(Math.min(planned, Math.max(0, budget - mv.moved))), backgroundColor: over ? fire.red : fire.accent }} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <FireButton
          label="Undo"
          icon="undo"
          a11y={plan ? 'Undo: drop the planned move' : 'Undo your last move'}
          height={46}
          size={14}
          style={{ flex: 1 }}
          busy={busy === 'undoMove'}
          disabled={!plan && !mv.lastMove}
          onPress={() => {
            if (plan) {
              haptic.select()
              setPlan(null)
            } else void op('undoMove')
          }}
        />
        <FireButton
          label={mv.dashed ? 'Dashed' : 'Dash'}
          icon="run"
          kind="amber"
          a11y={mv.dashed ? 'Already dashing this turn' : `Dash: ${mv.speed} more feet this turn`}
          height={46}
          size={14}
          style={{ flex: 1 }}
          busy={busy === 'dash'}
          disabled={mv.dashed}
          onPress={() => void op('dash')}
        />
        <FireButton
          label="Move here"
          kind="primary"
          a11y={plan ? `Move here, ${plan.cost} feet` : 'Move here (drag your token on the map first)'}
          height={46}
          size={14}
          style={{ flex: 1.3 }}
          busy={busy === 'move'}
          disabled={!plan || (over && mv.enforced)}
          onPress={() => void commit()}
        />
      </View>
    </View>
  )
}

/** Players: the map is covered while the game master has the table paused. */
export function PausedCover({ table, bottomInset }: { table: TableState; bottomInset: number }) {
  const fire = useFire()
  const still = useStill()
  const paused = table.campaign.live?.paused
  if (!paused || table.myRole === 'gm') return null
  const by = table.members.find((m) => m.userId === paused.by)?.user?.displayName ?? 'The game master'
  return (
    <Animated.View
      entering={still ? undefined : FadeIn.duration(220)}
      exiting={still ? undefined : FadeOut.duration(220)}
      accessibilityRole="alert"
      accessibilityLabel={`The table is paused. ${by} paused the game${paused.message ? `: ${paused.message}` : ''}. Tokens and rolls wait until it starts again.`}
      style={{ position: 'absolute', inset: 0, borderRadius: 14, backgroundColor: 'rgba(11,8,7,0.82)', alignItems: 'center', justifyContent: 'center', padding: 28, paddingBottom: bottomInset + 120, gap: 14 }}
    >
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: fire.amberSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="pause" size={28} color={fire.amber} />
      </View>
      <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 22, color: fire.ink, textAlign: 'center' }}>The table is paused</Text>
      <Text size={15} style={{ color: fire.muted, textAlign: 'center', lineHeight: 22 }}>
        {by} paused the game{paused.message ? `: “${paused.message}”.` : '.'} Tokens and rolls wait until it starts again. You can still look at your sheet.
      </Text>
    </Animated.View>
  )
}

/** The cards over the bottom of the map: paused (game master), spotlight, moved view, whisper, notices. */
export function TableCards({ campaignId, table, meId }: { campaignId: string; table: TableState; meId: string }) {
  const fire = useFire()
  const still = useStill()
  const fx = useFx(campaignId)
  const live = table.campaign.live
  const gm = table.myRole === 'gm'
  const member = (id: string) => table.members.find((m) => m.userId === id)?.user ?? null
  const first = (id: string) => (id === meId ? 'You' : (member(id)?.displayName.split(' ')[0] ?? 'Someone'))
  const [busy, setBusy] = useState(false)

  // The moved-view card stays a few seconds (tap it to put it away).
  const [viewAt, setViewAt] = useState<number | null>(null)
  useEffect(() => {
    if (!fx.focus || fx.focus.by === meId) return
    setViewAt(fx.focus.at)
    const at = fx.focus.at
    const id = setTimeout(() => setViewAt((v) => (v === at ? null : v)), 6000)
    return () => clearTimeout(id)
  }, [fx.focus, meId])
  const sceneName = fx.focus && table.scene?.id === fx.focus.sceneId ? table.scene.name : null

  const card = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, borderWidth: 1 }
  const enter = still ? undefined : FadeIn.duration(200)
  const exit = still ? undefined : FadeOut.duration(200)
  const spot = live?.spotlight ? member(live.spotlight) : null
  return (
    <View pointerEvents="box-none" style={{ gap: 8 }}>
      {live?.paused && gm ? (
        <Animated.View entering={enter} exiting={exit} accessibilityRole="alert" style={[card, { backgroundColor: fire.amberSoft, borderColor: fire.amberLine }]}>
          <Icon name="pause" size={20} color={fire.amber} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text size={15} weight="bold" style={{ color: fire.ink }}>
              Paused for everyone
            </Text>
            {live.paused.message ? (
              <Text size={13} numberOfLines={1} style={{ color: fire.muted }}>
                “{live.paused.message}”
              </Text>
            ) : null}
          </View>
          <FireButton
            label="Resume"
            kind="primary"
            height={40}
            size={14}
            busy={busy}
            onPress={async () => {
              setBusy(true)
              const r = await campfireApi.pause(campaignId, false)
              setBusy(false)
              if (!r.ok) void inform("Couldn't resume", r.message)
            }}
          />
        </Animated.View>
      ) : null}
      {live?.spotlight ? (
        <Animated.View entering={enter} exiting={exit} accessibilityRole="alert" style={[card, { backgroundColor: fire.concSoft, borderColor: fire.concLine }]}>
          {spot ? (
            <View style={{ borderRadius: 20, borderWidth: 2, borderColor: fire.green }}>
              <Avatar user={spot} size={34} />
            </View>
          ) : (
            <Icon name="sparkles" size={20} color={fire.conc} />
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text size={15} weight="bold" style={{ color: fire.ink }}>
              {live.spotlight === meId ? 'The spotlight is on you' : `Spotlight on ${first(live.spotlight)}`}
            </Text>
            <Text size={13} style={{ color: fire.conc }}>
              {live.spotlight === meId ? 'The game master is giving you the scene.' : 'The game master is giving them the scene.'}
            </Text>
          </View>
          {gm ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Turn the spotlight off"
              hitSlop={8}
              onPress={() => void campfireApi.spotlight(campaignId, null)}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="close" size={18} color={fire.muted} />
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}
      {fx.whisper ? (
        <Animated.View entering={enter} exiting={exit} accessibilityRole="alert" style={[card, { backgroundColor: fire.concSoft, borderColor: fire.concLine }]}>
          <Icon name="mic" size={20} color={fire.conc} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text size={15} weight="bold" style={{ color: fire.ink }}>
              {first(fx.whisper.from)} is whispering to you
            </Text>
            <Text size={13} style={{ color: fire.conc }}>
              Only you hear them right now.
            </Text>
          </View>
        </Animated.View>
      ) : null}
      {viewAt && fx.focus ? (
        <Animated.View entering={enter} exiting={exit}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${first(fx.focus.by)} moved everyone's view${sceneName ? ` on ${sceneName}` : ''}. Tap to close.`}
            onPress={() => setViewAt(null)}
            style={[card, { backgroundColor: fire.card, borderColor: fire.line }]}
          >
            <Icon name="eye" size={20} color={fire.amber} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text size={15} weight="bold" style={{ color: fire.ink }}>
                {first(fx.focus.by)} moved everyone’s view
              </Text>
              <Text size={13} numberOfLines={1} style={{ color: fire.muted }}>
                {sceneName ? `On ${sceneName} · ` : ''}drag to look around again
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
      {fx.notice ? (
        <Animated.View entering={enter} exiting={exit}>
          <Pressable
            accessibilityRole="button"
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${fx.notice.text}. Tap to close.`}
            onPress={() => setFx(campaignId, { notice: null })}
            style={[card, { backgroundColor: fire.card, borderColor: fire.line }]}
          >
            <Icon name="clock" size={18} color={fire.amber} />
            <Text size={14} style={{ flex: 1, color: fire.ink }}>
              {fx.notice.text}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  )
}
