import { useCallback, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Image } from 'expo-image'
import * as DocumentPicker from 'expo-document-picker'
import { ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_MESSAGE, fileTypeLabel, formatSize, type Attachment } from '@glofly/shared'
import * as api from '@/api/glofly'
import { pickChatPhotos } from '@/lib/photos'
import { chooseFrom, inform } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'

// Photos and files waiting to be sent: they upload as soon as they're picked (with progress) and
// are attached when you press Send. Shown as a tray above the message box.

export type UploadItem = {
  key: string
  uri: string
  name: string
  kind: 'image' | 'file'
  size: number | null
  progress: number
  attachment: Attachment | null
  error: string | null
}

export type Uploads = {
  items: UploadItem[]
  busy: boolean
  add: (files: { uri: string; name: string; kind: 'image' | 'file'; size: number | null }[]) => void
  remove: (key: string) => void
  readyAttachments: () => Attachment[]
  clear: () => void
}

let counter = 0

export function useUploads(conversationId: string): Uploads {
  const [items, setItems] = useState<UploadItem[]>([])
  const ref = useRef(items)
  ref.current = items
  const aborts = useRef(new Map<string, AbortController>())

  const update = (key: string, patch: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  const start = useCallback(
    async (item: UploadItem) => {
      const ctrl = new AbortController()
      aborts.current.set(item.key, ctrl)
      const r = await api.uploadAttachment(conversationId, { uri: item.uri, type: 'application/octet-stream', name: item.name }, undefined, (f) => update(item.key, { progress: f }), ctrl.signal)
      aborts.current.delete(item.key)
      if (ctrl.signal.aborted) return
      if (r.ok) update(item.key, { attachment: r.data, progress: 1 })
      else update(item.key, { error: r.message })
    },
    [conversationId],
  )

  const add: Uploads['add'] = (files) => {
    const room = ATTACHMENTS_PER_MESSAGE - ref.current.length
    if (files.length > room) void inform(`Up to ${ATTACHMENTS_PER_MESSAGE} at a time`, 'Send these first, then add more.')
    const fresh: UploadItem[] = []
    for (const f of files.slice(0, Math.max(0, room))) {
      if (f.size !== null && f.size > ATTACHMENT_MAX_BYTES) {
        void inform(`${f.name} is too big`, `Files can be up to ${formatSize(ATTACHMENT_MAX_BYTES)}.`)
        continue
      }
      fresh.push({ key: `u${counter++}`, uri: f.uri, name: f.name, kind: f.kind, size: f.size, progress: 0, attachment: null, error: null })
    }
    setItems((list) => [...list, ...fresh])
    fresh.forEach((i) => void start(i))
  }

  const remove = (key: string) => {
    const item = ref.current.find((i) => i.key === key)
    aborts.current.get(key)?.abort()
    if (item?.attachment) void api.removeUpload(conversationId, item.attachment.id)
    setItems((list) => list.filter((i) => i.key !== key))
  }

  return useMemo(
    () => ({
      items,
      busy: items.some((i) => !i.attachment && !i.error),
      add,
      remove,
      readyAttachments: () => ref.current.filter((i) => i.attachment).map((i) => i.attachment!),
      clear: () => setItems([]),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  )
}

/** The + button: Photos, Camera or File. */
export async function attachMenu(uploads: Uploads) {
  const pick = await chooseFrom(
    [
      { key: 'photos', label: 'Photos', icon: 'photo' },
      { key: 'camera', label: 'Camera', icon: 'camera' },
      { key: 'file', label: 'File', icon: 'file' },
    ],
    'Send',
  )
  if (pick === 'photos' || pick === 'camera') {
    const left = ATTACHMENTS_PER_MESSAGE - uploads.items.length
    const photos = await pickChatPhotos(pick === 'camera' ? 'camera' : 'library', Math.max(1, left))
    if (photos === 'denied') return void inform('Camera not allowed', 'Allow Glofly to use the camera in Android Settings → Apps → Glofly → Permissions.')
    if (photos) uploads.add(photos.map((p) => ({ uri: p.uri, name: p.name, kind: 'image', size: p.size })))
  } else if (pick === 'file') {
    const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
    if (r.canceled) return
    uploads.add(r.assets.map((a) => ({ uri: a.uri, name: a.name, kind: a.mimeType?.startsWith('image/') ? 'image' : 'file', size: a.size ?? null })))
  }
}

export function UploadTray({ uploads }: { uploads: Uploads }) {
  const { c } = useTheme()
  if (!uploads.items.length) return null
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 4, paddingTop: 4 }} accessibilityLabel="Photos and files to send">
      {uploads.items.map((i) => (
        <View key={i.key} style={{ width: 76, height: 76, borderRadius: 14, overflow: 'hidden', backgroundColor: c.surface, borderWidth: i.error ? 2 : 0, borderColor: c.danger }}>
          {i.kind === 'image' ? (
            <Image source={{ uri: i.uri }} style={{ width: 76, height: 76 }} contentFit="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 6, gap: 2 }}>
              <Icon name="file" size={22} color={c.ink2} />
              <Text size={10} weight="bold" tone="muted" numberOfLines={1}>
                {fileTypeLabel(i.name)}
              </Text>
              <Text size={10} numberOfLines={1}>
                {i.name}
              </Text>
            </View>
          )}
          {!i.attachment && !i.error ? (
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.25)' }}>
              <View style={{ width: `${Math.round(i.progress * 100)}%`, height: 4, backgroundColor: c.accent }} />
            </View>
          ) : null}
          {i.error ? (
            <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 4 }}>
              <Text size={10} weight="bold" style={{ color: '#FFFFFF', textAlign: 'center' }} numberOfLines={3}>
                {i.error}
              </Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${i.name}`}
            onPress={() => uploads.remove(i.key)}
            hitSlop={6}
            style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={13} color="#FFFFFF" strokeWidth={2.8} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  )
}
