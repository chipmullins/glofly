import { useRef, useState } from 'react'
import { Pressable, ScrollView, View, type View as RNView } from 'react-native'
import { useCall } from '@/calls/controller'
import { InVoiceCount, StackedFaces, TalkingFace, useTalking, VOICE_LIST_MAX } from './feel'
import { CONSTELLATION_THEME, voiceLine, type ConstellationCard, type ConstellationDetail, type Nebula, type PublicUser, type VoiceNebulaState } from '@glofly/shared'
import { useStore } from '@/state/store'
import { useCx } from '@/state/constellations'
import { firstName } from '@/lib/format'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { measure } from './ContextMenu'
import { BannerArt } from './community'
import { haptic } from './motion'
import { nebulaMenu } from './nebulaActions'
import { gateLabel, isQuiet, sectionsOf } from './roles'
import { BannerStars, ConstellationIcon, CountBadge, HomeGlyph, GalaxyIcon, Live, N, SpeakerGlyph, StarGlyph } from './ui'

// Inside a constellation (canvas board 4, and the iPad board): the icon strip to switch
// constellations, the banner, and the categories with their nebulas.

/** Category sections you folded, per constellation (kept while Glofly is open). */
const folded = new Map<string, Set<string>>()

/** Your constellations in dashboard order (plus this one, if it isn't on the dashboard yet). */
export function useStripList(c: ConstellationDetail | null): Pick<ConstellationCard, 'id' | 'name' | 'color' | 'iconVersion' | 'unreadCount' | 'mentionCount'>[] {
  const cards = useCx((s) => s.cards)
  if (!c || cards.some((x) => x.id === c.id)) return cards
  return [{ id: c.id, name: c.name, color: c.color, iconVersion: c.iconVersion, unreadCount: 0, mentionCount: 0 }, ...cards]
}

/** The row of constellation icons at the top of a constellation home (swipe sideways too). */
export function IconStrip({ current, onPick, onAdd }: { current: string; onPick: (id: string) => void; onAdd: () => void }) {
  const c = useCx((s) => s.details[current]) ?? null
  const list = useStripList(c)
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, gap: 10, alignItems: 'center' }}>
      {list.map((x) => {
        const on = x.id === current
        return (
          <Pressable
            key={x.id}
            accessibilityRole="button"
            accessibilityLabel={`${x.name}${on ? ', open now' : ''}${x.mentionCount ? `, ${x.mentionCount} mentions` : x.unreadCount ? ', new messages' : ''}`}
            accessibilityState={{ selected: on }}
            onPress={() => !on && onPick(x.id)}
            hitSlop={2}
          >
            <ConstellationIcon c={x} size={on ? 46 : 42} radius={on ? 15 : 14} ring={on} />
            {!on && (x.mentionCount || x.unreadCount) ? (
              <CountBadge count={x.mentionCount || x.unreadCount} mention={!!x.mentionCount} style={{ position: 'absolute', right: -4, top: -4 }} />
            ) : null}
          </Pressable>
        )
      })}
      <Pressable accessibilityRole="button" accessibilityLabel="Create or join a constellation" onPress={onAdd} style={{ width: 42, height: 42, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: N.edge2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="plus" size={18} color={N.muted} strokeWidth={2.2} />
      </Pressable>
    </ScrollView>
  )
}

