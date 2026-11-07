import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Ellipse, Line, Path } from 'react-native-svg'
import { CONSTELLATION_THEME, ROLE_COLORS, colorsFor, constellationInitials, initials, starChartFor, type ConstellationColor, type NebulaStar, type PublicUser, type RoleColor } from '@glofly/shared'
import { authHeaders, url } from '@/api/http'
import { Avatar } from '@/ui/Avatar'
import { Icon, type IconName } from '@/ui/icons'
import { Text, webNoOutline } from '@/ui/kit'
import { font } from '@/ui/theme'

// The night side's own pieces, drawn from the "Glofly 2.0 Mobile" canvas: colors, glyphs, the
// constellation icon, headers, rows, chips, segmented controls and switches. Everything here is
// dark in every theme (like the night sky).

/** The night tab bar's height above the safe area (sheets that sit over it leave this much room). */
export const NIGHT_TAB_HEIGHT = 58

export const N = {
  bg: '#120c0a',
  deep: '#0b0706',
  side: '#160e0c',
  strip: '#0d0807',
  card: '#1c1210',
  card2: '#241712',
  raised: '#2a1c17',
  line: '#2a1c17',
  line2: '#3a2a22',
  edge: '#4a372b',
  edge2: '#574a41',
  ink: '#f5ede6',
  ink2: '#d9c2b1',
  muted: '#b8a699',
  faint: '#9c8a7d',
  dim: '#6b5547',
  amber: '#ffb347',
  amberInk: '#1c1210',
  tag: '#ffc596',
  green: '#2e9e5b',
  greenText: '#6fd39a',
  greenDeep: '#163024',
  greenEdge: '#2e5a3f',
  online: '#3dba6e',
  away: '#f0b429',
  red: '#d33a2c',
  redText: '#ff8a7a',
  violet: '#b57cff',
  violetText: '#cfa8ff',
  violetInk: '#1d0a33',
  orange: '#f47a1f',
  orangeInk: '#2a1406',
  glow: 'rgba(255,165,74,0.35)',
}

/** "#ffb347" → "rgba(255,179,71,.16)" */
export function hexA(hex: string, alpha: number): string {
  const v = hex.replace('#', '')
  return `rgba(${parseInt(v.slice(0, 2), 16)},${parseInt(v.slice(2, 4), 16)},${parseInt(v.slice(4, 6), 16)},${alpha})`
}

/** A role's colors on the night side: the name color, and its little badge. */
export function roleNight(color: RoleColor | undefined, owner = false) {
  const c = owner ? ROLE_COLORS.ember : (ROLE_COLORS[color ?? 'gray'] ?? ROLE_COLORS.gray)
  return { text: c.dark, badgeBg: hexA(c.dark, 0.16), dot: c.dark }
}

// ───────────── Glyphs ─────────────

/** Constellations: a few stars joined, ending in a bright one (Oct 17: replaces the spiral galaxy). */
export function GalaxyIcon({ size = 24, color = N.amber, strokeWidth = 1.3, star = true }: { size?: number; color?: string; strokeWidth?: number; star?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3.5 19 8.5 12.5 13 16 17.5 8.5" opacity={0.75} />
      <Circle cx={3.5} cy={19} r={1.6} fill={color} stroke="none" />
      <Circle cx={8.5} cy={12.5} r={1.5} fill={color} stroke="none" />
      <Circle cx={13} cy={16} r={1.5} fill={color} stroke="none" />
      {star ? <Path d="M18.5 2.5l1.1 3 3 1.1-3 1.1-1.1 3-1.1-3-3-1.1 3-1.1z" fill={color} stroke="none" /> : <Circle cx={17.5} cy={8.5} r={1.5} fill={color} stroke="none" />}
    </Svg>
  )
}

