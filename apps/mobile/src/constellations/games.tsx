import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { colorsFor, gameKey, timeAgo, type MyGame } from '@glofly/shared'
import { Image } from 'expo-image'
import { gameCoverSource } from '@/profiles/Board'
import { cx } from '@/api/constellations'
import { useStore } from '@/state/store'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { font, useTheme } from '@/ui/theme'

// My games (canvas board 10): the games someone has played, with their playtime. Drawn in Glofly's
// own colors (light or dark), not the night side's.

/** "SV" for Stardew Valley, "HD" for Hades. */
export function gameInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export function GameTile({ name, size, radius, ring, cover }: { name: string; size: number; radius: number; ring?: string; cover?: string }) {
  const [bg] = colorsFor(gameKey(name))
  // 0.9.1: box art (IGDB, served by Glofly) when known.
  if (cover)
    return (
      <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg, overflow: 'hidden', borderWidth: ring ? 2 : 0, borderColor: ring }}>
        <Image source={gameCoverSource(cover)} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={120} accessibilityIgnoresInvertColors />
      </View>
    )
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', borderWidth: ring ? 2 : 0, borderColor: ring }}>
      <Text style={{ color: '#ffffff', fontFamily: font.displayBold, fontSize: Math.round(size * 0.3) }}>{gameInitials(name)}</Text>
    </View>
  )
}

/** "214 h", "45 m" */
export function hoursShort(seconds: number): string {
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${Math.max(1, m)} m`
  return `${Math.round(seconds / 3600)} h`
}

/** "playing now", "yesterday", "3 days ago", "Sept 30" */
export function lastPlayed(g: MyGame, playingNow: string | null): string {
  if (playingNow && gameKey(playingNow) === g.key) return 'playing now'
  const days = (Date.now() - new Date(g.lastPlayedAt).getTime()) / 86_400_000
  if (days >= 7 && days < 14) return 'last week'
  return timeAgo(g.lastPlayedAt).replace(/^on /, '')
}

/** Favorites first (by playtime), then the rest by playtime. */
export function sortGames(games: MyGame[]): MyGame[] {
  return [...games].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.seconds - a.seconds)
}

/** The "My games · 12 games · 410 hours" card on a profile (hidden when there's nothing to show). */
export function GamesCard({ userId, isMe, onOpen }: { userId: string; isMe: boolean; onOpen?: () => void }) {
  const { c } = useTheme()
  const [games, setGames] = useState<MyGame[] | null>(null)
  useEffect(() => {
    let live = true
    void (isMe ? cx.myGames() : cx.gamesOf(userId)).then((r) => {
      if (!live) return
      if (!r.ok) return setGames([])
      setGames('shared' in r.data && !r.data.shared ? [] : r.data.games.filter((g) => isMe || !g.hidden))
    })
    return () => {
      live = false
    }
  }, [userId, isMe])
  if (!games || (!games.length && !isMe)) return null
  const total = games.reduce((s, g) => s + g.seconds, 0)
  const top = sortGames(games).slice(0, 3)
  const hours = Math.round(total / 3600)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`My games, ${games.length} ${games.length === 1 ? 'game' : 'games'}, ${hours} hours`}
      onPress={() => {
        onOpen?.()
        router.push({ pathname: '/games/[id]', params: { id: isMe ? 'me' : userId } })
      }}
      style={({ pressed }) => ({ minHeight: 64, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.surface : c.bg, flexDirection: 'row', alignItems: 'center', gap: 12, boxShadow: `0 4px 14px ${c.shadow}` })}
    >
      {top.length ? (
        <View style={{ flexDirection: 'row' }}>
          {top.map((g, i) => (
            <View key={g.key} style={{ marginLeft: i ? -12 : 0 }}>
              <GameTile name={g.name} cover={g.cover} size={36} radius={10} ring={c.bg} />
            </View>
          ))}
        </View>
      ) : (
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="gamepad" size={20} color={c.muted} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text size={16} weight="bold">
          My games
        </Text>
        <Text size={13} tone="muted">
          {games.length ? `${games.length} ${games.length === 1 ? 'game' : 'games'} · ${hours} ${hours === 1 ? 'hour' : 'hours'}` : 'Nothing played yet'}
        </Text>
      </View>
      <Icon name="chevronRight" size={18} color={c.faint} />
    </Pressable>
  )
}

/** What someone is playing right now (from their presence), for "playing now". */
export function usePlayingNow(userId: string): string | null {
  return useStore((s) => s.presence[userId]?.activity?.name ?? null)
}
