import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { api } from '@control/api'
import { when } from '@control/format'
import { IconButton, Muted, Screen, Status, Text } from '@/ui/kit'
import { c, font } from '@/ui/theme'
import { NotePicker } from '@/ui/NotePicker'
import { useLoad, useQuickNotes } from '@/lib/hooks'
import { haptic } from '@/lib/haptics'
import { toast } from '@/ui/toast'

// One Inbox thread: team messages on the right (purple), their replies on the left (white).
// Replying sends another team message (they can reply again).
export default function Thread() {
  const { userId } = useLocalSearchParams<{ userId: string }>()
  const insets = useSafeAreaInsets()
  const { data, error, loading, reload } = useLoad(() => api.inboxThread(userId), [userId], { everyMs: 30_000 })
  const notes = useQuickNotes((s) => s.notes)
  const loadNotes = useQuickNotes((s) => s.load)
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const scroll = useRef<ScrollView>(null)

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])
  useEffect(() => {
    if (!note) setNote(notes[0] ?? 'Inbox reply')
  }, [notes, note])

  async function send() {
    if (!text.trim() || busy) return
    setBusy(true)
    const r = await api.messageUser(userId, text.trim(), true, note.trim().length >= 3 ? note.trim() : 'Inbox reply')
    setBusy(false)
    if (!r.ok) {
      haptic.error()
      toast(r.message, 'bad')
      return
    }
    haptic.success()
    setText('')
    reload()
  }

  const u = data?.user
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.page }}>
      <Screen
        back
        title={u ? u.displayName || `@${u.username}` : 'Inbox'}
        scroll={false}
        right={u ? <Muted onPress={() => router.push(`/account/${u.id}`)} accessibilityRole="button" style={{ padding: 10 }}>Account</Muted> : null}
        footer={
          <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card, gap: 4 }}>
            <View style={{ paddingHorizontal: 4 }}>
              <NotePicker label="Note for the log" value={note} onChange={setNote} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Reply as Glofly Team"
                placeholderTextColor="#a8968a"
                accessibilityLabel="Reply as Glofly Team"
                multiline
                maxLength={1000}
                style={{ flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, borderRadius: 22, borderWidth: 1, borderColor: c.fieldBorder, fontFamily: font.body, fontSize: 15, color: c.ink }}
              />
              <IconButton name="send" label="Send reply" bg={c.primary} color={c.white} disabled={!text.trim() || busy} onPress={() => void send()} />
            </View>
          </View>
        }
      >
        <Status loading={loading} error={!data ? error : null} onRetry={reload} />
        <ScrollView ref={scroll} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>
          {data?.items.map((m) => {
            const team = m.from === 'team'
            return (
              <View key={m.id} style={{ alignItems: team ? 'flex-end' : 'flex-start' }}>
                <View
                  style={{
                    maxWidth: '82%',
                    paddingVertical: 9,
                    paddingHorizontal: 12,
                    borderRadius: 16,
                    borderBottomRightRadius: team ? 4 : 16,
                    borderBottomLeftRadius: team ? 16 : 4,
                    backgroundColor: team ? c.primary : c.card,
                    borderWidth: team ? 0 : 1,
                    borderColor: c.border,
                  }}
                >
                  <Text size={14.5} color={team ? c.white : c.ink} style={{ lineHeight: 20 }} selectable>
                    {m.body}
                  </Text>
                </View>
                <Muted size={11.5} style={{ marginTop: 3, marginHorizontal: 4 }}>
                  {when(m.createdAt)}
                  {team ? ` · ${m.seen ? 'Seen' : 'Not seen yet'}${m.allowReply ? '' : ' · no replies'}` : ''}
                </Muted>
              </View>
            )
          })}
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  )
}
