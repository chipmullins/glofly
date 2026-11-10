import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ABILITIES,
  ABILITY_NAMES,
  CONDITIONS,
  DAMAGE_TYPES,
  EXHAUSTION_LEVELS,
  SKILLS,
  SKILL_IDS,
  abilityMod,
  attackExpressions,
  attackToHit,
  classLine,
  initiativeBonus,
  passivePerception,
  saveBonus,
  sheetProf,
  skillBonus,
  spellAttackBonus,
  spellSaveDc,
  withBonus,
  type Ability,
  type AttackKind,
  type Character,
  type ConditionId,
  type DamageType,
  type Sheet5e,
  type SheetAttack,
} from '@glofly/shared'
import { Text, webNoOutline } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { confirm, inform } from '@/ui/dialogs'
import { pickSquarePhoto } from '@/lib/photos'
import { APP_SETTINGS } from '@/lib/config'
import { campfireApi, fileSource } from './api'
import { rollAtTable } from './actions'
import { upsertCharacter } from './store'
import { Bar, FireButton, Section } from './ui'
import { hpColor, initialOf, signed, useFire } from './lib'

// Your character sheet (5e): tap any number to roll it at the table. HP, slots, resources,
// conditions and death saves are tracked here and saved as you go (the token's HP bar follows).
// "Edit" opens the basics (name, class, abilities, AC, HP max, actions). The D&D Beyond link
// only opens the sheet there (nothing is imported).

const SAVE_DELAY = 700

