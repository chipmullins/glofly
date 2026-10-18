import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { CATEGORIES_MAX, NEBULA_NAME_MAX, NEBULA_TOPIC_MAX, NEBULAS_MAX, cleanNebulaName, type ConstellationDetail, type Nebula, type NebulaKind } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { cxSay, putDetail } from '@/state/constellations'
import { chooseFrom, confirm } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { askText } from '@/constellations/ask'
import { haptic } from '@/constellations/motion'
import { NightModal } from '@/constellations/sheet'
import { ReorderList, runDetail, SettingsScreen, useSettingsDetail, type ReorderItem } from '@/constellations/settingsKit'
import { Glyph, N, NightButton, NightField, Segmented, SpeakerGlyph, StarGlyph, Toggle } from '@/constellations/ui'

// Nebulas & categories (canvas board 7b): hold a nebula's grip and drag it (into another category
// too); tap a nebula or category to rename, move or delete it.

const ROW = 48
const NEW_CATEGORY = '__new_category__'

export default function NebulasScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  const [editing, setEditing] = useState<Nebula | 'new' | null>(null)
  if (!c) return <SettingsScreen title="Nebulas & categories" c={null}>{null}</SettingsScreen>

  const cats = [...c.categories].sort((a, b) => a.position - b.position)
  const ordered = [...c.nebulas].sort((a, b) => a.position - b.position)
  const loose = ordered.filter((n) => !n.categoryId || !cats.some((x) => x.id === n.categoryId))
  const flat: ({ kind: 'cat'; id: string; name: string } | { kind: 'neb'; n: Nebula })[] = [
    ...loose.map((n) => ({ kind: 'neb' as const, n })),
    ...cats.flatMap((cat) => [{ kind: 'cat' as const, id: cat.id, name: cat.name }, ...ordered.filter((n) => n.categoryId === cat.id).map((n) => ({ kind: 'neb' as const, n }))]),
  ]

  /** Saves a new order of the flat list (a nebula belongs to the category heading above it). */
  async function saveOrder(ids: string[]) {
    let category: string | null = null
    const nebulas: { id: string; categoryId: string | null }[] = []
    for (const id of ids) {
      if (id.startsWith('cat:')) category = id.slice(4)
      else nebulas.push({ id, categoryId: category })
    }
    // Shows right away; the server's copy replaces it.
    putDetail({ ...c!, nebulas: c!.nebulas.map((n) => { const i = nebulas.findIndex((x) => x.id === n.id); return { ...n, position: i, categoryId: nebulas[i]?.categoryId ?? null } }) })
    await runDetail(() => cx.layout(c!.id, cats.map((x) => x.id), nebulas))
  }

  async function categoryMenu(id: string, name: string) {
    const i = cats.findIndex((x) => x.id === id)
    const pick = await chooseFrom(
      [
        { key: 'rename', label: 'Rename', icon: 'pencil' },
        ...(i > 0 ? [{ key: 'up', label: 'Move up', icon: 'arrowUp' as const }] : []),
        ...(i < cats.length - 1 ? [{ key: 'down', label: 'Move down', icon: 'arrowDown' as const }] : []),
        { key: 'delete', label: 'Delete category', icon: 'trash', danger: true, detail: name.trim().toLowerCase() === 'general' ? "Its nebulas won't be in a category" : 'Its nebulas move to General' },
      ],
      name,
    )
    if (pick === 'rename') {
      const t = await askText('Rename category', '', name)
      if (t && t !== name) await runDetail(() => cx.renameCategory(c!.id, id, t))
    }
    if (pick === 'up' || pick === 'down') {
      const ids = cats.map((x) => x.id)
      const j = pick === 'up' ? i - 1 : i + 1
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
      await runDetail(() => cx.layout(c!.id, ids, ordered.map((n) => ({ id: n.id, categoryId: n.categoryId }))))
    }
    if (pick === 'delete') {
      const count = ordered.filter((n) => n.categoryId === id).length
      const general = name.trim().toLowerCase() === 'general'
      const message = !count ? 'Nothing else is deleted.' : general ? "Its nebulas won't be in a category. Nothing else is deleted." : `Its ${count === 1 ? 'nebula moves' : `${count} nebulas move`} to General. Nothing else is deleted.`
      const ok = await confirm({ title: `Delete ${name}?`, message, confirmLabel: 'Delete', danger: true })
      if (ok) await runDetail(() => cx.removeCategory(c!.id, id))
    }
  }

  async function addCategory() {
    if (cats.length >= CATEGORIES_MAX) return cxSay(`Up to ${CATEGORIES_MAX} categories.`)
    const t = await askText('New category', 'e.g. Gaming')
    if (t && (await runDetail(() => cx.addCategory(c!.id, t)))) haptic.success()
  }

  const items: ReorderItem[] = flat.map((x) =>
    x.kind === 'cat'
      ? {
          id: `cat:${x.id}`,
          movable: false,
          render: () => (
            <Pressable accessibilityRole="button" accessibilityLabel={`Category ${x.name}. Rename, move or delete`} onPress={() => void categoryMenu(x.id, x.name)} style={{ height: ROW, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginTop: 4 }}>
              <Text size={12} weight="bold" style={{ flex: 1, color: N.muted, letterSpacing: 0.96, textTransform: 'uppercase' }} numberOfLines={1}>
                {x.name}
              </Text>
              <Icon name="pencil" size={15} color={N.faint} />
            </Pressable>
          ),
        }
      : {
          id: x.n.id,
          movable: true,
          render: () => (
            <Pressable accessibilityRole="button" accessibilityLabel={`${x.n.name}${x.n.kind === 'voice' ? ', voice' : ''}${x.n.readOnly ? ', read-only' : ''}. Edit. Hold the grip to move it`} onPress={() => setEditing(x.n)} style={{ height: ROW - 4, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderRadius: 12, backgroundColor: N.card, borderWidth: 1, borderColor: N.line }}>
              <Glyph name="grip" size={16} color={N.dim} />
              {x.n.kind === 'voice' ? <SpeakerGlyph size={15} color={N.faint} /> : <StarGlyph size={15} color={N.faint} />}
              <Text size={15} numberOfLines={1} style={{ flex: 1 }}>
                {x.n.name}
              </Text>
              {x.n.readOnly ? (
                <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: N.card2 }}>
                  <Text size={11} weight="bold" style={{ color: N.muted }}>
                    Read-only
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ),
        },
  )

  return (
    <SettingsScreen title="Nebulas & categories" c={c}>
      <NightButton kind="amberOutline" label="+ Nebula" onPress={() => (c.nebulas.length >= NEBULAS_MAX ? cxSay(`Up to ${NEBULAS_MAX} nebulas.`) : setEditing('new'))} />
      <Text size={12} style={{ color: N.faint }}>
        Hold a nebula and drag it to move it, even into another category.
      </Text>
      <ReorderList key={flat.map((x) => (x.kind === 'cat' ? x.id : `${x.n.id}:${x.n.categoryId}`)).join()} items={items} rowHeight={ROW} gap={4} bounds={[0, flat.length - 1]} onReorder={(ids) => void saveOrder(ids)} />
      {/* 0.7.1: Categories — add, rename and delete them here */}
      <Text size={12} weight="bold" style={{ color: N.muted, letterSpacing: 0.96, textTransform: 'uppercase', marginTop: 14 }}>
        Categories
      </Text>
      <View style={{ borderRadius: 14, backgroundColor: N.card, borderWidth: 1, borderColor: N.line, overflow: 'hidden' }}>
        {cats.length === 0 ? (
          <Text size={14} style={{ color: N.muted, padding: 14 }}>
            No categories yet.
          </Text>
        ) : null}
        {cats.map((cat, i) => {
          const count = ordered.filter((n) => n.categoryId === cat.id).length
          return (
            <Pressable key={cat.id} accessibilityRole="button" accessibilityLabel={`${cat.name}, ${count} nebulas. Rename, move or delete`} onPress={() => void categoryMenu(cat.id, cat.name)} style={({ pressed }) => ({ minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: N.line, backgroundColor: pressed ? N.card2 : 'transparent' })}>
              <Text size={15} numberOfLines={1} style={{ flex: 1 }}>
                {cat.name}
              </Text>
              <Text size={13} style={{ color: N.muted }}>
                {count} {count === 1 ? 'nebula' : 'nebulas'}
              </Text>
              <Icon name="chevronRight" size={16} color={N.faint} />
            </Pressable>
          )
        })}
      </View>
      <NightButton kind="outline" label="+ New category" onPress={() => void addCategory()} />
      {editing ? <NebulaSheet c={c} nebula={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </SettingsScreen>
  )
}

function NebulaSheet({ c, nebula, onClose }: { c: ConstellationDetail; nebula: Nebula | null; onClose: () => void }) {
  const cats = [...c.categories].sort((a, b) => a.position - b.position)
  const [kind, setKind] = useState<NebulaKind>(nebula?.kind ?? 'text')
  const [name, setName] = useState(nebula?.name ?? '')
  const [topic, setTopic] = useState(nebula?.topic ?? '')
  const [readOnly, setReadOnly] = useState(nebula?.readOnly ?? false)
  const [categoryId, setCategoryId] = useState<string | null>(nebula ? nebula.categoryId : (cats[0]?.id ?? null))
  const [busy, setBusy] = useState(false)
  const category = cats.find((x) => x.id === categoryId)

  async function pickCategory() {
    const pick = await chooseFrom(
      [
        { key: '', label: 'Not in a category', checked: !categoryId },
        ...cats.map((x) => ({ key: x.id, label: x.name, checked: x.id === categoryId })),
        // 0.7.1: make one right here
        ...(cats.length < CATEGORIES_MAX ? [{ key: NEW_CATEGORY, label: '+ New category', icon: 'plus' as const }] : []),
      ],
      'Category',
    )
    if (pick === NEW_CATEGORY) {
      const t = await askText('New category', 'e.g. Gaming')
      if (!t) return
      const before = new Set(c.categories.map((x) => x.id))
      const r = await cx.addCategory(c.id, t)
      if (!r.ok) return cxSay(r.message)
      putDetail(r.data.constellation)
      const made = r.data.constellation.categories.find((x) => !before.has(x.id))
      if (made) setCategoryId(made.id)
      return
    }
    if (pick !== null) setCategoryId(pick || null)
  }

  async function save() {
    const clean = cleanNebulaName(name, kind)
    if (!clean) return cxSay(kind === 'text' ? 'Use letters, numbers and dashes (up to 32).' : 'Give it a name (up to 32 characters).')
    setBusy(true)
    const ok = nebula
      ? await runDetail(() => cx.updateNebula(c.id, nebula.id, { name: clean, topic: kind === 'text' ? topic.trim() || null : null, readOnly: kind === 'text' ? readOnly : false, categoryId }))
      : await runDetail(() => cx.addNebula(c.id, { name: clean, kind, categoryId, topic: kind === 'text' ? topic.trim() || null : null, readOnly: kind === 'text' ? readOnly : false }))
    setBusy(false)
    if (ok) {
      haptic.success()
      onClose()
    }
  }

  async function remove() {
    if (!nebula) return
    const ok = await confirm({ title: `Delete ${nebula.kind === 'text' ? '#' : ''}${nebula.name}?`, message: nebula.kind === 'text' ? 'All its messages and files are deleted for everyone. This is saved to the moderation log.' : 'Anyone in it is disconnected.', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    if (await runDetail(() => cx.removeNebula(c.id, nebula.id))) onClose()
  }

  return (
    <NightModal onClose={onClose} fit top={80} accessibilityLabel={nebula ? `Edit ${nebula.name}` : 'New nebula'} footer={<NightButton height={50} label={nebula ? 'Save' : 'Create nebula'} busy={busy} onPress={() => void save()} />}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <Text display size={20}>
          {nebula ? 'Edit nebula' : 'New nebula'}
        </Text>
        {nebula ? null : (
          <View style={{ gap: 6 }}>
            <Text size={12} weight="bold" style={{ color: N.muted }}>
              Type
            </Text>
          <Segmented
            label="Kind of nebula"
            options={[
              { id: 'text', name: 'Text' },
              { id: 'voice', name: 'Voice' },
            ]}
            value={kind}
            onChange={setKind}
          />
          </View>
        )}
        <NightField label="Name" value={name} onChangeText={setName} max={NEBULA_NAME_MAX} autoCapitalize={kind === 'text' ? 'none' : 'sentences'} placeholder={kind === 'text' ? 'movie-night' : 'Campfire'} />
        {kind === 'text' ? (
          <>
            <NightField label="Topic (optional)" value={topic} onChangeText={setTopic} max={NEBULA_TOPIC_MAX} placeholder="What it's for" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text size={15} weight="medium">
                  Read-only
                </Text>
                <Text size={12} style={{ color: N.muted }}>
                  Only people who manage nebulas or delete messages can post
                </Text>
              </View>
              <Toggle value={readOnly} onChange={setReadOnly} label="Read-only" />
            </View>
          </>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`Category: ${category?.name ?? 'none'}. Change`} onPress={() => void pickCategory()} style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: N.edge, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text size={15} style={{ flex: 1 }}>
            Category
          </Text>
          <Text size={14} style={{ color: N.muted }}>
            {category?.name ?? 'None'}
          </Text>
          <Icon name="chevronRight" size={16} color={N.faint} />
        </Pressable>
        {nebula ? (
          <Pressable accessibilityRole="button" onPress={() => void remove()} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="trash" size={18} color={N.redText} />
            <Text size={15} weight="bold" style={{ color: N.redText }}>
              Delete this nebula
            </Text>
          </Pressable>
        ) : null}
      </View>
    </NightModal>
  )
}
