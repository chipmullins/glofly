import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import {
  colorsFor,
  playtimeLabel,
  type ActivityItem,
  type BoardTileView,
  type ConstellationColor,
  type MutualConstellation,
  type ProfileConstellation,
  type PublicUser,
} from '@glofly/shared'
import * as api from '@/api/glofly'
import { cx } from '@/api/constellations'
import { authHeaders, url } from '@/api/http'
import { ConstellationIcon } from '@/constellations/ui'
import { flyIn } from '@/constellations/transition'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/icons'
import { Spinner, Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'

// Profiles 2.0 on phones (0.9.1, canvas "Glofly profiles" boards PhoneProfile and PhoneTabs):
// the header picture, board tiles, and the Board / Mutuals / Activity tabs. JS only.

const NIGHT = '#1C1210'
const NIGHT_TEXT = '#F5EDE6'
const NIGHT_MUTED = '#B8A699'

export const headerSource = (userId: string, version: string) => ({
  uri: url(`/headers/${userId}/${version}`),
  headers: authHeaders(),
  cacheKey: `header-${userId}-${version}`,
})

/** The header: their picture (placed where they put it), or the night sky. */
export function ProfileHeaderImage({
  userId,
  header,
  height,
  localUri,
}: {
  userId: string
  header: { version: string; focus: number } | null | undefined
  height: number
  /** A picture just picked (not saved yet) */
  localUri?: string | null
}) {
  const source = localUri ? { uri: localUri } : header ? headerSource(userId, header.version) : null
  return (
    <View style={{ height, backgroundColor: '#2A1A33', overflow: 'hidden' }}>
      {source ? (
        <Image
          source={source}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          contentFit="cover"
          contentPosition={{ left: '50%', top: `${header?.focus ?? 50}%` }}
          transition={150}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <>
          {[
            [0.18, 0.3, 3],
            [0.62, 0.22, 2],
            [0.78, 0.6, 3],
            [0.4, 0.68, 2],
          ].map(([x, y, s], i) => (
            <View
              key={i}
              style={{ position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, width: s, height: s, borderRadius: s, backgroundColor: '#FFD59A', opacity: 0.85 }}
            />
          ))}
        </>
      )}
    </View>
  )
}

/** A game's picture (its colors and letters until box art arrives). */
export function GameArt({ name, width, radius = 9 }: { name: string; width?: number; radius?: number }) {
  const [bg, fg] = colorsFor(name)
  const letters = name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? '')
    .join('')
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: width ?? '100%', aspectRatio: 3 / 4, borderRadius: radius, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text size={width && width < 40 ? 11 : 18} weight="bold" style={{ color: fg }}>
        {letters || '?'}
      </Text>
    </View>
  )
}

const label = (t: string, night?: boolean) => (
  <Text size={11.5} weight="bold" style={{ letterSpacing: 0.7, textTransform: 'uppercase', color: night ? NIGHT_MUTED : undefined }} tone={night ? undefined : 'muted'}>
    {t}
  </Text>
)

const hours = (s: number) => (s >= 3600 ? `${Math.round(s / 3600)} h` : playtimeLabel(s))

export function openConstellation(id: string) {
  if (router.canGoBack()) router.back()
  setTimeout(() => flyIn(null, ['/constellations', `/constellations/${id}`] as never), 60)
}

