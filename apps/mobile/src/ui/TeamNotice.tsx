import { useState } from 'react'
import { KeyboardAvoidingView, Linking, Modal, Platform, View } from 'react-native'
import { SUPPORT_EMAIL, TEAM_REPLY_MAX } from '@glofly/shared'
import * as api from '@/api/glofly'
import { useStore } from '@/state/store'
import { Button, Field, Notice, Text } from './kit'
import { useTheme } from './theme'

// "A message from the Glofly team": a warning from Glofly Control, shown until "I understand".
// 0.9.0: a message sent with Control's "Message as Glofly team" shows as from the Glofly Team
// (Official), with a reply box when replies are allowed (the reply goes to the team's Inbox).

export function TeamNotice() {
  const { c } = useTheme()
  const notice = useStore((s) => s.notices[0])
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!notice) return null
  const isMessage = notice.kind === 'message'
  const canReply = isMessage && notice.allowReply === true
  const done = () => {
    setReply('')
    setFailed(false)
    useStore.setState({ notices: useStore.getState().notices.filter((n) => n.id !== notice.id) })
  }
  const seen = () => {
    done()
    void api.noticeSeen(notice.id)
  }
  const send = async () => {
    if (!reply.trim() || sending) return
    setSending(true)
    setFailed(false)
    const result = await api.noticeReply(notice.id, reply.trim())
    setSending(false)
    if (result.ok) done()
    else setFailed(true)
  }
  return (
    <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: c.backdrop, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View accessibilityRole="alert" style={{ width: '100%', maxWidth: 380, backgroundColor: c.sheet, borderRadius: 28, padding: 24, gap: 14 }}>
            {isMessage ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text display size={22}>
                  Glofly Team
                </Text>
                <View style={{ backgroundColor: '#ffc24a', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                  <Text size={11} weight="bold" style={{ color: '#24174a' }}>
                    Official
                  </Text>
                </View>
              </View>
            ) : (
              <Text display size={22}>
                A message from the Glofly team
              </Text>
            )}
            <View style={isMessage ? { backgroundColor: c.field, borderRadius: 16, borderTopLeftRadius: 4, paddingHorizontal: 14, paddingVertical: 10 } : undefined}>
              <Text size={15} tone="ink2" style={{ lineHeight: 22 }}>
                {notice.body}
              </Text>
            </View>
            {canReply ? (
              <Field
                label="Reply to the Glofly team"
                value={reply}
                onChangeText={setReply}
                placeholder="Write a reply (optional)"
                multiline
                maxLength={TEAM_REPLY_MAX}
                editable={!sending}
                style={{ minHeight: 70, paddingTop: 12, textAlignVertical: 'top' }}
              />
            ) : (
              <Text size={13} tone="muted">
                Questions?{' '}
                <Text size={13} weight="bold" tone="accent" accessibilityRole="link" onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
                  {SUPPORT_EMAIL}
                </Text>
              </Text>
            )}
            {failed ? <Notice>That didn't send. Check your connection and try again.</Notice> : null}
            {canReply && reply.trim() ? (
              <View style={{ gap: 10 }}>
                <Button label="Send reply" onPress={() => void send()} busy={sending} />
                <Button label="Close" kind="ghost" onPress={seen} disabled={sending} />
              </View>
            ) : (
              <Button label={isMessage ? 'Got it' : 'I understand'} onPress={seen} />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
