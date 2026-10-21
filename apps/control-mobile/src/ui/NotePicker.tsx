import { useState } from 'react'
import { Modal, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Field, Pill, Text } from './kit'
import { c } from './theme'
import { useQuickNotes } from '@/lib/hooks'

/** "Use a quick note for the log   Report follow-up ›": tap to pick a quick note or write one. */
export function NotePicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const insets = useSafeAreaInsets()
  const notes = useQuickNotes((s) => s.notes)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'none'}`}
        onPress={() => {
          setDraft(value)
          setOpen(true)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}
      >
        <Text size={14} weight="semi" style={{ flex: 1 }}>
          {label}
        </Text>
        <Text size={13} weight="semi" color={c.primary} numberOfLines={1} style={{ maxWidth: '50%' }}>
          {value || 'Choose'}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1, backgroundColor: c.scrim }} onPress={() => setOpen(false)} />
        <View style={{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#e2d6c8' }} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 18, gap: 14 }}>
            <Text display weight="bold" size={20} accessibilityRole="header">
              Note for the audit log
            </Text>
            {notes.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {notes.map((n) => (
                  <Pill key={n} label={n} on={draft === n} onPress={() => setDraft(n)} />
                ))}
              </View>
            ) : null}
            <Field label="Or write one" value={draft} onChangeText={setDraft} maxLength={500} />
            <Button
              label="Use this note"
              disabled={draft.trim().length < 3}
              onPress={() => {
                onChange(draft.trim())
                setOpen(false)
              }}
            />
          </ScrollView>
        </View>
      </Modal>
    </>
  )
}
