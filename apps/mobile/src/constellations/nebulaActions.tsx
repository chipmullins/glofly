import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { create } from 'zustand'
import { MUTE_CHOICES, PINNED_NEBULAS_MAX, type ConstellationDetail, type MuteDuration, type Nebula, type NotifyLevel } from '@glofly/shared'
import * as api from '@/api/glofly'
import { cx } from '@/api/constellations'
import { cxSay, patchNebula, refreshCardsSoon, setPins, useCx } from '@/state/constellations'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { openContextMenu, type MenuItem } from './ContextMenu'
import { haptic } from './motion'
import { NightModal } from './sheet'
import { markNebulaRead } from './useNebula'
import { Caps, Glyph, N, Radio, SpeakerGlyph, StarGlyph } from './ui'
import { isQuiet, mutedUntilText } from './roles'

// A nebula's own settings (canvas board 6): press and hold it for Mark as read, Mute, Notify me
// about and Pin to Glofly dock; the Mute / Notify sheet; and the same from a nebula's header.

export const NOTIFY_WORDS: Record<NotifyLevel, string> = { all: 'All messages', mentions: 'Only @mentions', none: 'Nothing' }

/** The Mute / Notify sheet, shown by whichever screen asked for it. */
export const useNebulaSheet = create<{ open: { constellationId: string; nebulaId: string } | null }>(() => ({ open: null }))
export const openNebulaSheet = (constellationId: string, nebulaId: string) => useNebulaSheet.setState({ open: { constellationId, nebulaId } })

/** Press and hold a nebula. */
export async function nebulaMenu(c: ConstellationDetail, n: Nebula, anchor: { x: number; y: number; w: number; h: number }, preview: ReactNode) {
  haptic.medium()
  const pins = useCx.getState().pins
  const pinned = pins.some((p) => p.nebula.id === n.id)
  const quiet = isQuiet(n)
  const level = n.notify ?? null
  const items: MenuItem[] = [
    { key: 'read', label: 'Mark as read', icon: <Glyph name="markRead" color={N.ink} />, disabled: !n.unreadCount && !n.mentionCount },
    {
      key: 'mute',
      label: quiet ? 'Muted' : 'Mute',
      icon: <Icon name="bellOff" size={18} color={N.ink} />,
      detail: quiet && n.mutedUntil ? mutedUntilText(n.mutedUntil) : '1 h · 8 h · 24 h · Until on',
      chevron: true,
    },
    { key: 'notify', label: 'Notify me about', icon: <Icon name="bell" size={18} color={N.ink} />, detail: level ? NOTIFY_WORDS[level] : 'Default', chevron: true },
    pinned
      ? { key: 'unpin', label: 'Unpin from Glofly dock', icon: <Icon name="unpin" size={18} color={N.amber} /> }
      : { key: 'pin', label: 'Pin to Glofly dock', icon: <Icon name="pin" size={18} color={N.amber} />, detail: `${pins.length} of ${PINNED_NEBULAS_MAX}`, disabled: pins.length >= PINNED_NEBULAS_MAX },
  ]
  const pick = await openContextMenu(anchor, preview, items)
  if (pick === 'read') await markNebulaRead(c.id, n)
  if (pick === 'mute' || pick === 'notify') openNebulaSheet(c.id, n.id)
  if (pick === 'pin' || pick === 'unpin') await pinNebula(c, n, pick === 'pin')
}

export async function pinNebula(c: ConstellationDetail, n: Nebula, on: boolean) {
  const r = on ? await cx.pin(c.id, n.id) : await cx.unpin(c.id, n.id)
  if (!r.ok) return cxSay(r.message)
  haptic.success()
  setPins(r.data.pins)
  cxSay(on ? `Pinned #${n.name} to your Glofly dock.` : `Unpinned #${n.name}.`)
}

export async function muteNebula(c: ConstellationDetail, n: Nebula, duration: MuteDuration | null) {
  const before = n.mutedUntil ?? null
  patchNebula(c.id, n.id, { mutedUntil: duration ? new Date(Date.now() + 60_000).toISOString() : null })
  const r = await api.muteChat(n.conversationId, duration)
  if (!r.ok) {
    patchNebula(c.id, n.id, { mutedUntil: before })
    return cxSay(r.message)
  }
  patchNebula(c.id, n.id, { mutedUntil: r.data })
  refreshCardsSoon()
}

