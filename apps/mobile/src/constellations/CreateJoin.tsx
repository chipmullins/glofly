import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Image } from 'expo-image'
import {
  CONSTELLATION_DESCRIPTION_MAX,
  CONSTELLATION_NAME_MAX,
  CONSTELLATION_TAGS_MAX,
  CONSTELLATION_TEMPLATES,
  CONSTELLATION_TYPES,
  JOIN_REQUEST_NOTE_MAX,
  cleanTag,
  inviteCodeFrom,
  type ConstellationTemplate,
  type ConstellationType,
  type ConstellationVisibility,
  type DirectoryEntry,
  CONSTELLATION_THEME,
  ACCENT_THEME,
  ROLE_COLORS,
} from '@glofly/shared'
import { cx } from '@/api/constellations'
import type { Upload } from '@/api/http'
import { pickSquarePhoto } from '@/lib/photos'
import { putDetail, refreshCards } from '@/state/constellations'
import { chooseFrom, inform } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { NightModal } from './sheet'
import { askText } from './ask'
import { haptic } from './motion'
import { BannerStars, Caps, Chip, ConstellationIcon, Face, Glyph, MemberLine, N, NightButton, NightField, Radio, Segmented } from './ui'

// Board 3: Create / Join / Ask to join, as bottom sheets over the night.

const WHO: { id: ConstellationVisibility; name: string; what: string }[] = [
  { id: 'invite', name: 'Invite only', what: 'People join with your invite' },
  { id: 'public', name: 'Public', what: 'Anyone can find it and join' },
  { id: 'approval', name: 'Public, approval needed', what: 'A moderator lets people in' },
]

