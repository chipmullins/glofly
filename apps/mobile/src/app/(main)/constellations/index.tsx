import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, interpolate, Extrapolation } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CONSTELLATION_THEME, CONSTELLATION_TYPES, ROLE_COLORS, voiceLine, type ConstellationCard, type ConstellationInvite, type DirectoryEntry } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { useSession } from '@/state/session'
import { useStore } from '@/state/store'
import { cxSay, putDetail, refreshCards, useCx } from '@/state/constellations'
import { chooseFrom, confirm } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { NightSky } from '@/constellations/sky'
import { NightTabBar } from '@/constellations/NightTabBar'
import { flyHome, useContentInStyle, warpClock } from '@/constellations/transition'
import { CreateJoinSheet, AskToJoinSheet, JoinButton } from '@/constellations/CreateJoin'
import { haptic } from '@/constellations/motion'
import { BannerStars, Caps, StarChart, Chip, ChipRow, ConstellationIcon, FireflyMark, Face, Live, MemberLine, N, NightButton, SpeakerGlyph, StarGlyph, hexA } from '@/constellations/ui'
import { StatusDot } from '@/ui/Avatar'
import { YourBans } from '@/constellations/YourBans'

// Board 2: your constellations (full-width cards), invites, and "Adventure to new
// constellations" (kinds, popular tags, three to try). Scrolling down tucks the header into a bar.

type Sheet = { kind: 'create' | 'join' } | { kind: 'ask'; entry: DirectoryEntry } | null

