import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import Svg, { Path } from 'react-native-svg'
import { MY_GAMES_VISIBILITY, type MyGame, type MyGamesVisibility } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { useSession } from '@/state/session'
import { useStore } from '@/state/store'
import { firstName } from '@/lib/format'
import { confirm, inform } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { IconButton, Spinner, Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
import { GameTile, hoursShort, lastPlayed, sortGames, usePlayingNow } from '@/constellations/games'
import { haptic } from '@/constellations/motion'

// My games (canvas board 10). Someone else's: totals, favorites (with a bar), then most played.
// Yours ("me"): who can see it, star games, swipe one to hide or remove it, and the hidden ones.

export default function GamesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const meId = useSession((s) => s.user?.id ?? '')
  const mine = id === 'me' || id === meId
  return mine ? <MyOwnGames /> : <FriendGames userId={id} />
}

function Header({ title }: { title: string }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 4, height: insets.top + 56, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.bg }}>
      <IconButton name="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/chats'))} color={c.ink} size={24} />
      <Text size={17} weight="bold" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
        {title}
      </Text>
    </View>
  )
}

function FriendGames({ userId }: { userId: string }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const person = useStore((s) => s.people[userId])
  const playing = usePlayingNow(userId)
  const [data, setData] = useState<{ games: MyGame[]; shared: boolean } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    void cx.gamesOf(userId).then((r) => (r.ok ? setData({ games: r.data.games, shared: r.data.shared }) : setProblem(r.message)))
  }, [userId])
  const name = person ? firstName(person.displayName, person.username) : 'Their'
  const games = sortGames((data?.games ?? []).filter((g) => !g.hidden))
  const favorites = games.filter((g) => g.favorite)
  const rest = games.filter((g) => !g.favorite)
  const total = games.reduce((s, g) => s + g.seconds, 0)
  const max = Math.max(1, ...games.map((g) => g.seconds))
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={person ? `${name}'s games` : 'My games'} />
      {!data ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>{problem ? <Text tone="muted">{problem}</Text> : <Spinner />}</View>
      ) : !data.shared ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 }}>
          <Icon name="lock" size={28} color={c.muted} />
          <Text tone="muted" style={{ textAlign: 'center' }}>
            {name} keeps their games to themselves.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 32, gap: 10, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Stat value={`${Math.round(total / 3600)} h`} label="total playtime" />
            <Stat value={String(games.length)} label={games.length === 1 ? 'game played' : 'games played'} />
          </View>
          {!games.length ? (
            <Text tone="muted" style={{ paddingVertical: 16 }}>
              No games yet.
            </Text>
          ) : null}
          {favorites.length ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <Icon name="sparkles" size={14} color={c.accentText} />
              <Text size={12} weight="bold" style={{ color: c.accentText, letterSpacing: 0.96, textTransform: 'uppercase' }} accessibilityRole="header">
                Favorites
              </Text>
            </View>
          ) : null}
          {favorites.map((g) => (
            <View key={g.key} accessible accessibilityLabel={`${g.name}, ${hoursShort(g.seconds)}, ${lastPlayed(g, playing)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: c.accentSoft }}>
              <GameTile name={g.name} size={56} radius={14} />
              <View style={{ flex: 1 }}>
                <Text size={16} weight="bold" numberOfLines={1}>
                  {g.name}
                </Text>
                <Text size={13} tone="ink2">
                  {hoursShort(g.seconds)} · {lastPlayed(g, playing)}
                </Text>
                <View style={{ marginTop: 6, height: 5, borderRadius: 3, backgroundColor: 'rgba(244,122,31,0.25)' }}>
                  <View style={{ width: `${Math.max(4, Math.round((g.seconds / max) * 100))}%`, height: 5, borderRadius: 3, backgroundColor: c.accent }} />
                </View>
              </View>
            </View>
          ))}
          {rest.length ? (
            <Text size={12} weight="bold" tone="muted" style={{ marginTop: 8, letterSpacing: 0.96, textTransform: 'uppercase' }} accessibilityRole="header">
              Most played
            </Text>
          ) : null}
          {rest.map((g) => (
            <View key={g.key} accessible accessibilityLabel={`${g.name}, ${hoursShort(g.seconds)}, ${lastPlayed(g, playing)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
              <GameTile name={g.name} size={48} radius={12} />
              <View style={{ flex: 1 }}>
                <Text size={15} weight="bold" numberOfLines={1}>
                  {g.name}
                </Text>
                <Text size={13} tone="muted">
                  {hoursShort(g.seconds)} · {lastPlayed(g, playing)}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  const { c } = useTheme()
  return (
    <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.surface }}>
      <Text display size={24}>
        {value}
      </Text>
      <Text size={12} tone="muted">
        {label}
      </Text>
    </View>
  )
}

function MyOwnGames() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const meId = useSession((s) => s.user?.id ?? '')
  const playing = usePlayingNow(meId)
  const [games, setGames] = useState<MyGame[] | null>(null)
  const [visibility, setVisibility] = useState<MyGamesVisibility>('friends')
  const [showHidden, setShowHidden] = useState(false)
  useEffect(() => {
    void cx.myGames().then((r) => {
      if (!r.ok) return void inform("Couldn't load your games", r.message)
      setGames(r.data.games)
      setVisibility(r.data.visibility)
    })
  }, [])

  async function changeVisibility(v: MyGamesVisibility) {
    haptic.select()
    const before = visibility
    setVisibility(v)
    const r = await cx.setGamesVisibility(v)
    if (!r.ok) {
      setVisibility(before)
      void inform("Couldn't change that", r.message)
    }
  }
  async function change(g: MyGame, changes: { favorite?: boolean; hidden?: boolean }) {
    haptic.light()
    setGames((l) => l?.map((x) => (x.key === g.key ? { ...x, ...changes } : x)) ?? null)
    const r = await cx.setGame(g.key, changes)
    if (r.ok) setGames(r.data.games)
    else {
      setGames((l) => l?.map((x) => (x.key === g.key ? g : x)) ?? null)
      void inform("Couldn't change that", r.message)
    }
  }
  async function remove(g: MyGame) {
    const ok = await confirm({ title: `Remove ${g.name}?`, message: 'Its playtime is forgotten. If you play it again, it starts from zero.', confirmLabel: 'Remove', danger: true })
    if (!ok) return
    const r = await cx.removeGame(g.key)
    if (r.ok) setGames(r.data.games)
    else void inform("Couldn't remove it", r.message)
  }

  const shown = sortGames((games ?? []).filter((g) => !g.hidden))
  const hidden = sortGames((games ?? []).filter((g) => g.hidden))

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="My games" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 32, gap: 4, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <View style={{ gap: 8, marginBottom: 10 }}>
          <Text size={12} weight="bold" tone="muted">
            Who can see My games
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Who can see My games" style={{ flexDirection: 'row', padding: 4, borderRadius: 12, backgroundColor: c.surface }}>
            {MY_GAMES_VISIBILITY.map((o) => {
              const on = o.id === visibility
              return (
                <Pressable key={o.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => void changeVisibility(o.id)} style={{ flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accent : 'transparent' }}>
                  <Text size={13} weight={on ? 'bold' : 'medium'} style={{ color: on ? c.accentInk : c.muted }}>
                    {o.name}
                  </Text>
                </Pressable>
              )
            })}
          </View>
          <Text size={12} tone="faint">
            Playtime counts while a game is detected on your computer.
          </Text>
        </View>
        {games === null ? <Spinner /> : null}
        {games && !games.length ? (
          <Text tone="muted" style={{ paddingVertical: 16 }}>
            Nothing yet. Play a game with Glofly open on your computer and it shows up here.
          </Text>
        ) : null}
        {shown.map((g) => (
          <GameRow key={g.key} g={g} playing={playing} onStar={() => void change(g, { favorite: !g.favorite })} onHide={() => void change(g, { hidden: true })} onRemove={() => void remove(g)} />
        ))}
        {hidden.length ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${hidden.length} hidden ${hidden.length === 1 ? 'game' : 'games'}. ${showHidden ? 'Hide them' : 'Show them'}`} onPress={() => setShowHidden(!showHidden)} style={{ marginTop: 6, minHeight: 56, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: c.line, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="eyeOff" size={18} color={c.muted} />
            <Text size={14} tone="muted" style={{ flex: 1 }}>
              {hidden.length} hidden {hidden.length === 1 ? 'game' : 'games'}
            </Text>
            <Text size={14} weight="bold" style={{ color: c.accentText }}>
              {showHidden ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
        ) : null}
        {showHidden
          ? hidden.map((g) => (
              <View key={g.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 66, paddingHorizontal: 12, opacity: 0.75 }}>
                <GameTile name={g.name} size={46} radius={12} />
                <View style={{ flex: 1 }}>
                  <Text size={15} weight="bold" numberOfLines={1}>
                    {g.name}
                  </Text>
                  <Text size={12} tone="muted">
                    {hoursShort(g.seconds)} · only you see it
                  </Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Show ${g.name} again`} onPress={() => void change(g, { hidden: false })} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: c.surface, justifyContent: 'center' }}>
                  <Text size={13} weight="bold">
                    Unhide
                  </Text>
                </Pressable>
              </View>
            ))
          : null}
      </ScrollView>
    </View>
  )
}