export function CreateJoinSheet({ initialTab, initialCode, onClose, onDone }: { initialTab: 'create' | 'join'; initialCode?: string; onClose: () => void; onDone: (constellationId: string) => void }) {
  const [tab, setTab] = useState<'create' | 'join'>(initialCode ? 'join' : initialTab)
  // Create
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<ConstellationTemplate>('gaming')
  const [visibility, setVisibility] = useState<ConstellationVisibility>('invite')
  const [type, setType] = useState<ConstellationType | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<Upload | null>(null)
  // Join
  const [link, setLink] = useState(initialCode ?? '')
  const [found, setFound] = useState<{ code: string; preview: DirectoryEntry | null; problem: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const code = inviteCodeFrom(link)
  const current = code && found?.code === code ? found : null
  const preview = current?.preview ?? null
  const previewProblem = code ? (current?.problem ?? null) : link.trim() ? "That doesn't look like a Glofly invite." : null
  useEffect(() => {
    if (!code) return
    let stale = false
    const t = setTimeout(() => {
      void cx.linkPreview(code).then((r) => {
        if (stale) return
        setFound(r.ok ? { code, preview: r.data.constellation, problem: null } : { code, preview: null, problem: r.message })
      })
    }, 250)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [code])

  async function pickIcon() {
    const p = await pickSquarePhoto('library')
    if (p === 'denied') return void inform("Glofly can't open your photos", 'Allow photo access for Glofly in Settings.')
    if (p) setPhoto(p)
  }

  async function pickKind() {
    const pick = await chooseFrom(
      CONSTELLATION_TYPES.map((t) => ({ key: t.id, label: t.name, checked: type === t.id })),
      'What kind is it?',
    )
    if (pick) setType(pick as ConstellationType)
  }

  async function addTag() {
    if (tags.length >= CONSTELLATION_TAGS_MAX) return void inform(`Up to ${CONSTELLATION_TAGS_MAX} tags`)
    const typed = await askText('Add a tag', 'e.g. co-op, raids, chill')
    if (!typed) return
    const t = cleanTag(typed)
    if (!t) return void inform('That won’t work as a tag', 'Tags use letters and numbers, up to 20 characters.')
    if (!tags.includes(t)) setTags([...tags, t])
  }

  async function create() {
    if (!name.trim()) return setError('Give your constellation a name.')
    if (visibility !== 'invite' && !type) return setError('Pick what kind of constellation it is, so people can find it.')
    setBusy(true)
    setError(null)
    const r = await cx.create({
      name: name.trim(),
      template,
      visibility,
      type,
      tags: visibility === 'invite' ? [] : tags,
      description: visibility === 'invite' ? null : description.trim() || null,
    })
    if (!r.ok) {
      setBusy(false)
      return setError(r.message)
    }
    if (photo) {
      const up = await cx.setIcon(r.data.constellation.id, photo)
      if (up.ok) putDetail({ ...r.data.constellation, iconVersion: up.data.iconVersion })
      else putDetail(r.data.constellation)
    } else putDetail(r.data.constellation)
    setBusy(false)
    haptic.success()
    void refreshCards()
    onDone(r.data.constellation.id)
  }

  async function join() {
    if (!code || !preview) return
    if (preview.joined) return onDone(preview.id)
    setBusy(true)
    setError(null)
    const r = await cx.joinLink(code)
    setBusy(false)
    if (!r.ok) return setError(r.message)
    putDetail(r.data.constellation)
    haptic.success()
    void refreshCards()
    onDone(r.data.constellation.id)
  }

  const tabs = (
    <Segmented
      label="Create or join"
      value={tab}
      onChange={(t) => {
        setTab(t)
        setError(null)
      }}
      options={[
        { id: 'create', name: 'Create' },
        { id: 'join', name: 'Join with an invite' },
      ]}
    />
  )

  if (tab === 'join') {
    return (
      <NightModal onClose={onClose} top={240} accessibilityLabel="Join with an invite" footer={
        <View style={{ gap: 8 }}>
          {error ? <Text size={13} style={{ color: N.redText, textAlign: 'center' }}>{error}</Text> : null}
          <NightButton kind="green" height={50} label={preview ? (preview.joined ? `Open ${preview.name}` : `Join ${preview.name}`) : 'Join'} disabled={!preview} busy={busy} onPress={() => void join()} />
        </View>
      }>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 12 }}>
          {tabs}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingLeft: 14, borderRadius: 14, borderWidth: 1, borderColor: N.edge, backgroundColor: N.bg }}>
            <Icon name="link" size={17} color={N.muted} />
            <View style={{ flex: 1 }}>
              <NightField value={link} onChangeText={setLink} placeholder="glofly.app/c/AbC123" autoCapitalize="none" autoCorrect={false} autoFocus={!initialCode} accessibilityLabel="Invite link or code" style={{ borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 }} />
            </View>
          </View>
          {preview ? <PreviewCard entry={preview} /> : previewProblem ? <Text size={14} style={{ color: N.muted, textAlign: 'center' }}>{previewProblem}</Text> : (
            <Text size={14} style={{ color: N.muted, lineHeight: 20 }}>Paste the invite link a friend sent you. Invites from friends also show up on your dashboard.</Text>
          )}
        </ScrollView>
      </NightModal>
    )
  }

  return (
    <NightModal onClose={onClose} top={58} accessibilityLabel="Create a constellation" footer={
      <View style={{ gap: 8 }}>
        {error ? <Text size={13} style={{ color: N.redText, textAlign: 'center' }} accessibilityLiveRegion="polite">{error}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Glyph name="crown" size={14} color={N.amber} />
          <Text size={12} weight="bold" style={{ color: N.amber }}>You'll be the Owner</Text>
        </View>
        <CreateButton template={template} busy={busy} onPress={() => void create()} />
      </View>
    }>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 12 }}>
        {tabs}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={photo ? 'Change the icon' : 'Choose an icon'} onPress={() => void pickIcon()} style={{ width: 72, height: 72, borderRadius: 22, borderWidth: 1.5, borderStyle: photo ? 'solid' : 'dashed', borderColor: N.amber, backgroundColor: N.card2, alignItems: 'center', justifyContent: 'center', gap: 2, overflow: 'hidden' }}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={{ width: '100%', height: '100%' }} />
            ) : (
              <>
                <Icon name="camera" size={22} color={N.amber} />
                <Text size={11} weight="bold" style={{ color: N.amber }}>Icon</Text>
              </>
            )}
          </Pressable>
          <View style={{ flex: 1 }}>
            <NightField label="Name" value={name} onChangeText={setName} max={CONSTELLATION_NAME_MAX} placeholder="Friday Raid Club" returnKeyType="done" />
          </View>
        </View>
        <TemplatePicker value={template} onChange={setTemplate} />
        <View style={{ gap: 8 }}>
          <Caps>Who can join</Caps>
          <View style={{ borderRadius: 16, backgroundColor: N.bg, borderWidth: 1, borderColor: N.line2, overflow: 'hidden' }}>
            {WHO.map((w, i) => (
              <Pressable key={w.id} accessibilityRole="radio" accessibilityState={{ checked: visibility === w.id }} accessibilityLabel={`${w.name}: ${w.what}`} onPress={() => setVisibility(w.id)} style={{ minHeight: 52, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: i < WHO.length - 1 ? 1 : 0, borderBottomColor: N.line }}>
                <View style={{ flex: 1 }}>
                  <Text size={14} weight="bold">{w.name}</Text>
                  <Text size={12} style={{ color: N.muted }}>{w.what}</Text>
                </View>
                <Radio on={visibility === w.id} />
              </Pressable>
            ))}
          </View>
        </View>
        {visibility !== 'invite' ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Pressable accessibilityRole="button" accessibilityLabel={type ? `Kind: ${CONSTELLATION_TYPES.find((t) => t.id === type)?.name}. Change` : 'Pick a kind'} onPress={() => void pickKind()} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: type ? N.edge : N.amber, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text size={13} weight="medium">{type ? `Kind: ${CONSTELLATION_TYPES.find((t) => t.id === type)?.name}` : 'Pick a kind'}</Text>
                <Icon name="chevronDown" size={12} color={N.ink} />
              </Pressable>
              {tags.map((t) => (
                <Chip key={t} label={`#${t}`} tag onRemove={() => setTags(tags.filter((x) => x !== t))} />
              ))}
              {tags.length < CONSTELLATION_TAGS_MAX ? <Chip label="+ Tag" dashed onPress={() => void addTag()} /> : null}
            </View>
            <NightField label="Description (shown in the directory)" value={description} onChangeText={setDescription} multiline max={CONSTELLATION_DESCRIPTION_MAX} placeholder="What it's about, who it's for" />
          </>
        ) : null}
      </ScrollView>
    </NightModal>
  )
}

