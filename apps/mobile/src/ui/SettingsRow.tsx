import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { Icon, type IconName } from './icons'
import { Switch, Text } from './kit'
import { useTheme } from './theme'

/** One row on a settings page: icon, label, optional detail, and a switch / value / chevron. */
export function SettingsRow({
  icon,
  label,
  detail,
  value,
  onPress,
  toggle,
  danger,
  disabled,
  right,
  selected,
}: {
  icon?: IconName
  label: string
  detail?: string
  value?: string
  onPress?: () => void
  toggle?: { value: boolean; onChange: (v: boolean) => void }
  danger?: boolean
  disabled?: boolean
  right?: ReactNode
  /** One choice of several (Oct 30, 2026): a check when picked, no chevron. */
  selected?: boolean
}) {
  const { c } = useTheme()
  const content = (
    <>
      {icon ? <Icon name={icon} size={22} color={danger ? c.danger : c.ink2} /> : null}
      <View style={{ flex: 1, minWidth: 0, paddingVertical: 12 }}>
        <Text size={16} tone={danger ? 'danger' : 'ink'} weight={danger ? 'medium' : 'regular'}>
          {label}
        </Text>
        {detail ? (
          <Text size={13} tone="muted" style={{ marginTop: 2, lineHeight: 18 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text size={14} tone="muted" numberOfLines={1} style={{ maxWidth: '45%' }}>
          {value}
        </Text>
      ) : null}
      {right}
      {selected !== undefined ? (
        selected ? <Icon name="check" size={20} color={c.accentText} /> : <View style={{ width: 20 }} />
      ) : toggle ? (
        <Switch value={toggle.value} onChange={toggle.onChange} label={label} />
      ) : onPress ? (
        <Icon name="chevronRight" size={18} color={c.faint} />
      ) : null}
    </>
  )
  const style = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 16, paddingHorizontal: 20, minHeight: 56, opacity: disabled ? 0.5 : 1 }
  if (toggle && !onPress)
    return (
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: toggle.value, disabled }} accessibilityLabel={label} disabled={disabled} onPress={() => toggle.onChange(!toggle.value)} style={style}>
        {content}
      </Pressable>
    )
  if (onPress)
    return (
      <Pressable accessibilityRole={selected !== undefined ? 'radio' : 'button'} accessibilityState={selected !== undefined ? { checked: selected, disabled } : undefined} disabled={disabled} onPress={onPress} android_ripple={{ color: c.line }} style={style}>
        {content}
      </Pressable>
    )
  return <View style={style}>{content}</View>
}
