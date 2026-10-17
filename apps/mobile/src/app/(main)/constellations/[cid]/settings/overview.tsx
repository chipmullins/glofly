import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import {
  CONSTELLATION_COLORS,
  CONSTELLATION_DESCRIPTION_MAX,
  CONSTELLATION_NAME_MAX,
  CONSTELLATION_TAGS_MAX,
  CONSTELLATION_THEME,
  CONSTELLATION_TYPES,
  cleanTag,
  type ConstellationDetail,
  type ConstellationType,
  type ConstellationVisibility,
} from '@glofly/shared'
import { cx } from '@/api/constellations'
import { cxSay, loadDetail } from '@/state/constellations'
import { pickSquarePhoto } from '@/lib/photos'
import { chooseFrom, inform } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { askText } from '@/constellations/ask'
import { haptic } from '@/constellations/motion'
import { runDetail, SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { Caps, Chip, ConstellationIcon, N, NightField, Segmented } from '@/constellations/ui'

// Overview (canvas board 7b): icon, name, banner color, who can join, kind and tags, description.

const WHO: { id: ConstellationVisibility; name: string; flex?: number }[] = [
  { id: 'invite', name: 'Invite only' },
  { id: 'public', name: 'Public', flex: 0.8 },
  { id: 'approval', name: 'With approval', flex: 1.2 },
]

export default function OverviewScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  if (!c) return <SettingsScreen title="Overview" c={null}>{null}</SettingsScreen>
  return <Overview key={c.id} c={c} />
}