export default function Dashboard() {
  const insets = useSafeAreaInsets()
  const me = useSession((s) => s.user)
  const myStatus = useStore((s) => s.myStatus?.status)
  const cards = useCx((s) => s.cards)
  const invites = useCx((s) => s.invites)
  const loaded = useCx((s) => s.loaded)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [discover, setDiscover] = useState<{ tags: string[]; suggestions: DirectoryEntry[] } | null>(null)
  const content = useContentInStyle()
  const scrollY = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y
  })
  const bar = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [110, 160], [0, 1], Extrapolation.CLAMP) }))

  const loadDiscover = () =>
    void cx.discover().then((r) => {
      if (r.ok) setDiscover(r.data)
    })
  useEffect(() => {
    void refreshCards()
    loadDiscover()
  }, [])

  const open = (id: string) => {
    haptic.select()
    router.push({ pathname: '/constellations/[cid]', params: { cid: id } })
  }

  async function joinEntry(e: DirectoryEntry) {
    if (e.joined) return open(e.id)
    if (e.visibility === 'approval') {
      if (e.requested) {
        const ok = await confirm({ title: 'Take back your request?', message: `You asked to join ${e.name}.`, confirmLabel: 'Take it back' })
        if (!ok) return
        const r = await cx.cancelRequest(e.id)
        if (!r.ok) return cxSay(r.message)
        loadDiscover()
        return
      }
      return setSheet({ kind: 'ask', entry: e })
    }
    const r = await cx.join(e.id)
    if (!r.ok) return cxSay(r.message)
    if ('constellation' in r.data && 'nebulas' in r.data.constellation) {
      putDetail(r.data.constellation)
      haptic.success()
      void refreshCards()
      loadDiscover()
      open(r.data.constellation.id)
    }
  }

  async function cardMenu(card: ConstellationCard, index: number) {
    haptic.medium()
    const pick = await chooseFrom(
      [
        { key: 'open', label: `Open ${card.name}`, icon: 'chevronRight' },
        ...(card.unreadCount || card.mentionCount ? [{ key: 'read', label: 'Mark everything read', icon: 'checkDouble' as const }] : []),
        ...(index > 0 ? [{ key: 'up', label: 'Move up', icon: 'arrowUp' as const }] : []),
        ...(index < cards.length - 1 ? [{ key: 'down', label: 'Move down', icon: 'arrowDown' as const }] : []),
      ],
      card.name,
    )
    if (pick === 'open') open(card.id)
    if (pick === 'read') {
      await cx.readAll(card.id)
      void refreshCards()
    }
    if (pick === 'up' || pick === 'down') {
      const ids = cards.map((c) => c.id)
      const j = pick === 'up' ? index - 1 : index + 1
      ;[ids[index], ids[j]] = [ids[j], ids[index]]
      useCx.setState({ cards: ids.map((id) => cards.find((c) => c.id === id)!) })
      const r = await cx.order(ids)
      if (!r.ok) cxSay(r.message)
      void refreshCards()
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      <NightSky clock={warpClock} />
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 32, gap: 16 }}>
        <Animated.View style={[{ gap: 16 }, content]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to Glofly" onPress={() => flyHome()} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 5, paddingRight: 14, borderRadius: 22, backgroundColor: N.raised, borderWidth: 1, borderColor: N.edge, boxShadow: '0 0 18px rgba(255,165,74,0.22)' }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: N.card, alignItems: 'center', justifyContent: 'center' }}>
                <FireflyMark size={22} />
              </View>
              <Text size={14} weight="bold">Glofly</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Find a constellation" onPress={() => router.push('/constellations/directory')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="search" size={18} color={N.ink2} />
            </Pressable>
            {me ? (
              <Pressable accessibilityRole="button" accessibilityLabel="You" onPress={() => router.navigate('/constellations/you')}>
                <Face user={me} size={40} me />
                {myStatus ? <StatusDot status={myStatus === 'invisible' ? 'offline' : myStatus} size={12} ring={N.bg} style={{ position: 'absolute', right: -1, bottom: -1 }} /> : null}
              </Pressable>
            ) : null}
          </View>
          <View>
            <Text display size={30} style={{ letterSpacing: -0.3 }} accessibilityRole="header">
              Your constellations
            </Text>
            <Text size={14} style={{ color: N.ink2, marginTop: 4 }}>
              Communities you belong to.
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NightButton kind="outline" label="Join with an invite" icon="link" style={{ flex: 1 }} onPress={() => setSheet({ kind: 'join' })} />
            <NightButton label="Create" icon="plus" style={{ flex: 1 }} onPress={() => setSheet({ kind: 'create' })} />
          </View>
          {cards.map((card, i) => (
            <Card key={card.id} card={card} onPress={() => open(card.id)} onLongPress={() => void cardMenu(card, i)} />
          ))}
          {loaded && cards.length === 0 ? (
            <View style={{ borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: N.edge, padding: 20, gap: 6, alignItems: 'center' }}>
              <StarGlyph size={22} color={N.amber} />
              <Text size={16} weight="bold">No constellations yet</Text>
              <Text size={14} style={{ color: N.ink2, textAlign: 'center' }}>Create one for your friends, or find one to join below.</Text>
            </View>
          ) : null}
          <YourBans />
          {invites.length ? (
            <View style={{ gap: 10 }}>
              <Caps>Invites</Caps>
              {invites.map((inv) => (
                <InviteCard key={inv.id} invite={inv} onJoin={() => void joinEntry({ ...inv.constellation, visibility: 'public' })} />
              ))}
            </View>
          ) : null}
          <Adventure discover={discover} onJoin={(e) => void joinEntry(e)} />
        </Animated.View>
      </Animated.ScrollView>
      {/* Scrolled: the header tucks into a bar */}
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: insets.top + 6, paddingHorizontal: 18, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(18,12,10,0.88)', borderBottomWidth: 1, borderBottomColor: N.line }, bar]} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Glofly" onPress={() => flyHome()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: N.raised, borderWidth: 1, borderColor: N.edge, alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 14px rgba(255,165,74,0.2)' }}>
          <FireflyMark size={22} />
        </Pressable>
        <Text display size={17} style={{ flex: 1, textAlign: 'center' }}>
          Your constellations
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Create a constellation" onPress={() => setSheet({ kind: 'create' })} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: N.amber, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" size={18} color={N.amberInk} strokeWidth={2.4} />
        </Pressable>
      </Animated.View>
      <NightTabBar active="constellations" />
      {sheet?.kind === 'create' || sheet?.kind === 'join' ? (
        <CreateJoinSheet
          initialTab={sheet.kind}
          onClose={() => setSheet(null)}
          onDone={(id) => {
            setSheet(null)
            open(id)
          }}
        />
      ) : null}
      {sheet?.kind === 'ask' ? (
        <AskToJoinSheet
          entry={sheet.entry}
          onClose={() => setSheet(null)}
          onSent={() => {
            setSheet(null)
            loadDiscover()
            cxSay(`Request sent. A moderator of ${sheet.entry.name} will let you in.`)
          }}
        />
      ) : null}
      
    </View>
  )
}