function GameRow({ g, playing, onStar, onHide, onRemove }: { g: MyGame; playing: string | null; onStar: () => void; onHide: () => void; onRemove: () => void }) {
  const { c } = useTheme()
  return (
    <Swipeable
      friction={1.5}
      rightThreshold={60}
      overshootRight={false}
      renderRightActions={() => (
        <View style={{ flexDirection: 'row', borderTopRightRadius: 16, borderBottomRightRadius: 16, overflow: 'hidden' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Hide ${g.name}`} onPress={onHide} style={{ width: 78, backgroundColor: '#4A372B', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            <Icon name="eyeOff" size={18} color="#F5EDE6" />
            <Text size={13} weight="bold" style={{ color: '#F5EDE6' }}>
              Hide
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${g.name}`} onPress={onRemove} style={{ width: 78, backgroundColor: '#D33A2C', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            <Icon name="trash" size={18} color="#fff" />
            <Text size={13} weight="bold" style={{ color: '#fff' }}>
              Remove
            </Text>
          </Pressable>
        </View>
      )}
    >
      <View
        accessible
        accessibilityLabel={`${g.name}${g.favorite ? ', starred' : ''}, ${hoursShort(g.seconds)}, ${lastPlayed(g, playing)}`}
        accessibilityHint="Swipe left to hide or remove"
        accessibilityActions={[
          { name: 'star', label: g.favorite ? 'Unstar' : 'Star' },
          { name: 'hide', label: 'Hide' },
          { name: 'remove', label: 'Remove' },
        ]}
        onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'star' ? onStar() : e.nativeEvent.actionName === 'hide' ? onHide() : onRemove())}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 66, paddingHorizontal: 12, borderRadius: 16, backgroundColor: g.favorite ? c.surface : c.bg }}
      >
        <GameTile name={g.name} size={46} radius={12} />
        <View style={{ flex: 1 }}>
          <Text size={15} weight="bold" numberOfLines={1}>
            {g.name}
          </Text>
          <Text size={12} tone="muted">
            {hoursShort(g.seconds)} · {lastPlayed(g, playing)}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={g.favorite ? `Unstar ${g.name}` : `Star ${g.name}`} onPress={onStar} hitSlop={4} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
          <StarIcon on={g.favorite} color={g.favorite ? c.accentText : c.faint} />
        </Pressable>
      </View>
    </Swipeable>
  )
}

function StarIcon({ on, color }: { on: boolean; color: string }) {
  // The app's icon set has no star; this is the canvas's.
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill={on ? color : 'none'} stroke={color} strokeWidth={2} strokeLinejoin="round">
      <Path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
    </Svg>
  )
}
