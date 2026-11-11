import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ABILITIES,
  ABILITY_NAMES,
  abilityMod,
  asiFeats,
  averageHitDie,
  isFullCharacter,
  levelUpPreview,
  levelUpSheet,
  rulesOf,
  type BuilderRules,
  type CampaignHub,
  type Character,
  type SessionRsvp,
} from '@glofly/shared'
import { useSession } from '@/state/session'
import { ThemeOverride } from '@/ui/theme'
import { Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { inform } from '@/ui/dialogs'
import { onHubChange, upsertCharacter, useCampfire } from '@/campfire/store'
import { FireButton } from '@/campfire/ui'
import { useFire } from '@/campfire/lib'
import { builderFor, roundA } from '@/campfire/roundA'

// The campaign hub on a phone (approved board "HubPhone"): the next session and "are you
// coming?", leveling up when the party levels, the last recap, quests, the party's loot and the
// journal. Read-only besides RSVPs and your own level up: running the campaign is on a computer.

type Tab = 'hub' | 'quests' | 'loot' | 'journal'

export default function CampfireHub() {
  const { campaign } = useLocalSearchParams<{ campaign: string }>()
  return (
    <ThemeOverride mode="night">
      <Hub campaignId={String(campaign ?? '')} />
    </ThemeOverride>
  )
}

const dayTime = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const inDays = (iso: string) => {
  const d = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`
}

function Hub({ campaignId }: { campaignId: string }) {
  const fire = useFire()
  const insets = useSafeAreaInsets()
  const meId = useSession((s) => s.user?.id ?? '')
  const table = useCampfire((s) => s.tables[campaignId])
  const [hub, setHub] = useState<CampaignHub | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('hub')
  const [recapOpen, setRecapOpen] = useState(false)
  const [leveling, setLeveling] = useState(false)
  const [data, setData] = useState<BuilderRules | null>(null)

  const load = useCallback(async () => {
    const r = await roundA.hub(campaignId)
    if (!r.ok) return setError(r.message)
    setHub(r.data)
  }, [campaignId])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => onHubChange((id) => id === campaignId && void load()), [campaignId, load])
  const rules = rulesOf(table?.campaign.settings)
  useEffect(() => {
    void builderFor(campaignId, rules).then(setData)
  }, [campaignId, rules])

  if (!hub)
    return (
      <View style={{ flex: 1, backgroundColor: fire.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
        <Text style={{ color: error ? fire.ink : fire.muted, textAlign: 'center' }}>{error ?? 'Opening the hub…'}</Text>
        {error ? <FireButton label="Back" onPress={() => router.back()} /> : null}
      </View>
    )

  const mine = table?.characters.find((c) => c.ownerId === meId && c.kind === 'pc' && isFullCharacter(c)) as Character | undefined
  const myLevel = mine ? mine.sheet.classes.reduce((n, c) => n + c.level, 0) : 0
  const canLevel = !!mine && !!data && !!levelUpPreview(data, mine.sheet) && myLevel < hub.progress.level
  if (leveling && mine && data) return <PhoneLevelUp campaignId={campaignId} ch={mine} data={data} onClose={() => setLeveling(false)} />

  const next = hub.sessions.filter((s) => !s.before && s.startsAt && new Date(s.startsAt).getTime() > Date.now() - 4 * 3600_000).sort((a, b) => new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime())[0]
  const played = hub.progress.sessionsBefore + hub.sessions.filter((s) => !s.before && s.startsAt && new Date(s.startsAt).getTime() < Date.now()).length
  const last = [...hub.sessions].filter((s) => s.recapPostedAt).sort((a, b) => b.number - a.number)[0]
  const quest = hub.quests.find((q) => q.status === 'open')
  const myAnswer = next?.rsvps.find((r) => r.userId === meId)?.answer
  const count = (a: SessionRsvp) => next?.rsvps.filter((r) => r.answer === a).length ?? 0
  const answer = async (a: SessionRsvp) => {
    if (!next) return
    const r = await roundA.rsvp(next.id, a)
    if (!r.ok) return void inform("Couldn't save that", r.message)
    void load()
  }

  return (
    <View style={{ flex: 1, backgroundColor: fire.bg }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: fire.deep, gap: 6 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to the table" onPress={() => router.back()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: fire.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevronLeft" size={20} color={fire.ink} />
        </Pressable>
        <Text size={12} style={{ color: fire.muted }}>
          {`Level ${hub.progress.level} · ${played} session${played === 1 ? '' : 's'} played`}
        </Text>
        <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', fontSize: 26, color: fire.ink }}>
          {table?.campaign.name ?? 'Campaign hub'}
        </Text>
        {hub.pitch ? (
          <Text size={14} style={{ color: fire.muted }}>
            {hub.pitch}
          </Text>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }}>
        {tab === 'hub' ? (
          <>
            <View style={{ padding: 16, borderRadius: 18, backgroundColor: fire.amberSoft, borderWidth: 1, borderColor: fire.amberLine, gap: 10 }}>
              {next?.startsAt ? (
                <>
                  <Text size={12} weight="bold" style={{ color: fire.amber }}>
                    Next session {inDays(next.startsAt)}
                  </Text>
                  <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 20, color: fire.ink }}>{dayTime(next.startsAt)}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {(
                      [
                        ['yes', 'Going'],
                        ['maybe', 'Maybe'],
                        ['no', 'Can’t'],
                      ] as const
                    ).map(([a, label]) => (
                      <FireButton key={a} label={label} kind={myAnswer === a ? 'primary' : 'card'} style={{ flex: 1 }} onPress={() => void answer(a)} />
                    ))}
                  </View>
                  <Text size={12} style={{ color: fire.muted }}>
                    {count('yes')} going · {count('maybe')} maybe · reminders a day and 30 minutes before
                  </Text>
                </>
              ) : (
                <Text style={{ color: fire.muted }}>No session planned yet. Your game master plans them on a computer.</Text>
              )}
            </View>
            {canLevel && mine ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.green }}>
                <View style={{ flex: 1 }}>
                  <Text weight="bold" style={{ color: fire.ink }}>
                    {mine.name}
                  </Text>
                  <Text size={13} style={{ color: fire.muted }}>
                    {mine.sheet.classes[0]?.name} {myLevel} · level {myLevel + 1} is ready
                  </Text>
                </View>
                <FireButton label="Level up" kind="primary" onPress={() => setLeveling(true)} />
              </View>
            ) : null}
            {last ? (
              <View style={{ padding: 16, borderRadius: 18, backgroundColor: fire.card, gap: 8 }}>
                <Text size={12} weight="bold" style={{ color: fire.muted }}>
                  {last.before ? 'The story so far' : 'Last time'}
                </Text>
                <Text size={15} numberOfLines={recapOpen ? undefined : 4} style={{ color: fire.ink }}>
                  {last.recap}
                </Text>
                <Pressable accessibilityRole="button" onPress={() => setRecapOpen((v) => !v)}>
                  <Text size={14} weight="bold" style={{ color: fire.amber }}>
                    {recapOpen ? 'Show less' : 'Read the whole recap'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {quest ? (
              <Pressable accessibilityRole="button" onPress={() => setTab('quests')} style={{ padding: 16, borderRadius: 18, backgroundColor: fire.card, gap: 4, borderLeftWidth: 3, borderLeftColor: fire.amber }}>
                <Text size={12} weight="bold" style={{ color: fire.muted }}>
                  Current quest
                </Text>
                <Text weight="bold" size={16} style={{ color: fire.ink }}>
                  {quest.title}
                </Text>
                {quest.detail ? (
                  <Text size={14} style={{ color: fire.muted }}>
                    {quest.detail}
                  </Text>
                ) : null}
              </Pressable>
            ) : null}
          </>
        ) : tab === 'quests' ? (
          hub.quests.length ? (
            hub.quests.map((q) => (
              <View key={q.id} style={{ padding: 14, borderRadius: 14, backgroundColor: fire.card, gap: 4, opacity: q.status === 'open' ? 1 : 0.6 }}>
                <Text weight="bold" style={{ color: fire.ink, textDecorationLine: q.status === 'done' ? 'line-through' : 'none' }}>
                  {q.title}
                </Text>
                <Text size={13} style={{ color: fire.muted }}>
                  {[q.status === 'open' ? 'Open' : q.status === 'done' ? 'Done' : 'Failed', q.giver ? `from ${q.giver}` : null, q.detail || null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            ))
          ) : (
            <Text style={{ color: fire.muted }}>No quests yet.</Text>
          )
        ) : tab === 'loot' ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['pp', 'gp', 'ep', 'sp', 'cp'] as const).map((k) => (
                <View key={k} style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: fire.card, alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 18, color: fire.amber }}>{hub.loot.coins[k]}</Text>
                  <Text size={11} weight="bold" style={{ color: fire.muted }}>
                    {k.toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
            {hub.loot.items.map((it) => (
              <View key={it.id} style={{ padding: 14, borderRadius: 14, backgroundColor: fire.card }}>
                <Text weight="bold" style={{ color: fire.ink }}>
                  {it.name}
                  {it.qty > 1 ? ` × ${it.qty}` : ''}
                </Text>
                {it.notes ? (
                  <Text size={13} style={{ color: fire.muted }}>
                    {it.notes}
                  </Text>
                ) : null}
              </View>
            ))}
            <Text size={12} style={{ color: fire.muted }}>
              Your game master splits the coins and hands out items.
            </Text>
          </>
        ) : hub.journal.length ? (
          hub.journal.map((j) => (
            <View key={j.id} style={{ padding: 14, borderRadius: 14, backgroundColor: fire.card, gap: 4 }}>
              <Text weight="bold" style={{ color: fire.ink }}>
                {j.name}
              </Text>
              <Text size={12} weight="bold" style={{ color: fire.amber }}>
                {j.kind === 'npc' ? 'Person' : j.kind === 'place' ? 'Place' : j.kind === 'item' ? 'Item' : 'Lore'}
              </Text>
              <Text size={14} style={{ color: fire.muted }}>
                {j.text}
              </Text>
            </View>
          ))
        ) : (
          <Text style={{ color: fire.muted }}>Nothing written yet.</Text>
        )}
      </ScrollView>
      <View style={{ flexDirection: 'row', paddingBottom: insets.bottom + 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: fire.line, backgroundColor: fire.panel }} accessibilityRole="tablist">
        {(
          [
            ['hub', 'Hub'],
            ['quests', 'Quests'],
            ['loot', 'Loot'],
            ['journal', 'Journal'],
          ] as const
        ).map(([id, label]) => (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} onPress={() => setTab(id)} style={{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Text weight="bold" size={14} style={{ color: tab === id ? fire.amber : fire.muted }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

/** Leveling up on a phone: hit points (average or a roll at the table), the subclass, an ASI. */
function PhoneLevelUp({ campaignId, ch, data, onClose }: { campaignId: string; ch: Character; data: BuilderRules; onClose: () => void }) {
  const fire = useFire()
  const insets = useSafeAreaInsets()
  const p = levelUpPreview(data, ch.sheet)!
  const [rolled, setRolled] = useState<number | null>(null)
  const [subclass, setSubclass] = useState<string | null>(null)
  const [plus, setPlus] = useState<Partial<Record<(typeof ABILITIES)[number], number>>>({})
  const [feat, setFeat] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const total = Object.values(plus).reduce((n: number, v) => n + (v ?? 0), 0)
  const ready = (!p.level.asi || total === 2 || !!feat) && (!p.needsSubclass || !!subclass)
  const con = abilityMod(ch.sheet.abilities.con)

  const roll = async () => {
    const r = await roundA.roll(campaignId, `1d${p.cls.hitDie}`, `${ch.name}: hit points for level ${p.next}`, ch.id)
    if (!r.ok) return void inform("Couldn't roll", r.message)
    setRolled(r.data.total)
  }
  const save = async () => {
    setBusy(true)
    const sheet = levelUpSheet(data, ch.sheet, { rolled, subclassId: subclass, ...(p.level.asi ? { asi: feat ? { kind: 'feat', featId: feat } : { kind: 'asi', plus } } : {}) })
    const r = await roundA.saveSheet(ch.id, sheet)
    setBusy(false)
    if (!r.ok) return void inform("Couldn't level up", r.message)
    upsertCharacter(campaignId, r.data)
    onClose()
  }

  return (
    <View style={{ flex: 1, backgroundColor: fire.bg, paddingTop: insets.top + 8 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text size={12} weight="bold" style={{ color: fire.amber }}>
          LEVEL UP
        </Text>
        <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', fontSize: 24, color: fire.ink }}>
          {ch.name} reaches level {p.next}
        </Text>
        <View style={{ padding: 14, borderRadius: 16, backgroundColor: fire.card, gap: 10 }}>
          <Text weight="bold" style={{ color: fire.ink }}>
            Hit points
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <FireButton label={`Average: +${Math.max(1, averageHitDie(p.cls.hitDie) + con)}`} kind={rolled === null ? 'primary' : 'card'} style={{ flex: 1 }} onPress={() => setRolled(null)} />
            <FireButton label={rolled === null ? `Roll 1d${p.cls.hitDie}` : `Rolled ${rolled}: +${Math.max(1, rolled + con)}`} kind={rolled === null ? 'card' : 'primary'} style={{ flex: 1 }} onPress={() => void roll()} />
          </View>
          <Text size={12} style={{ color: fire.muted }}>
            A roll happens at the table, so everyone sees it.
          </Text>
        </View>
        {p.needsSubclass ? (
          <View style={{ padding: 14, borderRadius: 16, backgroundColor: fire.card, gap: 10 }}>
            <Text weight="bold" style={{ color: fire.ink }}>
              {p.cls.subclassLabel || 'Subclass'}
            </Text>
            {p.cls.subclasses.map((s) => (
              <FireButton key={s.id} label={s.name} kind={subclass === s.id ? 'primary' : 'card'} onPress={() => setSubclass(s.id)} />
            ))}
          </View>
        ) : null}
        {p.level.asi ? (
          <View style={{ padding: 14, borderRadius: 16, backgroundColor: fire.card, gap: 10 }}>
            <Text weight="bold" style={{ color: fire.ink }}>
              Ability Score Improvement: +2 in all ({total} of 2)
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {ABILITIES.map((a) => {
                const v = plus[a] ?? 0
                return (
                  <FireButton
                    key={a}
                    label={`${ABILITY_NAMES[a].slice(0, 3)} ${ch.sheet.abilities[a]}${v ? ` +${v}` : ''}`}
                    kind={v ? 'primary' : 'card'}
                    style={{ width: '31%' }}
                    onPress={() => setPlus({ ...plus, [a]: v >= 2 || (total >= 2 && v > 0) ? 0 : total >= 2 ? v : v + 1 })}
                  />
                )
              })}
            </View>
            {asiFeats(data).length ? (
              <>
                <Text size={12} weight="bold" style={{ color: fire.muted }}>
                  Or take a feat instead
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {asiFeats(data).map((f) => (
                    <FireButton key={f.id} label={f.name} kind={feat === f.id ? 'primary' : 'card'} onPress={() => setFeat(feat === f.id ? null : f.id)} />
                  ))}
                </View>
              </>
            ) : null}
          </View>
        ) : null}
        <View style={{ padding: 14, borderRadius: 16, backgroundColor: fire.card, gap: 6 }}>
          <Text weight="bold" style={{ color: fire.ink }}>
            Done for you
          </Text>
          <Text size={13} style={{ color: fire.muted }}>
            ✓ Hit dice {p.next - 1} → {p.next} (d{p.cls.hitDie})
          </Text>
          {p.newFeatures.map((f) => (
            <Text key={f.name} size={13} style={{ color: fire.muted }}>
              ✓ New: {f.name}
            </Text>
          ))}
          {p.cls.spellAbility ? (
            <Text size={13} style={{ color: fire.muted }}>
              ✓ Spell slots updated; add new spells on your sheet
            </Text>
          ) : null}
        </View>
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, padding: 16, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: fire.line }}>
        <FireButton label="Later" style={{ flex: 1 }} onPress={onClose} />
        <FireButton label={`Finish level ${p.next}`} kind="primary" busy={busy} disabled={!ready} style={{ flex: 2 }} onPress={() => void save()} />
      </View>
    </View>
  )
}