/** The constellation behind an invite link (or a directory entry). */
export function PreviewCard({ entry }: { entry: DirectoryEntry }) {
  const t = CONSTELLATION_THEME[entry.color] ?? CONSTELLATION_THEME.ember
  const kind = entry.type ? CONSTELLATION_TYPES.find((x) => x.id === entry.type)?.name : undefined
  const friends = entry.friends
  return (
    <View style={{ borderRadius: 20, backgroundColor: N.bg, borderWidth: 1, borderColor: N.edge, overflow: 'hidden', boxShadow: '0 0 0 1px rgba(255,179,71,0.14), 0 0 24px rgba(255,165,74,0.14)' }}>
      <View style={{ height: 70, backgroundColor: t.banner }}>
        <BannerStars id={entry.id} color={entry.color} width={340} />
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 8 }}>
        <ConstellationIcon c={entry} size={56} radius={18} border={N.bg} style={{ marginTop: -28 }} />
        <Text display size={22}>{entry.name}</Text>
        <MemberLine members={entry.memberCount} online={entry.onlineCount} extra={kind} />
        {entry.description ? <Text size={14} style={{ color: N.ink2, lineHeight: 20 }}>{entry.description}</Text> : null}
        {friends.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <View style={{ flexDirection: 'row' }}>
              {friends.slice(0, 3).map((f, i) => (
                <Face key={f.id} user={f} size={26} style={{ marginLeft: i ? -8 : 0, borderWidth: 2, borderColor: N.bg, borderRadius: 13 }} />
              ))}
            </View>
            <Text size={13}>
              {friends.length === 1 ? `${friends[0].displayName.split(/\s+/)[0]} is here` : `${friends[0].displayName.split(/\s+/)[0]} and ${friends.length - 1} ${friends.length - 1 === 1 ? 'friend' : 'friends'} are here`}
            </Text>
          </View>
        ) : null}
        {entry.joined ? <Text size={13} weight="bold" style={{ color: N.greenText }}>You're already in it</Text> : null}
      </View>
    </View>
  )
}

