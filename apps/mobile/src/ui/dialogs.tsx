import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'
import { Icon, type IconName } from './icons'
import { Text } from './kit'
import { useTheme } from './theme'

// Dialogs and bottom sheets drawn in Glofly's style (and the same on the web preview, where
// Android's own alerts don't exist). Call confirm() / chooseFrom() from anywhere.

type ConfirmOptions = {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string | null
  danger?: boolean
}

export type SheetItem = {
  key: string
  label: string
  icon?: IconName
  danger?: boolean
  detail?: string
  checked?: boolean
  /** A round color dot instead of an icon (accent color picker). */
  swatch?: string
}

type Overlay = (
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'sheet'; title?: string; header?: ReactNode; items: SheetItem[]; resolve: (key: string | null) => void }
) & { id: number; closing?: boolean }

const useOverlays = create<{ stack: Overlay[] }>(() => ({ stack: [] }))
let nextId = 1

type NewOverlay = Overlay extends infer O ? (O extends Overlay ? Omit<O, 'id' | 'closing'> : never) : never

function push(o: NewOverlay) {
  useOverlays.setState((s) => ({ stack: [...s.stack, { ...o, id: nextId++ } as Overlay] }))
}

// iPhone: a closed dialog or sheet stays mounted (hidden) until iOS says its slide-away animation
// has really finished (Modal's onDismiss), so afterOverlaysClose() knows exactly when it's gone.
// Other platforms remove it right away.
function pop() {
  lastClosedAt = Date.now()
  if (Platform.OS !== 'ios') return useOverlays.setState((s) => ({ stack: s.stack.slice(0, -1) }))
  useOverlays.setState((s) => {
    const i = s.stack.map((o) => !o.closing).lastIndexOf(true)
    if (i < 0) return s
    const stack = s.stack.slice()
    stack[i] = { ...stack[i], closing: true }
    return { stack }
  })
  // Safety net: if iOS never reports the dismissal, forget the overlay after a second anyway.
  const id = useOverlays.getState().stack.filter((o) => o.closing).at(-1)?.id
  if (id !== undefined) setTimeout(() => dismissed(id), 1200)
}

function dismissed(id: number) {
  const before = useOverlays.getState().stack
  if (!before.some((o) => o.id === id)) return
  useOverlays.setState((s) => ({ stack: s.stack.filter((o) => o.id !== id) }))
  if (!useOverlays.getState().stack.some((o) => o.closing)) {
    lastGoneAt = Date.now()
    waiters.splice(0).forEach((w) => w())
  }
}

// When a dialog or sheet closed / finished disappearing (for afterOverlaysClose).
let lastClosedAt = 0
let lastGoneAt = 0
const waiters: (() => void)[] = []
// A short breath after iOS reports a sheet gone, before presenting its own screen.
const IOS_SETTLE_MS = 120
// Sheets that aren't ours (BottomSheet inside a screen) don't report: wait this long instead.
const IOS_DISMISS_MS = 550

/**
 * Waits until a sheet or dialog that just closed has finished sliding away. iPhone only: iOS can't
 * show its own screens (the photo library, the Files picker) while one of ours is still on its way
 * out; it silently shows nothing. Our dialogs and sheets report the exact moment they're gone
 * (Modal onDismiss); otherwise it waits a fixed time after the last close.
 */
export async function afterOverlaysClose(): Promise<void> {
  if (Platform.OS !== 'ios') return
  if (useOverlays.getState().stack.some((o) => o.closing)) {
    await new Promise<void>((r) => waiters.push(r))
  }
  const sinceGone = Date.now() - lastGoneAt
  const sinceClosed = Date.now() - lastClosedAt
  const wait = Math.max(IOS_SETTLE_MS - sinceGone, lastGoneAt >= lastClosedAt ? 0 : IOS_DISMISS_MS - sinceClosed)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => push({ kind: 'confirm', options, resolve }))
}

/** A message with just an OK button. */
export function inform(title: string, message?: string): Promise<void> {
  return confirm({ title, message, confirmLabel: 'OK', cancelLabel: null }).then(() => undefined)
}

/** A bottom sheet of choices; resolves to the picked key, or null if dismissed. */
export function chooseFrom(items: SheetItem[], title?: string, header?: ReactNode): Promise<string | null> {
  return new Promise((resolve) => push({ kind: 'sheet', items, title, header, resolve }))
}

