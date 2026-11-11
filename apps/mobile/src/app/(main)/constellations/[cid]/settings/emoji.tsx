import { useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Image } from 'expo-image'
import { cleanEmojiName, type ConstellationEmoji } from '@glofly/shared'
import { request, upload } from '@/api/http'
import { cxSay } from '@/state/constellations'
import { pickChatMedia } from '@/lib/photos'
import { chooseFrom, confirm } from '@/ui/dialogs'
import { Spinner, Text } from '@/ui/kit'
import { emojiSource, loadEmojiSets } from '@/chat/customEmoji'
import { askText } from '@/constellations/ask'
import { haptic } from '@/constellations/motion'
import { SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { Chip, ChipRow, N, NightButton } from '@/constellations/ui'

// Communities round 2 (approved board 2c, right): Settings → Emoji & stickers on a phone. Adding
// one is a photo upload; the server cleans it (re-saved as WebP, no hidden details).

type Lists = { emoji: ConstellationEmoji[]; stickers: ConstellationEmoji[]; limits: { emoji: number; stickers: number }; canManage: boolean }

export default function EmojiSettingsScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  const [lists, setLists] = useState<Lists | null>(null)
  const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    void request<Lists>('GET', `/constellations/${cid}/emoji`).then((r) => (r.ok ? setLists(r.data) : cxSay(r.message)))
  }, [cid])
  useEffect(load, [load])

  async function add() {
    const picked = await pickChatMedia('library', 1)
    if (picked === 'denied' || !picked?.length) return
    const photo = picked[0]
    if (photo.video) return cxSay('Pick a picture, not a video.')
    const typed = await askText(tab === 'emoji' ? 'Name it (like night_owl)' : 'Name the sticker', tab === 'emoji' ? 'night_owl' : 'Owl hype')
    if (!typed) return
    const name = tab === 'emoji' ? cleanEmojiName(typed) : typed.trim().slice(0, 30)
    if (!name) return cxSay('Emoji names are 2–32 letters, numbers or _.')
    let cutout = false
    if (tab === 'stickers' && !/gif/i.test(photo.type ?? '')) {
      const pick = await chooseFrom(
        [
          { key: 'keep', label: 'Use the whole picture', icon: 'photo' },
          { key: 'cut', label: 'Cut out the background', icon: 'edit' },
        ],
        'Background',
      )
      if (!pick) return
      cutout = pick === 'cut'
    }
    setBusy(true)
    const q = new URLSearchParams({ kind: tab === 'emoji' ? 'emoji' : 'sticker', name, outside: '1', cutout: cutout ? '1' : '0' })
    const r = await upload<Lists>('POST', `/constellations/${cid}/emoji?${q}`, { uri: photo.uri, type: photo.type || 'image/jpeg' })
    setBusy(false)
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    load()
    void loadEmojiSets()
  }

  async function manage(e: ConstellationEmoji) {
    const pick = await chooseFrom(
      [
        { key: 'rename', label: 'Rename', icon: 'pencil' },
        { key: 'outside', label: e.outside ? 'Only in this constellation' : 'Usable everywhere', icon: 'lock' },
        { key: 'remove', label: 'Remove', icon: 'trash', danger: true },
      ],
      tab === 'emoji' ? `:${e.name}:` : e.name,
    )
    if (!pick) return
    if (pick === 'remove') {
      const ok = await confirm({ title: `Remove ${tab === 'emoji' ? `:${e.name}:` : e.name}?`, message: 'Messages that used it show its name instead.', confirmLabel: 'Remove', danger: true })
      if (!ok) return
      const r = await request('DELETE', `/constellations/${cid}/emoji/${e.id}`)
      if (!r.ok) return cxSay(r.message)
    } else {
      const changes = pick === 'outside' ? { outside: !e.outside } : { name: (await askText('New name', '', e.name)) ?? undefined }
      if (pick === 'rename' && !changes.name) return
      const r = await request('PATCH', `/constellations/${cid}/emoji/${e.id}`, changes)
      if (!r.ok) return cxSay(r.message)
    }
    load()
    void loadEmojiSets()
  }

  if (!lists) {
    return (
      <SettingsScreen title="Emoji & stickers" c={c}>
        <Spinner />
      </SettingsScreen>
    )
  }
  const items = tab === 'emoji' ? lists.emoji : lists.stickers
  const max = tab === 'emoji' ? lists.limits.emoji : lists.limits.stickers
  return (
    <SettingsScreen title="Emoji & stickers" c={c}>
      <ChipRow inset={16}>
        <Chip label={`Emoji ${lists.emoji.length} of ${lists.limits.emoji}`} on={tab === 'emoji'} onPress={() => setTab('emoji')} />
        <Chip label={`Stickers ${lists.stickers.length} of ${lists.limits.stickers}`} on={tab === 'stickers'} onPress={() => setTab('stickers')} />
      </ChipRow>
      {items.length === 0 ? (
        <Text size={14} style={{ color: N.muted }}>
          {tab === 'emoji' ? 'No emoji yet. Members can use them in any chat on Glofly, for free.' : 'No stickers yet.'}
        </Text>
      ) : null}
      <View style={{ gap: 2 }}>
        {items.map((e) => (
          <Pressable
            key={e.id}
            accessibilityRole={lists.canManage ? 'button' : undefined}
            accessibilityLabel={tab === 'emoji' ? `:${e.name}:` : e.name}
            disabled={!lists.canManage}
            onPress={() => void manage(e)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: pressed ? N.card2 : 'transparent' })}
          >
            <Image source={emojiSource(e.id)} style={{ width: tab === 'emoji' ? 36 : 56, height: tab === 'emoji' ? 36 : 56 }} contentFit="contain" />
            <View style={{ flex: 1 }}>
              <Text size={15} weight="bold">
                {tab === 'emoji' ? `:${e.name}:` : e.name}
              </Text>
              <Text size={12} style={{ color: N.muted }}>
                {[e.animated ? 'Animated' : null, e.createdBy ? `by ${e.createdBy.displayName.split(/\s+/)[0]}` : null, e.outside ? null : 'here only'].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      {lists.canManage ? (
        <NightButton label="Add from Photos" icon="photo" height={50} busy={busy} disabled={items.length >= max} onPress={() => void add()} />
      ) : (
        <Text size={12} style={{ color: N.faint }}>
          People with “Manage emoji & stickers” can add more.
        </Text>
      )}
    </SettingsScreen>
  )
}