/** Ask to join a constellation that needs approval (a note for the moderators). */
export function AskToJoinSheet({ entry, onClose, onSent }: { entry: DirectoryEntry; onClose: () => void; onSent: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const kind = entry.type ? CONSTELLATION_TYPES.find((x) => x.id === entry.type)?.name : undefined
  async function send() {
    setBusy(true)
    setError(null)
    const r = await cx.join(entry.id, note.trim() || undefined)
    setBusy(false)
    if (!r.ok) return setError(r.message)
    haptic.success()
    void refreshCards()
    onSent()
  }
  return (
    <NightModal onClose={onClose} top={226} accessibilityLabel={`Ask to join ${entry.name}`}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <ConstellationIcon c={entry} size={60} radius={19} />
          <View style={{ flex: 1 }}>
            <Text display size={22}>{entry.name}</Text>
            <Text size={13} style={{ color: N.ink2, marginTop: 2 }}>
              {entry.memberCount} {entry.memberCount === 1 ? 'member' : 'members'}
              {kind ? ` · ${kind}` : ''}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: N.card2 }}>
          <Glyph name="shield" size={18} color={N.amber} />
          <Text size={13} style={{ color: N.ink2, flex: 1, lineHeight: 18 }}>Moderators review requests here. You'll get in as soon as someone lets you in.</Text>
        </View>
        <NightField label="Note to the moderators (optional)" value={note} onChangeText={setNote} multiline count max={JOIN_REQUEST_NOTE_MAX} style={{ borderColor: N.amber }} />
        {error ? <Text size={13} style={{ color: N.redText }}>{error}</Text> : null}
        <NightButton height={50} label="Send request" busy={busy} onPress={() => void send()} />
      </ScrollView>
    </NightModal>
  )
}

/** Join / Ask to join / Requested / Open, by what the entry says. */
export function JoinButton({ entry, onPress, compact }: { entry: DirectoryEntry; onPress: () => void; compact?: boolean }) {
  const label = entry.joined ? 'Open' : entry.visibility === 'approval' ? (entry.requested ? 'Requested · Cancel' : 'Ask to join') : 'Join'
  const kind = entry.joined ? 'quiet' : entry.visibility === 'approval' ? 'amberOutline' : 'green'
  return <NightButton kind={kind} label={label} height={36} style={compact ? { alignSelf: 'center' } : { marginTop: 4 }} onPress={onPress} accessibilityLabel={`${label}, ${entry.name}`} />
}


// 0.8.0 templates (approved Templates board): "Start empty" first (dashed +), a small "Choose a
// premade template" divider, then the three templates; below, what you'll get. The Create button
// takes the template's accent.

const ACCENT_NAMES: Record<ConstellationTemplate, string> = { blank: 'Firefly gold', friends: 'Firefly gold', gaming: 'Violet', study: 'Lagoon' }