/** The little firefly on the "Glofly" pill and nebula headers (32 × 32). */
export function FireflyMark({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Ellipse cx={12} cy={11} rx={5.5} ry={3.2} transform="rotate(-28 12 11)" fill="#e9d5c4" opacity={0.55} />
      <Ellipse cx={20} cy={11} rx={5.5} ry={3.2} transform="rotate(28 20 11)" fill="#e9d5c4" opacity={0.55} />
      <Ellipse cx={16} cy={15} rx={3} ry={5} fill="#4a372b" />
      <Circle cx={16} cy={22} r={5} fill="#ffb347" opacity={0.35} />
      <Circle cx={16} cy={21.5} r={3.2} fill="#ffb347" />
    </Svg>
  )
}

/** The Home tab's firefly (32 × 28). */
export function HomeGlyph({ width = 26, height = 22 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 32 28">
      <Ellipse cx={12} cy={9} rx={5.5} ry={3.2} transform="rotate(-28 12 9)" fill="#e9d5c4" opacity={0.6} />
      <Ellipse cx={20} cy={9} rx={5.5} ry={3.2} transform="rotate(28 20 9)" fill="#e9d5c4" opacity={0.6} />
      <Ellipse cx={16} cy={13} rx={3} ry={5} fill="#6b5547" />
      <Circle cx={16} cy={20} r={5} fill="#ffb347" opacity={0.35} />
      <Circle cx={16} cy={19.5} r={3.2} fill="#ffb347" />
    </Svg>
  )
}

/** "Open Glofly" (32 × 24). */
export function OpenGloflyGlyph() {
  return (
    <Svg width={16} height={12} viewBox="0 0 32 24">
      <Circle cx={16} cy={16} r={5} fill="#ffb347" />
      <Ellipse cx={10} cy={8} rx={6} ry={3.4} transform="rotate(-28 10 8)" fill="#e9d5c4" opacity={0.6} />
      <Ellipse cx={22} cy={8} rx={6} ry={3.4} transform="rotate(28 22 8)" fill="#e9d5c4" opacity={0.6} />
    </Svg>
  )
}

/** The four-point star (text nebulas). */
export function StarGlyph({ size = 16, color = N.faint }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
    </Svg>
  )
}

/** The speaker (voice nebulas). */
export function SpeakerGlyph({ size = 16, color = N.faint, waves = 1 }: { size?: number; color?: string; waves?: 0 | 1 | 2 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 10v4h4l5 4V6L8 10H4z" />
      {waves >= 1 ? <Path d="M16.5 9a4 4 0 0 1 0 6" /> : null}
      {waves >= 2 ? <Path d="M19 6.5a8 8 0 0 1 0 11" /> : null}
    </Svg>
  )
}

