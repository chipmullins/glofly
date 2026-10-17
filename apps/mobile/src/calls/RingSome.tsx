import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { ConversationSummary } from '@glofly/shared'
import { Avatar } from '@/ui/Avatar'
import { BottomSheet } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Button, Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
import { startCallIn } from './controller'

/**
 * Groups (0.5.2): start a call that rings only some of the group. Everyone starts picked (like a
 * normal call); whoever isn't picked sees the call in the chat and can join, without ringing.
 * Opened by long-pressing a group's call buttons, or "Choose who to ring" in the chat's menu.
 */
export function RingSomeSheet({ chat, onClose }: { chat: ConversationSummary; onClose: () => void }) {
  const { c } = useTheme()
  const people = [...chat.members].sort((a, b) => a.displayName.localeCompare(b.displayName))
  const [picked, setPicked] = useState<string[]>(() => people.map((p) => p.id))
  const all = picked.length === people.length
  const start = (video: boolean) => {
    onClose()
    void startCallIn(chat.id, video, all ? undefined : picked)
  }
  const check = (on: boolean) => (
    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: on ? 0 : 2, borderColor: c.muted, backgroundColor: on ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {on ? <Icon name="check" size={14} color={c.accentInk} strokeWidth={3} /> : null}
    </View>
  )
  return (
    <BottomSheet onClose={onClose}>
      <View style={{ maxHeight: 560 }}>
        <Text display size={20} style={{ paddingHorizontal: 20 }}>
          Who should be rung?
        </Text>
        <Text size={14} tone="muted" style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 }}>
          Only the people you pick are rung. Everyone else in the group can still join.
        </Text>
        <ScrollView style={{ flexGrow: 0 }}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: all }}
            accessibilityLabel="Everyone"
            onPress={() => setPicked(all ? [] : people.map((p) => p.id))}
            android_ripple={{ color: c.line }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 16 }}
          >
            <View style={{ flex: 1 }}>
              <Text size={16} weight="bold">
                Everyone
              </Text>
              <Text size={13} tone="muted">
                {picked.length} of {people.length} picked
              </Text>
            </View>
            {check(all)}
          </Pressable>
          {people.map((p) => {
            const on = picked.includes(p.id)
            return (
              <Pressable
                key={p.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={p.displayName}
                onPress={() => setPicked((list) => (on ? list.filter((x) => x !== p.id) : [...list, p.id]))}
                android_ripple={{ color: c.line }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 16 }}
              >
                <Avatar user={p} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text size={16} weight="bold" numberOfLines={1}>
                    {p.displayName}
                  </Text>
                  <Text size={13} tone="muted">
                    @{p.username}
                  </Text>
                </View>
                {check(on)}
              </Pressable>
            )
          })}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: 10, padding: 16 }}>
          <Button label="Voice call" kind="secondary" icon="phone" disabled={!picked.length} onPress={() => start(false)} style={{ flex: 1 }} />
          <Button label="Video call" icon="video" disabled={!picked.length} onPress={() => start(true)} style={{ flex: 1 }} />
        </View>
      </View>
    </BottomSheet>
  )
}
