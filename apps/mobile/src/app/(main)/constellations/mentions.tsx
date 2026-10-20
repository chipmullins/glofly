import { useCallback, useEffect, useState } from 'react'
import { FlatList, Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { INBOX_TABS, type InboxItem, type InboxPage, type InboxTab, type NebulaMention } from '@glofly/shared'
import { cxSay, refreshMentionCount } from '@/state/constellations'
import { useSession } from '@/state/session'
import { isWideNow } from '@/lib/layout'
import { Spinner, Text } from '@/ui/kit'
import { NightSky } from '@/constellations/sky'
import { NightTabBar } from '@/constellations/NightTabBar'
import { haptic } from '@/constellations/motion'
import { community, refreshInbox, requestJump, startCommunity, useCommunity } from '@/constellations/communityTools'
import { Chip, ChipRow, Face, N } from '@/constellations/ui'

// The Inbox (0.8.0, approved Oct 20 board 15; it replaces Mentions here, on the same tab):
// @mentions, replies to you, events you're going to and join requests you can let in, across
// every constellation. Tap one to open it.

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

/** Opens a nebula (and, given a message, shows it there). */
export function openMention(m: Pick<NebulaMention, 'constellation' | 'nebula'>, messageId?: string) {
  haptic.select()
  if (messageId) requestJump(m.nebula.id, messageId)
  if (isWideNow()) return router.push({ pathname: '/constellations/[cid]', params: { cid: m.constellation.id, nebula: m.nebula.id } })
  router.push({ pathname: '/constellations/[cid]', params: { cid: m.constellation.id } })
  setTimeout(() => router.push({ pathname: '/constellations/[cid]/nebula/[nid]', params: { cid: m.constellation.id, nid: m.nebula.id } }), 40)
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name

function headline(i: InboxItem): string {
  if (i.kind === 'mention') return `${first(i.sender!.displayName)} mentioned you`
  if (i.kind === 'reply') return `${first(i.sender!.displayName)} replied to you`
  if (i.kind === 'request') return `${first(i.request!.user.displayName)} wants to join`
  const e = i.event!
  if (i.key.endsWith(':live')) return `${e.title} is happening now`
  if (i.key.endsWith(':soon')) return `${e.title} starts soon`
  const start = new Date(e.startsAt)
  const days = Math.round((start.getTime() - Date.now()) / 86_400_000)
  return `${e.title} is ${days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `on ${start.toLocaleDateString([], { weekday: 'long' })}`}`
}

function body(i: InboxItem): string {
  if (i.kind === 'reply' && i.repliedTo) return `↪ “${i.repliedTo}” — ${i.text}`
  if (i.kind === 'request') return i.request!.note ? `“${i.request!.note}”` : 'No note.'
  if (i.kind === 'event') {
    const e = i.event!
    const when = new Date(e.startsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    const said = e.mine === 'going' ? ' You said Going.' : e.mine === 'maybe' ? ' You said Maybe.' : ''
    return `${when} · ${e.going} going.${said}${e.mine && !e.started ? ' Reminder 15 min before.' : ''}`
  }
  return i.text ?? ''
}

const BADGE: Record<InboxItem['kind'], { mark: string; bg: string; ink: string }> = {
  mention: { mark: '@', bg: N.orange, ink: N.orangeInk },
  reply: { mark: '↩', bg: '#1789ad', ink: '#ffffff' },
  event: { mark: '★', bg: '#8b3fd9', ink: '#ffffff' },
  request: { mark: '+', bg: N.green, ink: '#ffffff' },
}

export default function InboxScreen() {
  const insets = useSafeAreaInsets()
  const meId = useSession((s) => s.user?.id ?? '')
  const tick = useCommunity((s) => s.inboxTick)
  const [tab, setTab] = useState<InboxTab>('all')
  const [page, setPage] = useState<InboxPage | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (t: InboxTab, before?: string) => {
    const r = await community.inbox(t, before)
    if (!r.ok) return cxSay(r.message)
    setPage((old) => (before && old ? { ...r.data, items: [...old.items, ...r.data.items] } : r.data))
    useCommunity.setState({ inbox: r.data.counts })
  }, [])
  useEffect(() => {
    startCommunity()
  }, [])
  useEffect(() => {
    void load(tab)
  }, [tab, tick, load])

  async function readAll() {
    const r = await community.inboxReadAll()
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    void load(tab)
    void refreshMentionCount()
  }
  async function markRead(i: InboxItem) {
    setPage((p) => (p ? { ...p, items: p.items.map((x) => (x.key === i.key ? { ...x, unread: false } : x)) } : p))
    await community.inboxRead([i.key])
    refreshInbox()
  }
  async function answer(i: InboxItem, decision: 'approve' | 'deny') {
    if (!i.request) return
    setBusy(i.key)
    const r = await community.answerRequest(i.constellation.id, i.request.user.id, decision)
    setBusy(null)
    if (!r.ok) cxSay(r.message)
    else haptic.success()
    void load(tab)
  }
  function open(i: InboxItem) {
    if (i.unread) void community.inboxRead([i.key]).then(() => refreshInbox())
    if (i.nebula) openMention({ constellation: { ...i.constellation }, nebula: { id: i.nebula.id, name: i.nebula.name } }, i.messageId)
  }

  const counts = page?.counts
  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      <NightSky flies={1} />
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 50 }}>
        <Text display size={24} style={{ flex: 1 }} accessibilityRole="header">
          Inbox
        </Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !counts?.all }} disabled={!counts?.all} onPress={() => void readAll()} style={{ height: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: N.edge2, justifyContent: 'center', opacity: counts?.all ? 1 : 0.45 }}>
          <Text size={13} weight="bold" style={{ color: N.amber }}>
            Mark all read
          </Text>
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <ChipRow inset={16}>
          {INBOX_TABS.map((t) => (
            <Chip key={t.id} label={counts && counts[t.id] ? `${t.name} ${counts[t.id]}` : t.name} on={tab === t.id} onPress={() => setTab(t.id)} />
          ))}
        </ChipRow>
      </View>
      <FlatList
        data={page?.items ?? []}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 140, gap: 10 }}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          const last = page?.items.at(-1)
          if (page?.more && last) void load(tab, last.createdAt)
        }}
        ListEmptyComponent={
          page === null ? (
            <View style={{ padding: 32 }}>
              <Spinner />
            </View>
          ) : (
            <View style={{ padding: 32, alignItems: 'center', gap: 6 }}>
              <Text size={16} weight="bold">
                {tab === 'all' ? "You're all caught up" : `No ${INBOX_TABS.find((t) => t.id === tab)!.name.toLowerCase()} right now`}
              </Text>
              <Text size={14} style={{ color: N.muted, textAlign: 'center' }}>
                Mentions, replies, events and join requests land here.
              </Text>
            </View>
          )
        }
        renderItem={({ item: i }) => {
          const face = i.kind === 'request' ? i.request!.user : i.sender
          const b = BADGE[i.kind]
          return (
            <View style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, backgroundColor: i.unread ? N.raised : N.card2, borderWidth: 1, borderColor: i.unread ? N.edge : N.line }}>
              <View style={{ width: 42, height: 42 }}>
                {face ? (
                  <Face user={face} size={42} me={face.id === meId} />
                ) : (
                  <View style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}>
                    <Text size={22}>📅</Text>
                  </View>
                )}
                <View style={{ position: 'absolute', right: -4, bottom: -4, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: N.card2, backgroundColor: b.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Text size={10} weight="bold" style={{ color: b.ink }}>
                    {b.mark}
                  </Text>
                </View>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text size={15} weight="bold" style={{ flex: 1 }} numberOfLines={2}>
                    {headline(i)}
                  </Text>
                  <Text size={12} style={{ color: N.faint }}>
                    {shortAgo(i.createdAt)}
                  </Text>
                  {i.unread ? <View accessibilityLabel="New" style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: N.amber }} /> : null}
                </View>
                <Text size={12} weight="bold" numberOfLines={1} style={{ color: N.amber, marginTop: 2 }}>
                  {i.constellation.name}
                  {i.kind === 'request' ? ' · approval needed' : i.kind === 'event' ? (i.event!.where ? ` · ${i.event!.where}` : '') : i.nebula ? ` · #${i.nebula.name}` : ''}
                </Text>
                <Text size={14} numberOfLines={3} style={{ color: N.ink2, marginTop: 4, lineHeight: 20 }}>
                  {body(i)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {i.kind === 'request' ? (
                    <>
                      <Pressable accessibilityRole="button" disabled={busy === i.key} onPress={() => void answer(i, 'approve')} style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: N.amber, justifyContent: 'center' }}>
                        <Text size={13} weight="bold" style={{ color: N.amberInk }}>
                          Let in
                        </Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" disabled={busy === i.key} onPress={() => void answer(i, 'deny')} style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: N.edge2, justifyContent: 'center' }}>
                        <Text size={13} weight="bold">
                          Decline
                        </Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Pressable accessibilityRole="button" onPress={() => open(i)} style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: N.edge2, justifyContent: 'center' }}>
                        <Text size={13} weight="bold">
                          {i.kind === 'event' ? 'Open event' : 'Jump to message'}
                        </Text>
                      </Pressable>
                      {i.unread ? (
                        <Pressable accessibilityRole="button" onPress={() => void markRead(i)} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }}>
                          <Text size={13} weight="bold" style={{ color: N.ink2 }}>
                            Mark read
                          </Text>
                        </Pressable>
                      ) : null}
                    </>
                  )}
                </View>
              </View>
            </View>
          )
        }}
      />
      <NightTabBar active="mentions" />
    </View>
  )
}
