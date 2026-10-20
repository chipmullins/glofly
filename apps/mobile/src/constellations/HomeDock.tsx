import { useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'
import { MESSAGE_MAX, type PinnedNebula } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { useCall, hangUp, setMic } from '@/calls/controller'
import { sendText } from '@/chat/send'
import { cxSay, loadDetail, refreshCards, refreshMentionCount, refreshPins, setPins, useCx, useCxAvailable } from '@/state/constellations'
import { useStore } from '@/state/store'
import { Icon } from '@/ui/icons'
import { Text, webNoOutline } from '@/ui/kit'
import { ThemeOverride, font } from '@/ui/theme'
import { InlineSheet, NightModal, Handle } from './sheet'
import { NightSky } from './sky'
import { flyIn } from './transition'
import { haptic } from './motion'
import { NebulaRow } from './NebulaRow'
import { roleLook, cantPost } from './roles'
import { useNebulaChat } from './useNebula'
import { usePreloadCx } from './feel'
import { CountBadge, ConstellationIcon, Caps, Glyph, N, SpeakerGlyph, StarGlyph } from './ui'

// The nebula dock on Glofly home (board 8b), the same "portal" as the DM Dock: swipe up on the
// Constellations tab (or hold it) and your constellations, pinned nebulas, Mentions and the voice
// nebula you're in peek up over home; keep pulling for the full sheet. A pinned nebula opens as a
// mini chat right there. Night colors in both themes.

type HomeDockState = { open: 'peek' | 'full' | null; nebula: PinnedNebula | null }
export const useHomeDock = create<HomeDockState>(() => ({ open: null, nebula: null }))

export function openHomeDock() {
  haptic.light()
  void refreshCards()
  void refreshPins()
  void refreshMentionCount()
  useHomeDock.setState({ open: 'peek' })
}
const close = () => useHomeDock.setState({ open: null })

/** Fly in to a place (a constellation, a nebula, Mentions, the voice stage). */
function flyTo(...paths: string[]) {
  useHomeDock.setState({ open: null, nebula: null })
  flyIn(null, ['/constellations', ...paths] as never)
}

export function HomeDock() {
  // 0.7.5 instant fly-in: your last constellation loads ahead while you're home
  usePreloadCx()
  const available = useCxAvailable()
  const open = useHomeDock((s) => s.open)
  const nebula = useHomeDock((s) => s.nebula)
  const insets = useSafeAreaInsets()
  if (!available) return null
  return (
    <ThemeOverride mode="night">
      <InlineSheet open={open === 'peek'} onClose={close} onPullUp={() => useHomeDock.setState({ open: 'full' })} bottom={Math.max(insets.bottom, 12) + 72} float backdrop="rgba(36,23,15,0.2)">
        <Peek />
      </InlineSheet>
      {open === 'full' ? (
        <NightModal onClose={close} top={120} bg={N.bg} padded={false} accessibilityLabel="Constellations">
          <View style={{ flex: 1, overflow: 'hidden' }}>
            <NightSky flies={2} />
            <Full />
          </View>
        </NightModal>
      ) : null}
      {nebula ? <NebulaMini pin={nebula} onClose={() => useHomeDock.setState({ nebula: null })} /> : null}
    </ThemeOverride>
  )
}

function Icons({ size = 50 }: { size?: number }) {
  const cards = useCx((s) => s.cards)
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 8 }}>
      {cards.map((card) => (
        <Pressable key={card.id} accessibilityRole="button" accessibilityLabel={`${card.name}${card.mentionCount ? `, ${card.mentionCount} mentions` : card.unreadCount ? ', new messages' : ''}`} onPress={() => flyTo(`/constellations/${card.id}`)}>
          <ConstellationIcon c={card} size={size} radius={16} />
          {card.mentionCount ? (
            <CountBadge count={1} mention ring={N.bg} style={{ position: 'absolute', right: -4, top: -4 }} />
          ) : card.voice ? (
            <View style={{ position: 'absolute', right: -3, bottom: -3, width: 14, height: 14, borderRadius: 7, backgroundColor: N.online, borderWidth: 2.5, borderColor: N.bg }} />
          ) : card.unreadCount ? (
            <View style={{ position: 'absolute', right: -2, top: -2, width: 10, height: 10, borderRadius: 5, backgroundColor: N.orange, borderWidth: 2, borderColor: N.bg }} />
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  )
}

function MentionsRow({ chevron }: { chevron?: boolean }) {
  const mentions = useCx((s) => s.mentionsUnread)
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Mentions${mentions ? `, ${mentions} new` : ''}`} onPress={() => flyTo('/constellations/mentions')} style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 16, backgroundColor: 'rgba(28,18,16,0.85)', borderWidth: chevron ? 1 : 0, borderColor: N.line2, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(181,124,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
        <Glyph name="mention" size={15} color={N.violetText} />
      </View>
      <Text size={chevron ? 15 : 14} weight="bold" style={{ flex: 1 }}>
        Mentions
      </Text>
      {mentions ? (
        <View style={{ height: 20, paddingHorizontal: 7, borderRadius: 10, backgroundColor: N.violet, justifyContent: 'center' }}>
          <Text size={11} weight="bold" style={{ color: N.violetInk }}>
            {mentions} new
          </Text>
        </View>
      ) : null}
      {chevron ? <Icon name="chevronRight" size={16} color={N.faint} strokeWidth={2.2} /> : null}
    </Pressable>
  )
}

function Header({ big }: { big?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text display size={big ? 22 : 17} style={{ flex: 1 }} accessibilityRole="header">
        Constellations
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Fly in to Constellations" onPress={() => flyTo()} style={{ height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: N.amber, justifyContent: 'center' }}>
        <Text size={13} weight="bold" style={{ color: N.amberInk }}>
          Fly in
        </Text>
      </Pressable>
    </View>
  )
}

function Peek() {
  const pins = useCx((s) => s.pins)
  const cards = useCx((s) => s.cards)
  const { height } = useWindowDimensions()
  return (
    <View style={{ borderRadius: 26, backgroundColor: N.bg, overflow: 'hidden', boxShadow: '0 -6px 40px rgba(36,23,15,0.35), 0 0 0 1px rgba(255,179,71,0.25)', maxHeight: height * 0.6 }}>
      <NightSky flies={1} />
      <View style={{ paddingTop: 8, paddingHorizontal: 14, paddingBottom: 14, gap: 14 }}>
        <Handle width={36} />
        <Header />
        {cards.length ? <Icons /> : <Text size={14} style={{ color: N.ink2 }}>You're not in any constellations yet. Fly in to create or find one.</Text>}
        {pins.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginRight: -14 }} contentContainerStyle={{ gap: 8, paddingRight: 14 }}>
            {pins.map((p) => (
              <PinChip key={p.nebula.id} pin={p} />
            ))}
          </ScrollView>
        ) : null}
        <VoiceCard compact />
        {cards.length ? <MentionsRow /> : null}
      </View>
    </View>
  )
}

/** A pinned nebula's color: its constellation's glow. */
const pinColor = (p: PinnedNebula) => ({ ember: '#ffb347', lagoon: '#8ad8ef', violet: '#cfa8ff', green: '#6fd39a', red: '#ff8a9b' })[p.color] ?? N.amber

function PinChip({ pin }: { pin: PinnedNebula }) {
  const unread = pin.nebula.unreadCount > 0
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${pin.nebula.name} in ${pin.constellationName}${pin.nebula.mentionCount ? ', mentions you' : unread ? ', new messages' : ''}`} onPress={() => openPin(pin)} style={{ height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: N.card2, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {pin.nebula.kind === 'voice' ? <SpeakerGlyph size={12} color={pinColor(pin)} /> : <StarGlyph size={12} color={pinColor(pin)} />}
      <Text size={13} weight="medium">
        {pin.nebula.name}
      </Text>
      {pin.nebula.mentionCount ? (
        <Text size={11} weight="bold" style={{ color: N.violetText }}>
          @
        </Text>
      ) : unread ? (
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: N.orange }} />
      ) : null}
    </Pressable>
  )
}

function openPin(pin: PinnedNebula) {
  if (pin.nebula.kind === 'voice') return flyTo(`/constellations/${pin.constellationId}`, `/constellations/${pin.constellationId}/nebula/${pin.nebula.id}`)
  useHomeDock.setState({ open: null, nebula: pin })
}

/** "You're in Campfire": Mute / Watch / Leave. */
function VoiceCard({ compact }: { compact?: boolean }) {
  const voice = useCall((s) => s.voice)
  const call = useCall((s) => s.call)
  const micOn = useCall((s) => s.micOn)
  const tiles = useCall((s) => s.tiles)
  const people = useStore((s) => s.people)
  if (!voice || !call) return null
  const sharing = tiles.find((t) => t.screen && !t.local)
  const sharer = sharing ? people[sharing.userId]?.displayName.split(/\s+/)[0] : null
  return (
    <View style={{ gap: 10, padding: 12, borderRadius: 18, backgroundColor: N.greenDeep, borderWidth: 1, borderColor: N.greenEdge }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(111,211,154,0.16)', alignItems: 'center', justifyContent: 'center' }}>
          <SpeakerGlyph size={18} color={N.greenText} />
        </View>
        <View style={{ flex: 1 }}>
          <Text size={15} weight="bold">You're in {voice.nebulaName}</Text>
          <Text size={12} style={{ color: '#a7e0bf' }} numberOfLines={1}>
            {voice.constellationName} · {tiles.length} in voice{sharer ? ` · ${sharer} sharing` : ''}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <VoiceButton label={micOn ? 'Mute' : 'Unmute'} onPress={() => void setMic(!micOn)} />
        <VoiceButton label="Watch" onPress={() => flyTo('/constellations/voice')} />
        <VoiceButton label="Leave" danger onPress={() => void hangUp()} />
      </View>
      {compact ? null : null}
    </View>
  )
}

function VoiceButton({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: danger ? N.red : 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
      <Text size={13} weight={danger ? 'bold' : 'medium'} style={{ color: danger ? '#fff' : N.ink }}>
        {label}
      </Text>
    </Pressable>
  )
}

function Full() {
  const pins = useCx((s) => s.pins)
  const cards = useCx((s) => s.cards)
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 14 }}>
      <Header big />
      <VoiceCard />
      {cards.length ? (
        <>
          <Caps>Yours</Caps>
          <Icons />
        </>
      ) : (
        <Text size={14} style={{ color: N.ink2 }}>You're not in any constellations yet. Fly in to create or find one.</Text>
      )}
      <Caps>Pinned nebulas</Caps>
      {pins.length ? (
        <View style={{ borderRadius: 16, backgroundColor: 'rgba(28,18,16,0.85)', borderWidth: 1, borderColor: N.line2, overflow: 'hidden' }}>
          {pins.map((p, i) => (
            <Pressable key={p.nebula.id} accessibilityRole="button" accessibilityLabel={`${p.nebula.name}, ${p.constellationName}${p.nebula.mentionCount ? ', mentions you' : p.nebula.unreadCount ? `, ${p.nebula.unreadCount} new` : ''}`} onPress={() => openPin(p)} style={{ minHeight: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: i < pins.length - 1 ? 1 : 0, borderBottomColor: N.line }}>
              {p.nebula.kind === 'voice' ? <SpeakerGlyph size={15} color={pinColor(p)} /> : <StarGlyph size={15} color={pinColor(p)} />}
              <View style={{ flex: 1, paddingVertical: 6 }}>
                <Text size={15} weight={p.nebula.unreadCount || p.nebula.mentionCount ? 'bold' : 'regular'}>
                  {p.nebula.name}
                </Text>
                <Text size={12} style={{ color: N.muted }}>
                  {p.constellationName}
                  {p.nebula.mentionCount ? ' · mentioned you' : ''}
                </Text>
              </View>
              {p.nebula.mentionCount ? (
                <Text size={11} weight="bold" style={{ color: N.violetText }}>
                  @{p.nebula.mentionCount}
                </Text>
              ) : p.nebula.unreadCount ? (
                <CountBadge count={p.nebula.unreadCount} ring="transparent" />
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : (
        <Text size={13} style={{ color: N.muted }}>Hold a nebula in Constellations and pick "Pin to Glofly dock" to keep it here.</Text>
      )}
      {cards.length ? <MentionsRow chevron /> : null}
    </ScrollView>
  )
}

/** A pinned nebula opened on Glofly home: its chat, Unpin, Fly in. */
function NebulaMini({ pin, onClose }: { pin: PinnedNebula; onClose: () => void }) {
  const { height } = useWindowDimensions()
  const detail = useCx((s) => s.details[pin.constellationId] ?? null)
  const [text, setText] = useState('')
  useEffect(() => {
    void loadDetail(pin.constellationId)
  }, [pin.constellationId])
  const nebula = detail?.nebulas.find((n) => n.id === pin.nebula.id) ?? null
  const { rows, people, members, meId } = useNebulaChat(detail, nebula)
  const blocked = detail && nebula ? cantPost(detail, nebula) : null
  const recent = useMemo(() => rows.slice(0, 40), [rows])
  async function unpin() {
    const r = await cx.unpin(pin.constellationId, pin.nebula.id)
    if (!r.ok) return cxSay(r.message)
    setPins(r.data.pins)
    onClose()
  }
  const send = () => {
    const body = text.trim()
    if (!body || !nebula) return
    sendText(nebula.conversationId, body, null)
    setText('')
  }
  return (
    <NightModal onClose={onClose} top={Math.min(230, Math.round(height * 0.28))} bg={N.bg} edge={N.edge} padded={false} backdrop="rgba(36,23,15,0.35)" accessibilityLabel={`${pin.nebula.name} in ${pin.constellationName}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: N.line }}>
        <ConstellationIcon c={{ id: pin.constellationId, name: pin.constellationName, color: pin.color, iconVersion: pin.iconVersion }} size={36} radius={12} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <StarGlyph size={13} color={pinColor(pin)} />
            <Text size={16} weight="bold" numberOfLines={1}>
              {pin.nebula.name}
            </Text>
          </View>
          <Text size={12} style={{ color: N.muted }} numberOfLines={1}>
            {pin.constellationName}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Unpin from dock" onPress={() => void unpin()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: N.card2, alignItems: 'center', justifyContent: 'center' }}>
          <Glyph name="pin" size={16} color={N.amber} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Fly in to ${pin.nebula.name}`} onPress={() => flyTo(`/constellations/${pin.constellationId}`, `/constellations/${pin.constellationId}/nebula/${pin.nebula.id}`)} style={{ height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: N.amber, justifyContent: 'center' }}>
          <Text size={13} weight="bold" style={{ color: N.amberInk }}>
            Fly in
          </Text>
        </Pressable>
      </View>
      <FlatList
        data={recent}
        inverted
        style={{ flex: 1 }}
        keyExtractor={(r) => r.message.id}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}
        renderItem={({ item }) => (
          <NebulaRow row={item} meId={meId} sender={people[item.message.senderId]} role={detail ? roleLook(detail, item.message.senderId) : null} members={members} people={people} highlight={false} compact canAct={!blocked} />
        )}
      />
      {blocked ? (
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: N.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Glyph name={blocked.kind === 'timeout' ? 'timer' : 'lock'} size={15} color={N.muted} />
          <Text size={13} style={{ color: N.muted }}>{blocked.text}</Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: N.line }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={`Message #${pin.nebula.name}`}
            placeholderTextColor={N.faint}
            accessibilityLabel={`Message ${pin.nebula.name}`}
            maxLength={MESSAGE_MAX}
            onSubmitEditing={send}
            returnKeyType="send"
            selectionColor={N.amber}
            style={[{ flex: 1, height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2, color: N.ink, fontFamily: font.body, fontSize: 15 }, webNoOutline]}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={send} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: N.amber, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="send" size={18} color={N.amberInk} strokeWidth={2.2} />
          </Pressable>
        </View>
      )}
    </NightModal>
  )
}
