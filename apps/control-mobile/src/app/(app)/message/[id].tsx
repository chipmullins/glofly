import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { api } from '@control/api'
import { avatarColor, initials } from '@control/format'
import { Button, Card, Field, Muted, Switch, Text } from '@/ui/kit'
import { Shield } from '@/ui/icons'
import { c } from '@/ui/theme'
import { NotePicker } from '@/ui/NotePicker'
import { useLoad, useQuickNotes } from '@/lib/hooks'
import { haptic } from '@/lib/haptics'
import { toast } from '@/ui/toast'

// Message as Glofly team (MessageUser.dc.html). The person sees it as "Glofly Team · Official",
// with a reply box when "Let them reply" is on; replies come to the Inbox.

const MAX = 1000

export default function MessageUser() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const { data } = useLoad(() => api.account(id), [id])
  const notes = useQuickNotes((s) => s.notes)
  const loadNotes = useQuickNotes((s) => s.load)
  const [body, setBody] = useState('')
  const [allowReply, setAllowReply] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const a = data?.account

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])
  useEffect(() => {
    if (!note && notes.length) setNote(notes.find((n) => /follow|message|team/i.test(n)) ?? notes[0])
  }, [notes, note])

  async function send() {
    setError(null)
    if (!body.trim()) return setError('Write the message.')
    if (note.trim().length < 3) return setError('Pick or write a note for the audit log.')
    setBusy(true)
    const r = await api.messageUser(id, body.trim(), allowReply, note.trim())
    setBusy(false)
    if (!r.ok) {
      haptic.error()
      return setError(r.message)
    }
    haptic.success()
    toast(r.data.message || 'Message sent.')
    router.back()
  }

  const name = a?.displayName || a?.username || ''
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.page }}>
      <View style={{ paddingTop: 12, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={{ minHeight: 44, justifyContent: 'center', width: 64 }}>
          <Text size={15} weight="semi" color={c.primary}>
            Cancel
          </Text>
        </Pressable>
        <Text display weight="semi" size={17} style={{ flex: 1, textAlign: 'center' }} accessibilityRole="header">
          Message as Glofly team
        </Text>
        <View style={{ width: 64 }} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 20, gap: 14, flexGrow: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 14 }}>
          <Text size={14.5} color={c.muted}>
            To
          </Text>
          {a ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingLeft: 4, paddingRight: 10, borderRadius: 999, backgroundColor: c.primarySoft }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: avatarColor(a.id), alignItems: 'center', justifyContent: 'center' }}>
                <Text size={10} weight="semi" color={c.white}>
                  {initials(name)}
                </Text>
              </View>
              <Text size={14.5} weight="semi" color={c.primary}>{`@${a.username}`}</Text>
            </View>
          ) : null}
        </View>

        <Field label="Message" value={body} onChangeText={setBody} multiline maxLength={MAX} hint={`${body.length}/${MAX}`} inputStyle={{ minHeight: 110, borderRadius: 14, lineHeight: 21 }} />

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}>
            <View style={{ flex: 1 }}>
              <Text size={14} weight="semi">
                Let them reply
              </Text>
              <Muted>Replies come to Control's Inbox</Muted>
            </View>
            <Switch label="Let them reply" value={allowReply} onChange={setAllowReply} />
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: c.divider, paddingVertical: 10 }}>
            <NotePicker label="Use a quick note for the log" value={note} onChange={setNote} />
          </View>
        </Card>

        <View accessibilityLabel="What they'll see" style={{ gap: 8 }}>
          <Text size={12} weight="semi" color={c.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.7 }}>
            What they'll see in Glofly
          </Text>
          <View style={{ padding: 14, borderRadius: 18, backgroundColor: c.tabBar, flexDirection: 'row', gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#3d2775', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={20} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text size={13.5} weight="semi" color={c.white}>
                  Glofly Team
                </Text>
                <View style={{ backgroundColor: c.gold, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
                  <Text size={11} weight="bold" color={c.goldInk}>
                    Official
                  </Text>
                </View>
              </View>
              <View style={{ paddingVertical: 9, paddingHorizontal: 12, borderTopLeftRadius: 4, borderRadius: 14, backgroundColor: '#2d1f5c' }}>
                <Text size={13.5} color={c.onViolet} style={{ lineHeight: 20 }}>
                  {body.trim() || 'Your message shows here.'}
                </Text>
              </View>
              {allowReply ? (
                <Text size={12} color={c.onVioletMuted}>
                  They can reply.
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        <View style={{ flex: 1 }} />
        {error ? (
          <Text size={13.5} color={c.dangerText} accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}
        <Button label="Send" busy={busy} disabled={!a || !body.trim()} onPress={() => void send()} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
