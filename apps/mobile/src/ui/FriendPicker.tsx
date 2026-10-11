import { useMemo, useState } from 'react'
import { FlatList, Pressable, TextInput, View } from 'react-native'
import type { FriendEntry } from '@glofly/shared'
import { useStore } from '@/state/store'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { Text, webNoOutline } from './kit'
import { font, useTheme } from './theme'

/** Friends with a search box; tap to pick (one, or several with checkboxes). */
export function FriendPicker({
  selected,
  onToggle,
  exclude = [],
  multi = true,
  header,
}: {
  selected: string[]
  onToggle: (f: FriendEntry) => void
  exclude?: string[]
  multi?: boolean
  header?: React.ReactNode
}) {
  const { c } = useTheme()
  const friends = useStore((s) => s.friends.friends)
  const presence = useStore((s) => s.presence)
  const [query, setQuery] = useState('')
  const list = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '')
    return friends
      .filter((f) => !exclude.includes(f.id))
      .filter((f) => !q || f.displayName.toLowerCase().includes(q) || f.username.toLowerCase().includes(q))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [friends, exclude, query])
  return (
    <FlatList
      data={list}
      keyExtractor={(f) => f.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: 12, paddingHorizontal: 16, paddingBottom: 8 }}>
          {header}
          <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 24, backgroundColor: c.surface }}>
            <Icon name="search" size={20} color={c.muted} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search friends" placeholderTextColor={c.muted} accessibilityLabel="Search friends" style={[{ flex: 1, height: 44, color: c.ink, fontFamily: font.body, fontSize: 16 }, webNoOutline]} />
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text tone="muted" style={{ textAlign: 'center', padding: 24 }}>
          {friends.length ? 'No friends match.' : 'Add some friends first (Friends tab → Add friend).'}
        </Text>
      }
      renderItem={({ item: f }) => {
        const on = selected.includes(f.id)
        return (
          <Pressable
            accessibilityRole={multi ? 'checkbox' : 'button'}
            accessibilityState={multi ? { checked: on } : undefined}
            accessibilityLabel={f.displayName}
            onPress={() => onToggle(f)}
            android_ripple={{ color: c.line }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 16 }}
          >
            <Avatar user={f} size={44} status={(presence[f.id] ?? f.presence)?.status ?? null} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text size={16} weight="bold" numberOfLines={1}>
                {f.displayName}
              </Text>
              <Text size={13} tone="muted">
                @{f.username}
              </Text>
            </View>
            {multi ? (
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: on ? 0 : 2, borderColor: c.muted, backgroundColor: on ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {on ? <Icon name="check" size={14} color={c.accentInk} strokeWidth={3} /> : null}
              </View>
            ) : null}
          </Pressable>
        )
      }}
    />
  )
}
