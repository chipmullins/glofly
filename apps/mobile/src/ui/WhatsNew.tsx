import { useEffect } from 'react'
import { Modal, ScrollView, View } from 'react-native'
import { useSession } from '@/state/session'
import { useWelcome } from '@/lib/welcome'
import { checkWhatsNew, markWhatsNewSeen, useWhatsNew } from '@/lib/whatsNew'
import { Button, Text } from './kit'
import { useTheme } from './theme'

// 0.11.3 (Chip: a "what's new" pop-up on the first launch after an update). lib/whatsNew.ts
// decides when; the notes are in shared whatsNew.ts.

export function WhatsNewHost() {
  const { c } = useTheme()
  const user = useSession((s) => s.user)
  const welcoming = useWelcome((s) => s.userId)
  const notes = useWhatsNew((s) => s.notes)
  useEffect(() => {
    if (user) void checkWhatsNew(welcoming === user.id)
  }, [user?.id, welcoming])
  if (!user || welcoming === user.id || !notes.length) return null
  const top = notes[0]
  return (
    <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={() => void markWhatsNewSeen()}>
      <View style={{ flex: 1, backgroundColor: c.backdrop, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 420, maxHeight: '86%', backgroundColor: c.sheet, borderRadius: 28, overflow: 'hidden' }}>
          <View style={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12, gap: 4, backgroundColor: c.accentSoft }}>
            <Text size={12} weight="bold" tone="accent" style={{ letterSpacing: 0.8, textTransform: 'uppercase' }}>
              What’s new in Glofly {top.version}
            </Text>
            <Text display size={22} accessibilityRole="header">
              {top.headline}
            </Text>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 12, gap: 14 }}>
            {notes.map((n, ni) => (
              <View key={n.version} style={{ gap: 14 }}>
                {ni > 0 ? (
                  <Text size={13} tone="muted" weight="bold" style={{ marginTop: 6 }}>
                    Also in {n.version}: {n.headline}
                  </Text>
                ) : null}
                {n.items.map((i) => (
                  <View key={i.title} style={{ gap: 3, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: c.accent }}>
                    <Text weight="bold">{i.title}</Text>
                    <Text size={14} tone="muted" style={{ lineHeight: 20 }}>
                      {i.text}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
          <View style={{ padding: 20, paddingTop: 8 }}>
            <Button label="Got it" onPress={() => void markWhatsNewSeen()} />
          </View>
        </View>
      </View>
    </Modal>
  )
}
