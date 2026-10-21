import { useState, type ReactNode, type Ref } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch as RNSwitch,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { c, chipColors, font, type ChipTone } from './theme'
import { Icon, type IconName } from './icons'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { avatarColor, initials } from '@control/format'

// The building blocks every screen uses, drawn from the approved mockups.

type Weight = 'regular' | 'medium' | 'semi' | 'bold'

export function Text({
  style,
  size = 15,
  weight = 'regular',
  display,
  color = c.ink,
  ...rest
}: TextProps & { size?: number; weight?: Weight; display?: boolean; color?: string }) {
  const family = display
    ? weight === 'bold'
      ? font.displayBold
      : weight === 'medium' || weight === 'regular'
        ? font.displayMedium
        : font.display
    : weight === 'bold' || weight === 'semi'
      ? font.bodySemi
      : weight === 'medium'
        ? font.bodyMedium
        : font.body
  return <RNText maxFontSizeMultiplier={1.6} {...rest} style={[{ color, fontFamily: family, fontSize: size }, style]} />
}

export const Muted = (p: TextProps & { size?: number; weight?: Weight; color?: string }) => <Text size={12.5} color={c.muted} {...p} />

export function Button({
  label,
  onPress,
  kind = 'primary',
  busy,
  disabled,
  icon,
  style,
  height = 52,
  accessibilityLabel,
}: {
  label: string
  onPress?: () => void
  kind?: 'primary' | 'gold' | 'danger' | 'secondary' | 'dangerSoft' | 'ghost'
  busy?: boolean
  disabled?: boolean
  icon?: IconName
  style?: StyleProp<ViewStyle>
  height?: number
  accessibilityLabel?: string
}) {
  const colors: Record<string, [string, string, string]> = {
    primary: [c.primary, c.white, c.primary],
    gold: [c.gold, c.goldInk, c.gold],
    danger: [c.danger, c.white, c.danger],
    secondary: [c.card, c.ink, c.fieldBorder],
    dangerSoft: [c.dangerSoft, c.dangerText, c.dangerBorder],
    ghost: ['transparent', c.primary, 'transparent'],
  }
  const [bg, fg, border] = colors[kind]
  const off = disabled || busy
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: height,
          borderRadius: 14,
          paddingHorizontal: 16,
          paddingVertical: 8,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          opacity: disabled && !busy ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={20} color={fg} /> : null}
      <Text display={height >= 50} weight="bold" size={height >= 50 ? 17 : 14} color={fg} style={{ textAlign: 'center', flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  )
}

/** A round icon button (≥44 pt) with a VoiceOver label. */
export function IconButton({
  name,
  label,
  onPress,
  color = c.ink,
  bg = 'transparent',
  border,
  size = 22,
  style,
  disabled,
}: {
  name: IconName
  label: string
  onPress?: () => void
  color?: string
  bg?: string
  border?: string
  size?: number
  style?: StyleProp<ViewStyle>
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg,
          borderWidth: border ? 1 : 0,
          borderColor: border,
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  )
}

export function Card({ children, style, pad = 14 }: { children: ReactNode; style?: StyleProp<ViewStyle>; pad?: number }) {
  return (
    <View style={[{ backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 16, paddingHorizontal: pad }, style]}>
      {children}
    </View>
  )
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 4 }}>
      <Text display weight="semi" size={16} style={{ flex: 1 }} accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  )
}

/** Small uppercase heading above a group (Alerts.dc.html). */
export function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <Text size={13} weight="semi" color={c.muted} accessibilityRole="header" style={{ marginHorizontal: 4, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>
      {children}
    </Text>
  )
}

/** A list row: title + sub on the left, anything on the right; tappable when onPress is set. */
export function Row({
  title,
  sub,
  right,
  left,
  onPress,
  first,
  chevron = !!onPress,
  minHeight = 52,
  titleColor = c.ink,
  accessibilityLabel,
  disabled,
}: {
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
  left?: ReactNode
  onPress?: () => void
  first?: boolean
  chevron?: boolean
  minHeight?: number
  titleColor?: string
  accessibilityLabel?: string
  disabled?: boolean
}) {
  const content = (
    <>
      {left}
      <View style={{ flex: 1, paddingVertical: 8 }}>
        {typeof title === 'string' ? (
          <Text size={14} weight="semi" color={titleColor}>
            {title}
          </Text>
        ) : (
          title
        )}
        {sub ? typeof sub === 'string' ? <Muted>{sub}</Muted> : sub : null}
      </View>
      {right}
      {chevron ? <Icon name="chevron" size={16} color={c.faint} /> : null}
    </>
  )
  const style: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight,
    borderTopWidth: first ? 0 : 1,
    borderTopColor: c.divider,
  }
  if (!onPress) return <View style={style}>{content}</View>
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [style, { opacity: disabled ? 0.5 : pressed ? 0.6 : 1 }]}
    >
      {content}
    </Pressable>
  )
}

export function Chip({ label, tone = 'off', small }: { label: string; tone?: ChipTone; small?: boolean }) {
  const [bg, fg] = chipColors[tone]
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: small ? 9 : 12, paddingVertical: small ? 4 : 6, alignSelf: 'center' }}>
      <Text size={small ? 11.5 : 12.5} weight="bold" color={fg} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

/** A selectable pill (filters, quick notes). */
export function Pill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        paddingHorizontal: 14,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: on ? c.primary : c.fieldBorder,
        backgroundColor: on ? c.primary : c.card,
        justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text size={13.5} weight="semi" color={on ? c.white : c.ink}>
        {label}
      </Text>
    </Pressable>
  )
}