/** A constellation's card: banner with stars (and "6 new" / "@you"), icon, role, name, who's on. */
function Card({ card, onPress, onLongPress }: { card: ConstellationCard; onPress: () => void; onLongPress: () => void }) {
  const t = CONSTELLATION_THEME[card.color] ?? CONSTELLATION_THEME.ember
  const role = card.role.owner ? "You're the Owner" : card.role.name
  const roleColor = card.role.owner ? N.amber : (ROLE_COLORS[card.role.color] ?? ROLE_COLORS.gray).dark
  const glow = card.unreadCount > 0 || card.mentionCount > 0
  const label = `${card.name}. ${card.memberCount} members, ${card.onlineCount} online. ${role}.${card.mentionCount ? ` ${card.mentionCount} mentions of you.` : card.unreadCount ? ` ${card.unreadCount} new.` : ''}${card.voice ? ` ${voiceLine(card.voice.people, card.voice.nebulaName, card.voice.total)}.` : ''}`
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Hold for more"
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={380}
      style={({ pressed }) => ({ borderRadius: 20, backgroundColor: '#1c1512', borderWidth: 1, borderColor: N.edge, overflow: 'hidden', transform: [{ scale: pressed ? 0.985 : 1 }], boxShadow: glow ? '0 0 0 1px rgba(255,179,71,0.16), 0 0 26px rgba(255,165,74,0.16)' : '0 0 0 1px rgba(255,179,71,0.08)' })}
    >
      {/* Nov 6, 2026: no colored banner. Its own star pattern sits top right, the icon glows in a
          ring of its color (the night sky and fireflies stay behind the cards). */}
      <StarChart id={card.id} sky={card.sky} color={t.accent} />
      {card.mentionCount > 0 ? (
        <View style={{ position: 'absolute', right: 12, top: 12, zIndex: 2, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: N.violet }}>
          <Text size={12} weight="bold" style={{ color: N.violetInk }}>@you</Text>
        </View>
      ) : card.unreadCount > 0 ? (
        <View style={{ position: 'absolute', right: 12, top: 12, zIndex: 2, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: t.badge }}>
          <Text size={12} weight="bold" style={{ color: t.badgeText }}>{card.unreadCount > 99 ? '99+' : card.unreadCount} new</Text>
        </View>
      ) : null}
      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ padding: 3, borderRadius: 21, borderWidth: 2, borderColor: hexA(t.accent, 0.75), boxShadow: `0 0 18px ${hexA(t.accent, 0.35)}` }}>
            <ConstellationIcon c={card} size={54} radius={16} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text display size={19} numberOfLines={1}>{card.name}</Text>
            <MemberLine members={card.memberCount} online={card.onlineCount} />
            <View style={{ alignSelf: 'flex-start', marginTop: 3, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 10, backgroundColor: card.role.owner ? hexA(N.amber, 0.14) : 'rgba(255,255,255,0.07)' }}>
              <Text size={12} weight="bold" style={{ color: roleColor }}>{card.role.owner ? 'Owner' : card.role.name}</Text>
            </View>
          </View>
        </View>
        {card.voice ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: N.card2 }}>
            <SpeakerGlyph size={15} color={N.greenText} />
            <Text size={13} numberOfLines={1} style={{ flex: 1 }}>{voiceLine(card.voice.people, card.voice.nebulaName, card.voice.total)}</Text>
            {card.voice.live ? <Live /> : null}
          </View>
        ) : null}
        {card.lastMention && card.mentionCount > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: N.card2 }}>
            <StarGlyph size={15} color={N.violetText} />
            <Text size={13} numberOfLines={1} style={{ flex: 1 }}>
              {card.lastMention.by.displayName.split(/\s+/)[0]} mentioned you in {card.lastMention.nebulaName}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