/** A few small line icons the canvas uses that the app's icon set doesn't have. */
export function Glyph({ name, size = 18, color = N.ink }: { name: 'crown' | 'shield' | 'timer' | 'leave' | 'kick' | 'ban' | 'grip' | 'lock' | 'mention' | 'list' | 'micSlash' | 'eyeOff' | 'pin' | 'external' | 'screen' | 'watch' | 'markRead' | 'invite' | 'inbox'; size?: number; color?: string }) {
  const fillOnly = name === 'crown' || name === 'grip'
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={fillOnly ? color : 'none'} stroke={fillOnly ? 'none' : color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {name === 'crown' ? <Path d="M3 18h18l-2-10-4.5 4L12 5l-2.5 7L5 8z" /> : null}
      {name === 'shield' ? <Path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z" /> : null}
      {name === 'timer' ? <Path d="M12 9v4l2.5 2M9 2h6M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0z" /> : null}
      {name === 'leave' ? <Path d="M16 17l5-5-5-5M21 12H9M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" /> : null}
      {name === 'kick' ? <Path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M16 11h6M12.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z" /> : null}
      {name === 'ban' ? <Path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM5.6 5.6l12.8 12.8" /> : null}
      {name === 'grip' ? (
        <>
          <Circle cx={9} cy={6} r={1.6} />
          <Circle cx={15} cy={6} r={1.6} />
          <Circle cx={9} cy={12} r={1.6} />
          <Circle cx={15} cy={12} r={1.6} />
          <Circle cx={9} cy={18} r={1.6} />
          <Circle cx={15} cy={18} r={1.6} />
        </>
      ) : null}
      {name === 'lock' ? <Path d="M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 11V8a4 4 0 0 1 8 0v3" /> : null}
      {name === 'mention' ? <Path d="M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9" /> : null}
      {name === 'list' ? <Path d="M4 6h16M4 12h16M4 18h10" /> : null}
      {name === 'micSlash' ? <Path d="M9 5a3 3 0 0 1 6 0v6M5 11a7 7 0 0 0 11 5.7M12 18v3M3 3l18 18" /> : null}
      {name === 'eyeOff' ? <Path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 22 12a17 17 0 0 1-3 3.8M6.2 6.2A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.2-1" /> : null}
      {name === 'pin' ? <Path d="M9 4h6l-1 6 4 3v2H6v-2l4-3zM12 15v6" /> : null}
      {name === 'external' ? <Path d="M10 14 21 3M15 3h6v6M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" /> : null}
      {name === 'screen' ? <Path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 20h8M12 16v4" /> : null}
      {name === 'watch' ? <Path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 21h8M10 9l4 2-4 2z" /> : null}
      {name === 'markRead' ? <Path d="M2 12l5 5L18 6M12 15l2 2L22 9" /> : null}
      {name === 'inbox' ? <Path d="M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" /> : null}
      {name === 'invite' ? <Path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6M12.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z" /> : null}
    </Svg>
  )
}

// ───────────── The constellation icon ─────────────

export const constellationIconSource = (id: string, version: string) => ({
  uri: url(`/constellations/${id}/icon/${version}`),
  headers: authHeaders(),
  cacheKey: `cx-icon-${id}-${version}`,
})

/** A constellation's icon: its photo, or its initials on its color. `ring` = the open one (gold). */
export function ConstellationIcon({
  c,
  size = 42,
  radius,
  ring,
  border,
  style,
}: {
  c: { id: string; name: string; color: ConstellationColor; iconVersion: string | null }
  size?: number
  radius?: number
  ring?: boolean
  border?: string
  style?: StyleProp<ViewStyle>
}) {
  const t = CONSTELLATION_THEME[c.color] ?? CONSTELLATION_THEME.ember
  const r = radius ?? Math.round(size / 3)
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width: size, height: size, borderRadius: r, backgroundColor: c.iconVersion ? N.bg : t.icon, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
        border ? { borderWidth: 3, borderColor: border } : null,
        ring ? { boxShadow: `0 0 0 2.5px ${N.amber}, 0 0 16px rgba(255,165,74,0.45)`, overflow: 'visible' } : null,
        style,
      ]}
    >
      {c.iconVersion ? (
        <Image source={constellationIconSource(c.id, c.iconVersion)} style={{ width: '100%', height: '100%', borderRadius: r - (border ? 3 : 0) }} cachePolicy="disk" transition={120} />
      ) : (
        <Text style={{ color: t.iconText, fontFamily: font.displayBold, fontSize: Math.round(size * 0.34) }}>{constellationInitials(c.name)}</Text>
      )}
    </View>
  )
}

/** A steady number from an id (banner stars sit in the same spots every time). */
function hash(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 33 + (ch.codePointAt(0) ?? 0)) >>> 0
  return h
}

/** The stars on a banner: a small one in the glow color, a tiny cream one and a big glowing one. */
export function BannerStars({ id, color, width }: { id: string; color: ConstellationColor; width: number }) {
  const t = CONSTELLATION_THEME[color] ?? CONSTELLATION_THEME.ember
  const h = hash(id)
  const n = (k: number, span: number) => ((h >> (k * 3)) % span) - span / 2
  return (
    <>
      <View style={{ position: 'absolute', left: 30 + n(1, 20), top: 20 + n(2, 10), width: 3, height: 3, borderRadius: 2, backgroundColor: t.glow }} />
      <View style={{ position: 'absolute', left: Math.round(width * 0.4) + n(3, 40), top: 42 + n(4, 12), width: 2, height: 2, borderRadius: 1, backgroundColor: t.star }} />
      <View style={{ position: 'absolute', right: 60 + n(5, 30), top: 18 + n(6, 10), width: 4, height: 4, borderRadius: 2, backgroundColor: t.glow, boxShadow: `0 0 10px 3px ${hexA(t.glow, 0.45)}` }} />
    </>
  )
}

/** A face on the night side: the photo, or initials (you are always Glow Orange, like the canvas). */
export function Face({ user, size, me, ring, style }: { user: Pick<PublicUser, 'id' | 'displayName' | 'avatarVersion'>; size: number; me?: boolean; ring?: string; style?: StyleProp<ViewStyle> }) {
  if (user.avatarVersion || !me) {
    return (
      <View style={[{ borderRadius: size / 2 }, ring ? { boxShadow: ring } : null, style]}>
        <Avatar user={user} size={size} />
      </View>
    )
  }
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: N.orange, alignItems: 'center', justifyContent: 'center' }, ring ? { boxShadow: ring } : null, style]}>
      <Text style={{ color: N.orangeInk, fontFamily: font.bodyBold, fontSize: Math.round(size * 0.36) }}>{initials(user.displayName)}</Text>
    </View>
  )
}