export function Switch({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <RNSwitch
      accessibilityLabel={label}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{ true: c.primary, false: '#e2d6c8' }}
      ios_backgroundColor="#e2d6c8"
      thumbColor="#ffffff"
    />
  )
}

export function Field({
  label,
  error,
  dark,
  style,
  inputStyle,
  hint,
  ref,
  ...rest
}: TextInputProps & {
  label?: string
  error?: string
  dark?: boolean
  style?: StyleProp<ViewStyle>
  inputStyle?: StyleProp<TextStyle>
  hint?: string
  ref?: Ref<TextInput>
}) {
  const [focused, setFocused] = useState(false)
  const border = error ? c.danger : focused ? (dark ? c.gold : c.primary) : dark ? c.fieldBorderOnViolet : c.fieldBorder
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? (
        <Text size={13} weight={dark ? 'medium' : 'semi'} color={dark ? c.onVioletSoft : c.muted}>
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        accessibilityLabel={label ?? rest.placeholder}
        placeholderTextColor={dark ? '#7d70a8' : '#a8968a'}
        maxFontSizeMultiplier={1.4}
        {...rest}
        onFocus={(e) => {
          setFocused(true)
          rest.onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          rest.onBlur?.(e)
        }}
        style={[
          {
            minHeight: rest.multiline ? 96 : 48,
            paddingHorizontal: 14,
            paddingVertical: rest.multiline ? 12 : 0,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: border,
            backgroundColor: dark ? c.fieldOnViolet : c.card,
            color: dark ? c.white : c.ink,
            fontFamily: font.body,
            fontSize: 16,
            textAlignVertical: rest.multiline ? 'top' : 'center',
          },
          inputStyle,
        ]}
      />
      {error ? (
        <Text size={12.5} color={dark ? '#ff9b92' : c.dangerText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Muted>{hint}</Muted>
      ) : null}
    </View>
  )
}

export function Avatar({ id, name, size = 40, online, ring = c.page }: { id: string; name: string; size?: number; online?: boolean; ring?: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(id), alignItems: 'center', justifyContent: 'center' }}
    >
      <Text display={size >= 50} weight="semi" size={size * 0.36} color={c.white} maxFontSizeMultiplier={1}>
        {initials(name)}
      </Text>
      {online ? (
        <View
          style={{
            position: 'absolute',
            right: 1,
            bottom: 1,
            width: size * 0.24,
            height: size * 0.24,
            borderRadius: size * 0.12,
            backgroundColor: c.online,
            borderWidth: Math.max(2, size * 0.05),
            borderColor: ring,
          }}
        />
      ) : null}
    </View>
  )
}

export const Dot = ({ color, size = 10 }: { color: string; size?: number }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
)

/** A page: warm background, safe areas, a title row and pull to refresh. */
export function Screen({
  title,
  back,
  right,
  children,
  onRefresh,
  refreshing = false,
  header,
  scroll = true,
  footer,
  contentStyle,
}: {
  title?: string
  back?: boolean | string
  right?: ReactNode
  children: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  /** Replaces the plain title row (violet headers). */
  header?: ReactNode
  scroll?: boolean
  footer?: ReactNode
  contentStyle?: StyleProp<ViewStyle>
}) {
  const insets = useSafeAreaInsets()
  const top = header ? null : (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {back ? (
        <IconButton name="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ marginLeft: -12 }} />
      ) : null}
      {title ? (
        <Text display weight="bold" size={26} style={{ flex: 1 }} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
      ) : typeof back === 'string' ? (
        <Text size={15} weight="semi" color={c.muted} style={{ flex: 1 }}>
          {back}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {right}
    </View>
  )
  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={header ? c.onViolet : c.muted} /> : undefined}
    >
      {header}
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, paddingHorizontal: 16, gap: 12 }, contentStyle]}>{children}</View>
  )
  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      {top}
      {body}
      {footer}
    </View>
  )
}

/** Loading / error / empty states inside a page. */
export function Status({ loading, error, onRetry, empty }: { loading?: boolean; error?: string | null; onRetry?: () => void; empty?: string }) {
  if (loading)
    return (
      <View style={{ paddingVertical: 40, alignItems: 'center' }}>
        <ActivityIndicator color={c.muted} />
      </View>
    )
  if (error)
    return (
      <Card style={{ paddingVertical: 14, gap: 10 }}>
        <Text size={14} color={c.dangerText}>
          {error}
        </Text>
        {onRetry ? <Button label="Try again" kind="secondary" height={44} onPress={onRetry} /> : null}
      </Card>
    )
  if (empty)
    return (
      <View style={{ paddingVertical: 32, alignItems: 'center' }}>
        <Muted size={14} style={{ textAlign: 'center' }}>
          {empty}
        </Muted>
      </View>
    )
  return null
}

/** Full-bleed violet header with rounded bottom (Home, Constellation). */
export function VioletHeader({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        {
          marginHorizontal: -16,
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: 20,
          backgroundColor: c.tabBar,
          borderBottomLeftRadius: 24,
          borderBottomRightRadius: 24,
          gap: 14,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Gradient from={c.violetTop} to={c.tabBar} />
      {children}
    </View>
  )
}

/** A top-to-bottom gradient filling its parent (the mockups' violet headers and sign-in page). */
export function Gradient({ from, to, stop = 1 }: { from: string; to: string; stop?: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset={String(stop)} stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#g)" />
      </Svg>
    </View>
  )
}