export function CharacterSheetView({ campaignId, initial }: { campaignId: string; initial: Character }) {
  const fire = useFire()
  const insets = useSafeAreaInsets()
  const [ch, setCh] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<{ sheet?: Sheet5e; name?: string; ddbUrl?: string | null } | null>(null)
  const s = ch.sheet
  const locked = s.locked

  // Someone else (the GM, a hit) changed it: take theirs unless we're about to save ours.
  useEffect(() => {
    if (!pendingSave.current) setCh(initial)
  }, [initial])

  const flush = async () => {
    const body = pendingSave.current
    pendingSave.current = null
    if (!body) return
    setSaving(true)
    const r = await campfireApi.saveCharacter(ch.id, body)
    setSaving(false)
    if (r.ok) {
      upsertCharacter(campaignId, r.data)
      if (!pendingSave.current) setCh(r.data)
    } else void inform("Couldn't save your sheet", r.message)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      void flush()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const save = (change: { sheet?: Sheet5e; name?: string; ddbUrl?: string | null }, now = false) => {
    setCh((c) => ({ ...c, ...(change.name !== undefined ? { name: change.name } : {}), ...(change.sheet ? { sheet: change.sheet } : {}), ...(change.ddbUrl !== undefined ? { ddbUrl: change.ddbUrl } : {}) }))
    pendingSave.current = { ...(pendingSave.current ?? {}), ...change }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), now ? 0 : SAVE_DELAY)
  }
  const edit = (fn: (x: Sheet5e) => Sheet5e, now = false) => save({ sheet: fn(structuredClone(s)) }, now)
  const roll = (expression: string, label: string) => void rollAtTable(campaignId, expression, { label, characterId: ch.id })

  const changePortrait = async () => {
    const picked = await pickSquarePhoto()
    if (picked === 'denied') return void inform('Not allowed', `Allow Glofly to use your photos in ${APP_SETTINGS}.`)
    if (!picked) return
    setBusy('portrait')
    const up = await campfireApi.uploadFile(campaignId, 'portrait', picked)
    if (!up.ok) {
      setBusy(null)
      return void inform("Couldn't upload it", up.message)
    }
    const r = await campfireApi.saveCharacter(ch.id, { portraitFileId: up.data.id })
    setBusy(null)
    if (r.ok) {
      setCh(r.data)
      upsertCharacter(campaignId, r.data)
    } else void inform("Couldn't save it", r.message)
  }

  const rest = async (kind: 'short' | 'long') => {
    const ok = await confirm({
      title: kind === 'short' ? 'Take a short rest?' : 'Take a long rest?',
      message: kind === 'short' ? 'Short-rest resources come back.' : 'HP, spell slots, resources and half your hit dice come back.',
      confirmLabel: kind === 'short' ? 'Short rest' : 'Long rest',
    })
    if (!ok) return
    await flush()
    setBusy(kind)
    const r = await campfireApi.rest(ch.id, kind)
    setBusy(null)
    if (r.ok) {
      setCh(r.data)
      upsertCharacter(campaignId, r.data)
    } else void inform("Couldn't rest", r.message)
  }

  const deathSave = async () => {
    await flush()
    setBusy('death')
    const r = await campfireApi.deathSave(ch.id)
    setBusy(null)
    if (!r.ok) return void inform("Couldn't roll it", r.message)
    setCh((c) => ({ ...c, sheet: { ...c.sheet, deathSaves: r.data.deathSaves } }))
  }

  const hp = s.hp
  const dc = spellSaveDc(s)
  const atk = spellAttackBonus(s)
  const slots = s.spellcasting.slots.map((x, i) => ({ ...x, level: i + 1 })).filter((x) => x.max > 0)

  return (
    <View style={{ flex: 1, backgroundColor: fire.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to the table" onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/campfire/[id]', params: { id: campaignId } }))} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: fire.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevronLeft" size={20} color={fire.ink} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, fontFamily: 'Outfit_700Bold', fontSize: 17, color: fire.ink }}>
          Character sheet
        </Text>
        {saving ? <ActivityIndicator color={fire.muted} accessibilityLabel="Saving" /> : null}
        <FireButton label={editing ? 'Done' : 'Edit'} kind={editing ? 'primary' : 'card'} height={44} size={14} onPress={() => setEditing((e) => !e)} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32, gap: 18, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        {/* Who */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Change ${ch.name}'s portrait`} onPress={() => void changePortrait()} style={{ width: 72, height: 72 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, overflow: 'hidden', backgroundColor: fire.greenDeep, borderWidth: 3, borderColor: fire.green, alignItems: 'center', justifyContent: 'center' }}>
              {ch.portraitFileId ? <Image source={fileSource(ch.portraitFileId)} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 26, color: '#fff' }}>{initialOf(ch.name)}</Text>}
            </View>
            <View style={{ position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line, alignItems: 'center', justifyContent: 'center' }}>
              {busy === 'portrait' ? <ActivityIndicator size="small" color={fire.ink} /> : <Icon name="camera" size={14} color={fire.ink} />}
            </View>
          </Pressable>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            {editing ? (
              <Field label="Name" value={ch.name} onChange={(v) => save({ name: v })} />
            ) : (
              <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 22, color: fire.ink }} numberOfLines={1}>
                {ch.name}
              </Text>
            )}
            <Text size={13} style={{ color: fire.muted }} numberOfLines={2}>
              {[s.race, classLine(s) ? `${classLine(s)}` : null].filter(Boolean).join(' · ') || 'Add a race and class with Edit'}
            </Text>
            {ch.ddbUrl ? (
              <Pressable accessibilityRole="link" accessibilityLabel="Open the D&D Beyond sheet in the browser" onPress={() => void Linking.openURL(ch.ddbUrl!)} style={{ minHeight: 32, justifyContent: 'center' }}>
                <Text size={13} weight="bold" style={{ color: fire.amber }}>
                  Open the D&amp;D Beyond sheet ↗
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <Text size={12} style={{ color: fire.muted, marginTop: -8 }}>
          Your portrait shows on your token, in the turn order and on your rolls.
        </Text>

        {editing ? <Basics s={s} locked={locked} ddbUrl={ch.ddbUrl} onSheet={(x) => save({ sheet: x })} onDdb={(v) => save({ ddbUrl: v || null })} /> : null}

        {/* Hit points */}
        <View style={{ gap: 10, padding: 14, borderRadius: 16, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="heart" size={18} color={fire.red} />
            <Text size={14} weight="bold" style={{ flex: 1, marginLeft: 8, color: fire.ink }}>
              Hit points
            </Text>
            <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 16, color: fire.ink }}>
              {hp.current} / {hp.max}
              {hp.temp ? <Text style={{ color: fire.amber, fontFamily: 'Outfit_700Bold', fontSize: 14 }}>{`  +${hp.temp} temp`}</Text> : null}
            </Text>
          </View>
          <Bar fraction={hp.max ? hp.current / hp.max : 0} color={hpColor(fire, hp.current, hp.max)} height={8} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Stepper label="Hit points" short="Current" value={hp.current} onChange={(v) => edit((x) => ({ ...x, hp: { ...x.hp, current: Math.max(0, Math.min(x.hp.max, v)) } }))} />
            <Stepper label="Temporary hit points" short="Temp" value={hp.temp} onChange={(v) => edit((x) => ({ ...x, hp: { ...x.hp, temp: Math.max(0, v) } }))} />
          </View>
          {hp.current === 0 ? (
            <View style={{ gap: 8, paddingTop: 4 }}>
              <Text size={14} weight="bold" style={{ color: s.deathSaves.dead ? fire.redText : fire.ink }}>
                {s.deathSaves.dead ? 'Dead' : s.deathSaves.stable ? 'Stable' : 'Death saves'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 16 }} accessible accessibilityLabel={`Death saves: ${s.deathSaves.successes} successes, ${s.deathSaves.failures} failures`}>
                <Dots label="Successes" n={s.deathSaves.successes} color={fire.green} />
                <Dots label="Failures" n={s.deathSaves.failures} color={fire.red} />
              </View>
              {!s.deathSaves.dead && !s.deathSaves.stable ? <FireButton label="Roll a death save" kind="amber" icon="dice" busy={busy === 'death'} onPress={() => void deathSave()} /> : null}
            </View>
          ) : null}
        </View>

        {/* The numbers */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat label="Armor class" value={String(s.ac)} />
          <Stat label="Speed" value={`${s.speed} ft`} />
          <Stat label="Initiative" value={signed(initiativeBonus(s))} onPress={() => roll(withBonus('1d20', initiativeBonus(s)), 'Initiative')} />
          <Stat label="Proficiency" value={signed(sheetProf(s))} />
        </View>
        <Text size={12} style={{ color: fire.muted, marginTop: -10 }}>
          Passive Perception {passivePerception(s)}
          {s.hitDice.length ? ` · Hit dice ${s.hitDice.map((h) => `${h.max - h.used}/${h.max} d${h.die}`).join(', ')}` : ''}
        </Text>

        <Section title="Abilities">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ABILITIES.map((a) => (
              <Pressable
                key={a}
                accessibilityRole="button"
                accessibilityLabel={`${ABILITY_NAMES[a]} ${s.abilities[a]}, ${signed(abilityMod(s.abilities[a]))}. Roll a check`}
                onPress={() => roll(withBonus('1d20', abilityMod(s.abilities[a])), `${ABILITY_NAMES[a]} check`)}
                style={({ pressed }) => ({ width: '31.5%', minHeight: 72, flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 12, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line, opacity: pressed ? 0.8 : 1 })}
              >
                <Text size={11} weight="bold" style={{ color: fire.muted, letterSpacing: 0.6 }}>
                  {a.toUpperCase()}
                </Text>
                <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 20, color: fire.ink }}>{signed(abilityMod(s.abilities[a]))}</Text>
                <Text size={12} style={{ color: fire.muted }}>
                  {s.abilities[a]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text size={12} style={{ color: fire.muted }}>
            Tap an ability, save, skill or action to roll it.
          </Text>
        </Section>

        <Section title="Saving throws">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {ABILITIES.map((a) => (
              <RollRow key={a} half label={ABILITY_NAMES[a]} prof={s.saves[a] ? 1 : 0} bonus={saveBonus(s, a)} onPress={() => roll(withBonus('1d20', saveBonus(s, a)), `${ABILITY_NAMES[a]} save`)} />
            ))}
          </View>
        </Section>

        <Section title="Skills">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {SKILL_IDS.map((k) => (
              <RollRow
                key={k}
                half
                label={SKILLS[k].name}
                sub={SKILLS[k].ability.toUpperCase()}
                prof={s.skills[k] ?? 0}
                bonus={skillBonus(s, k)}
                onPress={() => roll(withBonus('1d20', skillBonus(s, k)), `${SKILLS[k].name} check`)}
                onLongPress={editing ? () => edit((x) => ({ ...x, skills: { ...x.skills, [k]: (((x.skills[k] ?? 0) + 1) % 3) as 0 | 1 | 2 } })) : undefined}
              />
            ))}
          </View>
          {editing ? (
            <Text size={12} style={{ color: fire.muted }}>
              Long-press a skill to switch between not proficient, proficient and expertise.
            </Text>
          ) : null}
        </Section>

        <Section title="Actions">
          {s.attacks.length === 0 && !editing ? (
            <Text size={13} style={{ color: fire.muted }}>
              No actions yet. Add your weapons and attack spells with Edit.
            </Text>
          ) : null}
          {s.attacks.map((a) => {
            const ex = attackExpressions(s, a)
            return (
              <View key={a.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${a.name}, ${signed(attackToHit(s, a))} to hit, ${ex.damage} ${a.damageType}. Roll it`}
                  onPress={async () => {
                    if (await rollAtTable(campaignId, ex.toHit, { label: `${a.name}: to hit`, characterId: ch.id })) void rollAtTable(campaignId, ex.damage, { label: `${a.name}: damage`, characterId: ch.id })
                  }}
                  style={({ pressed }) => ({ flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: fire.line, backgroundColor: fire.card, opacity: pressed ? 0.8 : 1 })}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text size={14} weight="bold" numberOfLines={1} style={{ color: fire.ink }}>
                      {a.name}
                    </Text>
                    <Text size={12} numberOfLines={1} style={{ color: fire.muted }}>
                      {a.kind === 'spell' ? 'Spell' : a.kind === 'ranged' ? 'Ranged' : 'Melee'} · {a.damageType}
                      {a.range ? ` · ${a.range}` : ''}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 13, color: fire.amber }}>{signed(attackToHit(s, a))}</Text>
                  <Text size={13} style={{ color: fire.muted }}>
                    {ex.damage}
                  </Text>
                  <Icon name="dice" size={16} color={fire.muted} />
                </Pressable>
                {editing ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${a.name}`} onPress={() => edit((x) => ({ ...x, attacks: x.attacks.filter((y) => y.id !== a.id) }))} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="trash" size={18} color={fire.redText} />
                  </Pressable>
                ) : null}
              </View>
            )
          })}
          {editing ? <AddAttack onAdd={(a) => edit((x) => ({ ...x, attacks: [...x.attacks, a] }))} /> : null}
          <Text size={12} style={{ color: fire.muted }}>
            On the map, tap a creature first to attack it (the game master&apos;s numbers stay hidden).
          </Text>
        </Section>

        {s.spellcasting.ability || slots.length || s.spellcasting.spells.length ? (
          <Section title="Spells">
            <Text size={13} style={{ color: fire.ink }}>
              Spell save DC {dc} · Spell attack {signed(atk)}
              {s.concentration ? ` · Concentrating on ${s.concentration}` : ''}
            </Text>
            {s.concentration ? <FireButton label="Stop concentrating" height={44} size={14} onPress={() => edit((x) => ({ ...x, concentration: null }))} /> : null}
            {slots.map((sl) => (
              <View key={sl.level} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text size={13} weight="bold" style={{ width: 72, color: fire.muted }}>
                  Level {sl.level}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 }}>
                  {Array.from({ length: sl.max }, (_, i) => {
                    const used = i < sl.used
                    return (
                      <Pressable
                        key={i}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: used }}
                        accessibilityLabel={`Level ${sl.level} slot ${i + 1}, ${used ? 'used' : 'ready'}`}
                        onPress={() => edit((x) => {
                          const next = { ...x, spellcasting: { ...x.spellcasting, slots: x.spellcasting.slots.map((z) => ({ ...z })) } }
                          next.spellcasting.slots[sl.level - 1].used = used ? i : i + 1
                          return next
                        })}
                        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: fire.amber, backgroundColor: used ? 'transparent' : fire.amber }} />
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            ))}
            {s.spellcasting.pact ? (
              <Counter label={`Pact slots (level ${s.spellcasting.pact.level})`} used={s.spellcasting.pact.used} max={s.spellcasting.pact.max} onChange={(used) => edit((x) => ({ ...x, spellcasting: { ...x.spellcasting, pact: x.spellcasting.pact ? { ...x.spellcasting.pact, used } : null } }))} />
            ) : null}
            {s.spellcasting.spells.length ? (
              <Text size={13} style={{ color: fire.muted, lineHeight: 20 }}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
                  .map((lv) => {
                    const names = s.spellcasting.spells.filter((sp) => sp.level === lv).map((sp) => sp.name + (lv > 0 && !sp.prepared ? ' (not prepared)' : ''))
                    return names.length ? `${lv === 0 ? 'Cantrips' : `Level ${lv}`}: ${names.join(', ')}` : null
                  })
                  .filter(Boolean)
                  .join('\n')}
              </Text>
            ) : null}
          </Section>
        ) : null}

        {s.resources.length ? (
          <Section title="Resources">
            {s.resources.map((r) => (
              <Counter key={r.id} label={`${r.name}${r.reset !== 'none' ? ` · ${r.reset} rest` : ''}`} used={r.used} max={r.max} onChange={(used) => edit((x) => ({ ...x, resources: x.resources.map((y) => (y.id === r.id ? { ...y, used } : y)) }))} />
            ))}
          </Section>
        ) : null}

        <Section title="Conditions">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {CONDITIONS.filter((c) => c.id !== 'exhaustion').map((c) => {
              const on = s.conditions.includes(c.id)
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={c.name}
                  onPress={() => edit((x) => ({ ...x, conditions: on ? x.conditions.filter((y) => y !== c.id) : [...x.conditions, c.id as ConditionId] }))}
                  style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 22, justifyContent: 'center', backgroundColor: on ? fire.amberSoft : fire.card, borderWidth: 1, borderColor: on ? fire.amber : fire.line }}
                >
                  <Text size={13} weight="bold" style={{ color: on ? fire.amber : fire.ink }}>
                    {c.name}
                  </Text>
                </Pressable>
              )
            })}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text size={13} style={{ flex: 1, color: fire.ink }}>
              Exhaustion: {s.exhaustion ? `level ${s.exhaustion}` : 'none'}
              {s.exhaustion ? <Text size={12} style={{ color: fire.muted }}>{`  ${EXHAUSTION_LEVELS[s.exhaustion - 1] ?? ''}`}</Text> : null}
            </Text>
            <Round icon="minus" label="Less exhaustion" onPress={() => edit((x) => ({ ...x, exhaustion: Math.max(0, x.exhaustion - 1) }))} />
            <Round icon="plus" label="More exhaustion" onPress={() => edit((x) => ({ ...x, exhaustion: Math.min(6, x.exhaustion + 1) }))} />
          </View>
        </Section>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <FireButton label="Short rest" busy={busy === 'short'} style={{ flex: 1 }} onPress={() => void rest('short')} />
          <FireButton label="Long rest" busy={busy === 'long'} style={{ flex: 1 }} onPress={() => void rest('long')} />
        </View>

        {s.features.length || s.inventory.length || s.notes ? (
          <Section title="Features, gear and notes">
            {s.features.map((f) => (
              <Text key={f.id} size={13} style={{ color: fire.ink }}>
                <Text size={13} weight="bold" style={{ color: fire.ink }}>
                  {f.name}.{' '}
                </Text>
                {f.text}
              </Text>
            ))}
            {s.inventory.length ? (
              <Text size={13} style={{ color: fire.muted }}>
                {s.inventory.map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(', ')}
              </Text>
            ) : null}
            {s.notes ? (
              <Text size={13} style={{ color: fire.muted }}>
                {s.notes}
              </Text>
            ) : null}
          </Section>
        ) : null}
        {locked ? (
          <Text size={12} style={{ color: fire.muted }}>
            The game master locked your armor class and hit point maximum.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  )
}