export async function setNebulaNotify(c: ConstellationDetail, n: Nebula, level: NotifyLevel | null) {
  const before = n.notify
  patchNebula(c.id, n.id, { notify: level })
  const r = await cx.nebulaNotify(c.id, n.id, level)
  if (!r.ok) {
    patchNebula(c.id, n.id, { notify: before })
    cxSay(r.message)
  }
}

/** "8 hours" as the canvas writes it. */
const MUTE_SHORT: Record<MuteDuration, string> = { '1h': '1 hour', '8h': '8 hours', '24h': '24 hours', forever: 'Until I turn it on' }

export function NebulaSheetHost() {
  const open = useNebulaSheet((s) => s.open)
  const c = useCx((s) => (open ? s.details[open.constellationId] : undefined))
  const n = c?.nebulas.find((x) => x.id === open?.nebulaId)
  const [picked, setPicked] = useState<MuteDuration | null>(null)
  if (!open || !c || !n) return null
  const close = () => {
    setPicked(null)
    useNebulaSheet.setState({ open: null })
  }
  const quiet = isQuiet(n)
  const level = n.notify
  const choices: { id: NotifyLevel | null; name: string; sub?: string }[] = [
    { id: 'all', name: NOTIFY_WORDS.all },
    { id: 'mentions', name: NOTIFY_WORDS.mentions },
    { id: 'none', name: NOTIFY_WORDS.none },
    { id: null, name: `${c.name} default`, sub: `Currently: ${NOTIFY_WORDS[c.me.notify]}` },
  ]
  return (
    <NightModal onClose={close} fit accessibilityLabel={`${n.name} notifications`}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {n.kind === 'voice' ? <SpeakerGlyph size={16} color={N.amber} /> : <StarGlyph size={16} color={N.amber} />}
          <Text size={18} weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {n.name}
          </Text>
          <Text size={14} numberOfLines={1} style={{ color: N.muted, flexShrink: 1 }}>
            · {c.name}
          </Text>
        </View>
        <Caps>{quiet && n.mutedUntil ? `Muted ${mutedUntilText(n.mutedUntil)}` : 'Mute for'}</Caps>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {MUTE_CHOICES.map((m) => {
            const on = picked === m.duration
            return (
              <Pressable
                key={m.duration}
                accessibilityRole="button"
                accessibilityLabel={`Mute ${m.label.toLowerCase()}`}
                accessibilityState={{ selected: on }}
                onPress={() => {
                  haptic.select()
                  setPicked(m.duration)
                  void muteNebula(c, n, m.duration).then(close)
                }}
                style={{ flexBasis: '47%', flexGrow: 1, height: 46, borderRadius: 14, borderWidth: on ? 1.5 : 1, borderColor: on ? N.amber : N.edge, backgroundColor: on ? N.raised : N.card2, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text size={15} weight={on ? 'bold' : 'medium'} style={{ color: on ? N.amber : N.ink }}>
                  {MUTE_SHORT[m.duration]}
                </Text>
              </Pressable>
            )
          })}
        </View>
        {quiet ? (
          <Pressable accessibilityRole="button" onPress={() => void muteNebula(c, n, null).then(close)} style={{ height: 46, borderRadius: 14, borderWidth: 1, borderColor: N.amber, alignItems: 'center', justifyContent: 'center' }}>
            <Text size={15} weight="bold" style={{ color: N.amber }}>
              Unmute now
            </Text>
          </Pressable>
        ) : null}
        <Text size={12} style={{ color: N.faint }}>
          @mentions of you still come through.
        </Text>
        <Caps style={{ marginTop: 4 }}>Notify me about</Caps>
        <View accessibilityRole="radiogroup" style={{ borderRadius: 16, backgroundColor: N.bg, borderWidth: 1, borderColor: N.line2, overflow: 'hidden' }}>
          {choices.map((ch, i) => {
            const on = level === ch.id
            return (
              <Pressable
                key={String(ch.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={ch.sub ? `${ch.name}, ${ch.sub}` : ch.name}
                onPress={() => {
                  haptic.select()
                  void setNebulaNotify(c, n, ch.id)
                }}
                style={{ minHeight: ch.sub ? 56 : 50, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: i === choices.length - 1 ? 0 : 1, borderBottomColor: N.line }}
              >
                <View style={{ flex: 1 }}>
                  <Text size={15} weight={on ? 'bold' : 'regular'}>
                    {ch.name}
                  </Text>
                  {ch.sub ? (
                    <Text size={12} style={{ color: N.faint }}>
                      {ch.sub}
                    </Text>
                  ) : null}
                </View>
                <Radio on={on} />
              </Pressable>
            )
          })}
        </View>
      </View>
    </NightModal>
  )
}