function Overview({ c }: { c: ConstellationDetail }) {
  const [name, setName] = useState(c.name)
  const [description, setDescription] = useState(c.description ?? '')
  const [visibility, setVisibility] = useState<ConstellationVisibility>(c.visibility)
  const [type, setType] = useState<ConstellationType | null>(c.type)
  const [tags, setTags] = useState<string[]>(c.tags)
  const [busy, setBusy] = useState(false)
  const [iconBusy, setIconBusy] = useState(false)
  const dirty = name.trim() !== c.name || (description.trim() || null) !== c.description || visibility !== c.visibility || type !== c.type || tags.join(',') !== c.tags.join(',')

  async function save() {
    if (!name.trim()) return cxSay('Give it a name.')
    if (visibility !== 'invite' && !type) return cxSay('Pick what kind it is, so people can find it.')
    setBusy(true)
    const ok = await runDetail(() => cx.update(c.id, { name: name.trim(), description: description.trim() || null, visibility, type, tags }))
    setBusy(false)
    if (ok) {
      haptic.success()
      cxSay('Saved.')
    }
  }

  async function pickIcon() {
    const choice = c.iconVersion
      ? await chooseFrom(
          [
            { key: 'pick', label: 'Choose a new picture', icon: 'photo' },
            { key: 'camera', label: 'Take a photo', icon: 'camera' },
            { key: 'remove', label: 'Use initials instead', icon: 'trash', danger: true },
          ],
          'Constellation icon',
        )
      : await chooseFrom(
          [
            { key: 'pick', label: 'Choose a picture', icon: 'photo' },
            { key: 'camera', label: 'Take a photo', icon: 'camera' },
          ],
          'Constellation icon',
        )
    if (!choice) return
    setIconBusy(true)
    if (choice === 'remove') {
      const r = await cx.removeIcon(c.id)
      if (!r.ok) cxSay(r.message)
      else void loadDetail(c.id)
      setIconBusy(false)
      return
    }
    const p = await pickSquarePhoto(choice === 'camera' ? 'camera' : 'library')
    if (p === 'denied') {
      setIconBusy(false)
      return void inform("Glofly can't open your photos", 'Allow photo access for Glofly in Settings.')
    }
    if (p) {
      const r = await cx.setIcon(c.id, p)
      if (!r.ok) cxSay(r.message)
      else {
        haptic.success()
        void loadDetail(c.id)
      }
    }
    setIconBusy(false)
  }

  async function pickKind() {
    const pick = await chooseFrom(
      CONSTELLATION_TYPES.map((t) => ({ key: t.id, label: t.name, checked: type === t.id })),
      'What kind is it?',
    )
    if (pick) setType(pick as ConstellationType)
  }

  async function addTag() {
    if (tags.length >= CONSTELLATION_TAGS_MAX) return cxSay(`Up to ${CONSTELLATION_TAGS_MAX} tags.`)
    const typed = await askText('Add a tag', 'e.g. co-op, raids, chill')
    if (!typed) return
    const t = cleanTag(typed)
    if (!t) return cxSay('Tags use letters and numbers, up to 20 characters.')
    if (!tags.includes(t)) setTags([...tags, t])
  }

  return (
    <SettingsScreen
      title="Overview"
      c={c}
      right={
        <Pressable accessibilityRole="button" accessibilityLabel="Save" accessibilityState={{ disabled: !dirty || busy }} disabled={!dirty || busy} onPress={() => void save()} style={{ height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: N.amber, justifyContent: 'center', opacity: !dirty || busy ? 0.45 : 1 }}>
          <Text size={14} weight="bold" style={{ color: N.amberInk }}>
            Save
          </Text>
        </Pressable>
      }
    >
      <View style={{ alignItems: 'center', paddingVertical: 6 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Change icon" onPress={() => void pickIcon()} disabled={iconBusy} style={{ opacity: iconBusy ? 0.5 : 1 }}>
          <ConstellationIcon c={c} size={88} radius={28} />
          <View style={{ position: 'absolute', right: -6, bottom: -6, width: 32, height: 32, borderRadius: 16, backgroundColor: N.amber, borderWidth: 3, borderColor: N.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="camera" size={15} color={N.amberInk} />
          </View>
        </Pressable>
      </View>
      <NightField label="Name" value={name} onChangeText={setName} max={CONSTELLATION_NAME_MAX} returnKeyType="done" />
      <View style={{ gap: 8 }}>
        <Caps>Banner color</Caps>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 10 }}>
          {CONSTELLATION_COLORS.map((color) => {
            const t = CONSTELLATION_THEME[color]
            const on = c.color === color
            return (
              <Pressable
                key={color}
                accessibilityRole="radio"
                accessibilityLabel={t.name}
                accessibilityState={{ checked: on }}
                onPress={() => {
                  haptic.select()
                  void runDetail(() => cx.update(c.id, { color }))
                }}
                style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: t.banner, alignItems: 'center', justifyContent: 'center', boxShadow: on ? `0 0 0 2px ${N.bg}, 0 0 0 4px ${t.glow}` : undefined }}
              >
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.glow, boxShadow: `0 0 8px 2px ${t.glow}` }} />
              </Pressable>
            )
          })}
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Caps>Who can join</Caps>
        <Segmented label="Who can join" options={WHO} value={visibility} onChange={setVisibility} />
      </View>
      {visibility !== 'invite' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={type ? `Kind: ${CONSTELLATION_TYPES.find((t) => t.id === type)?.name}. Change` : 'Pick a kind'} onPress={() => void pickKind()} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: type ? N.edge : N.amber, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text size={13} weight="medium">
              {type ? `Kind: ${CONSTELLATION_TYPES.find((t) => t.id === type)?.name}` : 'Pick a kind'}
            </Text>
            <Icon name="chevronDown" size={12} color={N.ink} />
          </Pressable>
          {tags.map((t) => (
            <Chip key={t} label={`#${t}`} tag onRemove={() => setTags(tags.filter((x) => x !== t))} />
          ))}
          {tags.length < CONSTELLATION_TAGS_MAX ? <Chip label="+ Tag" dashed onPress={() => void addTag()} /> : null}
        </View>
      ) : null}
      <NightField label="Description" value={description} onChangeText={setDescription} multiline max={CONSTELLATION_DESCRIPTION_MAX} count placeholder="What it's about, who it's for" />
    </SettingsScreen>
  )
}