/** Name, race, class, abilities, AC, HP max, speed and the D&D Beyond link (Edit). */
function Basics({ s, locked, ddbUrl, onSheet, onDdb }: { s: Sheet5e; locked: boolean; ddbUrl: string | null; onSheet: (x: Sheet5e) => void; onDdb: (v: string) => void }) {
  const fire = useFire()
  const cls = s.classes[0] ?? { name: '', level: 1, hitDie: 8, caster: 'none' as const }
  const setClass = (c: Partial<typeof cls>) => onSheet({ ...s, classes: [{ ...cls, ...c }, ...s.classes.slice(1)] })
  return (
    <View style={{ gap: 12, padding: 14, borderRadius: 16, backgroundColor: fire.panel, borderWidth: 1, borderColor: fire.line }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field label="Race" value={s.race} onChange={(v) => onSheet({ ...s, race: v })} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Class" value={cls.name} onChange={(v) => setClass({ name: v })} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Stepper label="Level" value={cls.level} onChange={(v) => setClass({ level: Math.max(1, Math.min(20, v)) })} />
        <Stepper label="Speed" value={s.speed} step={5} onChange={(v) => onSheet({ ...s, speed: Math.max(0, v) })} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Stepper label="Armor class" short="AC" value={s.ac} disabled={locked} onChange={(v) => onSheet({ ...s, ac: Math.max(0, v) })} />
        <Stepper label="Hit point maximum" short="HP max" value={s.hp.max} disabled={locked} onChange={(v) => onSheet({ ...s, hp: { ...s.hp, max: Math.max(1, v), current: Math.min(s.hp.current, Math.max(1, v)) } })} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ABILITIES.map((a) => (
          <View key={a} style={{ width: '48%', flexGrow: 1 }}>
            <Stepper label={ABILITY_NAMES[a]} short={a.toUpperCase()} value={s.abilities[a]} onChange={(v) => onSheet({ ...s, abilities: { ...s.abilities, [a]: Math.max(1, Math.min(30, v)) } })} />
          </View>
        ))}
      </View>
      <View style={{ gap: 6 }}>
        <Text size={13} weight="bold" style={{ color: fire.ink }}>
          Saving throws you&apos;re proficient in
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {ABILITIES.map((a) => {
            const on = !!s.saves[a]
            return (
              <Pressable key={a} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${ABILITY_NAMES[a]} save proficiency`} onPress={() => onSheet({ ...s, saves: { ...s.saves, [a]: !on } })} style={{ minWidth: 52, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? fire.amberSoft : fire.card, borderWidth: 1, borderColor: on ? fire.amber : fire.line }}>
                <Text size={13} weight="bold" style={{ color: on ? fire.amber : fire.ink }}>
                  {a.toUpperCase()}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>
      <Field label="D&D Beyond link (optional)" value={ddbUrl ?? ''} placeholder="https://www.dndbeyond.com/characters/…" onChange={onDdb} url />
    </View>
  )
}

function AddAttack({ onAdd }: { onAdd: (a: SheetAttack) => void }) {
  const fire = useFire()
  const [name, setName] = useState('')
  const [damage, setDamage] = useState('1d8')
  const [kind, setKind] = useState<AttackKind>('melee')
  const [ability, setAbility] = useState<Ability | 'spell'>('str')
  const [type, setType] = useState<DamageType>('slashing')
  const add = () => {
    if (!name.trim()) return void inform('Give it a name', 'Like "Longbow" or "Fire Bolt".')
    onAdd({ id: `a${Date.now().toString(36)}`, name: name.trim(), kind, ability, proficient: true, bonus: 0, fixedToHit: null, damage: damage.trim() || '1d4', damageAbility: kind !== 'spell', damageType: type, range: '', notes: '' })
    setName('')
  }
  const chips = <T extends string>(values: readonly T[], value: T, set: (v: T) => void, label: (v: T) => string) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {values.map((v) => (
        <Pressable key={v} accessibilityRole="radio" accessibilityState={{ selected: v === value }} onPress={() => set(v)} style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 20, justifyContent: 'center', backgroundColor: v === value ? fire.amberSoft : fire.card, borderWidth: 1, borderColor: v === value ? fire.amber : fire.line }}>
          <Text size={13} weight="bold" style={{ color: v === value ? fire.amber : fire.ink }}>
            {label(v)}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  )
  return (
    <View style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: fire.line }}>
      <Text size={13} weight="bold" style={{ color: fire.ink }}>
        Add an action
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 2 }}>
          <Field label="Name" value={name} onChange={setName} placeholder="Longbow" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Damage dice" value={damage} onChange={setDamage} placeholder="1d8" />
        </View>
      </View>
      {chips(['melee', 'ranged', 'spell'] as const, kind, (k) => {
        setKind(k)
        setAbility(k === 'spell' ? 'spell' : k === 'ranged' ? 'dex' : 'str')
      }, (k) => (k === 'melee' ? 'Melee' : k === 'ranged' ? 'Ranged' : 'Spell'))}
      {chips([...ABILITIES, 'spell'] as const, ability, setAbility, (a) => (a === 'spell' ? 'Spellcasting' : a.toUpperCase()))}
      {chips(DAMAGE_TYPES, type, setType, (t) => t)}
      <FireButton label="Add action" icon="plus" kind="primary" onPress={add} />
    </View>
  )
}

function Field({ label, value, onChange, placeholder, url }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; url?: boolean }) {
  const fire = useFire()
  return (
    <View style={{ gap: 4 }}>
      <Text size={12} weight="bold" style={{ color: fire.muted }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={fire.muted}
        accessibilityLabel={label}
        autoCapitalize={url ? 'none' : 'words'}
        autoCorrect={false}
        keyboardType={url ? 'url' : 'default'}
        style={[{ height: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line, color: fire.ink, fontSize: 15, fontFamily: 'DMSans_400Regular' }, webNoOutline]}
      />
    </View>
  )
}

function Round({ icon, label, onPress, disabled }: { icon: 'plus' | 'minus'; label: string; onPress: () => void; disabled?: boolean }) {
  const fire = useFire()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: fire.raised, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}>
      <Icon name={icon} size={18} color={fire.ink} />
    </Pressable>
  )
}

function Stepper({ label, short, value, onChange, step = 1, disabled }: { label: string; short?: string; value: number; onChange: (v: number) => void; step?: number; disabled?: boolean }) {
  const fire = useFire()
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, borderRadius: 12, backgroundColor: fire.bg, borderWidth: 1, borderColor: fire.line }} accessible={false}>
      <Round icon="minus" label={`Lower ${label}`} disabled={disabled} onPress={() => onChange(value - step)} />
      <View style={{ flex: 1, alignItems: 'center' }} accessible accessibilityLabel={`${label}: ${value}`}>
        <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 17, color: fire.ink }}>{value}</Text>
        <Text size={11} numberOfLines={1} style={{ color: fire.muted }}>
          {short ?? label}
        </Text>
      </View>
      <Round icon="plus" label={`Raise ${label}`} disabled={disabled} onPress={() => onChange(value + step)} />
    </View>
  )
}

function Counter({ label, used, max, onChange }: { label: string; used: number; max: number; onChange: (used: number) => void }) {
  const fire = useFire()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 }}>
      <Text size={13} style={{ flex: 1, color: fire.ink }} numberOfLines={2}>
        {label}
      </Text>
      <Text accessibilityLabel={`${max - used} of ${max} left`} style={{ fontFamily: 'Outfit_700Bold', fontSize: 15, color: fire.ink, minWidth: 44, textAlign: 'center' }}>
        {max - used}/{max}
      </Text>
      <Round icon="minus" label={`Use one: ${label}`} disabled={used >= max} onPress={() => onChange(Math.min(max, used + 1))} />
      <Round icon="plus" label={`Get one back: ${label}`} disabled={used <= 0} onPress={() => onChange(Math.max(0, used - 1))} />
    </View>
  )
}

function Stat({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const fire = useFire()
  const body: ReactNode = (
    <>
      <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 18, color: fire.ink }}>{value}</Text>
      <Text size={11} numberOfLines={1} style={{ color: fire.muted }}>
        {label}
      </Text>
    </>
  )
  const style = { flex: 1, minHeight: 64, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 2, borderRadius: 12, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line }
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${value}. Roll it`} onPress={onPress} style={style}>
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={`${label} ${value}`} style={style}>
      {body}
    </View>
  )
}

function RollRow({ label, sub, prof, bonus, onPress, onLongPress, half }: { label: string; sub?: string; prof: number; bonus: number; onPress: () => void; onLongPress?: () => void; half?: boolean }) {
  const fire = useFire()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${signed(bonus)}${prof === 2 ? ', expertise' : prof === 1 ? ', proficient' : ''}. Roll it`}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({ width: half ? '48.5%' : '100%', flexGrow: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line, opacity: pressed ? 0.8 : 1 })}
    >
      <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: fire.amber, backgroundColor: prof ? fire.amber : 'transparent', boxShadow: prof === 2 ? `0 0 0 2px ${fire.amberSoft}, 0 0 0 4px ${fire.amber}` : undefined }} />
      <Text size={13} numberOfLines={1} style={{ flex: 1, color: fire.ink }}>
        {label}
        {sub ? <Text size={11} style={{ color: fire.muted }}>{`  ${sub}`}</Text> : null}
      </Text>
      <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 14, color: fire.amber }}>{signed(bonus)}</Text>
    </Pressable>
  )
}

function Dots({ label, n, color }: { label: string; n: number; color: string }) {
  const fire = useFire()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text size={12} style={{ color: fire.muted }}>
        {label}
      </Text>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: color, backgroundColor: i < n ? color : 'transparent' }} />
      ))}
    </View>
  )
}