/** iPad: the strip down the left (Home, all constellations, then each one). */
export function SideStrip({ current, homeCount, onHome, onHomeHold, onAll, onPick, onAdd }: { current: string; homeCount: number; onHome: () => void; onHomeHold: () => void; onAll: () => void; onPick: (id: string) => void; onAdd: () => void }) {
  const c = useCx((s) => s.details[current]) ?? null
  const list = useStripList(c)
  return (
    <View style={{ width: 80, backgroundColor: N.strip, borderRightWidth: 1, borderRightColor: N.card2 }}>
      <ScrollView contentContainerStyle={{ paddingTop: 18, paddingBottom: 24, alignItems: 'center', gap: 12 }} showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Glofly home${homeCount ? `, ${homeCount} unread` : ''}`} accessibilityHint="Hold for your Glofly chats" accessibilityActions={[{ name: 'activate' }, { name: 'longpress', label: 'Your Glofly chats' }]} onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'longpress' ? onHomeHold() : onHome())} onPress={onHome} onLongPress={onHomeHold} delayLongPress={380} style={{ alignItems: 'center', gap: 4 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: N.raised, borderWidth: 1, borderColor: N.edge, alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 16px rgba(255,165,74,0.25)' }}>
            <HomeGlyph />
            <CountBadge count={homeCount} ring={N.strip} style={{ position: 'absolute', right: -4, top: -4 }} />
          </View>
          <Text size={11} weight="bold" style={{ color: N.tag }}>
            Home
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="All constellations" onPress={onAll} style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: N.card, alignItems: 'center', justifyContent: 'center' }}>
          <GalaxyIcon size={24} />
        </Pressable>
        <View style={{ width: 32, height: 2, borderRadius: 1, backgroundColor: N.line }} />
        {list.map((x) => {
          const on = x.id === current
          return (
            <Pressable key={x.id} accessibilityRole="button" accessibilityLabel={`${x.name}${on ? ', open now' : ''}${x.mentionCount ? `, ${x.mentionCount} mentions` : ''}`} accessibilityState={{ selected: on }} onPress={() => !on && onPick(x.id)}>
              <ConstellationIcon c={x} size={48} radius={16} ring={on} />
              {!on && (x.mentionCount || x.unreadCount) ? <CountBadge count={x.mentionCount || x.unreadCount} mention={!!x.mentionCount} ring={N.strip} style={{ position: 'absolute', right: -4, top: -4 }} /> : null}
            </Pressable>
          )
        })}
        <Pressable accessibilityRole="button" accessibilityLabel="Create or join a constellation" onPress={onAdd} style={{ width: 48, height: 48, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: N.edge2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" size={18} color={N.muted} strokeWidth={2.2} />
        </Pressable>
      </ScrollView>
    </View>
  )
}

/** The banner with the constellation's icon over its bottom edge, name and member count (phone). */
export function ConstellationBanner({ c, width, onInvite, onSettings }: { c: ConstellationDetail; width: number; onInvite: (() => void) | null; onSettings: () => void }) {
  const t = CONSTELLATION_THEME[c.color] ?? CONSTELLATION_THEME.ember
  const online = c.members.filter((m) => m.status !== 'offline').length
  return (
    <View>
      <View style={{ marginHorizontal: 12, height: 104, borderRadius: 20, backgroundColor: t.banner, overflow: 'hidden' }}>
        {/* 0.7.5 identity: its banner photo (or the sky in its accent once it picked one) */}
        {c.bannerVersion || (c.accent && c.accent !== 'gold') ? (
          <View style={{ position: 'absolute', inset: 0 } as object}>
            <BannerArt c={c} width={width - 24} height={104} />
          </View>
        ) : (
          <BannerStars id={c.id} color={c.color} width={width - 24} />
        )}
        <View style={{ position: 'absolute', right: 10, top: 10, flexDirection: 'row', gap: 6 }}>
          {onInvite ? <BannerButton label="Invite people" icon="addPerson" onPress={onInvite} /> : null}
          <BannerButton label={`${c.name} settings`} icon="gear" onPress={onSettings} />
        </View>
      </View>
      <View style={{ paddingHorizontal: 24, flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: -24 }}>
        <ConstellationIcon c={c} size={56} radius={18} border={N.bg} style={{ boxShadow: `0 0 0 1px ${N.edge}` }} />
        <View style={{ flex: 1, paddingBottom: 2 }}>
          <Text display size={22} numberOfLines={1} accessibilityRole="header">
            {c.name}
          </Text>
          <Text size={12} style={{ color: N.ink2 }}>
            {c.members.length} {c.members.length === 1 ? 'member' : 'members'} · <Text size={12} style={{ color: N.greenText }}>{online} online</Text>
          </Text>
        </View>
      </View>
    </View>
  )
}

function BannerButton({ label, icon, onPress }: { label: string; icon: 'addPerson' | 'gear'; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(18,12,10,0.7)', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={18} color={N.ink} />
    </Pressable>
  )
}

/** iPad: the smaller banner at the top of the sidebar (name and count on it). */
export function SideBanner({ c }: { c: ConstellationDetail }) {
  const t = CONSTELLATION_THEME[c.color] ?? CONSTELLATION_THEME.ember
  const online = c.members.filter((m) => m.status !== 'offline').length
  return (
    <View style={{ marginHorizontal: 12, height: 92, borderRadius: 18, backgroundColor: t.banner, overflow: 'hidden' }}>
      {c.bannerVersion || (c.accent && c.accent !== 'gold') ? (
        <View style={{ position: 'absolute', inset: 0, opacity: 0.85 } as object}>
          <BannerArt c={c} width={276} height={92} />
        </View>
      ) : (
        <BannerStars id={c.id} color={c.color} width={276} />
      )}
      <Text display size={21} numberOfLines={1} style={{ position: 'absolute', left: 16, right: 90, bottom: 12 }} accessibilityRole="header">
        {c.name}
      </Text>
      <Text size={12} style={{ position: 'absolute', right: 14, bottom: 15, color: N.ink2 }}>
        {c.members.length} · <Text size={12} style={{ color: N.greenText }}>{online} on</Text>
      </Text>
    </View>
  )
}

type ListProps = {
  c: ConstellationDetail
  onOpen: (n: Nebula) => void
  /** iPad: the open nebula (highlighted) and the denser rows */
  selected?: string | null
  dense?: boolean
}

/** Categories → nebulas. Hold a nebula for its menu. */
export function NebulaList({ c, onOpen, selected, dense }: ListProps) {
  const [, redraw] = useState(0)
  const fold = folded.get(c.id) ?? new Set<string>()
  const people = useStore((s) => s.people)
  const toggle = (id: string) => {
    const next = new Set(fold)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    folded.set(c.id, next)
    haptic.select()
    redraw((x) => x + 1)
  }
  const sections = sectionsOf(c)
  if (!c.nebulas.length) {
    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <Text size={14} style={{ color: N.muted, textAlign: 'center' }}>
          No nebulas yet.
        </Text>
      </View>
    )
  }
  return (
    <View style={{ gap: 2 }}>
      {sections.map((s, si) => {
        const closed = fold.has(s.id)
        const hasNews = s.nebulas.some((n) => n.unreadCount || n.mentionCount)
        return (
          <View key={s.id} style={{ gap: 2 }}>
            {s.name ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${s.name}, ${closed ? 'folded' : 'open'}${closed && hasNews ? ', new messages inside' : ''}`}
                accessibilityHint={closed ? 'Shows its nebulas' : 'Hides its nebulas'}
                onPress={() => toggle(s.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: dense ? 10 : 12, paddingTop: si === 0 ? 8 : 12, paddingBottom: 4, minHeight: 32 }}
              >
                <View style={{ transform: [{ rotate: closed ? '-90deg' : '0deg' }] }}>
                  <Icon name="chevronDown" size={12} color={N.muted} strokeWidth={2.6} />
                </View>
                <Text size={dense ? 11 : 12} weight="bold" style={{ color: N.muted, letterSpacing: 0.96, textTransform: 'uppercase', flexShrink: 1 }} numberOfLines={1}>
                  {s.name}
                </Text>
                {/* 0.8.0: role-only category (only people who manage nebulas get the setting) */}
                {c.categories.find((x) => x.id === s.id)?.visibility === 'roles' ? (
                  <View accessible accessibilityLabel={`Only ${gateLabel(c, c.categories.find((x) => x.id === s.id)?.roleIds)}`}>
                    <Icon name="lock" size={11} color="#c9a47e" />
                  </View>
                ) : null}
                <View style={{ flex: 1 }} />
                {closed && hasNews ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: N.orange }} /> : null}
              </Pressable>
            ) : null}
            {closed
              ? null
              : s.nebulas.map((n) =>
                  n.kind === 'voice' ? (
                    <VoiceRow key={n.id} c={c} n={n} voice={c.voice.find((v) => v.nebulaId === n.id) ?? null} people={people} onOpen={onOpen} selected={selected === n.id} dense={dense} />
                  ) : (
                    <TextRow key={n.id} c={c} n={n} onOpen={onOpen} selected={selected === n.id} dense={dense} />
                  ),
                )}
          </View>
        )
      })}
    </View>
  )
}