/** Initials on a color, for things that aren't people (games). */
export function Tile({ label, size, radius, color }: { label: string; size: number; radius: number; color?: string }) {
  const [bg] = colorsFor(label)
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: color ?? bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#ffffff', fontFamily: font.displayBold, fontSize: Math.round(size * 0.3) }}>{label}</Text>
    </View>
  )
}

// ───────────── Small pieces ─────────────

export function Live({ small }: { small?: boolean }) {
  return (
    <View style={{ paddingHorizontal: small ? 5 : 6, paddingVertical: 1, borderRadius: small ? 3 : 4, backgroundColor: N.red }}>
      <Text size={small ? 9 : 10} weight="bold" style={{ color: '#fff' }}>
        LIVE
      </Text>
    </View>
  )
}

/** A count badge: orange for new, violet "@" for mentions. */
export function CountBadge({ count, mention, ring = N.bg, style }: { count: number; mention?: boolean; ring?: string; style?: StyleProp<ViewStyle> }) {
  if (count <= 0) return null
  return (
    <View
      style={[
        { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: mention ? N.violet : N.orange, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: ring },
        style,
      ]}
    >
      <Text size={10} weight="bold" style={{ color: mention ? N.violetInk : N.orangeInk }}>
        {mention ? (count > 1 ? `@${count}` : '@') : count > 99 ? '99+' : String(count)}
      </Text>
    </View>
  )
}

/** The section headings ("GENERAL", "WHO CAN JOIN"). */
export function Caps({ children, color = N.muted, style }: { children: ReactNode; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Text size={12} weight="bold" style={{ color, letterSpacing: 0.96, textTransform: 'uppercase' }}>
        {children}
      </Text>
    </View>
  )
}

