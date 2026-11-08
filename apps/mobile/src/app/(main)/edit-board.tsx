import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import {
  BOARD_GAMES_MAX,
  BOARD_NOTE_MAX,
  BOARD_TAGS_MAX,
  BOARD_TAG_MAX,
  cleanInterestTag,
  type BoardTile,
  type ConstellationCard,
  type ConstellationColor,
  type GameSearchResult,
  type MyGame,
} from '@glofly/shared'
import { cx } from '@/api/constellations'
import { ConstellationIcon } from '@/constellations/ui'
import { GameArt, IgdbCredit } from '@/profiles/Board'
import { TILE_NAMES, putTile, useBoardDraft } from '@/profiles/draft'
import { Icon } from '@/ui/icons'
import { Field, Spinner, Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { useTheme } from '@/ui/theme'

// "Add to your board" on phones (0.9.1, canvas board AddTile): pick a kind, then fill it in.
// Opened from Edit profile with ?kind=…&index=… to edit a tile already there.

type Kind = BoardTile['kind']

export default function EditBoard() {
  const params = useLocalSearchParams<{ kind?: string; index?: string }>()
  const index = params.index !== undefined && /^\d$/.test(params.index) ? Number(params.index) : null
  const board = useBoardDraft((s) => s.board)
  const tile = index !== null ? (board[index] ?? null) : null
  const [kind, setKind] = useState<Kind | null>(
    (['games', 'constellation', 'note', 'into'] as string[]).includes(params.kind ?? '') ? (params.kind as Kind) : null,
  )
  const done = (t: BoardTile) => {
    putTile(t, index)
    router.back()
  }
  if (!kind) return <KindPicker hasPlaying={board.some((t) => t.kind === 'playing')} onPick={(k) => (k === 'playing' ? done({ kind: 'playing' }) : setKind(k))} />
  if (kind === 'games') return <GamesEditor tile={tile?.kind === 'games' ? tile : null} onDone={done} />
  if (kind === 'constellation')
    return <ConstellationEditor tile={tile?.kind === 'constellation' ? tile : null} board={board} onDone={done} />
  if (kind === 'note') return <NoteEditor tile={tile?.kind === 'note' ? tile : null} onDone={done} />
  return <IntoEditor tile={tile?.kind === 'into' ? tile : null} onDone={done} />
}

function DoneButton({ ok, onPress }: { ok: boolean; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable accessibilityRole="button" disabled={!ok} onPress={onPress} style={{ height: 40, paddingHorizontal: 18, marginRight: 8, borderRadius: 20, backgroundColor: ok ? c.accent : c.surface, justifyContent: 'center' }}>
      <Text size={15} weight="bold" style={{ color: ok ? c.accentInk : c.muted }}>
        Done
      </Text>
    </Pressable>
  )
}

function Row({ selected, onPress, left, title, sub, label }: { selected?: boolean; onPress: () => void; left: React.ReactNode; title: string; sub?: string; label?: string }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, backgroundColor: selected ? c.accentSoft : pressed ? c.surface : 'transparent' })}
    >
      {left}
      <View style={{ flex: 1 }}>
        <Text size={15} weight="bold" numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text size={13} tone="muted">
            {sub}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon name="check" size={18} color={c.onlineText} /> : null}
    </Pressable>
  )
}

function KindPicker({ hasPlaying, onPick }: { hasPlaying: boolean; onPick: (k: Kind) => void }) {
  const swatch = (bg: string, border?: string) => <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: bg, borderWidth: border ? 1 : 0, borderColor: border }} />
  const { c } = useTheme()
  const kinds: { kind: Kind; sub: string; swatch: React.ReactNode }[] = [
    { kind: 'games', sub: `Up to ${BOARD_GAMES_MAX}, with their pictures`, swatch: swatch('#5E9E4E') },
    { kind: 'constellation', sub: 'Public ones you’re in, with Join', swatch: swatch('#7C3AED') },
    { kind: 'note', sub: `A few words, up to ${BOARD_NOTE_MAX} characters`, swatch: swatch(c.surface, c.line) },
    { kind: 'into', sub: `Up to ${BOARD_TAGS_MAX} short tags`, swatch: swatch(c.surface2) },
    ...(hasPlaying ? [] : [{ kind: 'playing' as const, sub: 'Shows the game you’re in right now', swatch: swatch('#1C1210') }]),
  ]
  return (
    <Screen title="Add to your board" contentStyle={{ padding: 16, gap: 4 }}>
      {kinds.map((k) => (
        <Row key={k.kind} onPress={() => onPick(k.kind)} left={k.swatch} title={TILE_NAMES[k.kind]} sub={k.sub} />
      ))}
    </Screen>
  )
}

