import { useEffect, useState } from 'react'
import { FlatList, Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { splitMentions, type NebulaMention } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { cxSay, refreshMentionCount, useCx } from '@/state/constellations'
import { useSession } from '@/state/session'
import { isWideNow } from '@/lib/layout'
import { Spinner, Text } from '@/ui/kit'
import { NightSky } from '@/constellations/sky'
import { NightTabBar } from '@/constellations/NightTabBar'
import { haptic } from '@/constellations/motion'
import { roleLook } from '@/constellations/roles'
import { Chip, ChipRow, Face, N } from '@/constellations/ui'

// Mentions (canvas board 8b): every @you across your nebulas, newest first; filter by
// constellation; tap one to open that nebula.

/** "now", "22m", "3h", "Thu", "Oct 2" */
function shortAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  const d = new Date(iso)
  if (s < 6 * 86400) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function openMention(m: Pick<NebulaMention, 'constellation' | 'nebula'>) {
  haptic.select()
  if (isWideNow()) return router.push({ pathname: '/constellations/[cid]', params: { cid: m.constellation.id, nebula: m.nebula.id } })
  router.push({ pathname: '/constellations/[cid]', params: { cid: m.constellation.id } })
  setTimeout(() => router.push({ pathname: '/constellations/[cid]/nebula/[nid]', params: { cid: m.constellation.id, nid: m.nebula.id } }), 40)
}

export default function MentionsScreen() {
  const insets = useSafeAreaInsets()
  const me = useSession((s) => s.user)
  const meId = me?.id ?? ''
  const unread = useCx((s) => s.mentionsUnread)
  const details = useCx((s) => s.details)
  const [list, setList] = useState<NebulaMention[] | null>(null)
  const [more, setMore] = useState(false)
  const [filter, setFilter] = useState<string | null>(null)

  async function load(before?: string) {
    const r = await cx.mentions(before)
    if (!r.ok) return cxSay(r.message)
    setList((old) => (before ? [...(old ?? []), ...r.data.mentions] : r.data.mentions))
    setMore(r.data.more)
    useCx.setState({ mentionsUnread: r.data.unread })
  }
  useEffect(() => {
    void load()
  }, [unread])

  async function readAll() {
    const r = await cx.readMentions()
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    setList((l) => l?.map((m) => ({ ...m, unread: false })) ?? null)
    void refreshMentionCount()
  }

  const places = [...new Map((list ?? []).map((m) => [m.constellation.id, m.constellation])).values()]
  const shown = (list ?? []).filter((m) => !filter || m.constellation.id === filter)

  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      <NightSky flies={1} />
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 50 }}>
        <Text display size={24} style={{ flex: 1 }} accessibilityRole="header">
          Mentions
        </Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !list?.some((m) => m.unread) }} disabled={!list?.some((m) => m.unread)} onPress={() => void readAll()} style={{ height: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: N.edge2, justifyContent: 'center', opacity: list?.some((m) => m.unread) ? 1 : 0.45 }}>
          <Text size={13} weight="bold" style={{ color: N.amber }}>
            Mark all read
          </Text>
        </Pressable>
      </View>
      {places.length > 1 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          <ChipRow inset={16}>
            <Chip label="All" on={!filter} onPress={() => setFilter(null)} />
            {places.map((p) => (
              <Chip key={p.id} label={p.name} on={filter === p.id} onPress={() => setFilter(p.id)} />
            ))}
          </ChipRow>
        </View>
      ) : null}
      <FlatList
        data={shown}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 140, gap: 10 }}
        onEndReachedThreshold={0.5}
        onEndReached={() => more && list?.length && void load(list[list.length - 1].createdAt)}
        ListEmptyComponent={
          list === null ? (
            <View style={{ padding: 32 }}>
              <Spinner />
            </View>
          ) : (
            <View style={{ padding: 32, alignItems: 'center', gap: 6 }}>
              <Text size={16} weight="bold">
                No mentions yet
              </Text>
              <Text size={14} style={{ color: N.muted, textAlign: 'center' }}>
                When someone @mentions you in a nebula, it shows up here.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          list?.length ? (
            <Text size={12} style={{ color: N.faint, textAlign: 'center', marginTop: 4 }}>
              {more ? 'Scroll for older mentions' : 'Tap one to open that nebula'}
            </Text>
          ) : null
        }
        renderItem={({ item: m }) => {
          const c = details[m.constellation.id]
          const look = c ? roleLook(c, m.sender.id) : null
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${m.unread ? 'New. ' : ''}${m.sender.displayName} in ${m.nebula.name}, ${m.constellation.name}: ${m.text}`}
              onPress={() => openMention(m)}
              style={({ pressed }) => ({ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, backgroundColor: m.unread ? N.card : 'rgba(28,18,16,0.7)', borderWidth: 1, borderColor: m.unread ? N.edge : N.line, opacity: pressed ? 0.85 : m.unread ? 1 : 0.8 })}
            >
              <Face user={m.sender} size={40} me={m.sender.id === meId} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text size={13} weight="bold" numberOfLines={1} style={{ color: look?.color ?? N.violetText, flexShrink: 1 }}>
                    {m.sender.displayName}
                  </Text>
                  <Text size={13} style={{ color: N.faint }}>
                    · {shortAgo(m.createdAt)}
                  </Text>
                  <View style={{ flex: 1 }} />
                  {m.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: N.violet }} /> : null}
                </View>
                <Text size={12} numberOfLines={1} style={{ color: N.muted, marginTop: 2 }}>
                  #{m.nebula.name} · {m.constellation.name}
                </Text>
                <Text size={15} numberOfLines={3} style={{ marginTop: 6, lineHeight: 21, color: m.unread ? N.ink : N.ink2 }}>
                  {splitMentions(m.text, [...(c ? c.members.map((x) => x.user) : [m.sender]), ...(me && !c ? [me] : [])]).map((p, i) =>
                    p.user ? (
                      <Text key={i} size={15} weight="bold" style={{ color: N.tag, backgroundColor: p.user.id === meId ? 'rgba(255,179,71,0.28)' : undefined, borderRadius: 5 }}>
                        {p.text}
                      </Text>
                    ) : (
                      p.text
                    ),
                  )}
                </Text>
              </View>
            </Pressable>
          )
        }}
      />
      <NightTabBar active="mentions" />
    </View>
  )
}
