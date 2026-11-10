import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Image } from 'expo-image'
import { clockTime, isFullCharacter, parseDice, type Handout, type PendingDamage, type RollVisibility, type TableState } from '@glofly/shared'
import { BottomSheet } from '@/ui/dialogs'
import { Text, Switch, webNoOutline } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { inform } from '@/ui/dialogs'
import { campfireApi, fileSource } from './api'
import { rollAtTable } from './actions'
import { setMusicPrefs, useMusicPrefs } from './music'
import { Bar, DieFace, FireButton, rollerName } from './ui'
import { barFraction, hpColor, initialOf, tokenColors, tokenName, useFire } from './lib'

// The panels behind the map's buttons: turn order, rolls (+ the roll box), handouts, music.
// Each is a bottom sheet (on an iPad it stays a comfortable width, centered).

export type PanelName = 'order' | 'rolls' | 'handouts' | 'music'

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const fire = useFire()
  return (
    <BottomSheet onClose={onClose}>
      <View style={{ paddingHorizontal: 18, paddingBottom: 26, gap: 12, maxHeight: 620 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text accessibilityRole="header" style={{ flex: 1, fontFamily: 'Outfit_700Bold', fontSize: 20, color: fire.ink }}>
            {title}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={22} color={fire.muted} />
          </Pressable>
        </View>
        {children}
      </View>
    </BottomSheet>
  )
}

function ToggleRow({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const fire = useFire()
  return (
    <Pressable onPress={() => onChange(!value)} accessible={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
      <Text size={14} style={{ flex: 1, color: fire.ink }}>
        {label}
      </Text>
      <Switch value={value} onChange={onChange} label={label} />
    </Pressable>
  )
}

export function TurnOrderPanel({ table, meId, onClose }: { table: TableState; meId: string; onClose: () => void }) {
  const fire = useFire()
  const combat = table.combat
  return (
    <Panel title={combat ? `Turn order · Round ${combat.round}` : 'Turn order'} onClose={onClose}>
      {!combat ? (
        <Text size={14} style={{ color: fire.muted }}>
          No fight going on. The game master starts the turn order.
        </Text>
      ) : (
        <ScrollView contentContainerStyle={{ gap: 2 }}>
          {combat.entries.map((e) => {
            const t = table.tokens.find((x) => x.id === e.tokenId)
            const active = combat.current === e.tokenId
            const colors = t ? tokenColors(t, table.characters, !!t.characterId && table.characters.some((c) => c.id === t.characterId && c.ownerId === meId)) : { ring: fire.red, fill: '#5C1F1A', party: false }
            const ch = t?.characterId ? table.characters.find((c) => c.id === t.characterId) : undefined
            const mine = !!ch && ch.ownerId === meId
            const bar = t?.bars[0] ?? null
            const frac = barFraction(bar)
            const state = bar?.state ?? (frac === null ? null : frac === 0 ? 'defeated' : frac <= 0.5 ? 'bloodied' : 'healthy')
            const name = ch?.name ?? (t ? tokenName(t) : e.name || 'Someone')
            return (
              <View
                key={e.tokenId}
                accessible
                accessibilityLabel={`${e.init ?? 'No'} initiative, ${name}${mine ? ' (you)' : ''}${active ? ', their turn' : ''}${state && !colors.party ? `, ${state}` : ''}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, minHeight: 48, backgroundColor: active ? fire.amberSoft : 'transparent', borderWidth: 1, borderColor: active ? 'rgba(255,179,71,0.5)' : 'transparent' }}
              >
                <Text style={{ width: 28, textAlign: 'right', fontFamily: 'Outfit_700Bold', fontSize: 15, color: active ? fire.amber : fire.muted }}>{e.init ?? '–'}</Text>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.fill, borderWidth: 2, borderColor: colors.party ? 'rgba(255,255,255,0.25)' : colors.ring, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {ch?.portraitFileId ? <Image source={fileSource(ch.portraitFileId)} style={{ width: '100%', height: '100%' }} /> : <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 12, color: '#fff' }}>{initialOf(name)}</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                  <Text size={14} weight="bold" numberOfLines={1} style={{ color: fire.ink }}>
                    {name}
                    {mine ? ' (you)' : ''}
                  </Text>
                  {colors.party && ch ? (
                    <Bar fraction={ch.summary.hp.max ? ch.summary.hp.current / ch.summary.hp.max : 0} color={hpColor(fire, ch.summary.hp.current, ch.summary.hp.max)} height={5} />
                  ) : null}
                </View>
                {!colors.party && state ? (
                  <Text size={12} style={{ color: state === 'defeated' ? fire.redText : state === 'bloodied' ? '#FFB08A' : fire.muted }}>
                    {state === 'defeated' ? 'Defeated' : state === 'bloodied' ? 'Bloodied' : 'Healthy'}
                  </Text>
                ) : null}
              </View>
            )
          })}
          <Text size={12} style={{ color: fire.muted, marginTop: 8 }}>
            Monsters&apos; health stays hidden unless the game master shows it.
          </Text>
        </ScrollView>
      )}
    </Panel>
  )
}

export function RollsPanel({ campaignId, table, meId, onClose }: { campaignId: string; table: TableState; meId: string; onClose: () => void }) {
  const fire = useFire()
  const [text, setText] = useState('')
  const [secret, setSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const mine = table.characters.find((c) => c.ownerId === meId && isFullCharacter(c))
  const gmOnly = table.campaign.settings.diceVisibility === 'gm' && table.myRole !== 'gm'
  const send = async () => {
    const expr = text.trim().replace(/^\/(roll|r)\s+/i, '')
    if (!expr) return
    const p = parseDice(expr)
    if (!p.ok) return void inform("That roll didn't work", p.error)
    setBusy(true)
    const vis: RollVisibility = secret ? 'gm' : 'all'
    const ok = await rollAtTable(campaignId, expr, { characterId: mine?.id ?? null, visibility: vis })
    setBusy(false)
    if (ok) setText('')
  }
  return (
    <Panel title="Rolls" onClose={onClose}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line }}>
          <Icon name="dice" size={18} color={fire.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="/roll 2d6+3"
            placeholderTextColor={fire.muted}
            accessibilityLabel="Roll dice"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={() => void send()}
            style={[{ flex: 1, color: fire.ink, fontSize: 15, fontFamily: 'DMSans_400Regular', height: 46 }, webNoOutline]}
          />
        </View>
        <FireButton label="Roll" kind="primary" busy={busy} onPress={() => void send()} style={{ width: 80 }} />
      </View>
      {gmOnly ? (
        <Text size={12} style={{ color: fire.muted }}>
          At this table your rolls only go to the game master.
        </Text>
      ) : (
        <ToggleRow value={secret} onChange={setSecret} label="Only the game master sees it" />
      )}
      <ScrollView contentContainerStyle={{ gap: 8 }} style={{ maxHeight: 420 }}>
        {table.rolls.length === 0 ? (
          <Text size={14} style={{ color: fire.muted }}>
            Rolls show here for everyone at the table.
          </Text>
        ) : (
          table.rolls.map((r) => (
            <View key={r.id} accessible accessibilityLabel={`${rollerName(table, r, meId)} rolled ${r.label ?? r.expression}: ${r.total}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, backgroundColor: fire.card, borderWidth: 1, borderColor: r.result.crit ? 'rgba(255,208,138,0.6)' : fire.line }}>
              <DieFace value={r.total} size={40} dim={r.visibility !== 'all'} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text size={14} weight="bold" numberOfLines={1} style={{ color: fire.ink }}>
                  {rollerName(table, r, meId)} · {r.label ?? r.expression}
                </Text>
                <Text size={12} numberOfLines={2} style={{ color: fire.muted, fontFamily: 'monospace' }}>
                  {r.result.breakdown}
                </Text>
              </View>
              <Text size={11} style={{ color: fire.muted }}>
                {r.visibility === 'gm' ? 'GM only · ' : r.visibility === 'whisper' ? 'Whisper · ' : ''}
                {clockTime(r.createdAt)}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </Panel>
  )
}

export function HandoutsPanel({ campaignId, table, onClose }: { campaignId: string; table: TableState; onClose: () => void }) {
  const fire = useFire()
  const [open, setOpen] = useState<Handout | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const show = async (id: string) => {
    setLoading(id)
    const r = await campfireApi.handout(campaignId, id)
    setLoading(null)
    if (r.ok) setOpen(r.data)
    else void inform("Couldn't open it", r.message)
  }
  // A handout that was taken away while open closes.
  useEffect(() => {
    if (open && !table.handouts.some((h) => h.id === open.id)) setOpen(null)
  }, [open, table.handouts])
  if (open) {
    return (
      <Panel title={open.title} onClose={onClose}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to handouts" onPress={() => setOpen(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 44 }}>
          <Icon name="chevronLeft" size={18} color={fire.amber} />
          <Text size={14} weight="bold" style={{ color: fire.amber }}>
            Handouts
          </Text>
        </Pressable>
        <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: 12 }}>
          {open.imageFileId ? <Image source={fileSource(open.imageFileId)} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: fire.card }} contentFit="contain" accessibilityLabel={`Picture: ${open.title}`} /> : null}
          {open.body ? (
            <Text size={15} style={{ color: fire.ink, lineHeight: 22 }} selectable>
              {open.body}
            </Text>
          ) : null}
        </ScrollView>
      </Panel>
    )
  }
  return (
    <Panel title="Handouts" onClose={onClose}>
      {table.handouts.length === 0 ? (
        <Text size={14} style={{ color: fire.muted }}>
          Nothing shared with you yet. Letters, maps and notes from the game master show here.
        </Text>
      ) : (
        <ScrollView contentContainerStyle={{ gap: 8 }} style={{ maxHeight: 480 }}>
          {table.handouts.map((h) => (
            <Pressable key={h.id} accessibilityRole="button" accessibilityLabel={`Open ${h.title}`} onPress={() => void show(h.id)} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line }}>
              {h.imageFileId ? <Image source={fileSource(h.imageFileId)} style={{ width: 40, height: 40, borderRadius: 8 }} contentFit="cover" /> : <Icon name="scroll" size={22} color={fire.amber} />}
              <Text size={15} weight="bold" numberOfLines={1} style={{ flex: 1, color: fire.ink }}>
                {h.title}
              </Text>
              {loading === h.id ? <ActivityIndicator color={fire.muted} /> : <Icon name="chevronRight" size={18} color={fire.muted} />}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Panel>
  )
}

const STEPS = [0, 0.25, 0.5, 0.75, 1]
export function MusicPanel({ music, onClose }: { music: { title: string | null; playing: boolean; loading: boolean }; onClose: () => void }) {
  const fire = useFire()
  const { volume, muted } = useMusicPrefs()
  return (
    <Panel title="Music" onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line }}>
        <Icon name="music" size={22} color={music.playing ? fire.amber : fire.muted} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text size={15} weight="bold" numberOfLines={1} style={{ color: fire.ink }}>
            {music.title ?? 'Nothing playing'}
          </Text>
          <Text size={12} style={{ color: fire.muted }}>
            {music.title ? (music.loading ? 'Loading…' : music.playing ? 'Playing for the table' : 'Paused by the game master') : 'The game master picks the music.'}
          </Text>
        </View>
      </View>
      <ToggleRow value={muted} onChange={(v) => setMusicPrefs({ muted: v })} label="Mute the music for me" />
      <View style={{ gap: 8 }}>
        <Text size={14} weight="bold" style={{ color: fire.ink }}>
          My volume
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel="My music volume">
          {STEPS.map((v) => {
            const on = Math.abs(volume - v) < 0.01
            return (
              <Pressable
                key={v}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={v === 0 ? 'Off' : `${Math.round(v * 100)} percent`}
                onPress={() => setMusicPrefs({ volume: v, muted: v === 0 ? true : false })}
                style={{ flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? fire.amberSoft : fire.card, borderWidth: 1, borderColor: on ? fire.amber : fire.line }}
              >
                <Text size={13} weight="bold" style={{ color: on ? fire.amber : fire.ink }}>
                  {v === 0 ? 'Off' : `${Math.round(v * 100)}%`}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <Text size={12} style={{ color: fire.muted }}>
          Only changes how loud it is on this phone.
        </Text>
      </View>
    </Panel>
  )
}

/** GMs: damage waiting for an OK (Round board's box): apply, change the amount, or skip. */
export function PendingBox({ table, pending }: { table: TableState; pending: PendingDamage }) {
  const fire = useFire()
  const [amount, setAmount] = useState(pending.amount)
  const [busy, setBusy] = useState<'apply' | 'skip' | null>(null)
  useEffect(() => setAmount(pending.amount), [pending.id, pending.amount])
  const target = table.tokens.find((t) => t.id === pending.targetTokenId)
  const who = tokenName(target)
  const go = async (what: 'apply' | 'skip') => {
    setBusy(what)
    const r = what === 'apply' ? await campfireApi.applyPending(pending.id, amount === pending.amount ? undefined : amount) : await campfireApi.skipPending(pending.id)
    setBusy(null)
    if (!r.ok) void inform(what === 'apply' ? "Couldn't apply it" : "Couldn't skip it", r.message)
  }
  return (
    <View accessibilityRole="alert" style={{ gap: 8, padding: 10, borderRadius: 14, backgroundColor: 'rgba(31,23,20,0.96)', borderWidth: 1, borderColor: 'rgba(255,179,71,0.45)' }}>
      <Text size={14} weight="bold" numberOfLines={2} style={{ color: fire.ink }}>
        Apply {amount}
        {pending.damageType ? ` ${pending.damageType}` : ''} damage to {who}?{pending.crit ? ' (critical)' : ''}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Less damage" onPress={() => setAmount((a) => Math.max(0, a - 1))} style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: fire.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="minus" size={18} color={fire.ink} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="More damage" onPress={() => setAmount((a) => a + 1)} style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: fire.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" size={18} color={fire.ink} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <FireButton label="Skip" kind="quiet" height={44} busy={busy === 'skip'} onPress={() => void go('skip')} style={{ paddingHorizontal: 12 }} size={13} />
        <FireButton label="Apply" kind="primary" height={44} busy={busy === 'apply'} onPress={() => void go('apply')} style={{ paddingHorizontal: 18 }} size={13} />
      </View>
    </View>
  )
}