function ConstellationTile({ c: k, preview }: { c: ProfileConstellation; preview?: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'joined' | 'asked'>(k.joined ? 'joined' : 'idle')
  const [problem, setProblem] = useState<string | null>(null)
  async function join() {
    setState('busy')
    setProblem(null)
    const r = await cx.join(k.id)
    if (!r.ok) {
      setState('idle')
      setProblem(r.message)
    } else setState('requested' in r.data ? 'asked' : 'joined')
  }
  return (
    <View style={{ flex: 1, borderRadius: 16, backgroundColor: NIGHT, padding: 12, gap: 6 }}>
      {label('I love', true)}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ConstellationIcon c={{ ...k, color: k.color as ConstellationColor }} size={30} />
        <View style={{ flex: 1 }}>
          <Text size={13.5} weight="bold" numberOfLines={2} style={{ color: NIGHT_TEXT }}>
            {k.name}
          </Text>
          <Text size={11.5} style={{ color: NIGHT_MUTED }}>
            {k.memberCount.toLocaleString()} {k.memberCount === 1 ? 'member' : 'members'}
          </Text>
        </View>
      </View>
      {preview ? null : state === 'asked' ? (
        <Text size={12.5} weight="medium" style={{ color: NIGHT_MUTED, textAlign: 'center' }}>
          Asked to join
        </Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state === 'joined' ? `Open ${k.name}` : `${k.visibility === 'approval' ? 'Ask to join' : 'Join'} ${k.name}`}
          disabled={state === 'busy'}
          onPress={() => (state === 'joined' ? openConstellation(k.id) : void join())}
          style={{ height: 44, borderRadius: 22, backgroundColor: state === 'joined' ? 'rgba(255,255,255,0.12)' : '#FFB347', alignItems: 'center', justifyContent: 'center', opacity: state === 'busy' ? 0.6 : 1 }}
        >
          <Text size={13} weight="bold" style={{ color: state === 'joined' ? NIGHT_TEXT : '#2A1406' }}>
            {state === 'joined' ? 'Open' : k.visibility === 'approval' ? 'Ask to join' : 'Join'}
          </Text>
        </Pressable>
      )}
      {problem ? (
        <Text size={12} style={{ color: '#FFB4A8' }}>
          {problem}
        </Text>
      ) : null}
    </View>
  )
}

