import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, Easing, FlatList, Linking, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native'
import { pickChatMedia } from '@/lib/photos'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { gifSize, gifUrl, triviaScores, WORD_LENGTH, type FireflyEmoji, type GifInfo, type LinkPreview, type Message, type Sticker, type TicTacToe, type Trivia, type WordGuess } from '@glofly/shared'
import * as api from '@/api/glofly'
import { authHeaders, url } from '@/api/http'
import { onLive } from '@/api/realtime'
import { updateMessage } from '@/state/sync'
import { BottomSheet, confirm, inform } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Button, Checkbox, Text, webNoOutline } from '@/ui/kit'
import { font, useTheme } from '@/ui/theme'

// 0.5.0 chat extras on the phone: GIFs, link previews, polls, mini games, lantern messages and
// firefly swarms. The server checks every vote and move; these show what it sends back.

const LANTERN = '#FFB048'

// ---------------------------------------------------------------------------------------------
// GIFs

export function GifView({ gif, onLongPress }: { gif: GifInfo; onLongPress: () => void }) {
  const { c } = useTheme()
  const size = gifSize(gif, 220)
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={300} accessibilityLabel={`GIF: ${gif.title}`}>
      <Image source={{ uri: gifUrl(gif.id, 'full') }} style={{ width: size.width, height: size.height, borderRadius: 16, backgroundColor: c.surface2 }} contentFit="cover" autoplay cachePolicy="disk" />
    </Pressable>
  )
}

/** Search GIPHY (trending until you type); resolves with the GIF picked, or null. */
export function GifSheet({ onPick, onPickSticker }: { onPick: (gif: GifInfo | null) => void; onPickSticker: (sticker: Sticker) => void }) {
  const [tab, setTab] = useState<'gifs' | 'stickers'>('gifs')
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<GifInfo[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [problem, setProblem] = useState('')
  const asked = useRef(0)

  async function load(q: string, offset: number) {
    const ask = ++asked.current
    if (offset === 0) setStatus('loading')
    const r = await api.gifs(q, offset)
    if (ask !== asked.current) return
    if (!r.ok) {
      setProblem(r.message)
      return setStatus('error')
    }
    setGifs((list) => (offset === 0 ? r.data.gifs : [...list, ...r.data.gifs]))
    setNext(r.data.next)
    setStatus('ready')
  }
  useEffect(() => {
    const t = setTimeout(() => void load(query, 0), query ? 350 : 0)
    return () => clearTimeout(t)
  }, [query])

  const col = (Math.min(width, 560) - 16 * 2 - 8) / 2
  return (
    <BottomSheet onClose={() => onPick(null)}>
      <View style={{ height: 520, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: 'row', gap: 4, marginHorizontal: 16, marginBottom: 10, padding: 3, borderRadius: 12, backgroundColor: c.surface }} accessibilityRole="tablist">
          {(['gifs', 'stickers'] as const).map((t) => (
            <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} style={{ flex: 1, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === t ? c.sheet : 'transparent' }}>
              <Text size={14} weight="bold" tone={tab === t ? 'ink' : 'muted'}>
                {t === 'gifs' ? 'GIFs' : 'My stickers'}
              </Text>
            </Pressable>
          ))}
        </View>
        {tab === 'stickers' ? (
          <StickerTray onPick={onPickSticker} />
        ) : (
        <>
        <View style={{ marginHorizontal: 16, height: 48, borderRadius: 24, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 }}>
          <Icon name="search" size={20} color={c.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search GIPHY"
            placeholderTextColor={c.muted}
            accessibilityLabel="Search GIFs"
            maxLength={50}
            style={[{ flex: 1, color: c.ink, fontFamily: font.body, fontSize: 16 }, webNoOutline]}
          />
        </View>
        <Text size={12} weight="bold" tone="faint" style={{ marginHorizontal: 20, marginTop: 10, marginBottom: 6, letterSpacing: 0.7, textTransform: 'uppercase' }}>
          {query.trim() ? 'Results' : 'Trending'}
        </Text>
        {status === 'error' ? (
          <Text tone="muted" style={{ textAlign: 'center', padding: 24 }}>
            {problem}
          </Text>
        ) : (
          <FlatList
            data={gifs}
            numColumns={2}
            keyExtractor={(g) => g.id}
            columnWrapperStyle={{ gap: 8 }}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              if (next === null || status !== 'ready') return
              const from = next
              setNext(null)
              void load(query, from)
            }}
            ListEmptyComponent={
              <Text tone="muted" style={{ textAlign: 'center', padding: 24 }}>
                {status === 'loading' ? 'Loading…' : `No GIFs for “${query.trim()}”.`}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" accessibilityLabel={`Send GIF: ${item.title}`} onPress={() => onPick(item)}>
                <Image source={{ uri: gifUrl(item.id, 'small') }} style={{ width: col, height: col * 0.75, borderRadius: 12, backgroundColor: c.surface2 }} contentFit="cover" autoplay />
              </Pressable>
            )}
          />
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4, paddingHorizontal: 20, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: c.line }}>
          <Text size={11} tone="faint">
            Powered by
          </Text>
          <Text size={12} weight="bold" display>
            GIPHY
          </Text>
        </View>
        </>
        )}
      </View>
    </BottomSheet>
  )
}

