import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { clockTime, dayLabel, isSameDay, type ModerationEntry } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { cxSay } from '@/state/constellations'
import { useSession } from '@/state/session'
import { Icon, type IconName } from '@/ui/icons'
import { Spinner, Text } from '@/ui/kit'
import { moderationKind, moderationParts, SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { Caps, Chip, ChipRow, Glyph, N, NightButton } from '@/constellations/ui'

// The moderation log (canvas board 7b): who did what, newest first, with filters.

type Filter = 'all' | 'messages' | 'members' | 'roles'

const ICON: Record<string, { glyph?: Parameters<typeof Glyph>[0]['name']; icon?: IconName; color: string }> = {
  timed_out: { glyph: 'timer', color: N.amber },
  timeout_removed: { glyph: 'timer', color: N.greenText },
  message_deleted: { icon: 'trash', color: N.redText },
  kicked: { glyph: 'kick', color: N.redText },
  banned: { glyph: 'ban', color: N.redText },
  unbanned: { glyph: 'ban', color: N.greenText },
  request_approved: { icon: 'check', color: N.greenText },
  request_denied: { icon: 'close', color: N.muted },
  joined: { icon: 'addPerson', color: N.greenText },
  left: { glyph: 'leave', color: N.muted },
  ownership_transferred: { glyph: 'crown', color: N.amber },
  voice_muted: { glyph: 'micSlash', color: N.amber },
  voice_unmuted: { icon: 'mic', color: N.greenText },
  voice_disconnected: { icon: 'hangup', color: N.redText },
}

export default function ModerationScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  const meId = useSession((s) => s.user?.id ?? '')
  const [entries, setEntries] = useState<ModerationEntry[] | null>(null)
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  useEffect(() => {
    void cx.moderation(cid).then((r) => {
      if (!r.ok) return cxSay(r.message)
      setEntries(r.data.entries)
      setMore(r.data.hasMore)
    })
  }, [cid])
  async function older() {
    if (!entries?.length) return
    setLoadingMore(true)
    const r = await cx.moderation(cid, entries[entries.length - 1].createdAt)
    setLoadingMore(false)
    if (!r.ok) return cxSay(r.message)
    setEntries([...entries, ...r.data.entries])
    setMore(r.data.hasMore)
  }
  const shown = (entries ?? []).filter((e) => filter === 'all' || moderationKind(e) === filter)
  const timedOut = (c?.members ?? []).filter((m) => m.timedOutUntil && new Date(m.timedOutUntil).getTime() > Date.now())

  return (
    <SettingsScreen title="Moderation log" c={c}>
      <ChipRow inset={16}>
        {(['all', 'messages', 'members', 'roles'] as Filter[]).map((f) => (
          <Chip key={f} label={f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)} on={filter === f} onPress={() => setFilter(f)} />
        ))}
      </ChipRow>
      {timedOut.length ? (
        <View style={{ gap: 6 }}>
          <Caps>Timed out now · {timedOut.length}</Caps>
          {timedOut.map((m) => (
            <Text key={m.user.id} size={14} style={{ color: N.ink2 }}>
              <Text size={14} weight="bold">{m.user.displayName}</Text> until {new Date(m.timedOutUntil!).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
            </Text>
          ))}
        </View>
      ) : null}
      {entries === null ? <Spinner /> : null}
      {entries && !shown.length ? (
        <Text size={14} style={{ color: N.muted }}>
          Nothing here yet.
        </Text>
      ) : null}
      <View>
        {shown.map((e, i) => {
          const p = moderationParts(e, meId)
          const look = ICON[e.action] ?? { glyph: 'shield' as const, color: N.violetText }
          const day = i === 0 || !isSameDay(shown[i - 1].createdAt, e.createdAt) ? dayLabel(e.createdAt) : null
          return (
            <View key={e.id}>
              {day ? <Caps style={{ paddingTop: i ? 14 : 4, paddingBottom: 6 }}>{day}</Caps> : null}
              <View accessible style={{ flexDirection: 'row', gap: 12, paddingVertical: 8 }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: N.card2, alignItems: 'center', justifyContent: 'center' }}>
                  {look.icon ? <Icon name={look.icon} size={16} color={look.color} /> : <Glyph name={look.glyph!} size={16} color={look.color} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text size={14} style={{ color: N.ink2, lineHeight: 20 }}>
                    <Text size={14} weight="bold" style={{ color: N.ink }}>{p.actor}</Text> {p.verb}
                    {p.target ? (
                      <>
                        {' '}
                        <Text size={14} weight="bold" style={{ color: N.ink }}>{p.target}</Text>
                      </>
                    ) : null}
                    {p.extra}
                  </Text>
                  <Text size={12} style={{ color: N.faint }}>
                    {clockTime(e.createdAt)}
                    {p.detail ? ` · ${p.detail}` : ''}
                  </Text>
                </View>
              </View>
            </View>
          )
        })}
      </View>
      {more ? <NightButton kind="outline" label="Show older" busy={loadingMore} onPress={() => void older()} /> : null}
    </SettingsScreen>
  )
}