export function DialogHost() {
  const stack = useOverlays((s) => s.stack)
  const open = stack.filter((o) => !o.closing)
  const top = open[open.length - 1]
  // Closing ones stay mounted, hidden, until iOS reports them gone (see pop()).
  const shown = stack.filter((o) => o.closing || o === top)
  return (
    <>
      {shown.map((o) => {
        const visible = !o.closing
        const onDismiss = () => dismissed(o.id)
        return o.kind === 'confirm' ? (
          <ConfirmDialog key={o.id} o={o} visible={visible} onDismiss={onDismiss} />
        ) : (
          <SheetView key={o.id} o={o} visible={visible} onDismiss={onDismiss} />
        )
      })}
    </>
  )
}

type Shown = { visible: boolean; onDismiss: () => void }

function ConfirmDialog({ o, visible, onDismiss }: { o: Extract<Overlay, { kind: 'confirm' }> } & Shown) {
  const { c } = useTheme()
  const done = (ok: boolean) => {
    if (o.closing) return
    pop()
    o.resolve(ok)
  }
  const { title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger } = o.options
  return (
    <Modal visible={visible} onDismiss={onDismiss} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => done(false)}>
      <Pressable accessibilityLabel="Close" onPress={() => cancelLabel !== null && done(false)} style={{ flex: 1, backgroundColor: c.backdrop, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <Pressable accessibilityRole="alert" style={{ width: '100%', maxWidth: 360, backgroundColor: c.sheet, borderRadius: 28, padding: 24, gap: 14 }}>
          <Text display size={22}>
            {title}
          </Text>
          {message ? (
            <Text size={15} tone="ink2" style={{ lineHeight: 21 }}>
              {message}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            {cancelLabel !== null ? (
              <Pressable accessibilityRole="button" onPress={() => done(false)} style={{ height: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 22 }}>
                <Text weight="bold" size={15} tone="accent">
                  {cancelLabel}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => done(true)}
              style={{ height: 44, paddingHorizontal: 20, justifyContent: 'center', borderRadius: 22, backgroundColor: danger ? c.danger : c.accent }}
            >
              <Text weight="bold" size={15} style={{ color: danger ? '#FFFFFF' : c.accentInk }}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function SheetView({ o, visible, onDismiss }: { o: Extract<Overlay, { kind: 'sheet' }> } & Shown) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const done = (key: string | null) => {
    if (o.closing) return
    pop()
    o.resolve(key)
  }
  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} onClose={() => done(null)}>
      {o.header}
      {o.title ? (
        <Text size={13} weight="bold" tone="muted" style={{ paddingHorizontal: 24, paddingTop: 4, paddingBottom: 8, letterSpacing: 0.6, textTransform: 'uppercase' }}>
          {o.title}
        </Text>
      ) : null}
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}>
        {o.items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            onPress={() => done(item.key)}
            android_ripple={{ color: c.line }}
            style={{ minHeight: 52, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 18 }}
          >
            {item.swatch ? <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: item.swatch }} /> : null}
            {item.icon ? <Icon name={item.icon} size={22} color={item.danger ? c.danger : c.ink2} /> : null}
            <View style={{ flex: 1, paddingVertical: 10 }}>
              <Text size={16} tone={item.danger ? 'danger' : 'ink'} weight={item.danger ? 'medium' : 'regular'}>
                {item.label}
              </Text>
              {item.detail ? (
                <Text size={13} tone="muted">
                  {item.detail}
                </Text>
              ) : null}
            </View>
            {item.checked ? <Icon name="check" size={20} color={c.accentText} strokeWidth={2.6} /> : null}
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheet>
  )
}

/** A sheet that slides up from the bottom with a drag handle (used by menus and forms). */
export function BottomSheet({ onClose, children, visible = true, onDismiss }: { onClose: () => void; children: ReactNode; visible?: boolean; onDismiss?: () => void }) {
  const { c } = useTheme()
  return (
    <Modal visible={visible} onDismiss={onDismiss} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={{ position: 'absolute', inset: 0, backgroundColor: c.backdrop }} />
        <View
          style={{ backgroundColor: c.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10 }}
        >
          <View style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: c.faint, opacity: 0.6, marginBottom: 10 }} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