/** The top of a night page: back (or close), a title, and actions on the right. */
export function NightHeader({
  title,
  subtitle,
  onBack,
  close,
  right,
  titleColor = N.ink,
  overlay,
}: {
  title?: ReactNode
  subtitle?: string
  onBack?: () => void
  close?: boolean
  right?: ReactNode
  titleColor?: string
  /** Sits over the content with a translucent bar (nebula chat) */
  overlay?: boolean
}) {
  const insets = useSafeAreaInsets()
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/constellations')))
  return (
    <View
      style={[
        { paddingTop: insets.top + 6, paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
        overlay ? { backgroundColor: 'rgba(18,12,10,0.94)', borderBottomWidth: 1, borderBottomColor: N.line } : null,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={close ? 'Close' : 'Back'}
        onPress={back}
        hitSlop={4}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: close ? N.card : 'transparent' }}
      >
        <Icon name={close ? 'close' : 'chevronLeft'} size={close ? 18 : 24} color={N.ink} strokeWidth={2.2} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? (
          <Text size={17} weight="bold" numberOfLines={1} style={{ color: titleColor }} accessibilityRole="header">
            {title}
          </Text>
        ) : (
          title
        )}
        {subtitle ? (
          <Text size={12} numberOfLines={1} style={{ color: N.muted }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  )
}

/** A rounded button: 'amber' (main), 'outline', 'green' (join), 'danger', 'quiet'. */
export function NightButton({
  label,
  onPress,
  kind = 'amber',
  icon,
  busy,
  disabled,
  height = 44,
  style,
  accessibilityLabel,
}: {
  label: string
  onPress?: () => void
  kind?: 'amber' | 'outline' | 'green' | 'danger' | 'quiet' | 'amberOutline'
  icon?: IconName
  busy?: boolean
  disabled?: boolean
  height?: number
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}) {
  const bg = kind === 'amber' ? N.amber : kind === 'green' ? N.green : kind === 'danger' ? N.red : kind === 'quiet' ? N.raised : kind === 'outline' ? 'rgba(18,12,10,0.6)' : 'transparent'
  const fg = kind === 'amber' ? N.amberInk : kind === 'green' || kind === 'danger' ? '#fff' : kind === 'amberOutline' ? N.amber : N.ink
  const border = kind === 'outline' ? N.edge2 : kind === 'amberOutline' ? N.amber : 'transparent'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        { height: Math.max(height, 44), borderRadius: Math.max(height, 44) / 2, paddingHorizontal: 16, backgroundColor: bg, borderWidth: border === 'transparent' ? 0 : 1, borderColor: border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        kind === 'green' && height >= 50 ? { boxShadow: '0 0 24px rgba(46,158,91,0.4)' } : null,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={16} color={fg} strokeWidth={2.2} /> : null}
      <Text size={height >= 50 ? 16 : 14} weight="bold" style={{ color: fg }}>
        {label}
      </Text>
    </Pressable>
  )
}

/** A filter chip ("Gaming", "#co-op"). */
export function Chip({ label, on, onPress, tag, onRemove, dashed }: { label: string; on?: boolean; onPress?: () => void; tag?: boolean; onRemove?: () => void; dashed?: boolean }) {
  const content = (
    <View
      style={{
        height: 34,
        paddingHorizontal: 13,
        borderRadius: 17,
        backgroundColor: on ? N.amber : tag ? N.card2 : 'transparent',
        borderWidth: on || tag ? 0 : 1,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: dashed ? N.edge2 : N.edge,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <Text size={13} weight={on ? 'bold' : tag ? 'regular' : 'medium'} style={{ color: on ? N.amberInk : tag ? N.tag : dashed ? N.muted : N.ink }}>
        {label}
      </Text>
      {onRemove ? <Icon name="close" size={12} color={on ? N.amberInk : N.tag} strokeWidth={2.4} /> : null}
    </View>
  )
  if (!onPress && !onRemove) return content
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={onRemove ? `Remove ${label}` : label}
      accessibilityState={{ selected: !!on }}
      onPress={onRemove ?? onPress}
      hitSlop={{ top: 6, bottom: 6 }}
    >
      {content}
    </Pressable>
  )
}

/** A segmented control ("Invite only · Public · With approval"). */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; name: string; flex?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: N.bg }}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.id)}
            style={{ flex: o.flex ?? 1, minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, backgroundColor: on ? N.raised : 'transparent', boxShadow: on ? `0 1px 0 ${N.edge}` : undefined }}
          >
            <Text size={13} weight={on ? 'bold' : 'medium'} numberOfLines={1} style={{ color: on ? N.ink : N.muted }}>
              {o.name}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** The same, with the picked one in amber (invite expiry, My games visibility). */