/** 0.8.0: the lock badge with the role, for people who manage nebulas (RoleNebulas board). */
function LockBadge({ label }: { label: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 120, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#2b1f1a' }}>
      <Icon name="lock" size={10} color="#e3c39f" />
      <Text size={11} weight="bold" numberOfLines={1} style={{ color: '#e3c39f', flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  )
}

function useHold(c: ConstellationDetail, n: Nebula, preview: () => React.ReactNode) {
  const ref = useRef<RNView>(null)
  const hold = async () => {
    const at = await measure(ref.current)
    if (at) void nebulaMenu(c, n, at, preview())
  }
  return { ref, hold }
}

/** The lifted copy of a nebula row in its menu. */
function Lifted({ n }: { n: Nebula }) {
  return (
    <View style={{ height: 52, paddingHorizontal: 14, borderRadius: 14, backgroundColor: N.raised, borderWidth: 1, borderColor: N.edge2, flexDirection: 'row', alignItems: 'center', gap: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.6)' }}>
      {n.kind === 'voice' ? <SpeakerGlyph size={16} color={N.amber} /> : <StarGlyph size={16} color={N.amber} />}
      <Text size={16} weight="bold" numberOfLines={1} style={{ flex: 1 }}>
        {n.name}
      </Text>
      {n.mentionCount ? (
        <Text size={11} weight="bold" style={{ color: N.violetText }}>
          @{n.mentionCount}
        </Text>
      ) : n.unreadCount ? (
        <CountBadge count={n.unreadCount} ring={N.raised} />
      ) : null}
    </View>
  )
}

function TextRow({ c, n, onOpen, selected, dense }: { c: ConstellationDetail; n: Nebula; onOpen: (n: Nebula) => void; selected?: boolean; dense?: boolean }) {
  const { ref, hold } = useHold(c, n, () => <Lifted n={n} />)
  const unread = n.unreadCount > 0 || n.mentionCount > 0
  const quiet = isQuiet(n)
  const bright = unread && !quiet
  const label = `${n.name}${n.mentionCount ? `, ${n.mentionCount} ${n.mentionCount === 1 ? 'mention' : 'mentions'} of you` : n.unreadCount ? `, ${n.unreadCount} new` : ''}${n.readOnly ? ', read only' : ''}${quiet ? ', muted' : ''}${n.visibility === 'roles' ? `, only ${gateLabel(c, n.roleIds)}` : ''}`
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Hold for notifications and pinning"
      accessibilityState={{ selected: !!selected }}
      onPress={() => onOpen(n)}
      onLongPress={() => void hold()}
      delayLongPress={350}
      style={({ pressed }) => ({
        height: dense ? 40 : 44,
        paddingHorizontal: dense ? 10 : 12,
        borderRadius: dense ? 10 : 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: selected ? N.raised : pressed ? N.card2 : bright && !dense ? N.card2 : 'transparent',
      })}
    >
      {n.kind === 'forum' ? (
        <Text size={dense ? 13 : 15} style={{ color: bright || selected ? N.amber : N.faint }}>
          💬
        </Text>
      ) : (
        <StarGlyph size={dense ? 14 : 16} color={bright || selected ? N.amber : N.faint} />
      )}
      <Text size={dense ? 14 : 15} weight={bright || selected ? 'bold' : 'regular'} numberOfLines={1} style={{ flex: 1, color: bright || selected ? N.ink : quiet ? N.faint : N.ink2 }}>
        {n.name}
      </Text>
      {n.mentionCount ? (
        <Text size={11} weight="bold" style={{ color: N.violetText }}>
          @{n.mentionCount}
        </Text>
      ) : n.unreadCount && !quiet ? (
        <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: N.orange, alignItems: 'center', justifyContent: 'center' }}>
          <Text size={11} weight="bold" style={{ color: N.orangeInk }}>
            {n.unreadCount > 99 ? '99+' : n.unreadCount}
          </Text>
        </View>
      ) : null}
      {quiet ? <Icon name="bellOff" size={14} color={N.faint} /> : null}
      {n.visibility === 'roles' ? <LockBadge label={gateLabel(c, n.roleIds)} /> : n.readOnly ? <Icon name="lock" size={14} color={N.faint} /> : null}
    </Pressable>
  )
}

