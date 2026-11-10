import { useEffect, useState } from 'react'
import { BackHandler, Platform, Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSession } from '@/state/session'
import { useWide } from '@/lib/layout'
import { allowRotation, lockPortrait } from '@/lib/orientation'
import { Avatar } from '@/ui/Avatar'
import { Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { ThemeOverride } from '@/ui/theme'
import { campfireApi } from '@/campfire/api'
import { forgetTable, loadTable, useCampfire } from '@/campfire/store'
import { CampfireMap } from '@/campfire/Map'
import { TableSheet } from '@/campfire/Board'
import { HandoutsPanel, MusicPanel, PendingBox, RollsPanel, TurnOrderPanel, type PanelName } from '@/campfire/Panels'
import { FireButton, MapButton, RollToast } from '@/campfire/ui'
import { useTableMusic } from '@/campfire/music'
import { myCharacter, myToken, useFire } from '@/campfire/lib'

// Campfire's table on a phone (the approved Phone board): the map on top, your turn, HP,
// actions and dice in the sheet below it. Turn order, rolls, handouts and music are behind the
// buttons on the map. While it's open the phone tells the server it's at the table (every 30 s).

export default function CampfireTable() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return (
    <ThemeOverride mode="night">
      <Table id={String(id)} />
    </ThemeOverride>
  )
}

function Table({ id }: { id: string }) {
  const fire = useFire()
  const insets = useSafeAreaInsets()
  const wide = useWide()
  const meId = useSession((s) => s.user?.id ?? '')
  const table = useCampfire((s) => s.tables[id])
  const error = useCampfire((s) => s.errors[id])
  const handouts = table?.handouts.length ?? 0
  const [panel, setPanel] = useState<PanelName | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [sheetH, setSheetH] = useState(0)
  const [seenHandouts, setSeenHandouts] = useState<number | null>(null)
  const music = useTableMusic(id, table)

  useEffect(() => {
    void loadTable(id)
    void campfireApi.presence(id)
    const t = setInterval(() => void campfireApi.presence(id), 30_000)
    return () => {
      clearInterval(t)
      void campfireApi.presence(id, true)
      forgetTable(id)
    }
  }, [id])

  useEffect(() => {
    allowRotation()
    return () => lockPortrait()
  }, [])

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/chats'))
  useEffect(() => {
    if (Platform.OS === 'web') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panel) setPanel(null)
      else leave()
      return true
    })
    return () => sub.remove()
  }, [panel])

  // A target that left the map (or went into fog) is let go.
  useEffect(() => {
    if (target && table && !table.tokens.some((t) => t.id === target)) setTarget(null)
  }, [table, target])
  // New handouts get a dot on their button until the panel is opened.
  useEffect(() => {
    if (table && seenHandouts === null) setSeenHandouts(table.handouts.length)
  }, [table, seenHandouts])

  if (!table) {
    return (
      <View style={{ flex: 1, backgroundColor: fire.bg, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
        {error ? (
          <>
            <Text size={16} style={{ color: fire.ink, textAlign: 'center' }}>
              {error}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <FireButton label="Back" onPress={leave} />
              <FireButton label="Try again" kind="primary" onPress={() => void loadTable(id)} />
            </View>
          </>
        ) : (
          <Text size={15} style={{ color: fire.muted }}>
            Lighting the campfire…
          </Text>
        )}
      </View>
    )
  }

  const character = myCharacter(table, meId)
  const token = myToken(table, meId)
  const gm = table.myRole === 'gm'
  const sub = [table.combat ? `Round ${table.combat.round}` : null, gm ? 'Game master' : character ? `Playing as ${character.name}` : 'Player'].filter(Boolean).join(' · ')
  const people = table.present.map((uid) => table.members.find((m) => m.userId === uid)?.user).filter((u): u is NonNullable<typeof u> => !!u)
  const newHandouts = seenHandouts !== null && handouts > seenHandouts ? handouts - seenHandouts : 0
  const pending = gm ? table.pending[0] : undefined

  const sheet = (
    <TableSheet
      campaignId={id}
      table={table}
      character={character}
      token={token}
      targetId={target}
      collapsed={collapsed && !wide}
      onToggle={() => setCollapsed((c) => !c)}
      onOpenPanel={setPanel}
      bottomPad={wide ? 0 : insets.bottom}
    />
  )

  return (
    <View style={{ flex: 1, backgroundColor: fire.bg, paddingLeft: insets.left, paddingRight: insets.right }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to the call" onPress={leave} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: fire.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevronLeft" size={20} color={fire.ink} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ fontFamily: 'Outfit_700Bold', fontSize: 17, color: fire.ink }}>
            {table.campaign.name}
          </Text>
          <Text size={12} numberOfLines={1} style={{ color: fire.muted }}>
            {sub}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 4 }} accessible accessibilityLabel={`At the table: ${people.map((p) => p.displayName).join(', ') || 'just you'}`}>
          {people.slice(0, 4).map((p) => (
            <View key={p.id} style={{ borderRadius: 16, borderWidth: 2, borderColor: fire.green }}>
              <Avatar user={p} size={26} />
            </View>
          ))}
          {people.length > 4 ? (
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: fire.card, alignItems: 'center', justifyContent: 'center' }}>
              <Text size={11} weight="bold" style={{ color: fire.muted }}>
                +{people.length - 4}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column', gap: wide ? 12 : 0, paddingHorizontal: 12, paddingBottom: wide ? insets.bottom + 12 : 0 }}>
        <View style={{ flex: 1 }}>
          <CampfireMap campaignId={id} table={table} meId={meId} targetId={target} onTarget={setTarget} bottomInset={wide ? 0 : Math.max(0, sheetH - 12)} />
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 10, right: 64, top: 10, gap: 8 }}>
            {pending ? <PendingBox table={table} pending={pending} /> : null}
            <RollToast campaignId={id} table={table} meId={meId} />
          </View>
          <View style={{ position: 'absolute', right: 10, top: 10, gap: 8 }}>
            <MapButton icon="order" label="Turn order" lit={!!table.combat} onPress={() => setPanel('order')} />
            <MapButton icon="dice" label="Rolls" onPress={() => setPanel('rolls')} />
            <MapButton
              icon="scroll"
              label="Handouts"
              badge={newHandouts || undefined}
              onPress={() => {
                setSeenHandouts(handouts)
                setPanel('handouts')
              }}
            />
            <MapButton icon="music" label={music.track ? `Music: ${music.track.title}` : 'Music'} lit={music.playing} onPress={() => setPanel('music')} />
          </View>
        </View>
        {wide ? (
          <View style={{ width: 380, justifyContent: 'flex-end' }}>
            <View style={{ borderRadius: 26, overflow: 'hidden' }}>{sheet}</View>
          </View>
        ) : null}
      </View>
      {wide ? null : (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}>
          {sheet}
        </View>
      )}

      {panel === 'order' ? <TurnOrderPanel table={table} meId={meId} onClose={() => setPanel(null)} /> : null}
      {panel === 'rolls' ? <RollsPanel campaignId={id} table={table} meId={meId} onClose={() => setPanel(null)} /> : null}
      {panel === 'handouts' ? <HandoutsPanel campaignId={id} table={table} onClose={() => setPanel(null)} /> : null}
      {panel === 'music' ? <MusicPanel music={{ title: music.track?.title ?? null, playing: music.playing, loading: music.loading }} onClose={() => setPanel(null)} /> : null}
    </View>
  )
}
