import { Pressable, ScrollView, View } from 'react-native'
import { router, usePathname } from 'expo-router'
import { create } from 'zustand'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { shortcutSections } from '@glofly/shared'
import { ALT, MOD, requestSearchFocus, useKeyCommand } from '@/lib/keys'
import { isWideNow, usePaneTab } from '@/lib/layout'
import { useNight, flyHome } from '@/constellations/transition'
import { BottomSheet, dismissTopOverlay, useOverlayOpen } from './dialogs'
import { Icon } from './icons'
import { Text } from './kit'
import { useTheme } from './theme'

// 0.8.0 keyboard shortcuts that work anywhere in Glofly (iPad, Android tablets, Chromebooks):
// ⌘K finds a chat, friend, constellation or setting (the Chats search, like the desktop's quick
// switcher), ⌘/ shows the shortcut sheet, ⌘N starts a new message, ⌘F searches (inside a chat the
// chat's own search wins), Esc closes Glofly's dialogs and sheets. Screens add their own on top
// (lib/keys.ts useKeyCommand).

const useSheet = create<{ open: boolean }>(() => ({ open: false }))
export const openShortcutSheet = () => useSheet.setState({ open: true })

/** Goes to the Chats search and focuses it (out of Constellations first, if needed). */
function goSearch() {
  const go = () => {
    usePaneTab.getState().set('chats')
    // iPad's two panes: the search is in the left pane; the open chat stays on the right.
    if (!isWideNow()) {
      if (router.canDismiss()) router.dismissAll()
      router.navigate('/chats')
    }
    requestSearchFocus()
  }
  if (useNight.getState().phase === 'night') flyHome(go, { quick: true })
  else go()
}

export function KeyShortcuts() {
  const path = usePathname()
  const overlay = useOverlayOpen()
  const sheet = useSheet((s) => s.open)
  const inCall = path === '/call' || path.startsWith('/live/') || path.startsWith('/incoming/')

  useKeyCommand('quick', goSearch, !inCall, -1)
  useKeyCommand('find', goSearch, !inCall, -1)
  useKeyCommand('shortcuts', () => useSheet.setState((s) => ({ open: !s.open })), true, -1)
  useKeyCommand(
    'newMessage',
    () => {
      const go = () => router.push('/new-chat')
      if (useNight.getState().phase === 'night') flyHome(go, { quick: true })
      else go()
    },
    !inCall && path !== '/new-chat',
    -1,
  )
  // Esc: Glofly's own dialog or sheet on top closes first; otherwise a pushed screen (a settings
  // page, a profile, New chat) goes back.
  useKeyCommand('escape', () => void dismissTopOverlay(), overlay, 10)
  useKeyCommand('escape', () => useSheet.setState({ open: false }), sheet, 11)
  useKeyCommand(
    'escape',
    () => {
      if (router.canGoBack()) router.back()
    },
    // Not out of a chat or nebula (like the desktop: Esc closes things on top of them).
    !inCall && path !== '/chats' && path !== '/' && !path.startsWith('/constellations') && !path.startsWith('/chat/'),
    -1,
  )

  return sheet ? <ShortcutSheet onClose={() => useSheet.setState({ open: false })} /> : null
}

/** The shortcut sheet (⌘/ or Settings → Keyboard shortcuts): the same list as the desktop's. */
export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const sections = shortcutSections('tablet', { mod: MOD, alt: ALT })
  return (
    <BottomSheet onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 6 }}>
        <Text display size={22} style={{ flex: 1 }} accessibilityRole="header">
          Keyboard shortcuts
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={6} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={18} color={c.muted} strokeWidth={2.4} />
        </Pressable>
      </View>
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 16, gap: 18 }}>
        {sections.map((s) => (
          <View key={s.title} style={{ gap: 4 }}>
            <Text size={13} weight="bold" tone="muted" style={{ letterSpacing: 0.6, textTransform: 'uppercase', paddingVertical: 4 }}>
              {s.title}
            </Text>
            {s.lines.map((l) => (
              <View key={l.what} accessible accessibilityLabel={`${l.what}: ${l.keys.map((k) => k.join(' ')).join(' or ')}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 40 }}>
                <Text size={15} style={{ flex: 1 }}>
                  {l.what}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {l.keys.map((combo, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      {i > 0 ? (
                        <Text size={12} tone="muted">
                          or
                        </Text>
                      ) : null}
                      {combo.map((k, j) => (
                        <View key={j} style={{ minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: c.line, borderBottomWidth: 2, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
                          <Text size={13} weight="bold">
                            {k}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ))}
        {MOD === '⌘' ? (
          <Text size={13} tone="muted">
            Hold ⌘ on the keyboard to see these at any time.
          </Text>
        ) : null}
      </ScrollView>
    </BottomSheet>
  )
}
