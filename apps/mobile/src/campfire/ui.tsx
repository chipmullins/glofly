import { useEffect, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import Svg, { Polygon } from 'react-native-svg'
import type { Roll, TableState } from '@glofly/shared'
import { Text } from '@/ui/kit'
import { Icon, type IconName } from '@/ui/icons'
import { useCampfire } from './store'
import { useFire, useStill } from './lib'

// Campfire's small pieces, styled from the boards (dark call colors, Outfit + DM Sans).

/** The hexagon die face from the roll cards (Start / Player boards). */
export function DieFace({ value, size = 44, dim }: { value: string | number; size?: number; dim?: boolean }) {
  const fire = useFire()
  const s = size
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={s} height={s} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
        <Polygon points="50,0 100,25 100,75 50,100 0,75 0,25" fill={dim ? fire.raised : fire.accent} />
      </Svg>
      <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: Math.round(s * 0.41), color: dim ? fire.muted : fire.accentInk }}>{String(value)}</Text>
    </View>
  )
}

/** The boards' buttons: card (dark), primary (orange), or amber (the d20). */
export function FireButton({
  label,
  onPress,
  kind = 'card',
  busy,
  disabled,
  icon,
  style,
  height = 48,
  a11y,
  size = 15,
}: {
  label: string
  onPress: () => void
  kind?: 'card' | 'primary' | 'amber' | 'quiet'
  busy?: boolean
  disabled?: boolean
  icon?: IconName
  style?: StyleProp<ViewStyle>
  height?: number
  a11y?: string
  size?: number
}) {
  const fire = useFire()
  const bg = kind === 'primary' ? fire.accent : kind === 'amber' ? fire.amberSoft : kind === 'quiet' ? 'transparent' : fire.card
  const fg = kind === 'primary' ? fire.accentInk : kind === 'amber' ? fire.amber : fire.ink
  const off = disabled || busy
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        { height: Math.max(44, height), borderRadius: 14, paddingHorizontal: 14, backgroundColor: bg, borderWidth: kind === 'primary' ? 0 : 1, borderColor: fire.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text weight="bold" size={size} numberOfLines={1} style={{ color: fg }}>
        {label}
      </Text>
    </Pressable>
  )
}

/** A round 44 pt icon button over the map. */
export function MapButton({ icon, label, onPress, badge, lit }: { icon: IconName; label: string; onPress: () => void; badge?: number; lit?: boolean }) {
  const fire = useFire()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} new` : label}
      onPress={onPress}
      style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: lit ? fire.amberSoft : 'rgba(20,15,13,0.85)', borderWidth: 1, borderColor: lit ? fire.amber : fire.line, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={icon} size={20} color={lit ? fire.amber : fire.ink} />
      {badge ? (
        <View style={{ position: 'absolute', right: -2, top: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: fire.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text size={11} weight="bold" style={{ color: fire.accentInk }}>
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}

/** Who made a roll ("Lyra", "Chip", "The game master"). */
export function rollerName(t: TableState, roll: Roll, meId: string): string {
  const ch = roll.characterId ? t.characters.find((c) => c.id === roll.characterId) : undefined
  if (ch) return ch.name
  if (roll.userId === meId) return 'You'
  const m = t.members.find((x) => x.userId === roll.userId)
  return m?.user?.displayName.split(' ')[0] ?? 'Someone'
}

/** The newest roll, over the map for a few seconds (Player board's status card). */
export function RollToast({ campaignId, table, meId }: { campaignId: string; table: TableState; meId: string }) {
  const fire = useFire()
  const still = useStill()
  const roll = useCampfire((s) => s.toast[campaignId])
  const [shown, setShown] = useState<Roll | null>(null)
  useEffect(() => {
    if (!roll) return
    setShown(roll)
    const t = setTimeout(() => setShown((r) => (r?.id === roll.id ? null : r)), 4500)
    return () => clearTimeout(t)
  }, [roll])
  if (!shown) return null
  const r = shown.result
  const title = r.crit ? 'Natural 20!' : r.fumble ? 'Natural 1' : (shown.label ?? r.label ?? `Rolled ${shown.expression}`)
  const who = rollerName(table, shown, meId)
  const sub = `${who}${shown.label && (r.crit || r.fumble) ? ` · ${shown.label}` : ''}${shown.visibility === 'gm' ? ' · game master only' : shown.visibility === 'whisper' ? ' · whispered' : ''}`
  return (
    <Animated.View
      key={shown.id}
      entering={still ? undefined : FadeIn.duration(180)}
      exiting={still ? undefined : FadeOut.duration(220)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${who} rolled ${shown.label ?? shown.expression}: ${shown.total}`}
      pointerEvents="none"
      style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18, backgroundColor: 'rgba(20,15,13,0.94)', boxShadow: `0 0 0 1px rgba(255,179,71,0.5), 0 14px 40px rgba(0,0,0,0.6)`, maxWidth: 360 }}
    >
      <DieFace value={shown.total} size={52} />
      <View style={{ flexShrink: 1, gap: 3 }}>
        <Text numberOfLines={1} style={{ fontFamily: 'Outfit_700Bold', fontSize: 19, color: r.crit ? fire.spell : fire.ink }}>
          {title}
        </Text>
        <Text size={13} numberOfLines={1} style={{ color: fire.ink }}>
          {sub}
        </Text>
        <Text size={12} numberOfLines={1} style={{ color: fire.muted, fontFamily: 'monospace' }}>
          {r.breakdown}
        </Text>
      </View>
    </Animated.View>
  )
}

/** A titled section in panels and the sheet screen. */
export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  const fire = useFire()
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 24 }}>
        <Text accessibilityRole="header" style={{ flex: 1, fontFamily: 'Outfit_700Bold', fontSize: 15, color: fire.muted }}>
          {title}
        </Text>
        {right}
      </View>
      {children}
    </View>
  )
}

/** A thin health bar. */
export function Bar({ fraction, color, height = 6 }: { fraction: number; color: string; height?: number }) {
  const fire = useFire()
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: fire.track, overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`, height: '100%', borderRadius: height / 2, backgroundColor: color }} />
    </View>
  )
}
