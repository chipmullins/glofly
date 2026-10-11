import { forwardRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { font, useTheme, type Colors } from './theme'
import { Icon, type IconName } from './icons'

// The building blocks every screen uses, styled from the design canvas.

/** The browser preview draws its own focus box inside our field; the field shows focus itself. */
export const webNoOutline = (Platform.OS === 'web' ? { outlineStyle: 'none' } : null) as TextStyle | null

type Tone = 'ink' | 'ink2' | 'muted' | 'faint' | 'accent' | 'danger' | 'online' | 'accentInk'

export function Text({
  style,
  tone = 'ink',
  weight = 'regular',
  size = 16,
  display,
  ...rest
}: TextProps & {
  tone?: Tone
  weight?: 'regular' | 'medium' | 'bold'
  size?: number
  /** Outfit (titles) instead of DM Sans */
  display?: boolean
}) {
  const { c } = useTheme()
  const color = toneColor(c, tone)
  const family = display
    ? weight === 'bold'
      ? font.displayBold
      : weight === 'medium'
        ? font.displayMedium
        : font.display
    : weight === 'bold'
      ? font.bodyBold
      : weight === 'medium'
        ? font.bodyMedium
        : font.body
  return <RNText {...rest} style={[{ color, fontFamily: family, fontSize: size }, style]} />
}

function toneColor(c: Colors, tone: Tone): string {
  switch (tone) {
    case 'ink2':
      return c.ink2
    case 'muted':
      return c.muted
    case 'faint':
      return c.faint
    case 'accent':
      return c.accentText
    case 'danger':
      return c.danger
    case 'online':
      return c.onlineText
    case 'accentInk':
      return c.accentInk
    default:
      return c.ink
  }
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  busy,
  disabled,
  icon,
  style,
  compact,
}: {
  label: string
  onPress?: () => void
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost'
  busy?: boolean
  disabled?: boolean
  icon?: IconName
  style?: StyleProp<ViewStyle>
  compact?: boolean
}) {
  const { c } = useTheme()
  const bg = kind === 'primary' ? c.accent : kind === 'danger' ? c.danger : kind === 'secondary' ? c.surface : 'transparent'
  const fg = kind === 'primary' ? c.accentInk : kind === 'danger' ? '#FFFFFF' : kind === 'ghost' ? c.accentText : c.ink
  const off = disabled || busy
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: compact ? 44 : 54,
          borderRadius: compact ? 22 : 27,
          paddingHorizontal: compact ? 18 : 24,
          backgroundColor: bg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled && !busy ? 0.5 : pressed ? 0.85 : 1,
        },
        kind === 'primary' && !off ? { shadowColor: c.accent, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 } : null,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={20} color={fg} /> : null}
      <Text size={compact ? 15 : 17} weight="bold" display={!compact} style={{ color: fg }}>
        {label}
      </Text>
    </Pressable>
  )
}

export function IconButton({
  name,
  label,
  onPress,
  color,
  size = 22,
  box = 48,
  style,
  disabled,
  ...rest
}: {
  name: IconName
  label: string
  onPress?: () => void
  color?: string
  size?: number
  box?: number
  style?: StyleProp<ViewStyle>
  disabled?: boolean
} & Omit<PressableProps, 'style' | 'onPress'>) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: c.line, borderless: true, radius: box / 2 }}
      style={({ pressed }) => [
        { width: box, height: box, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        style,
      ]}
      {...rest}
    >
      <Icon name={name} size={size} color={color ?? c.ink2} />
    </Pressable>
  )
}

export const Field = forwardRef<
  TextInput,
  TextInputProps & {
    label?: string
    error?: string | null
    hint?: ReactNode
    good?: boolean
    prefix?: string
    secure?: boolean
    containerStyle?: StyleProp<ViewStyle>
  }