/** Your stickers, and "Make a sticker" from a photo (the server cuts out the background). */
function StickerTray({ onPick }: { onPick: (sticker: Sticker) => void }) {
  const { c } = useTheme()
  const { width } = useWindowDimensions()
  const [stickers, setStickers] = useState<Sticker[] | null>(null)
  const [making, setMaking] = useState(false)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    void api.stickers().then((r) => (r.ok ? setStickers(r.data) : setProblem(r.message)))
  }, [])
  const cell = (Math.min(width, 560) - 32 - 16) / 3

  async function make() {
    const picked = await pickChatMedia('library', 1)
    if (picked === 'denied' || !picked?.length) return
    const photo = picked[0]
    if (photo.video) return setProblem('Pick a photo, not a video.')
    setMaking(true)
    setProblem('')
    const r = await api.makeSticker({ uri: photo.uri, type: photo.type || 'image/jpeg' })
    setMaking(false)
    if (r.ok) setStickers((list) => [r.data, ...(list ?? [])])
    else setProblem(r.message)
  }

  async function remove(st: Sticker) {
    const ok = await confirm({ title: 'Delete this sticker?', message: 'It stays in chats you already sent it to.', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    setStickers((list) => list?.filter((x) => x.id !== st.id) ?? null)
    await api.removeSticker(st.id)
  }

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, gap: 10 }}>
      <Text size={13} tone="muted">
        Turn any photo into a sticker: Glofly cuts out what's in front. Hold a sticker to delete it.
      </Text>
      {problem ? (
        <Text size={13} tone="danger">
          {problem}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Make a sticker" disabled={making} onPress={() => void make()} style={{ width: cell, height: cell, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.accent, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          {making ? <ActivityIndicator color={c.accent} /> : <Icon name="plus" size={24} color={c.accentText} />}
          <Text size={12} weight="bold" tone="accent" style={{ textAlign: 'center' }}>
            {making ? 'Cutting it out…' : 'Make a sticker'}
          </Text>
        </Pressable>
        {stickers?.map((st) => (
          <Pressable key={st.id} accessibilityRole="button" accessibilityLabel="Send sticker" onPress={() => onPick(st)} onLongPress={() => void remove(st)} style={{ width: cell, height: cell, borderRadius: 16, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
            <Image source={{ uri: url(api.stickerImagePath(st.id)), headers: authHeaders(), cacheKey: `st-${st.id}` }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  )
}

// ---------------------------------------------------------------------------------------------
// Link previews

export function LinkCard({ message, preview, mine }: { message: Message; preview: LinkPreview; mine: boolean }) {
  const { c } = useTheme()
  const [imageOk, setImageOk] = useState(true)
  let host = ''
  try {
    host = new URL(preview.url).hostname.replace(/^www\./, '')
  } catch {
    host = ''
  }
  const wide = !!preview.image && preview.image.width >= preview.image.height * 1.3
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${preview.title}, ${preview.siteName ?? host}. Open link`}
      onPress={() => {
        if (/^https?:\/\//i.test(preview.url)) void Linking.openURL(preview.url)
      }}
      style={{ marginTop: 6, width: 240, borderRadius: 14, overflow: 'hidden', backgroundColor: mine ? c.quoteBg : c.bg, borderLeftWidth: 3, borderLeftColor: mine ? c.meInk : c.accent }}
    >
      {preview.image && imageOk && wide ? (
        <Image source={{ uri: url(api.previewImagePath(message.conversationId, message.id)), headers: authHeaders(), cacheKey: `lp-${message.id}` }} style={{ width: 240, height: 240 / (preview.image.width / preview.image.height) }} contentFit="cover" onError={() => setImageOk(false)} />
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10, padding: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text size={12} weight="bold" numberOfLines={1} style={{ color: mine ? c.meInk : c.muted }}>
            {preview.siteName || host}
          </Text>
          <Text size={14} weight="bold" numberOfLines={2} style={{ color: mine ? c.meInk : c.accentText }}>
            {preview.title}
          </Text>
          {preview.description ? (
            <Text size={13} numberOfLines={2} style={{ color: mine ? c.meInk : c.ink2 }}>
              {preview.description}
            </Text>
          ) : null}
        </View>
        {preview.image && imageOk && !wide ? (
          <Image source={{ uri: url(api.previewImagePath(message.conversationId, message.id)), headers: authHeaders(), cacheKey: `lp-${message.id}` }} style={{ width: 56, height: 56, borderRadius: 8 }} contentFit="cover" onError={() => setImageOk(false)} />
        ) : null}
      </View>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------------------------
// Polls and games: cards drawn outside the bubble, in the app's surface color.

function Card({ label, icon, children, right }: { label: string; icon: 'gamepad' | 'poll'; children: React.ReactNode; right?: string }) {
  const { c } = useTheme()
  return (
    <View style={{ width: 280, maxWidth: '100%', padding: 14, borderRadius: 20, backgroundColor: c.sheet, borderWidth: 1, borderColor: c.line, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 12, backgroundColor: c.accentSoft }}>
          {icon === 'gamepad' ? <Icon name="gamepad" size={14} color={c.accentText} /> : <PollGlyph color={c.accentText} />}
          <Text size={11} weight="bold" tone="accent" style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>
            {label}
          </Text>
        </View>
        {right ? (
          <Text size={12} tone="faint">
            {right}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  )
}

function PollGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 14, height: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
      {[6, 12, 8].map((h, i) => (
        <View key={i} style={{ width: 3, height: h, borderRadius: 1, backgroundColor: color }} />
      ))}
    </View>
  )
}

async function run(call: Promise<import('@glofly/shared').ApiResult<Message>>, title: string): Promise<boolean> {
  const r = await call
  if (r.ok) updateMessage(r.data)
  else void inform(title, r.message)
  return r.ok
}

export function PollCard({ message, meId, nameOf, canAct }: { message: Message; meId: string; nameOf: (id: string) => string; canAct: boolean }) {
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  const poll = message.poll
  if (!poll) return null
  const voters = new Set(poll.options.flatMap((o) => o.votes))
  const total = voters.size
  const most = Math.max(1, ...poll.options.map((o) => o.votes.length))
  const mine = poll.options.map((o, i) => (o.votes.includes(meId) ? i : -1)).filter((i) => i >= 0)
  const closed = !!poll.closedAt
  const open = canAct && !closed

  async function pick(i: number) {
    if (!open || busy || !poll) return
    const next = poll.multi ? (mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i]) : mine.includes(i) ? [] : [i]
    setBusy(true)
    await run(api.vote(message.conversationId, message.id, next), "Couldn't vote")
    setBusy(false)
  }

  return (
    <Card label="Poll" icon="poll" right={closed ? 'Closed' : poll.multi ? 'Pick any' : 'Pick one'}>
      <Text display size={17} weight="medium">
        {poll.question}
      </Text>
      <View style={{ gap: 6 }}>
        {poll.options.map((o, i) => {
          const picked = mine.includes(i)
          const share = total ? Math.round((o.votes.length / total) * 100) : 0
          return (
            <Pressable
              key={i}
              accessibilityRole={poll.multi ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: picked, disabled: !open }}
              accessibilityLabel={`${o.text}, ${o.votes.length} ${o.votes.length === 1 ? 'vote' : 'votes'}`}
              disabled={!open || busy}
              onPress={() => void pick(i)}
              style={{ minHeight: 44, borderRadius: 14, borderWidth: 1.5, borderColor: picked ? c.accent : c.line, overflow: 'hidden', justifyContent: 'center' }}
            >
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${total ? (o.votes.length / most) * 100 : 0}%`, backgroundColor: picked ? c.accentSoft : c.surface }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                <View style={{ width: 20, height: 20, borderRadius: poll.multi ? 6 : 10, borderWidth: 1.5, borderColor: picked ? c.accent : c.fieldLine, backgroundColor: picked ? c.accent : c.sheet, alignItems: 'center', justifyContent: 'center' }}>
                  {picked ? <Icon name="check" size={12} color={c.accentInk} strokeWidth={3} /> : null}
                </View>
                <Text size={15} style={{ flex: 1 }}>
                  {o.text}
                </Text>
                {total ? (
                  <Text size={13} weight="bold" tone="muted">
                    {share}%
                  </Text>
                ) : null}
              </View>
            </Pressable>
          )
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text size={12} tone="faint">
          {total === 0 ? 'No votes yet' : total === 1 ? '1 vote' : `${total} votes`}
          {total > 0 ? ` · ${poll.options.flatMap((o) => o.votes).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).map(nameOf).join(', ')}` : ''}
        </Text>
        {message.senderId === meId && !closed && canAct ? (
          <Pressable accessibilityRole="button" onPress={() => void run(api.closePoll(message.conversationId, message.id), "Couldn't close it")} hitSlop={8}>
            <Text size={13} weight="bold" tone="accent">
              Close poll
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  )
}

/** Ask the group something. Resolves once posted (or closed). */
export function PollSheet({ conversationId, onDone }: { conversationId: string; onDone: () => void }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multi, setMulti] = useState(false)
  const [busy, setBusy] = useState(false)
  const filled = options.map((o) => o.trim()).filter(Boolean)
  const ready = question.trim().length > 0 && new Set(filled).size >= 2
  const field = [{ height: 46, borderWidth: 1.5, borderColor: c.fieldLine, borderRadius: 12, paddingHorizontal: 12, color: c.ink, fontFamily: font.body, fontSize: 16 }, webNoOutline]

  async function post() {
    if (!ready || busy) return
    setBusy(true)
    const ok = await run(api.createPoll(conversationId, question.trim(), filled, multi), "Couldn't post the poll")
    setBusy(false)
    if (ok) onDone()
  }

  return (
    <BottomSheet onClose={onDone}>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 620 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 20, gap: 12 }}>
        <Text display size={22}>
          New poll
        </Text>
        <TextInput value={question} onChangeText={setQuestion} placeholder="Ask a question" placeholderTextColor={c.faint} maxLength={120} accessibilityLabel="Question" style={field} />
        {options.map((o, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              value={o}
              onChangeText={(t) => setOptions((list) => list.map((x, j) => (j === i ? t : x)))}
              placeholder={`Choice ${i + 1}`}
              placeholderTextColor={c.faint}
              maxLength={120}
              accessibilityLabel={`Choice ${i + 1}`}
              style={[field, { flex: 1 }]}
            />
            {options.length > 2 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove choice ${i + 1}`} onPress={() => setOptions((list) => list.filter((_, j) => j !== i))} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={16} color={c.muted} />
              </Pressable>
            ) : null}
          </View>
        ))}
        {options.length < 6 ? (
          <Pressable accessibilityRole="button" onPress={() => setOptions((list) => [...list, ''])} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
            <Text size={15} weight="bold" tone="accent">
              + Add a choice
            </Text>
          </Pressable>
        ) : null}
        <Checkbox value={multi} onChange={setMulti}>
          <Text size={15}>Let people pick more than one</Text>
        </Checkbox>
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button label="Cancel" kind="ghost" compact onPress={onDone} />
          <Button label="Post poll" compact busy={busy} disabled={!ready} onPress={() => void post()} />
        </View>
      </ScrollView>
    </BottomSheet>
  )
}

export const GAMES: { kind: api.ChatGameKind; label: string; detail: string }[] = [
  { kind: 'tictactoe', label: 'Tic-tac-toe', detail: 'You against whoever plays next' },
  { kind: 'wordguess', label: 'Word guess', detail: 'Find the five-letter word together' },
  { kind: 'trivia', label: 'Trivia', detail: 'Five questions, everyone answers' },
]

type GameProps = { message: Message; meId: string; nameOf: (id: string) => string; canAct: boolean; memberIds: string[] }

export function GameCard(props: GameProps) {
  const g = props.message.game
  const [busy, setBusy] = useState(false)
  if (!g) return null
  const play = async (move: api.ChatGameMove) => {
    setBusy(true)
    const ok = await run(api.gameMove(props.message.conversationId, props.message.id, move), "Can't do that")
    setBusy(false)
    return ok
  }
  const label = GAMES.find((x) => x.kind === g.kind)?.label ?? 'Game'
  return (
    <Card label={label} icon="gamepad">
      {g.kind === 'tictactoe' ? <TicTacToeView g={g} {...props} busy={busy} play={play} /> : g.kind === 'wordguess' ? <WordGuessView g={g} {...props} busy={busy} play={play} /> : <TriviaView g={g} {...props} busy={busy} play={play} />}
    </Card>
  )
}

type ViewProps<T> = GameProps & { g: T; busy: boolean; play: (m: api.ChatGameMove) => Promise<boolean> }
const who = (id: string | null, meId: string, nameOf: (id: string) => string) => (!id ? 'someone' : id === meId ? 'You' : nameOf(id))
const O_BLUE = '#3A7BD5'

function TicTacToeView({ g, meId, nameOf, canAct, busy, play }: ViewProps<TicTacToe>) {
  const { c } = useTheme()
  const myMark = meId === g.x ? 'X' : meId === g.o ? 'O' : g.o === null ? 'O' : null
  const myTurn = !g.winner && myMark === g.turn
  const turnOf = g.turn === 'X' ? g.x : g.o
  const winnerId = g.winner === 'X' ? g.x : g.winner === 'O' ? g.o : null
  const status = g.winner ? (g.winner === 'draw' ? "It's a draw!" : `${who(winnerId, meId, nameOf)} ${winnerId === meId ? 'win' : 'wins'}! 🎉`) : myTurn ? (g.o === null && meId !== g.x ? 'Make a move to play O' : 'Your turn') : turnOf ? `${who(turnOf, meId, nameOf)}'s turn` : 'Waiting for someone to play O'
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {(['X', 'O'] as const).map((mark) => (
          <View key={mark} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: g.turn === mark && !g.winner ? c.accentSoft : c.surface, borderWidth: g.turn === mark && !g.winner ? 1.5 : 0, borderColor: c.accent }}>
            <Text display weight="bold" size={15} style={{ color: mark === 'X' ? c.accentText : O_BLUE }}>
              {mark}
            </Text>
            <Text size={13} numberOfLines={1} style={{ flex: 1 }}>
              {mark === 'X' ? who(g.x, meId, nameOf) : g.o ? who(g.o, meId, nameOf) : 'open seat'}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ width: 204, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignSelf: 'center' }}>
        {g.board.map((cell, i) => {
          const win = g.line?.includes(i)
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={cell ? `Square ${i + 1}, ${cell}` : `Square ${i + 1}, empty`}
              disabled={!canAct || busy || !!cell || !myTurn}
              onPress={() => void play({ square: i })}
              style={{ width: 64, height: 64, borderRadius: 14, backgroundColor: win ? c.accentSoft : c.surface, alignItems: 'center', justifyContent: 'center', boxShadow: win ? `0 0 14px ${c.glow}` : undefined }}
            >
              <Text display weight="bold" size={30} style={{ color: cell === 'X' ? c.accentText : O_BLUE }}>
                {cell}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <Text size={14} weight={g.winner ? 'bold' : 'regular'} tone={g.winner ? 'ink' : 'muted'}>
        {status}
      </Text>
    </>
  )
}

const TILE = { hit: '#2E9E5B', near: '#E2A00F', miss: '#9A8576' } as const

function WordGuessView({ g, meId, nameOf, canAct, busy, play }: ViewProps<WordGuess>) {
  const { c } = useTheme()
  const [word, setWord] = useState('')
  const rows = Array.from({ length: g.maxGuesses }, (_, i) => g.guesses[i] ?? null)
  const solver = g.solved ? (g.guesses.at(-1)?.userId ?? null) : null
  async function guess() {
    if (word.length !== WORD_LENGTH || busy) return
    if (await play({ word })) setWord('')
  }
  return (
    <>
      <View style={{ gap: 5 }}>
        {rows.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {Array.from({ length: WORD_LENGTH }, (_, j) => (
              <View key={j} style={{ width: 36, height: 36, borderRadius: 8, borderWidth: r ? 0 : 1.5, borderColor: c.line, backgroundColor: r ? TILE[r.marks[j]] : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                <Text display weight="bold" size={17} style={{ color: r ? '#FFFFFF' : c.ink }}>
                  {r?.word[j] ?? ''}
                </Text>
              </View>
            ))}
            {r ? (
              <Text size={11} tone="faint" numberOfLines={1} style={{ flex: 1, marginLeft: 2 }}>
                {who(r.userId, meId, nameOf)}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      {g.over ? (
        <Text size={14} weight="bold">
          {g.solved ? `${who(solver, meId, nameOf)} got it in ${g.guesses.length}! 🎉` : `Out of guesses. The word was ${g.answer ?? '…'}.`}
        </Text>
      ) : canAct ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={word}
            onChangeText={(t) => setWord(t.replace(/[^a-z]/gi, '').toUpperCase().slice(0, WORD_LENGTH))}
            placeholder="Your guess"
            placeholderTextColor={c.faint}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Your five-letter guess"
            onSubmitEditing={() => void guess()}
            style={[{ flex: 1, height: 44, borderWidth: 1.5, borderColor: c.fieldLine, borderRadius: 12, paddingHorizontal: 12, color: c.ink, fontFamily: font.displayBold, fontSize: 17, letterSpacing: 3 }, webNoOutline]}
          />
          <Button label="Guess" compact busy={busy} disabled={word.length !== WORD_LENGTH} onPress={() => void guess()} />
        </View>
      ) : null}
      {!g.over ? (
        <Text size={12} tone="faint">
          {g.maxGuesses - g.guesses.length} of {g.maxGuesses} guesses left · anyone can guess
        </Text>
      ) : null}
    </>
  )
}

function TriviaView({ g, meId, nameOf, canAct, memberIds, busy, play }: ViewProps<Trivia>) {
  const { c } = useTheme()
  const scores = triviaScores(g)
  if (g.over) {
    const board = memberIds
      .filter((id) => g.picks.some((p) => p.userId === id))
      .map((id) => ({ id, score: scores[id] ?? 0 }))
      .sort((a, b) => b.score - a.score)
    const top = board[0]?.score ?? 0
    return (
      <>
        <Text display size={16} weight="medium">
          Final scores
        </Text>
        {board.map((x) => (
          <View key={x.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: x.score === top && top > 0 ? c.accentSoft : c.surface }}>
            <Text size={14}>
              {who(x.id, meId, nameOf)}
              {x.score === top && top > 0 ? ' 👑' : ''}
            </Text>
            <Text size={14} weight="bold">
              {x.score}/{g.questions.length}
            </Text>
          </View>
        ))}
      </>
    )
  }
  const q = g.questions[g.current]
  const last = g.current > 0 ? g.questions[g.current - 1] : null
  const answered = new Set(g.picks.filter((p) => p.question === g.current).map((p) => p.userId))
  const iAnswered = answered.has(meId)
  const waiting = memberIds.filter((id) => !answered.has(id)).length
  return (
    <>
      {last ? (
        <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: c.onlineSoft }}>
          <Text size={13} tone="online">
            Last answer: <Text size={13} weight="bold" tone="online">{last.choices[last.answer] ?? '?'}</Text>
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {g.questions.map((_, i) => (
          <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i < g.current ? c.accentSoft : i === g.current ? c.accent : c.line }} />
        ))}
        <Text size={12} tone="faint" style={{ marginLeft: 'auto' }}>
          {q.category}
        </Text>
      </View>
      <Text display size={16} weight="medium">
        {q.q}
      </Text>
      <View style={{ gap: 6 }}>
        {q.choices.map((choice, i) => (
          <Pressable
            key={i}
            accessibilityRole="button"
            disabled={!canAct || busy || iAnswered}
            onPress={() => void play({ question: g.current, choice: i })}
            style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1.5, borderColor: c.line, opacity: iAnswered ? 0.7 : 1 }}
          >
            <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Text size={12} weight="bold" tone="muted">
                {'ABCD'[i]}
              </Text>
            </View>
            <Text size={14} style={{ flex: 1 }}>
              {choice}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text size={12} tone="faint" style={{ flex: 1 }}>
          {iAnswered ? (waiting > 0 ? `Answer locked in · waiting for ${waiting} more` : 'Answer locked in') : `${answered.size} answered`}
        </Text>
        {g.host === meId && canAct && answered.size > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => void play({ reveal: true })} hitSlop={8}>
            <Text size={13} weight="bold" tone="accent">
              Show answer
            </Text>
          </Pressable>
        ) : null}
      </View>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Lantern messages

export function LanternTag({ fadeAt }: { fadeAt: string | null | undefined }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, marginHorizontal: 6 }}>
      <LanternGlyph size={12} />
      <Text size={11} weight="bold" style={{ color: '#B8700A' }}>
        {fadeAt ? 'Fading away…' : 'Lantern · fades once read'}
      </Text>
    </View>
  )
}

export function LanternGlyph({ size = 16 }: { size?: number }) {
  return <View style={{ width: size * 0.7, height: size, borderRadius: size * 0.3, backgroundColor: LANTERN, boxShadow: `0 0 ${size * 0.6}px ${LANTERN}` }} />
}

/** A lantern's glow, and its fade once everyone has read it. */
export function useLanternFade(fadeAt: string | null | undefined): Animated.Value {
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!fadeAt) return
    const left = Math.max(0, new Date(fadeAt).getTime() - Date.now())
    const anim = Animated.timing(opacity, { toValue: 0.08, duration: left, easing: Easing.linear, useNativeDriver: true })
    anim.start()
    return () => anim.stop()
  }, [fadeAt, opacity])
  return opacity
}

/** Above the message box while the next message will be a lantern. */
export function LanternBar({ onOff }: { onOff: () => void }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingLeft: 12, paddingRight: 6, borderRadius: 14, backgroundColor: 'rgba(255,176,72,0.18)', borderWidth: 1, borderColor: 'rgba(255,176,72,0.55)' }}>
      <LanternGlyph />
      <Text size={13} style={{ flex: 1 }}>
        <Text size={13} weight="bold">
          Lantern message
        </Text>{' '}
        · fades once everyone has read it
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Turn off lantern" onPress={onOff} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="close" size={16} color={c.muted} />
      </Pressable>
    </View>
  )
}

// ---------------------------------------------------------------------------------------------
// Firefly swarms

type Fly = { x: number; delay: number; drift: number; size: number; y: Animated.Value }
type Swarm = { id: string; emoji: FireflyEmoji; name: string; flies: Fly[]; label: Animated.Value }

/** Someone long-pressed ❤️ or 🔥: a swarm of fireflies rises across the chat. */
export function ChatFireflies({ conversationId, meId, nameOf }: { conversationId: string; meId: string; nameOf: (id: string) => string }) {
  const { height } = useWindowDimensions()
  const [swarms, setSwarms] = useState<Swarm[]>([])
  const nameRef = useRef(nameOf)
  useEffect(() => {
    nameRef.current = nameOf
  })
  useEffect(
    () =>
      onLive((event, payload) => {
        if (event !== 'chat:fireflies') return
        const p = payload as { conversationId: string; userId: string; emoji: FireflyEmoji; id: string }
        if (p.conversationId !== conversationId) return
        const swarm: Swarm = {
          id: p.id,
          emoji: p.emoji,
          name: p.userId === meId ? 'You' : nameRef.current(p.userId),
          label: new Animated.Value(0),
          flies: Array.from({ length: 12 }, () => ({ x: 4 + Math.random() * 88, delay: Math.random() * 900, drift: (Math.random() - 0.5) * 110, size: 0.75 + Math.random() * 0.55, y: new Animated.Value(0) })),
        }
        setSwarms((all) => (all.some((s) => s.id === swarm.id) ? all : [...all.slice(-2), swarm]))
        Animated.sequence([Animated.timing(swarm.label, { toValue: 1, duration: 300, useNativeDriver: true }), Animated.delay(2200), Animated.timing(swarm.label, { toValue: 0, duration: 500, useNativeDriver: true })]).start()
        for (const f of swarm.flies) Animated.timing(f.y, { toValue: 1, duration: 3400, delay: f.delay, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
        setTimeout(() => setSwarms((all) => all.filter((s) => s.id !== swarm.id)), 4600)
      }),
    [conversationId, meId],
  )
  if (!swarms.length) return null
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }} accessibilityLiveRegion="polite">
      {swarms.map((s) => (
        <View key={s.id} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
          {s.flies.map((f, i) => {
            const d = 26 * f.size
            return (
              <Animated.View
                key={i}
                style={{
                  position: 'absolute',
                  left: `${f.x}%`,
                  bottom: -30,
                  width: d,
                  height: d,
                  borderRadius: d / 2,
                  backgroundColor: '#FFD27A',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 18px 6px rgba(255,166,60,0.6)',
                  opacity: f.y.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] }),
                  transform: [{ translateY: f.y.interpolate({ inputRange: [0, 1], outputRange: [0, -height * 0.8] }) }, { translateX: f.y.interpolate({ inputRange: [0, 1], outputRange: [0, f.drift] }) }],
                }}
              >
                <Text size={12 * f.size}>{s.emoji}</Text>
              </Animated.View>
            )
          })}
          <Animated.View style={{ position: 'absolute', alignSelf: 'center', bottom: '24%', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(28,18,16,0.75)', opacity: s.label }}>
            <Text size={13} weight="bold" style={{ color: '#FFFFFF' }}>
              {s.name} sent {s.emoji === '🔥' ? 'fire' : 'love'}
            </Text>
          </Animated.View>
        </View>
      ))}
    </View>
  )
}