function InviteCard({ invite, onJoin }: { invite: ConstellationInvite; onJoin: () => void }) {
  const e = invite.constellation
  const [busy, setBusy] = useState(false)
  return (
    <View style={{ gap: 12, padding: 14, borderRadius: 18, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ConstellationIcon c={e} size={44} radius={14} />
        <View style={{ flex: 1 }}>
          <Text size={15} weight="bold">{e.name}</Text>
          <Text size={13} style={{ color: N.ink2 }}>
            {invite.by.displayName.split(/\s+/)[0]} invited you · {e.memberCount} {e.memberCount === 1 ? 'member' : 'members'}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <NightButton
          kind="outline"
          label="Decline"
          style={{ flex: 1, backgroundColor: 'transparent' }}
          onPress={async () => {
            useCx.setState({ invites: useCx.getState().invites.filter((i) => i.id !== invite.id) })
            await cx.dismissInvite(invite.id)
            void refreshCards()
          }}
        />
        <NightButton
          kind="green"
          label="Join"
          busy={busy}
          style={{ flex: 1 }}
          onPress={() => {
            setBusy(true)
            onJoin()
          }}
        />
      </View>
    </View>
  )
}

/** "Adventure to new constellations": kinds, popular tags and up to three to try. */
function Adventure({ discover, onJoin }: { discover: { tags: string[]; suggestions: DirectoryEntry[] } | null; onJoin: (e: DirectoryEntry) => void }) {
  return (
    // Nov 6, 2026: a purple panel, like the computer and browser dashboards.
    <View style={{ gap: 12, marginTop: 6, padding: 16, borderRadius: 22, backgroundColor: 'rgba(58,36,104,0.38)', borderWidth: 1, borderColor: '#3a2a4a', overflow: 'hidden' }}>
      <View>
        <Text display size={22} accessibilityRole="header">
          Adventure to new constellations
        </Text>
        <Text size={13} style={{ color: N.ink2, marginTop: 4 }}>Public communities you can join or ask to join.</Text>
      </View>
      <ChipRow>
        {CONSTELLATION_TYPES.filter((t) => t.id !== 'other').map((t) => (
          <Chip key={t.id} label={t.name} onPress={() => router.push({ pathname: '/constellations/directory', params: { type: t.id } })} />
        ))}
      </ChipRow>
      {discover?.tags.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <Text size={12} weight="bold" style={{ color: N.muted, paddingVertical: 4 }}>Popular</Text>
          {discover.tags.slice(0, 6).map((tag) => (
            <Pressable key={tag} accessibilityRole="button" accessibilityLabel={`Tag ${tag}`} onPress={() => router.push({ pathname: '/constellations/directory', params: { tag } })} hitSlop={{ top: 8, bottom: 8 }} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: N.card2 }}>
              <Text size={12} style={{ color: N.tag }}>#{tag}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {discover?.suggestions.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
          {discover.suggestions.map((e) => (
            <Suggestion key={e.id} entry={e} onJoin={() => onJoin(e)} />
          ))}
        </ScrollView>
      ) : discover ? (
        <Text size={13} style={{ color: N.muted }}>Nothing new to try right now. Search the directory for more.</Text>
      ) : null}
    </View>
  )
}

function Suggestion({ entry, onJoin }: { entry: DirectoryEntry; onJoin: () => void }) {
  const t = CONSTELLATION_THEME[entry.color] ?? CONSTELLATION_THEME.ember
  const kind = entry.type ? CONSTELLATION_TYPES.find((x) => x.id === entry.type)?.name : null
  return (
    <View style={{ width: 250, borderRadius: 18, backgroundColor: N.card, borderWidth: 1, borderColor: N.edge, overflow: 'hidden' }}>
      <View style={{ height: 52, backgroundColor: t.banner }}>
        <View style={{ position: 'absolute', left: 180, top: 18, width: 3, height: 3, borderRadius: 2, backgroundColor: t.glow, boxShadow: `0 0 8px 2px ${hexA(t.glow, 0.45)}` }} />
      </View>
      <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 6 }}>
        <ConstellationIcon c={entry} size={44} radius={14} border={N.card} style={{ marginTop: -22 }} />
        <Text size={16} weight="bold" numberOfLines={1}>{entry.name}</Text>
        <Text size={12} numberOfLines={1} style={{ color: N.ink2 }}>
          {kind ? `${kind} · ` : ''}
          {entry.memberCount} members · <Text size={12} style={{ color: N.greenText }}>{entry.onlineCount} online</Text>
        </Text>
        <JoinButton entry={entry} onPress={onJoin} />
      </View>
    </View>
  )
}
