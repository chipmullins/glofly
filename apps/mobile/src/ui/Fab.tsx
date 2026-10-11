import { Pressable } from 'react-native'
import { Icon, type IconName } from './icons'
import { Text } from './kit'
import { useTheme } from './theme'

/** The floating "New chat" / "New group" / "Add friend" button from the design. */
export function Fab({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        right: 16,
        bottom: 16,
        height: 56,
        paddingLeft: 16,
        paddingRight: 20,
        borderRadius: 16,
        backgroundColor: c.accent,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        boxShadow: `0 4px 12px ${c.shadow}`,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Icon name={icon} size={22} color={c.accentInk} />
      <Text size={15} weight="bold" style={{ color: c.accentInk }}>
        {label}
      </Text>
    </Pressable>
  )
}