function VoiceRow({ c, n, voice, people, onOpen, selected, dense }: { c: ConstellationDetail; n: Nebula; voice: VoiceNebulaState | null; people: Record<string, PublicUser>; onOpen: (n: Nebula) => void; selected?: boolean; dense?: boolean }) {
  const { ref, hold } = useHold(c, n, () => <Lifted n={n} />)
  const inIt = (voice?.userIds ?? []).map((id) => people[id] ?? c.members.find((m) => m.user.id === id)?.user).filter((p): p is PublicUser => !!p)
  const sharer = voice?.sharing[0] ? (people[voice.sharing[0]] ?? null) : null
  const line = sharer ? `${firstName(sharer.displayName, sharer.username)} is sharing ${voice!.sharing.length > 1 ? 'a screen' : 'their screen'}` : inIt.length ? voiceLine(inIt.slice(0, 3), n.name, inIt.length) : ''
  const label = `${n.name}, voice${inIt.length ? `, ${inIt.length} in voice` : ', nobody in it'}${voice?.live ? ', live' : ''}${n.visibility === 'roles' ? `, only ${gateLabel(c, n.roleIds)}` : ''}`
  const busy = inIt.length > 0
  // 0.7.5: who's talking (from inside the room), and stacked faces when it's busy
  const talking = useTalking(n.id)
  const mine = useCall((st) => st.voice?.nebulaId === n.id)
  const stacked = inIt.length > VOICE_LIST_MAX && !mine
  if (!busy) {
    return (
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!selected }}
        onPress={() => onOpen(n)}
        onLongPress={() => void hold()}
        delayLongPress={350}
        style={({ pressed }) => ({ height: dense ? 40 : 44, paddingHorizontal: dense ? 10 : 12, borderRadius: dense ? 10 : 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: selected ? N.raised : pressed ? N.card2 : 'transparent' })}
      >
        <SpeakerGlyph size={dense ? 14 : 16} color={N.faint} />
        <Text size={dense ? 14 : 15} numberOfLines={1} style={{ flex: 1, color: N.ink2 }}>
          {n.name}
        </Text>
        {n.visibility === 'roles' ? <LockBadge label={gateLabel(c, n.roleIds)} /> : null}
      </Pressable>
    )
  }
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${line}`}
      accessibilityState={{ selected: !!selected }}
      onPress={() => onOpen(n)}
      onLongPress={() => void hold()}
      delayLongPress={350}
      style={({ pressed }) => ({ paddingVertical: dense ? 8 : 10, paddingHorizontal: dense ? 10 : 12, borderRadius: dense ? 10 : 12, gap: 6, backgroundColor: selected ? N.raised : pressed ? N.card2 : 'transparent' })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <SpeakerGlyph size={dense ? 14 : 16} color={N.greenText} waves={2} />
        <Text size={dense ? 14 : 15} weight="medium" numberOfLines={1} style={{ flex: 1 }}>
          {n.name}
        </Text>
        {n.visibility === 'roles' ? <LockBadge label={gateLabel(c, n.roleIds)} /> : null}
        <InVoiceCount count={inIt.length} small={dense} />
        {voice?.live ? <Live small={dense} /> : null}
      </View>
      {dense ? (
        <View style={{ paddingLeft: 24, gap: 4 }}>
          {inIt.slice(0, 6).map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TalkingFace user={p} size={20} talking={talking.has(p.id)} />
              <Text size={13} numberOfLines={1} style={{ color: talking.has(p.id) ? N.ink : N.ink2, flex: 1 }}>
                {p.displayName}
              </Text>
              {voice?.sharing.includes(p.id) ? <Live small /> : voice?.muted.includes(p.id) ? <Icon name="micOff" size={12} color={N.faint} /> : null}
            </View>
          ))}
          {inIt.length > 6 ? (
            <Text size={12} style={{ color: N.faint }}>
              and {inIt.length - 6} more
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 26 }}>
          {stacked ? (
            <StackedFaces people={inIt} size={24} />
          ) : (
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {inIt.slice(0, 4).map((p) => (
                <TalkingFace key={p.id} user={p} size={24} talking={talking.has(p.id)} />
              ))}
            </View>
          )}
          <Text size={12} numberOfLines={1} style={{ color: N.muted, flex: 1 }}>
            {line}
          </Text>
        </View>
      )}
    </Pressable>
  )
}