/** The board on a phone: wide tiles full width, small ones two to a row. */
export function BoardTiles({ tiles, userId, preview }: { tiles: BoardTileView[]; userId: string; preview?: boolean }) {
  const { c } = useTheme()
  const small = (t: BoardTileView, i: number) => {
    if (t.kind === 'note')
      return (
        <View key={i} style={{ flex: 1, borderRadius: 16, backgroundColor: c.surface, padding: 12, gap: 4 }}>
          {label('Note')}
          <Text size={13.5} style={{ lineHeight: 19 }}>
            {t.text}
          </Text>
        </View>
      )
    if (t.kind === 'constellation') return <ConstellationTile key={t.constellation.id} c={t.constellation} preview={preview} />
    if (t.kind === 'playing')
      return (
        <View key={i} style={{ flex: 1, borderRadius: 16, backgroundColor: NIGHT, padding: 12, gap: 6 }}>
          {label('Playing now', true)}
          {t.game ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <GameArt name={t.game} width={28} radius={5} />
              <Text size={13.5} weight="bold" numberOfLines={2} style={{ color: NIGHT_TEXT, flex: 1 }}>
                {t.game}
              </Text>
            </View>
          ) : (
            <Text size={12.5} style={{ color: NIGHT_MUTED }}>
              Nothing right now
            </Text>
          )}
        </View>
      )
    return null
  }
  // Group the small tiles into pairs, keeping the order.
  const rows: (BoardTileView | BoardTileView[])[] = []
  for (const t of tiles) {
    if (t.kind === 'games' || t.kind === 'into') rows.push(t)
    else {
      const last = rows.at(-1)
      if (Array.isArray(last) && last.length < 2) last.push(t)
      else rows.push([t])
    }
  }
  return (
    <View style={{ gap: 8 }}>
      {rows.map((row, i) =>
        Array.isArray(row) ? (
          <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
            {row.map((t, j) => small(t, j))}
            {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
          </View>
        ) : row.kind === 'games' ? (
          <View key={i} style={{ borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 12, gap: 8 }}>
            {label('Favorite games')}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {row.games.map((g) => (
                <View key={g.key} style={{ flex: 1, maxWidth: '33%', gap: 3 }}>
                  <GameArt name={g.name} />
                  <Text size={12.5} weight="bold" numberOfLines={1}>
                    {g.name}
                  </Text>
                  {g.seconds !== undefined ? (
                    <Text size={11.5} tone="muted">
                      {hours(g.seconds)}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
            {!preview ? (
              <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/games/[id]', params: { id: userId } })} style={{ minHeight: 32, justifyContent: 'center' }}>
                <Text size={13} weight="bold" style={{ color: c.accentText }}>
                  All their games (My games)
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : row.kind === 'into' ? (
          <View key={i} style={{ borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 12, gap: 8 }}>
            {label('I’m into')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {row.tags.map((t) => (
                <View key={t} style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 13, backgroundColor: c.surface }}>
                  <Text size={13} weight="medium">
                    {t}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null,
      )}
    </View>
  )
}

/** Mutual friends, then mutual constellations (one "Mutuals" tab on phones). */
export function MutualsList({ userId, name }: { userId: string; name: string }) {
  const { c } = useTheme()
  const [m, setM] = useState<{ friends: PublicUser[]; constellations: MutualConstellation[] } | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void api.getMutuals(userId).then((r) => live && setM(r.ok && r.data.shown ? r.data : null))
    return () => {
      live = false
    }
  }, [userId])
  if (m === undefined) return <Spinner />
  if (m === null) return <Text tone="muted">{name.split(' ')[0]} keeps this to themselves.</Text>
  if (!m.friends.length && !m.constellations.length) return <Text tone="muted">Nothing in common yet.</Text>
  return (
    <View style={{ gap: 6 }}>
      {m.friends.map((f) => (
        <Pressable
          key={f.id}
          accessibilityRole="button"
          accessibilityLabel={`${f.displayName}, open profile`}
          onPress={() => router.push({ pathname: '/profile/[id]', params: { id: f.id } })}
          style={({ pressed }) => ({ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, borderRadius: 12, backgroundColor: pressed ? c.surface : 'transparent' })}
        >
          <Avatar user={f} size={40} />
          <View style={{ flex: 1 }}>
            <Text size={15} weight="bold">
              {f.displayName}
            </Text>
            <Text size={13} tone="muted">
              @{f.username}
            </Text>
          </View>
          <Icon name="chevronRight" size={18} color={c.muted} />
        </Pressable>
      ))}
      {m.friends.length ? (
        <Text size={12.5} tone="muted">
          Only friends you both have. Nobody sees someone’s whole friend list.
        </Text>
      ) : null}
      {m.constellations.map((k) => (
        <Pressable
          key={k.id}
          accessibilityRole="button"
          accessibilityLabel={`${k.name}, open`}
          onPress={() => openConstellation(k.id)}
          style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, backgroundColor: NIGHT, marginTop: 4 }}
        >
          <ConstellationIcon c={{ ...k, color: k.color as ConstellationColor }} size={36} />
          <View style={{ flex: 1 }}>
            <Text size={14} weight="bold" style={{ color: NIGHT_TEXT }}>
              {k.name}
            </Text>
            <Text size={12} style={{ color: NIGHT_MUTED }}>
              {name.split(' ')[0]}: {k.roles.length ? k.roles.join(' · ') : 'Member'}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  )
}

function day(iso: string): string {
  const d = new Date(iso)
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(new Date()) - start(d)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ActivityFeed({ userId, name }: { userId: string; name: string }) {
  const [items, setItems] = useState<ActivityItem[] | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void api.getActivity(userId).then((r) => live && setItems(r.ok && r.data.shown ? r.data.items : null))
    return () => {
      live = false
    }
  }, [userId])
  if (items === undefined) return <Spinner />
  if (items === null) return <Text tone="muted">{name.split(' ')[0]} keeps this to themselves.</Text>
  if (!items.length) return <Text tone="muted">Nothing in the last 30 days.</Text>
  return (
    <View style={{ gap: 2 }}>
      {items.map((i, n) => {
        const d = day(i.at)
        const Day = d.charAt(0).toUpperCase() + d.slice(1)
        const [title, sub] =
          i.kind === 'played'
            ? [`Played ${i.game}`, `${playtimeLabel(i.seconds)} in all · ${d}`]
            : i.kind === 'started'
              ? [`Started playing ${i.game}`, `${Day} · new to their games`]
              : [`Joined ${i.constellation.name}`, `${Day} · a public constellation`]
        return (
          <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
            {i.kind === 'joined' ? (
              <ConstellationIcon c={{ ...i.constellation, color: i.constellation.color as ConstellationColor }} size={44} />
            ) : (
              <GameArt name={i.game} width={44} radius={8} />
            )}
            <View style={{ flex: 1 }}>
              <Text size={14.5} weight="bold">
                {title}
              </Text>
              <Text size={13} tone="muted">
                {sub}
              </Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}