function TemplateChoice({ t, on, onPress }: { t: (typeof CONSTELLATION_TEMPLATES)[number]; on: boolean; onPress: () => void }) {
  const a = ACCENT_THEME[t.accent]
  const empty = t.id === 'blank'
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${t.name}: ${t.what}`}
      onPress={onPress}
      style={{ minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderWidth: 2, borderColor: on ? a.color : N.line2, backgroundColor: on ? N.raised : N.card2, flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      {empty ? (
        <View style={{ width: 40, height: 40, borderRadius: 13, borderWidth: 2, borderStyle: 'dashed', borderColor: a.color, alignItems: 'center', justifyContent: 'center' }}>
          <Text size={20} weight="bold" style={{ color: a.color }}>+</Text>
        </View>
      ) : (
        <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: a.color, boxShadow: `0 0 16px rgba(${a.rgb},0.45)` }} />
      )}
      <View style={{ flex: 1 }}>
        <Text size={15} weight="bold">{t.name}</Text>
        <Text size={12} style={{ color: N.muted }}>{t.what}</Text>
      </View>
    </Pressable>
  )
}

function TemplatePicker({ value, onChange }: { value: ConstellationTemplate; onChange: (t: ConstellationTemplate) => void }) {
  const empty = CONSTELLATION_TEMPLATES.find((t) => t.id === 'blank')!
  const cur = CONSTELLATION_TEMPLATES.find((t) => t.id === value) ?? empty
  const a = ACCENT_THEME[cur.accent]
  const pickable = cur.roles.filter((r) => r.selfAssign)
  const caps = (label: string) => (
    <Text size={11} weight="bold" style={{ color: N.faint, letterSpacing: 0.88, textTransform: 'uppercase', marginBottom: 4 }}>{label}</Text>
  )
  return (
    <View style={{ gap: 10 }}>
      <View>
        <Caps>Start a constellation</Caps>
        <Text size={13} style={{ color: N.muted, marginTop: 2 }}>Pick a starting point. You can change every part of it afterwards.</Text>
      </View>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        <TemplateChoice t={empty} on={value === 'blank'} onPress={() => onChange('blank')} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 }}>
          <Text size={11} weight="bold" style={{ color: N.faint, letterSpacing: 0.88, textTransform: 'uppercase' }}>Choose a premade template</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: N.line2 }} />
        </View>
        {CONSTELLATION_TEMPLATES.filter((t) => t.id !== 'blank').map((t) => (
          <TemplateChoice key={t.id} t={t} on={value === t.id} onPress={() => onChange(t.id)} />
        ))}
      </View>
      <View accessibilityLiveRegion="polite" style={{ borderRadius: 18, borderWidth: 1, borderColor: N.line2, backgroundColor: N.bg, padding: 14, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: a.color, boxShadow: `0 0 10px rgba(${a.rgb},0.5)` }} />
          <Text size={16} weight="bold" style={{ flex: 1 }} numberOfLines={1}>What you'll get: {cur.name}</Text>
        </View>
        <Text size={12} style={{ color: N.muted, marginTop: -6 }}>Accent: {ACCENT_NAMES[cur.id]}</Text>
        <View>
          {caps('Nebulas')}
          {cur.categories.map((cat) => (
            <View key={cat.name} style={{ marginTop: 4 }}>
              <Text size={11} weight="bold" style={{ color: N.faint, letterSpacing: 0.66 }}>{cat.name.toUpperCase()}</Text>
              {cat.nebulas.map((n) => (
                <View key={n.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 }}>
                  <Text size={14} style={{ color: N.faint, width: 12, textAlign: 'center' }}>{n.kind === 'text' ? '#' : '◖'}</Text>
                  <Text size={14} style={{ color: '#e9d5c4' }}>{n.name}</Text>
                  {n.roles?.length ? (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, backgroundColor: '#34241c' }}>
                      <Text size={11} style={{ color: '#e3c39f' }}>only {n.roles.join(', ')}</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
        </View>
        <View>
          {caps('Roles members can pick')}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {pickable.length ? (
              pickable.map((r) => (
                <View key={r.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: '#4a372b' }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ROLE_COLORS[r.color].dot }} />
                  <Text size={13} weight="bold">{r.name}</Text>
                </View>
              ))
            ) : (
              <Text size={13} style={{ color: N.muted }}>None, add your own later</Text>
            )}
          </View>
        </View>
        <View>
          {caps('House rules')}
          {cur.rules.length ? (
            cur.rules.map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8, paddingVertical: 2 }}>
                <Text size={14} weight="bold" style={{ color: a.color }}>{i + 1}.</Text>
                <Text size={14} style={{ color: '#e9d5c4', flex: 1, lineHeight: 20 }}>{r}</Text>
              </View>
            ))
          ) : (
            <Text size={13} style={{ color: N.muted }}>None yet</Text>
          )}
        </View>
        <View>
          {caps('Welcome new members see')}
          <View style={{ borderRadius: 14, borderWidth: 1, borderColor: '#3a2a22', backgroundColor: N.card, padding: 12 }}>
            <Text size={14} style={{ lineHeight: 20 }}>{cur.welcome ?? 'Welcome! (You write this yourself in Settings → Welcome.)'}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

/** "Create Gaming squad", in the template's accent. */
function CreateButton({ template, busy, onPress }: { template: ConstellationTemplate; busy: boolean; onPress: () => void }) {
  const t = CONSTELLATION_TEMPLATES.find((x) => x.id === template) ?? CONSTELLATION_TEMPLATES[0]
  const a = ACCENT_THEME[t.accent]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Create ${t.name}`}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({ height: 50, borderRadius: 25, backgroundColor: a.color, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : pressed ? 0.85 : 1, boxShadow: `0 0 18px rgba(${a.rgb},0.45)` })}
    >
      <Text size={16} weight="bold" style={{ color: a.on }}>{busy ? 'Creating…' : `Create ${t.name}`}</Text>
    </Pressable>
  )
}