function GamesEditor({ tile, onDone }: { tile: Extract<BoardTile, { kind: 'games' }> | null; onDone: (t: BoardTile) => void }) {
  const { c } = useTheme()
  const [picked, setPicked] = useState<string[]>(tile?.games.map((g) => g.name) ?? [])
  const [query, setQuery] = useState('')
  const [played, setPlayed] = useState<MyGame[] | null>(null)
  useEffect(() => {
    void cx.myGames().then((r) => setPlayed(r.ok ? r.data.games.filter((g) => !g.hidden) : []))
  }, [])
  const q = query.trim().toLowerCase()
  const typed = query.trim().replace(/\s+/g, ' ').slice(0, 80)
  const isPicked = (n: string) => picked.some((p) => p.toLowerCase() === n.toLowerCase())
  const toggle = (n: string) =>
    setPicked((p) => (isPicked(n) ? p.filter((x) => x.toLowerCase() !== n.toLowerCase()) : p.length >= BOARD_GAMES_MAX ? p : [...p, n]))
  const matches = (played ?? []).filter((g) => !q || g.name.toLowerCase().includes(q)).slice(0, 8)
  // 0.9.1: IGDB results through Glofly, a moment after typing stops.
  const [found, setFound] = useState<GameSearchResult[]>([])
  const [credit, setCredit] = useState(false)
  useEffect(() => {
    if (q.length < 2) return setFound([])
    let live = true
    const timer = setTimeout(() => {
      void cx.searchGames(q).then((r) => {
        if (!live || !r.ok) return
        setFound(r.data.games)
        setCredit(r.data.available)
      })
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q])
  const playedNames = new Set(matches.map((g) => g.name.toLowerCase()))
  const more = found.filter((g) => !playedNames.has(g.name.toLowerCase())).slice(0, 6)
  const showTyped = !!typed && !(played ?? []).some((g) => g.name.toLowerCase() === typed.toLowerCase()) && !found.some((g) => g.name.toLowerCase() === typed.toLowerCase())
  const coverOf = (n: string) =>
    (played ?? []).find((g) => g.name.toLowerCase() === n.toLowerCase())?.cover ??
    found.find((g) => g.name.toLowerCase() === n.toLowerCase())?.cover ??
    tile?.games.find((g) => g.name.toLowerCase() === n.toLowerCase())?.cover ??
    undefined
  return (
    <Screen
      title="Favorite games"
      right={<DoneButton ok={picked.length > 0} onPress={() => onDone({ kind: 'games', games: picked.map((name) => { const cover = coverOf(name); return { key: name.toLowerCase(), name, ...(cover ? { cover } : {}) } }) })} />}
      contentStyle={{ padding: 16, gap: 12 }}
    >
      <Field label="Find a game" value={query} onChangeText={setQuery} placeholder="Type a game’s name" autoFocus returnKeyType="search" accessibilityLabel="Find a game" />
      {picked.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {picked.map((p) => (
            <Pressable key={p} accessibilityRole="button" accessibilityLabel={`Remove ${p}`} onPress={() => toggle(p)} style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 18, backgroundColor: c.accentSoft }}>
              <Text size={13} weight="bold">
                {p}
              </Text>
              <Icon name="close" size={13} color={c.ink2} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {played === null ? <Spinner /> : null}
      <View>
        {showTyped ? <Row onPress={() => toggle(typed)} selected={isPicked(typed)} left={<GameArt name={typed} width={30} radius={5} />} title={`Add “${typed}”`} /> : null}
        {matches.map((g) => (
          <Row key={g.key} onPress={() => toggle(g.name)} selected={isPicked(g.name)} left={<GameArt name={g.name} cover={g.cover} width={30} radius={5} />} title={g.name} sub="Played on Glofly" />
        ))}
        {more.map((g) => (
          <Row key={`igdb-${g.key}`} onPress={() => toggle(g.name)} selected={isPicked(g.name)} left={<GameArt name={g.name} cover={g.cover ?? undefined} width={30} radius={5} />} title={g.name} sub={g.year ? String(g.year) : undefined} />
        ))}
      </View>
      <Text size={12.5} tone="muted">
        Up to {BOARD_GAMES_MAX}. Games you’ve played on Glofly come first, or type any game.
      </Text>
      {credit ? <IgdbCredit /> : null}
    </Screen>
  )
}

function ConstellationEditor({ tile, board, onDone }: { tile: Extract<BoardTile, { kind: 'constellation' }> | null; board: BoardTile[]; onDone: (t: BoardTile) => void }) {
  const [pick, setPick] = useState<string | null>(tile?.constellationId ?? null)
  const [mine, setMine] = useState<ConstellationCard[] | null>(null)
  useEffect(() => {
    void cx.dashboard().then((r) => setMine(r.ok ? r.data.constellations : []))
  }, [])
  const used = new Set(board.flatMap((t) => (t.kind === 'constellation' && t.constellationId !== tile?.constellationId ? [t.constellationId] : [])))
  const choices = (mine ?? []).filter((k) => k.visibility !== 'invite' && !used.has(k.id))
  return (
    <Screen title="A constellation I love" right={<DoneButton ok={!!pick} onPress={() => pick && onDone({ kind: 'constellation', constellationId: pick })} />} contentStyle={{ padding: 16, gap: 4 }}>
      {mine === null ? <Spinner /> : null}
      {choices.map((k) => (
        <Row
          key={k.id}
          selected={pick === k.id}
          onPress={() => setPick(k.id)}
          left={<ConstellationIcon c={{ ...k, color: k.color as ConstellationColor }} size={38} />}
          title={k.name}
          sub={`${k.memberCount.toLocaleString()} ${k.memberCount === 1 ? 'member' : 'members'}`}
        />
      ))}
      {mine && !choices.length ? (
        <Text tone="muted">Only public or ask-to-join constellations you’re in can go on your board. Invite-only ones stay private.</Text>
      ) : null}
    </Screen>
  )
}

function NoteEditor({ tile, onDone }: { tile: Extract<BoardTile, { kind: 'note' }> | null; onDone: (t: BoardTile) => void }) {
  const [text, setText] = useState(tile?.text ?? '')
  return (
    <Screen title="Note" right={<DoneButton ok={!!text.trim()} onPress={() => onDone({ kind: 'note', text: text.trim() })} />} contentStyle={{ padding: 16, gap: 12 }}>
      <Field
        label={`A few words · ${text.length}/${BOARD_NOTE_MAX}`}
        value={text}
        onChangeText={setText}
        maxLength={BOARD_NOTE_MAX}
        multiline
        autoFocus
        placeholder="Looking for a duo for ranked on weekends…"
        style={{ minHeight: 110, textAlignVertical: 'top', paddingTop: 12 }}
        accessibilityLabel="Note"
      />
    </Screen>
  )
}

function IntoEditor({ tile, onDone }: { tile: Extract<BoardTile, { kind: 'into' }> | null; onDone: (t: BoardTile) => void }) {
  const { c } = useTheme()
  const [tags, setTags] = useState<string[]>(tile?.tags ?? [])
  const [draft, setDraft] = useState('')
  const add = () => {
    const t = cleanInterestTag(draft)
    if (t && tags.length < BOARD_TAGS_MAX && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) setTags([...tags, t])
    setDraft('')
  }
  const finish = () => {
    const extra = cleanInterestTag(draft)
    onDone({ kind: 'into', tags: extra && !tags.includes(extra) && tags.length < BOARD_TAGS_MAX ? [...tags, extra] : tags })
  }
  return (
    <Screen title="I’m into" right={<DoneButton ok={tags.length > 0 || !!cleanInterestTag(draft)} onPress={finish} />} contentStyle={{ padding: 16, gap: 12 }}>
      <Field
        label={`Add a thing · ${tags.length}/${BOARD_TAGS_MAX}`}
        value={draft}
        onChangeText={setDraft}
        maxLength={BOARD_TAG_MAX}
        autoFocus
        editable={tags.length < BOARD_TAGS_MAX}
        placeholder="Cozy games, lo-fi, cats…"
        returnKeyType="done"
        submitBehavior="submit"
        onSubmitEditing={add}
        accessibilityLabel="Add a thing you're into"
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {tags.map((t) => (
          <Pressable key={t} accessibilityRole="button" accessibilityLabel={`Remove ${t}`} onPress={() => setTags(tags.filter((x) => x !== t))} style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 18, backgroundColor: c.accentSoft }}>
            <Text size={13} weight="bold">
              {t}
            </Text>
            <Icon name="close" size={13} color={c.ink2} />
          </Pressable>
        ))}
      </View>
    </Screen>
  )
}
