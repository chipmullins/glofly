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

type Overlay =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'sheet'; title?: string; header?: ReactNode; items: SheetItem[]; resolve: (key: string | null) => void }

const useOverlays = create<{ stack: Overlay[] }>(() => ({ stack: [] }))

function push(o: Overlay) {
  useOverlays.setState((s) => ({ stack: [...s.stack, o] }))
}
function pop() {
  lastClosedAt = Date.now()
  useOverlays.setState((s) => ({ stack: s.stack.slice(0, -1) }))
}

// When a dialog or sheet closed (for afterOverlaysClose).
let lastClosedAt = 0
const IOS_DISMISS_MS = 450

/**
 * Waits until a sheet or dialog that just closed has finished sliding away. iPhone only: iOS can't
 * show its own screens (the photo library, the Files picker) while one of ours is still on its way
 * out; it silently shows nothing. That's why "Choose a photo" did nothing on iPhone while "Take a
 * photo" worked (the camera asks for permission first, which gave the sheet time to close).
 */
export async function afterOverlaysClose(): Promise<void> {
  if (Platform.OS !== 'ios') return
  const wait = IOS_DISMISS_MS - (Date.now() - lastClosedAt)
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
  const top = stack[stack.length - 1]
  if (!top) return null
  return top.kind === 'confirm' ? <ConfirmDialog o={top} /> : <SheetView o={top} />
}

function ConfirmDialog({ o }: { o: Extract<Overlay, { kind: 'confirm' }> }) {
  const { c } = useTheme()
  const done = (ok: boolean) => {
    pop()
    o.resolve(ok)
  }
  const { title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger } = o.options
  return (
    <Modal transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => done(false)}>
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

function SheetView({ o }: { o: Extract<Overlay, { kind: 'sheet' }> }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const done = (key: string | null) => {
    pop()
    o.resolve(key)
  }
  return (
    <BottomSheet onClose={() => done(null)}>
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
export function BottomSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { c } = useTheme()
  return (
    <Modal transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
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