export function AmberSegmented<T extends string>({ options, value, onChange, label, bg = N.bg, accent = N.amber, accentInk = N.amberInk }: { options: { id: T; name: string }[]; value: T; onChange: (v: T) => void; label: string; bg?: string; accent?: string; accentInk?: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', padding: 4, borderRadius: 12, backgroundColor: bg }}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <Pressable key={o.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.id)} style={{ flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? accent : 'transparent' }}>
            <Text size={13} weight={on ? 'bold' : 'medium'} style={{ color: on ? accentInk : N.muted }}>
              {o.name}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** The canvas's radio dot. */
export function Radio({ on }: { on: boolean }) {
  return <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: on ? 6 : 2, borderColor: on ? N.amber : N.edge2 }} />
}

/** The canvas's green switch (permissions). */
export function Toggle({ value, onChange, label, disabled, amber }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; /** 4.2: the amber switch (notifications, board 29) */ amber?: boolean }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      hitSlop={10}
      style={{ width: 46, height: 28, borderRadius: 14, backgroundColor: value ? (amber ? N.amber : N.green) : N.edge, justifyContent: 'center', opacity: disabled ? 0.45 : 1 }}
    >
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: value ? '#fff' : N.ink2, marginLeft: value ? 21 : 3 }} />
    </Pressable>
  )
}

/** A group of rows on a card (settings, menus). */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ borderRadius: 18, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2, overflow: 'hidden' }, style]}>{children}</View>
}

/** A row in a card: icon, label, detail, chevron. */
export function Row({
  icon,
  label,
  detail,
  onPress,
  danger,
  chevron,
  last,
  height = 50,
  right,
  sub,
  accessibilityLabel,
  disabled,
  bg,
}: {
  icon?: ReactNode
  label: string
  detail?: ReactNode
  onPress?: () => void
  danger?: boolean
  chevron?: boolean
  last?: boolean
  height?: number
  right?: ReactNode
  sub?: string
  accessibilityLabel?: string
  disabled?: boolean
  bg?: string
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      disabled={!onPress || disabled}
      onPress={onPress}
      android_ripple={{ color: N.line2 }}
      style={({ pressed }) => ({ minHeight: Math.max(height, 48), paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: N.line, backgroundColor: pressed ? N.card2 : (bg ?? 'transparent'), opacity: disabled ? 0.45 : 1 })}
    >
      {icon}
      <View style={{ flex: 1, paddingVertical: 8 }}>
        <Text size={15} weight={danger ? 'bold' : 'regular'} style={{ color: danger ? N.redText : N.ink }}>
          {label}
        </Text>
        {sub ? (
          <Text size={12} style={{ color: N.muted }}>
            {sub}
          </Text>
        ) : null}
      </View>
      {typeof detail === 'string' ? (
        <Text size={13} style={{ color: N.muted }}>
          {detail}
        </Text>
      ) : (
        detail
      )}
      {right}
      {chevron ? <Icon name="chevronRight" size={16} color={N.faint} strokeWidth={2.2} /> : null}
    </Pressable>
  )
}

/** The rounded square behind a settings icon. */
export function IconBox({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: danger ? 'rgba(211,58,44,0.18)' : N.line2, alignItems: 'center', justifyContent: 'center' }}>{children}</View>
}

