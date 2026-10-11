import { Linking, Modal, View } from 'react-native'
import { SUPPORT_EMAIL } from '@glofly/shared'
import * as api from '@/api/glofly'
import { useStore } from '@/state/store'
import { Button, Text } from './kit'
import { useTheme } from './theme'

// "A message from the Glofly team": a warning from Glofly Control, shown until "I understand".

export function TeamNotice() {
  const { c } = useTheme()
  const notice = useStore((s) => s.notices[0])
  if (!notice) return null
  const seen = () => {
    useStore.setState({ notices: useStore.getState().notices.filter((n) => n.id !== notice.id) })
    void api.noticeSeen(notice.id)
  }
  return (
    <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: c.backdrop, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View accessibilityRole="alert" style={{ width: '100%', maxWidth: 380, backgroundColor: c.sheet, borderRadius: 28, padding: 24, gap: 14 }}>
          <Text display size={22}>
            A message from the Glofly team
          </Text>
          <Text size={15} tone="ink2" style={{ lineHeight: 22 }}>
            {notice.body}
          </Text>
          <Text size={13} tone="muted">
            Questions?{' '}
            <Text size={13} weight="bold" tone="accent" accessibilityRole="link" onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
              {SUPPORT_EMAIL}
            </Text>
          </Text>
          <Button label="I understand" onPress={seen} />
        </View>
      </View>
    </Modal>
  )
}