>(function Field({ label, error, hint, good, prefix, secure, containerStyle, style, ...rest }, ref) {
  const { c } = useTheme()
  const [focused, setFocused] = useState(false)
  const [shown, setShown] = useState(false)
  const border = error ? c.danger : good ? c.online : focused ? c.accent : c.fieldLine
  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      {label ? (
        <Text size={14} weight="medium">
          {label}
        </Text>
      ) : null}
      <View
        style={{
          minHeight: 50,
          borderWidth: 1.5,
          borderColor: border,
          borderRadius: 12,
          backgroundColor: c.field,
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 14,
          ...(focused && !error ? { boxShadow: `0 0 0 4px ${c.focus}` } : null),
        }}
      >
        {prefix ? (
          <Text tone="faint" style={{ marginRight: 2 }}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={c.faint}
          selectionColor={c.accent}
          secureTextEntry={secure && !shown}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          onFocus={(e) => {
            setFocused(true)
            rest.onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            rest.onBlur?.(e)
          }}
          {...rest}
          style={[{ flex: 1, minHeight: 46, color: c.ink, fontFamily: font.body, fontSize: 16, paddingRight: 14 }, webNoOutline, style as StyleProp<TextStyle>]}
        />
        {secure ? (
          <IconButton name={shown ? 'eyeOff' : 'eye'} label={shown ? 'Hide password' : 'Show password'} onPress={() => setShown((s) => !s)} color={c.muted} size={20} box={44} />
        ) : null}
      </View>
      {error ? (
        <Text size={13} tone="danger" weight="medium" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        typeof hint === 'string' ? (
          <Text size={12} tone="muted">
            {hint}
          </Text>
        ) : (
          hint
        )
      ) : null}
    </View>
  )
})

export function Switch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={{
        width: 52,
        height: 32,
        borderRadius: 16,
        backgroundColor: value ? c.accent : c.surface2,
        borderWidth: value ? 0 : 2,
        borderColor: c.faint,
        justifyContent: 'center',
        paddingHorizontal: value ? 4 : 6,
      }}
    >
      <View
        style={{
          width: value ? 24 : 16,
          height: value ? 24 : 16,
          borderRadius: 12,
          backgroundColor: value ? c.accentInk : c.faint,
          alignSelf: value ? 'flex-end' : 'flex-start',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {value ? <Icon name="check" size={14} color={c.accent} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  )
}

export function Checkbox({ value, onChange, children }: { value: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44, paddingVertical: 6 }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          marginTop: 1,
          borderRadius: 3,
          borderWidth: value ? 0 : 2,
          borderColor: c.muted,
          backgroundColor: value ? c.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {value ? <Icon name="check" size={14} color={c.accentInk} strokeWidth={3.4} /> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  )
}

export function Badge({ count, muted, mention }: { count: number; muted?: boolean; mention?: boolean }) {
  const { c } = useTheme()
  if (count <= 0 && !mention) return null
  return (
    <View
      style={{
        minWidth: 22,
        height: 22,
        paddingHorizontal: 6,
        borderRadius: 11,
        backgroundColor: muted ? c.mutedBadge : c.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text size={12} weight="bold" style={{ color: muted ? '#FFFFFF' : c.accentInk }}>
        {mention ? '@' : count > 99 ? '99+' : String(count)}
      </Text>
    </View>
  )
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginLeft: inset }} />
}

export function Spinner({ color }: { color?: string }) {
  const { c } = useTheme()
  return <ActivityIndicator color={color ?? c.accent} />
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text size={12} weight="bold" tone="muted" style={{ letterSpacing: 0.7, textTransform: 'uppercase', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 }}>
      {children}
    </Text>
  )
}

/** A message box for errors and notes at the top of a form. */
export function Notice({ tone = 'danger', children }: { tone?: 'danger' | 'info' | 'good'; children: ReactNode }) {
  const { c } = useTheme()
  const bg = tone === 'danger' ? c.dangerSoft : tone === 'good' ? c.onlineSoft : c.infoSoft
  const fg = tone === 'danger' ? c.danger : tone === 'good' ? c.onlineText : c.info
  return (
    <View accessibilityLiveRegion="polite" style={{ borderRadius: 12, padding: 12, backgroundColor: bg, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Icon name={tone === 'good' ? 'check' : 'info'} size={18} color={fg} />
      <Text size={14} style={{ color: fg, flex: 1 }}>
        {children}
      </Text>
    </View>
  )
}
