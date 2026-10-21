import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'
import type { Result } from '@control/api'
import { Button, Field, Muted, Pill, Switch, Text } from './kit'
import { c } from './theme'
import { confirmWithFaceId } from '@/lib/faceid'
import { haptic } from '@/lib/haptics'
import { useQuickNotes } from '@/lib/hooks'
import { toast } from './toast'

// The action sheet from Emergency.dc.html: a title, what will happen, any fields the action needs,
// Quick notes chips + the note for the audit log, and a red/purple button. Dangerous actions ask
// for Face ID right before they're sent ("Restart with Face ID").

export type SheetField =
  | { kind: 'text'; key: string; label: string; placeholder?: string; initial?: string; multiline?: boolean; maxLength?: number; autoCapitalize?: 'none' | 'sentences'; keyboard?: 'default' | 'email-address' }
  | { kind: 'switch'; key: string; label: string; sub?: string; initial?: boolean }
  | { kind: 'choice'; key: string; label: string; options: { value: string; label: string }[]; initial?: string }

export type Values = Record<string, string | boolean>

export type SheetRequest = {
  title: string
  explanation?: string
  /** "Restart" → the button says "Restart with Face ID" when faceId is on. */
  action: string
  danger?: boolean
  faceId?: boolean
  fields?: SheetField[]
  /** Return an error message to stop. */
  validate?: (v: Values) => string | null
  /** The audit note box (on by default; off for things that don't need one). */
  note?: boolean
  run: (note: string, v: Values) => Promise<Result<{ message?: string } | unknown>>
  /** Shown as a toast when it worked (the server's message wins when there is one). */
  done?: string
  onDone?: (data: unknown) => void
}

const useSheet = create<{ req: SheetRequest | null; open: (r: SheetRequest) => void; close: () => void }>((set) => ({
  req: null,
  open: (req) => set({ req }),
  close: () => set({ req: null }),
}))

export const openSheet = (r: SheetRequest) => useSheet.getState().open(r)

export function SheetHost() {
  const { req, close } = useSheet()
  return (
    <Modal visible={!!req} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      {req ? <SheetBody key={req.title + req.action} req={req} close={close} /> : null}
    </Modal>
  )
}

function SheetBody({ req, close }: { req: SheetRequest; close: () => void }) {
  const insets = useSafeAreaInsets()
  const notes = useQuickNotes((s) => s.notes)
  const loadNotes = useQuickNotes((s) => s.load)
  const [note, setNote] = useState('')
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(
      (req.fields ?? []).map((f) => [f.key, f.kind === 'switch' ? (f.initial ?? false) : f.kind === 'choice' ? (f.initial ?? f.options[0]?.value ?? '') : (f.initial ?? '')]),
    ),
  )
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const wantsNote = req.note !== false

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  async function submit() {
    setError(null)
    setFieldErrors({})
    const problem = req.validate?.(values) ?? null
    if (problem) return setError(problem)
    if (wantsNote && note.trim().length < 3) return setError('Write a short note for the audit log (3 characters or more).')
    if (req.faceId) {
      haptic.danger()
      const yes = await confirmWithFaceId()
      if (!yes) return setError('Face ID didn\'t confirm it. Nothing was changed.')
    }
    setBusy(true)
    const r = await req.run(note.trim(), values)
    setBusy(false)
    if (!r.ok) {
      haptic.error()
      setError(r.message)
      if (r.fields) setFieldErrors(r.fields)
      return
    }
    haptic.success()
    const msg = (r.data as { message?: string } | null)?.message
    close()
    toast(msg || req.done || 'Done.')
    req.onDone?.(r.data)
  }

  const set = (k: string, v: string | boolean) => setValues((s) => ({ ...s, [k]: v }))

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={busy ? undefined : close} style={{ flex: 1, backgroundColor: c.scrim }} />
      <View
        accessibilityViewIsModal
        style={{
          maxHeight: '88%',
          backgroundColor: c.card,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingTop: 10,
          shadowColor: '#150d2e',
          shadowOpacity: 0.25,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: -8 },
        }}
      >
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#e2d6c8' }} />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: insets.bottom + 18, gap: 14 }}>
          <View>
            <Text display weight="bold" size={21} accessibilityRole="header">
              {req.title}
            </Text>
            {req.explanation ? (
              <Text size={13.5} color={c.muted} style={{ marginTop: 4, lineHeight: 20 }}>
                {req.explanation}
              </Text>
            ) : null}
          </View>

          {(req.fields ?? []).map((f) =>
            f.kind === 'text' ? (
              <Field
                key={f.key}
                label={f.label}
                placeholder={f.placeholder}
                value={String(values[f.key] ?? '')}
                onChangeText={(t) => set(f.key, t)}
                multiline={f.multiline}
                maxLength={f.maxLength}
                autoCapitalize={f.autoCapitalize ?? 'sentences'}
                autoCorrect={f.autoCapitalize !== 'none'}
                keyboardType={f.keyboard ?? 'default'}
                error={fieldErrors[f.key]}
                hint={f.maxLength && f.multiline ? `${String(values[f.key] ?? '').length}/${f.maxLength}` : undefined}
              />
            ) : f.kind === 'switch' ? (
              <View key={f.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
                <View style={{ flex: 1 }}>
                  <Text size={14} weight="semi">
                    {f.label}
                  </Text>
                  {f.sub ? <Muted>{f.sub}</Muted> : null}
                </View>
                <Switch label={f.label} value={!!values[f.key]} onChange={(v) => set(f.key, v)} />
              </View>
            ) : (
              <View key={f.key} style={{ gap: 8 }}>
                <Text size={13} weight="semi" color={c.muted}>
                  {f.label}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {f.options.map((o) => (
                    <Pill key={o.value} label={o.label} on={values[f.key] === o.value} onPress={() => set(f.key, o.value)} />
                  ))}
                </View>
              </View>
            ),
          )}

          {wantsNote ? (
            <View style={{ gap: 8 }}>
              {notes.length ? (
                <>
                  <Text size={13} weight="semi" color={c.muted}>
                    Quick notes
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {notes.map((n) => (
                      <Pill key={n} label={n} on={note === n} onPress={() => setNote(note === n ? '' : n)} />
                    ))}
                  </View>
                </>
              ) : null}
              <Field label="Note for the audit log" value={note} onChangeText={setNote} maxLength={500} placeholder="Why you're doing this" error={fieldErrors.note} />
            </View>
          ) : null}

          {error ? (
            <Text size={13.5} color={c.dangerText} accessibilityLiveRegion="assertive">
              {error}
            </Text>
          ) : null}

          <Button
            label={req.faceId ? `${req.action} with Face ID` : req.action}
            icon={req.faceId ? 'faceId' : undefined}
            kind={req.danger ? 'danger' : 'primary'}
            busy={busy}
            onPress={() => void submit()}
          />
          <Button label="Cancel" kind="ghost" height={44} onPress={close} disabled={busy} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  )
}