/** A text field on the night side. */
export function NightField({ label, style, multiline, count, max, ...rest }: TextInputProps & { label?: string; count?: boolean; max?: number }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text size={12} weight="bold" style={{ color: N.muted }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={N.faint}
        selectionColor={N.amber}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        multiline={multiline}
        maxLength={max}
        {...rest}
        style={[
          { minHeight: multiline ? 96 : 46, paddingHorizontal: 14, paddingVertical: multiline ? 12 : 0, borderRadius: 14, borderWidth: 1, borderColor: N.edge, backgroundColor: N.bg, color: N.ink, fontFamily: font.bodyMedium, fontSize: 16, textAlignVertical: multiline ? 'top' : 'center' },
          webNoOutline,
          style,
        ]}
      />
      {count && max ? (
        <Text size={12} style={{ color: N.faint, alignSelf: 'flex-end' }}>
          {String(rest.value ?? '').length} / {max}
        </Text>
      ) : null}
    </View>
  )
}

/** A search box ("Search members"). */
export function SearchBox({ value, onChange, placeholder, focusRing, autoFocus }: { value: string; onChange: (t: string) => void; placeholder: string; focusRing?: boolean; autoFocus?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: N.card, borderWidth: focusRing ? 1.5 : 1, borderColor: focusRing ? N.amber : N.line2, boxShadow: focusRing ? '0 0 16px rgba(255,165,74,0.2)' : undefined }}>
      <Icon name="search" size={16} color={N.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={N.muted}
        selectionColor={N.amber}
        accessibilityLabel={placeholder}
        autoFocus={autoFocus}
        autoCorrect={false}
        returnKeyType="search"
        style={[{ flex: 1, color: N.ink, fontFamily: font.body, fontSize: 15, height: 44 }, webNoOutline]}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={() => onChange('')} hitSlop={10}>
          <Icon name="close" size={14} color={N.muted} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </View>
  )
}

/** A horizontally scrolling row of chips that bleeds off the right edge like the canvas. */
export function ChipRow({ children, inset = 18 }: { children: ReactNode; inset?: number }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -inset }} contentContainerStyle={{ paddingHorizontal: inset, gap: 8 }}>
      {children}
    </ScrollView>
  )
}

/** Loading / problem in the middle of a night page. */
export function NightCenter({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>{children}</View>
}

/** "41 members · 12 online" */
export function MemberLine({ members, online, extra, size = 13 }: { members: number; online: number; extra?: string; size?: number }) {
  return (
    <Text size={size} style={{ color: N.ink2 }}>
      {members} {members === 1 ? 'member' : 'members'} · <Text size={size} style={{ color: N.greenText }}>{online} online</Text>
      {extra ? ` · ${extra}` : ''}
    </Text>
  )
}


/**
 * Nov 6, 2026: a constellation's own star pattern on its dashboard card (replaces the colored
 * banner). Same pattern as desktop and web (shared `starChartFor`): a nebula with news glows, a
 * busy one is a bigger star.
 */
export function StarChart({ id, sky, color, width = 150, height = 96 }: { id: string; sky?: NebulaStar[] | null; color: string; width?: number; height?: number }) {
  const chart = starChartFor(id, sky)
  const pt = (i: number): [number, number] => [chart.stars[i].x * width, chart.stars[i].y * height]
  return (
    <Svg width={width} height={height} pointerEvents="none" style={{ position: 'absolute', right: 4, top: 4 }}>
      {chart.links.map(([a, b]) => {
        const [x1, y1] = pt(a)
        const [x2, y2] = pt(b)
        return <Line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeOpacity={0.32} strokeWidth={1.2} />
      })}
      {chart.stars.map((st, i) => {
        const [x, y] = pt(i)
        const r = st.big ? 3.4 : 2.2
        return [
          st.bright || st.big ? <Circle key={`g${i}`} cx={x} cy={y} r={r * 3.2} fill={color} opacity={st.bright ? 0.28 : 0.16} /> : null,
          <Circle key={`s${i}`} cx={x} cy={y} r={r} fill={st.bright ? '#ffd27a' : color} />,
        ]
      })}
    </Svg>
  )
}
