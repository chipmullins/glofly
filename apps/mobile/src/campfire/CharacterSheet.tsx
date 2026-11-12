import { useEffect, useRef, useState, type ReactNode } from 'react'
import { withTwoHanded } from '@glofly/shared/campfire/builder'
import { ActivityIndicator, Linking, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated'
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
  applyDamage,
  attackExpressions,
  attackToHit,
  classLine,
  concentrationDc,
  damageModsFor,
  deathSaveFailures,
  heal,
  initiativeBonus,
  isFullCharacter,
  passivePerception,
  saveBonus,
  skillBonus,
  spellAttackBonus,
  spellSaveDc,
  totalLevel,
  withBonus,
  type Ability,
  type AttackKind,
  type Character,
  type ConditionId,
  type DamageType,
  type Sheet5e,
  type SheetAttack,
  type SheetSpell,
} from '@glofly/shared'
import { Text, webNoOutline } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { chooseFrom, confirm, inform } from '@/ui/dialogs'
import { haptic } from '@/constellations/motion'
import { pickSquarePhoto } from '@/lib/photos'
import { APP_SETTINGS } from '@/lib/config'
import { campfireApi, fileSource } from './api'
import { rollAtTable } from './actions'
import { upsertCharacter, useCampfire } from './store'
import { creditFor } from '@glofly/shared'
import { FireButton } from './ui'
import { hpColor, initialOf, signed, useFire, useStill } from './lib'
import { RollModeSwitch, SheetTabs, modeLabel, spellDice, useSrdSpells, withMode, type RollMode, type SheetExtras, type SpellExtras } from './sheetParts'

// Your character sheet (5e), laid out like the approved SheetPhone board: header, HP with temp HP
// as a blue segment and Damage / Heal, AC / Init / Speed, the concentration banner, then the tabs
// Overview / Actions / Spells / More, with Short rest / Long rest pinned at the bottom. Every d20
// follows the Normal / Advantage / Disadvantage switch. Changes save as you go (the token's HP bar
// follows). "Edit" opens the basics. The D&D Beyond link only opens the sheet there.

const SAVE_DELAY = 700
type Tab = 'overview' | 'actions' | 'spells' | 'more'
const TABS: readonly [Tab, string][] = [
  ['overview', 'Overview'],
  ['actions', 'Actions'],
  ['spells', 'Spells'],
  ['more', 'More'],
]

export function CharacterSheetView({ campaignId, initial }: { campaignId: string; initial: Character }) {
  const fire = useFire()
  const still = useStill()
  const insets = useSafeAreaInsets()
  const [ch, setCh] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [mode, setMode] = useState<RollMode>('normal')
  const [amount, setAmount] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<{ sheet?: Sheet5e; name?: string; ddbUrl?: string | null } | null>(null)
  const token = useCampfire((st) => st.tables[campaignId]?.tokens.find((t) => t.characterId === initial.id) ?? null)
  const combat = useCampfire((st) => st.tables[campaignId]?.combat ?? null)
  const s = ch.sheet
  const locked = s.locked

  // Someone else (the GM, a hit) changed it: take theirs unless we're about to save ours.
  useEffect(() => {
    if (!pendingSave.current) setCh(initial)
  }, [initial])

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current)
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
  const roll = (expression: string, label: string) => rollAtTable(campaignId, expression, { label, characterId: ch.id })
  /** A d20 roll that follows the Normal / Advantage / Disadvantage switch. */
  const rollD20 = (bonus: number, label: string) => roll(withMode(withBonus('1d20', bonus), mode), modeLabel(label, mode))

  const reload = async () => {
    const r = await campfireApi.character(ch.id)
    if (r.ok && isFullCharacter(r.data)) {
      upsertCharacter(campaignId, r.data)
      setCh(r.data)
    }
  }

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
      message: kind === 'short' ? 'Short-rest resources and pact slots come back.' : 'HP, spell slots, resources and half your hit dice come back.',
      confirmLabel: kind === 'short' ? 'Short rest' : 'Long rest',
    })
    if (!ok) return
    await flush()
    setBusy(kind)
    const r = await campfireApi.rest(ch.id, kind)
    setBusy(null)
    if (r.ok) {
      haptic.medium()
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
    await reload()
  }

  // Damage / Heal / Temp: through your token when it's on the map (so the table sees the bump,
  // and the server works out temp HP, death saves and concentration), otherwise on the sheet.
  const amountN = Math.max(0, Math.min(9999, Number.parseInt(amount, 10) || 0))
  const concentrationPrompt = async (taken: number, name: string) => {
    const dc = concentrationDc(taken)
    const ok = await confirm({ title: `Keep concentrating on ${name}?`, message: `Roll a Constitution saving throw, DC ${dc}.`, confirmLabel: 'Roll the save', cancelLabel: 'Not now' })
    if (ok) await rollD20(saveBonus(s, 'con'), `Concentration (DC ${dc})`)
  }
  const hurt = async () => {
    if (!amountN) return void inform('How much?', 'Type the amount first, then tap Damage or Heal.')
    const conc = s.concentration
    await flush()
    setBusy('damage')
    if (token) {
      const r = await campfireApi.damageToken(token.id, amountN)
      if (!r.ok) {
        setBusy(null)
        return void inform("Couldn't take the damage", r.message)
      }
      await reload()
    } else {
      edit((x) => {
        const wasDown = x.hp.current <= 0
        const out = applyDamage(x.hp.current, x.hp.temp, amountN, damageModsFor(x, null))
        x.hp = { ...x.hp, current: out.hp, temp: out.temp }
        if (out.hp <= 0 && !x.conditions.includes('unconscious')) x.conditions = [...x.conditions, 'unconscious']
        if (wasDown && amountN > 0) x.deathSaves = deathSaveFailures(x.deathSaves, 1).state
        return x
      }, true)
    }
    setBusy(null)
    haptic.medium()
    setAmount('')
    if (conc) void concentrationPrompt(amountN, conc)
  }
  const healUp = async () => {
    if (!amountN) return void inform('How much?', 'Type the amount first, then tap Damage or Heal.')
    await flush()
    setBusy('heal')
    if (token) {
      const r = await campfireApi.healToken(token.id, amountN)
      if (!r.ok) {
        setBusy(null)
        return void inform("Couldn't heal", r.message)
      }
      await reload()
    } else {
      edit((x) => {
        if (x.deathSaves.dead) return x
        const wasDown = x.hp.current <= 0
        x.hp = { ...x.hp, current: heal(x.hp.current, x.hp.max, amountN) }
        if (wasDown && x.hp.current > 0) {
          x.deathSaves = { successes: 0, failures: 0, stable: false, dead: false }
          x.conditions = x.conditions.filter((c) => c !== 'unconscious')
        }
        return x
      }, true)
    }
    setBusy(null)
    haptic.light()
    setAmount('')
  }
  const setTemp = () => {
    if (!amountN) return void inform('How much?', 'Type the temporary hit points first, then tap Temp. (They don’t stack: the bigger number stays.)')
    edit((x) => ({ ...x, hp: { ...x.hp, temp: Math.max(x.hp.temp, amountN) } }), true)
    setAmount('')
  }

  const endConcentration = async () => {
    if (!s.concentration) return
    const ok = await confirm({ title: `Stop concentrating on ${s.concentration}?`, confirmLabel: 'Stop concentrating' })
    if (ok) edit((x) => ({ ...x, concentration: null }), true)
  }

  const rollInitiative = async () => {
    const entry = combat && token ? combat.entries.find((e) => e.tokenId === token.id) : undefined
    if (entry && entry.init === null && mode === 'normal') {
      const r = await campfireApi.combat(campaignId, { op: 'roll', tokenId: token!.id })
      if (!r.ok) void inform("Couldn't roll initiative", r.message)
      return
    }
    await rollD20(initiativeBonus(s), 'Initiative')
  }

  const hp = s.hp
  const down = hp.current <= 0
  const extras = s as Sheet5e & SheetExtras

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to the table" onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/campfire/[id]', params: { id: campaignId } }))} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: fire.card, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="chevronLeft" size={20} color={fire.ink} />
      </Pressable>
      <Portrait fileId={ch.portraitFileId} name={ch.name} size={48} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text accessibilityRole="header" numberOfLines={1} style={{ fontFamily: 'Outfit_700Bold', fontSize: 19, lineHeight: 22, color: fire.ink }}>
          {ch.name}
        </Text>
        <Text size={12} numberOfLines={1} style={{ color: fire.muted }}>
          {[s.race, classLine(s)].filter(Boolean).join(' · ') || 'Add a race and class with Edit'}
        </Text>
      </View>
      {saving ? <ActivityIndicator color={fire.muted} accessibilityLabel="Saving" /> : null}
      <FireButton label={editing ? 'Done' : 'Edit'} kind={editing ? 'primary' : 'card'} height={44} size={13} style={{ paddingHorizontal: 12, borderRadius: 12 }} a11y={editing ? 'Done editing' : 'Edit the sheet'} onPress={() => setEditing((e) => !e)} />
    </View>
  )

  const top: ReactNode[] = []
  top.push(
    <View key="hp" style={{ gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: fire.panel, borderWidth: 1, borderColor: fire.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }} accessible accessibilityLabel={`Hit points ${hp.current} of ${hp.max}${hp.temp ? `, plus ${hp.temp} temporary` : ''}`}>
        <Text size={12} style={{ flex: 1, color: fire.muted }}>
          Hit points
        </Text>
        <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 24, lineHeight: 26, color: down ? fire.redText : fire.ink }}>{hp.current}</Text>
        <Text size={14} style={{ color: fire.muted }}>
          / {hp.max}
        </Text>
        {hp.temp ? (
          <View style={{ marginLeft: 4, paddingVertical: 3, paddingHorizontal: 7, borderRadius: 999, backgroundColor: fire.tempSoft }}>
            <Text size={11} weight="bold" style={{ color: fire.tempText }}>
              +{hp.temp}
            </Text>
          </View>
        ) : null}
      </View>
      <HpBar current={hp.current} max={hp.max} temp={hp.temp} still={still} />
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <TextInput
          value={amount}
          onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, '').slice(0, 4))}
          placeholder="0"
          placeholderTextColor={fire.muted}
          keyboardType="number-pad"
          accessibilityLabel="Amount of damage or healing"
          returnKeyType="done"
          style={[{ width: 64, height: 48, paddingHorizontal: 10, borderRadius: 12, backgroundColor: fire.well, borderWidth: 1, borderColor: fire.line, color: fire.ink, fontSize: 17, fontFamily: 'DMSans_700Bold', textAlign: 'center' }, webNoOutline]}
        />
        <HpButton label="Damage" a11y={amountN ? `Take ${amountN} damage` : 'Damage'} bg={fire.hurtSoft} fg={fire.hurtText} busy={busy === 'damage'} onPress={() => void hurt()} />
        <HpButton label="Heal" a11y={amountN ? `Heal ${amountN}` : 'Heal'} bg={fire.healSoft} fg={fire.healText} busy={busy === 'heal'} onPress={() => void healUp()} />
        <HpButton label="Temp" a11y={amountN ? `Set ${amountN} temporary hit points` : 'Temporary hit points'} bg={fire.tempSoft} fg={fire.tempText} narrow onPress={setTemp} />
      </View>
    </View>,
  )
  if (down) {
    top.push(<DeathSaves key="death" s={s} busy={busy === 'death'} big onRoll={() => void deathSave()} />)
  }
  top.push(
    <View key="pills" style={{ flexDirection: 'row', gap: 8 }}>
      <Pill value={String(s.ac)} label="AC" a11y={`Armor class ${s.ac}`} />
      <Pill value={signed(initiativeBonus(s))} label="Init" a11y={`Initiative ${signed(initiativeBonus(s))}. Roll it`} onPress={() => void rollInitiative()} />
      <Pill value={String(s.speed)} label="Speed" a11y={`Speed ${s.speed} feet`} />
    </View>,
  )
  if (s.concentration) {
    top.push(
      <Pressable
        key="conc"
        accessibilityRole="button"
        accessibilityLabel={`Concentrating on ${s.concentration}. Tap to stop concentrating`}
        onPress={() => void endConcentration()}
        style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: fire.concSoft, borderWidth: 1, borderColor: fire.concLine, opacity: pressed ? 0.85 : 1 })}
      >
        <ConcIcon color={fire.conc} />
        <Text size={13} numberOfLines={1} style={{ flex: 1, color: fire.ink }}>
          <Text size={13} weight="bold" style={{ color: fire.ink }}>
            {s.concentration}
          </Text>
          <Text size={13} style={{ color: fire.muted }}>
            {'  · concentrating'}
          </Text>
        </Text>
        <Text size={12} weight="bold" style={{ color: fire.conc }}>
          End
        </Text>
      </Pressable>,
    )
  }
  const tabsIndex = top.length
  top.push(
    <View key="tabs" style={{ backgroundColor: fire.bg, paddingVertical: 4, gap: 8 }}>
      <SheetTabs tabs={TABS} value={tab} onChange={setTab} />
      {tab !== 'more' ? <RollModeSwitch mode={mode} onChange={setMode} /> : null}
    </View>,
  )

  let body: ReactNode
  if (tab === 'overview') {
    body = (
      <Overview
        s={s}
        editing={editing}
        onRoll={rollD20}
        onEdit={edit}
        basics={editing ? <Basics s={s} locked={locked} ddbUrl={ch.ddbUrl} onSheet={(x) => save({ sheet: x })} onDdb={(v) => save({ ddbUrl: v || null })} name={ch.name} onName={(v) => save({ name: v })} /> : null}
        deathSaves={!down && (s.deathSaves.successes || s.deathSaves.failures || s.deathSaves.stable) ? <DeathSaves s={s} busy={false} onRoll={() => void deathSave()} /> : null}
      />
    )
  } else if (tab === 'actions') {
    body = <Actions s={s} editing={editing} mode={mode} roll={roll} onEdit={edit} extras={extras} />
  } else if (tab === 'spells') {
    body = <Spells s={s} mode={mode} roll={roll} onEdit={edit} />
  } else {
    body = <More ch={ch} editing={editing} busyPortrait={busy === 'portrait'} onPortrait={() => void changePortrait()} onEdit={edit} />
  }

  return (
    <View style={{ flex: 1, backgroundColor: fire.bg }}>
      {header}
      <ScrollView stickyHeaderIndices={[tabsIndex]} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        {top}
        <Animated.View key={tab} entering={still ? undefined : FadeIn.duration(160)} style={{ gap: 12 }}>
          {body}
          {locked ? (
            <Text size={12} style={{ color: fire.muted }}>
              The game master locked your armor class and hit point maximum.
            </Text>
          ) : null}
        </Animated.View>
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, paddingTop: 12, paddingHorizontal: 16, paddingBottom: insets.bottom + 14, borderTopWidth: 1, borderTopColor: fire.line, backgroundColor: fire.panel }}>
        <FireButton label="Short rest" busy={busy === 'short'} style={{ flex: 1 }} size={14} onPress={() => void rest('short')} />
        <FireButton label="Long rest" busy={busy === 'long'} style={{ flex: 1 }} size={14} onPress={() => void rest('long')} />
      </View>
    </View>
  )
}

// ───────────── Tabs ─────────────

function Overview({ s, editing, onRoll, onEdit, basics, deathSaves }: { s: Sheet5e; editing: boolean; onRoll: (bonus: number, label: string) => unknown; onEdit: (fn: (x: Sheet5e) => Sheet5e, now?: boolean) => void; basics: ReactNode; deathSaves: ReactNode }) {
  const fire = useFire()
  const [allConditions, setAllConditions] = useState(false)
  const shownConditions = allConditions ? CONDITIONS.filter((c) => c.id !== 'exhaustion') : CONDITIONS.filter((c) => s.conditions.includes(c.id))
  return (
    <>
      {basics}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ABILITIES.map((a) => (
          <Pressable
            key={a}
            accessibilityRole="button"
            accessibilityLabel={`${ABILITY_NAMES[a]} ${s.abilities[a]}, ${signed(abilityMod(s.abilities[a]))}. Roll a check`}
            onPress={() => void onRoll(abilityMod(s.abilities[a]), `${ABILITY_NAMES[a]} check`)}
            style={({ pressed }) => ({ width: '31%', flexGrow: 1, alignItems: 'center', gap: 4, paddingTop: 10, paddingBottom: 8, paddingHorizontal: 4, borderRadius: 12, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line, opacity: pressed ? 0.8 : 1 })}
          >
            <Text size={11} weight="bold" style={{ color: fire.muted, letterSpacing: 0.9 }}>
              {a.toUpperCase()}
            </Text>
            <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 26, lineHeight: 28, color: fire.ink }}>{signed(abilityMod(s.abilities[a]))}</Text>
            <View style={{ minWidth: 34, paddingVertical: 3, borderRadius: 999, backgroundColor: fire.well, alignItems: 'center' }}>
              <Text size={12} style={{ color: fire.muted }}>
                {s.abilities[a]}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      <SubHead title="Saving throws" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8 }}>
        {ABILITIES.map((a) => (
          <SkillRow key={a} half label={ABILITY_NAMES[a]} prof={s.saves[a] ? 1 : 0} bonus={saveBonus(s, a)} onPress={() => void onRoll(saveBonus(s, a), `${ABILITY_NAMES[a]} save`)} />
        ))}
      </View>

      <SubHead title="Skills" right={editing ? 'Long-press to change proficiency' : undefined} />
      <View>
        {SKILL_IDS.map((k) => (
          <SkillRow
            key={k}
            label={SKILLS[k].name}
            sub={SKILLS[k].ability.toUpperCase()}
            prof={s.skills[k] ?? 0}
            bonus={skillBonus(s, k)}
            onPress={() => void onRoll(skillBonus(s, k), `${SKILLS[k].name} check`)}
            onLongPress={editing ? () => onEdit((x) => ({ ...x, skills: { ...x.skills, [k]: (((x.skills[k] ?? 0) + 1) % 3) as 0 | 1 | 2 } })) : undefined}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }} accessible accessibilityLabel="Proficiency key: filled dot proficient, ringed dot expertise">
        <Legend prof={1} label="Proficient" />
        <Legend prof={2} label="Expertise" />
      </View>

      <SubHead title="Passive senses" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pill value={String(passivePerception(s))} label="Perception" a11y={`Passive Perception ${passivePerception(s)}`} small />
        <Pill value={String(10 + skillBonus(s, 'investigation'))} label="Investigation" a11y={`Passive Investigation ${10 + skillBonus(s, 'investigation')}`} small />
        <Pill value={String(10 + skillBonus(s, 'insight'))} label="Insight" a11y={`Passive Insight ${10 + skillBonus(s, 'insight')}`} small />
      </View>

      <SubHead title="Conditions" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {shownConditions.length === 0 ? (
          <Text size={13} style={{ color: fire.muted, paddingVertical: 4 }}>
            None right now.
          </Text>
        ) : null}
        {shownConditions.map((c) => {
          const on = s.conditions.includes(c.id)
          return (
            <Pressable
              key={c.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={c.name}
              onPress={() => onEdit((x) => ({ ...x, conditions: on ? x.conditions.filter((y) => y !== c.id) : [...x.conditions, c.id as ConditionId] }))}
              style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 22, justifyContent: 'center', backgroundColor: on ? fire.amberSoft : fire.card, borderWidth: 1, borderColor: on ? fire.amber : fire.line }}
            >
              <Text size={13} weight="bold" style={{ color: on ? fire.amber : fire.ink }}>
                {c.name}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <FireButton label={allConditions ? 'Done' : 'Add or remove a condition'} kind="quiet" height={44} size={13} style={{ alignSelf: 'flex-start', paddingHorizontal: 10 }} onPress={() => setAllConditions((v) => !v)} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text size={13} style={{ flex: 1, color: fire.ink }}>
          Exhaustion: {s.exhaustion ? `level ${s.exhaustion}` : 'none'}
          {s.exhaustion ? <Text size={12} style={{ color: fire.muted }}>{`  ${EXHAUSTION_LEVELS[s.exhaustion - 1] ?? ''}`}</Text> : null}
        </Text>
        <Round icon="minus" label="Less exhaustion" disabled={s.exhaustion <= 0} onPress={() => onEdit((x) => ({ ...x, exhaustion: Math.max(0, x.exhaustion - 1) }))} />
        <Round icon="plus" label="More exhaustion" disabled={s.exhaustion >= 6} onPress={() => onEdit((x) => ({ ...x, exhaustion: Math.min(6, x.exhaustion + 1) }))} />
      </View>
      {deathSaves}
      <Text size={12} style={{ color: fire.muted }}>
        Tap an ability, save or skill to roll it at the table.
      </Text>
    </>
  )
}

function Actions({ s, editing, mode, roll, onEdit, extras }: { s: Sheet5e; editing: boolean; mode: RollMode; roll: (e: string, l: string) => Promise<boolean>; onEdit: (fn: (x: Sheet5e) => Sheet5e, now?: boolean) => void; extras: SheetExtras }) {
  const fire = useFire()
  return (
    <>
      <SubHead title="Attacks" />
      <Text size={12} style={{ color: fire.muted }}>
        Tap the to-hit number, then the damage. To attack a creature, pick it on the map first and use the actions there (the game master&apos;s numbers stay hidden).
      </Text>
      {s.attacks.length === 0 && !editing ? (
        <Text size={13} style={{ color: fire.muted }}>
          No attacks yet. Add your weapons and attack spells with Edit.
        </Text>
      ) : null}
      {withTwoHanded(s.attacks).map((a) => {
        const ex = attackExpressions(s, a)
        const toHit = attackToHit(s, a)
        return (
          <View key={a.id} style={{ gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: fire.card }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text size={14} weight="bold" numberOfLines={1} style={{ color: fire.ink }}>
                  {a.name}
                </Text>
                <Text size={12} numberOfLines={1} style={{ color: fire.muted }}>
                  {[a.kind === 'spell' ? 'Spell' : a.kind === 'ranged' ? 'Ranged' : 'Melee', a.range].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Roll ${a.name} to hit, ${signed(toHit)}${mode === 'adv' ? ', with advantage' : mode === 'dis' ? ', with disadvantage' : ''}`}
                onPress={() => void roll(withMode(ex.toHit, mode), modeLabel(`${a.name}: to hit`, mode))}
                style={({ pressed }) => ({ width: 64, height: 44, borderRadius: 10, borderWidth: 1, borderColor: fire.amberLine, backgroundColor: fire.amberSoft, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
              >
                <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 16, color: fire.amber }}>{signed(toHit)}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Roll ${a.name} damage, ${ex.damage} ${a.damageType}`}
                onPress={() => void roll(ex.damage, `${a.name}: damage`)}
                style={({ pressed }) => ({ minWidth: 92, height: 44, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: fire.line, backgroundColor: fire.well, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
              >
                <Text size={14} weight="bold" numberOfLines={1} style={{ color: fire.ink }}>
                  {ex.damage}
                </Text>
                <Text size={11} numberOfLines={1} style={{ color: fire.muted }}>
                  {a.damageType}
                </Text>
              </Pressable>
              {editing && !a.virtual ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${a.name}`} onPress={() => onEdit((x) => ({ ...x, attacks: x.attacks.filter((y) => y.id !== a.id) }))} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="trash" size={18} color={fire.redText} />
                </Pressable>
              ) : null}
            </View>
            {a.notes ? (
              <Text size={12} style={{ color: fire.muted }}>
                {a.notes}
              </Text>
            ) : null}
          </View>
        )
      })}
      {editing ? <AddAttack onAdd={(a) => onEdit((x) => ({ ...x, attacks: [...x.attacks, a] }))} /> : null}

      <SubHead title="Class resources" />
      {s.hitDice.map((h, i) => (
        <Counter
          key={`hd${h.die}`}
          label={`Hit dice · d${h.die}`}
          sub="short rest: spend to heal"
          used={h.used}
          max={h.max}
          onChange={(used) => onEdit((x) => ({ ...x, hitDice: x.hitDice.map((y, j) => (j === i ? { ...y, used } : y)) }))}
          onSpend={() => void roll(withBonus(`1d${h.die}`, abilityMod(s.abilities.con)), `Hit die (d${h.die})`)}
        />
      ))}
      {s.resources.map((r) => (
        <Counter key={r.id} label={r.name} sub={r.reset !== 'none' ? `${r.reset} rest` : undefined} used={r.used} max={r.max} onChange={(used) => onEdit((x) => ({ ...x, resources: x.resources.map((y) => (y.id === r.id ? { ...y, used } : y)) }))} />
      ))}
      {typeof extras.inspiration === 'boolean' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 }}>
          <Text size={13} weight="bold" style={{ flex: 1, color: fire.ink }}>
            Inspiration
          </Text>
          <Text size={13} style={{ color: extras.inspiration ? fire.amber : fire.muted }}>
            {extras.inspiration ? '● ready' : '○ none'}
          </Text>
        </View>
      ) : null}
      {s.hitDice.length === 0 && s.resources.length === 0 ? (
        <Text size={13} style={{ color: fire.muted }}>
          No class resources on this sheet.
        </Text>
      ) : null}
    </>
  )
}

function Spells({ s, mode, roll, onEdit }: { s: Sheet5e; mode: RollMode; roll: (e: string, l: string) => Promise<boolean>; onEdit: (fn: (x: Sheet5e) => Sheet5e, now?: boolean) => void }) {
  const fire = useFire()
  const sc = s.spellcasting
  const srd = useSrdSpells(sc.spells)
  const [open, setOpen] = useState<string | null>(null)
  const dc = spellSaveDc(s)
  const atk = spellAttackBonus(s)
  const mod = sc.ability ? abilityMod(s.abilities[sc.ability]) : 0
  const slots = sc.slots.map((x, i) => ({ ...x, level: i + 1 })).filter((x) => x.max > 0)
  const level = Math.max(1, totalLevel(s))

  if (!sc.ability && !slots.length && !sc.spells.length && !sc.pact) {
    return (
      <Text size={13} style={{ color: fire.muted }}>
        This character doesn&apos;t cast spells. Spellcasters get their slots from their class level.
      </Text>
    )
  }

  const spend = (slotLevel: number, used: number) =>
    onEdit((x) => {
      x.spellcasting.slots = x.spellcasting.slots.map((z, i) => (i === slotLevel - 1 ? { ...z, used: Math.max(0, Math.min(z.max, used)) } : z))
      return x
    }, true)

  const cast = async (sp: SheetSpell) => {
    const info = srd[sp.name]
    const ext = sp as SheetSpell & SpellExtras
    const conc = ext.concentration ?? info?.concentration ?? false
    let at = sp.level
    let usePact = false
    if (sp.level > 0) {
      const options = slots.filter((x) => x.level >= sp.level && x.used < x.max)
      const pactOk = !!sc.pact && sc.pact.level >= sp.level && sc.pact.used < sc.pact.max
      if (!options.length && !pactOk) return void inform(`No slots left for ${sp.name}`, `You have no level ${sp.level} or higher spell slots left. A long rest brings them back.`)
      if (options.length + (pactOk ? 1 : 0) > 1) {
        const pick = await chooseFrom(
          [...options.map((o) => ({ key: `s${o.level}`, label: `Level ${o.level} slot`, detail: `${o.max - o.used} of ${o.max} left` })), ...(pactOk ? [{ key: 'pact', label: `Pact slot (level ${sc.pact!.level})`, detail: `${sc.pact!.max - sc.pact!.used} of ${sc.pact!.max} left` }] : [])],
          `Cast ${sp.name} with`,
        )
        if (!pick) return
        if (pick === 'pact') usePact = true
        else at = Number(pick.slice(1))
      } else if (pactOk && !options.length) usePact = true
      else at = options[0].level
      if (usePact) at = sc.pact!.level
    }
    if (conc && s.concentration && s.concentration !== sp.name) {
      const ok = await confirm({ title: `Stop concentrating on ${s.concentration}?`, message: `${sp.name} needs your concentration too. Casting it ends ${s.concentration}.`, confirmLabel: `Cast ${sp.name}` })
      if (!ok) return
    }
    onEdit((x) => {
      if (sp.level > 0) {
        if (usePact && x.spellcasting.pact) x.spellcasting.pact = { ...x.spellcasting.pact, used: x.spellcasting.pact.used + 1 }
        else x.spellcasting.slots = x.spellcasting.slots.map((z, i) => (i === at - 1 ? { ...z, used: Math.min(z.max, z.used + 1) } : z))
      }
      if (conc) x.concentration = sp.name
      return x
    }, true)
    haptic.light()
    const dice = spellDice(info, at, level, mod)
    if (info?.attack) {
      const ok = await roll(withMode(withBonus('1d20', atk), mode), modeLabel(`${sp.name}: spell attack`, mode))
      if (ok && dice) await roll(dice.expr, `${sp.name}: damage`)
    } else if (dice) {
      await roll(dice.expr, `${sp.name}: ${dice.heal ? 'healing' : 'damage'}`)
    }
  }

  const byLevel = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => ({ lv, spells: sc.spells.filter((sp) => sp.level === lv) })).filter((g) => g.spells.length)

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pill value={signed(atk)} label="Spell attack" a11y={`Spell attack ${signed(atk)}. Roll it`} small onPress={() => void roll(withMode(withBonus('1d20', atk), mode), modeLabel('Spell attack', mode))} />
        <Pill value={String(dc)} label="Save DC" a11y={`Spell save DC ${dc}`} small />
        <Pill value={sc.ability ? sc.ability.toUpperCase() : '—'} label="Ability" a11y={`Spellcasting ability ${sc.ability ? ABILITY_NAMES[sc.ability] : 'none'}`} small />
      </View>

      {slots.length || sc.pact ? <SubHead title="Spell slots" right="Tap a pip to spend or get it back" /> : null}
      {slots.map((sl) => (
        <View key={sl.level} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text size={13} weight="bold" style={{ width: 62, color: fire.muted }}>
            Level {sl.level}
          </Text>
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap' }}>
            {Array.from({ length: sl.max }, (_, i) => {
              const used = i >= sl.max - sl.used
              return (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityLabel={`Level ${sl.level} slot ${i + 1}, ${used ? 'used. Get it back' : 'ready. Spend it'}`}
                  onPress={() => spend(sl.level, used ? sl.used - 1 : sl.used + 1)}
                  style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: fire.amber, backgroundColor: used ? 'transparent' : fire.amber }} />
                </Pressable>
              )
            })}
          </View>
          <Text size={12} style={{ color: fire.muted }}>
            {sl.max - sl.used} of {sl.max} left
          </Text>
        </View>
      ))}
      {sc.pact ? (
        <Counter label={`Pact slots · level ${sc.pact.level}`} sub="short rest" used={sc.pact.used} max={sc.pact.max} onChange={(used) => onEdit((x) => ({ ...x, spellcasting: { ...x.spellcasting, pact: x.spellcasting.pact ? { ...x.spellcasting.pact, used } : null } }), true)} />
      ) : null}

      <SubHead title="Spells" />
      {byLevel.length === 0 ? (
        <Text size={13} style={{ color: fire.muted }}>
          No spells on this sheet yet.
        </Text>
      ) : null}
      {byLevel.map((g) => (
        <View key={g.lv} style={{ gap: 6 }}>
          <Text size={12} weight="bold" style={{ color: fire.muted, letterSpacing: 0.6 }}>
            {g.lv === 0 ? 'CANTRIPS' : `LEVEL ${g.lv}`}
          </Text>
          {g.spells.map((sp) => {
            const info = srd[sp.name]
            const ext = sp as SheetSpell & SpellExtras
            const conc = ext.concentration ?? info?.concentration ?? false
            const sub = [ext.castingTime ?? info?.castingTime, ext.range ?? info?.range, ext.duration ?? info?.duration].filter(Boolean).join(' · ')
            const dice = spellDice(info, sp.level, level, mod)
            const off = sp.level > 0 && !sp.prepared
            const key = `${sp.level}:${sp.name}`
            const isOpen = open === key
            return (
              <View key={key} style={{ gap: 8, paddingVertical: 10, paddingLeft: 10, paddingRight: 10, borderRadius: 12, backgroundColor: fire.card, opacity: off ? 0.6 : 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: fire.well, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
                    <Text size={12} weight="bold" style={{ color: fire.amber }}>
                      {sp.level === 0 ? 'C' : sp.level}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${sp.name}${sp.level ? `, level ${sp.level}` : ', cantrip'}${conc ? ', concentration' : ''}${off ? ', not prepared' : ''}${sub ? `, ${sub}` : ''}. ${isOpen ? 'Hide' : 'Show'} the description`}
                    accessibilityState={{ expanded: isOpen }}
                    onPress={() => setOpen(isOpen ? null : key)}
                    style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', gap: 2 }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text size={14} weight="bold" style={{ color: fire.ink }}>
                        {sp.name}
                      </Text>
                      {conc ? (
                        <View style={{ paddingVertical: 2, paddingHorizontal: 6, borderRadius: 999, backgroundColor: fire.concSoft, borderWidth: 1, borderColor: fire.concLine }}>
                          <Text size={10} weight="bold" style={{ color: fire.conc }}>
                            Concentration
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text size={12} numberOfLines={1} style={{ color: fire.muted }}>
                      {off ? 'Not prepared' : sub || (info === undefined ? ' ' : 'Your own spell')}
                    </Text>
                  </Pressable>
                  {off ? null : (
                    <FireButton
                      label={dice ? `Cast · ${dice.expr}` : 'Cast'}
                      a11y={`Cast ${sp.name}${dice ? `, rolls ${dice.expr}` : ''}`}
                      kind="amber"
                      height={44}
                      size={13}
                      style={{ paddingHorizontal: 12, borderRadius: 10, borderColor: fire.amberLine }}
                      onPress={() => void cast(sp)}
                    />
                  )}
                </View>
                {isOpen ? (
                  <Text size={13} style={{ color: fire.muted, lineHeight: 19 }}>
                    {info ? `${info.desc}${info.higherLevel ? `\n\n${info.higherLevel}` : ''}` : ext.notes || 'No description for this spell.'}
                  </Text>
                ) : null}
              </View>
            )
          })}
        </View>
      ))}
      <Text size={11} style={{ color: fire.muted }}>
        {creditFor(s.rules ?? '2014')}
      </Text>
    </>
  )
}

function More({ ch, editing, busyPortrait, onPortrait, onEdit }: { ch: Character; editing: boolean; busyPortrait: boolean; onPortrait: () => void; onEdit: (fn: (x: Sheet5e) => Sheet5e, now?: boolean) => void }) {
  const fire = useFire()
  const s = ch.sheet
  const [item, setItem] = useState('')
  const [feat, setFeat] = useState('')
  const [featText, setFeatText] = useState('')
  const id = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 14, backgroundColor: fire.panel, borderWidth: 1, borderColor: fire.line }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Change ${ch.name}'s portrait`} onPress={onPortrait} style={{ width: 64, height: 64 }}>
          <Portrait fileId={ch.portraitFileId} name={ch.name} size={64} />
          <View style={{ position: 'absolute', right: -4, bottom: -4, width: 28, height: 28, borderRadius: 14, backgroundColor: fire.accent, borderWidth: 2, borderColor: fire.panel, alignItems: 'center', justifyContent: 'center' }}>
            {busyPortrait ? <ActivityIndicator size="small" color={fire.accentInk} /> : <Icon name="camera" size={14} color={fire.accentInk} />}
          </View>
        </Pressable>
        <View style={{ flex: 1, gap: 6 }}>
          <Text size={13} style={{ color: fire.muted }}>
            Your portrait shows on your token, in the turn order and on your rolls.
          </Text>
          <FireButton label="Change portrait" height={44} size={13} style={{ alignSelf: 'flex-start' }} onPress={onPortrait} />
        </View>
      </View>

      {ch.ddbUrl ? (
        <Pressable accessibilityRole="link" accessibilityLabel="Open the D&D Beyond sheet in the browser" onPress={() => void Linking.openURL(ch.ddbUrl!)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: fire.card }}>
          <Icon name="link" size={16} color={fire.amber} />
          <Text size={14} weight="bold" style={{ flex: 1, color: fire.amber }}>
            D&amp;D Beyond sheet ↗
          </Text>
        </Pressable>
      ) : (
        <Text size={12} style={{ color: fire.muted }}>
          Have a D&amp;D Beyond sheet? Add its link with Edit on the Overview (it only opens there; nothing is imported).
        </Text>
      )}

      <SubHead title="Features" />
      {s.features.length === 0 ? (
        <Text size={13} style={{ color: fire.muted }}>
          No features yet.
        </Text>
      ) : null}
      {s.features.map((f) => (
        <View key={f.id} style={{ flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12, backgroundColor: fire.card }}>
          <Text size={13} style={{ flex: 1, color: fire.muted, lineHeight: 19 }}>
            <Text size={13} weight="bold" style={{ color: fire.ink }}>
              {f.name}.{' '}
            </Text>
            {f.text}
          </Text>
          {editing ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`} onPress={() => onEdit((x) => ({ ...x, features: x.features.filter((y) => y.id !== f.id) }))} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="trash" size={18} color={fire.redText} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {editing ? (
        <View style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: fire.line }}>
          <Field label="Feature name" value={feat} onChange={setFeat} placeholder="Favored Enemy" />
          <Field label="What it does" value={featText} onChange={setFeatText} placeholder="Advantage on Survival checks to track…" />
          <FireButton label="Add feature" icon="plus" height={44} size={13} onPress={() => {
            if (!feat.trim()) return
            onEdit((x) => ({ ...x, features: [...x.features, { id: id(), name: feat.trim(), text: featText.trim() }] }), true)
            setFeat('')
            setFeatText('')
          }} />
        </View>
      ) : null}

      <SubHead title="Inventory" />
      {s.inventory.length === 0 ? (
        <Text size={13} style={{ color: fire.muted }}>
          Nothing carried yet.
        </Text>
      ) : null}
      {s.inventory.map((it) => (
        <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: fire.card }}>
          <Text size={14} style={{ flex: 1, color: fire.ink }} numberOfLines={2}>
            {it.name}
            {it.notes ? <Text size={12} style={{ color: fire.muted }}>{`  ${it.notes}`}</Text> : null}
          </Text>
          {editing ? (
            <>
              <Round icon="minus" label={`One fewer ${it.name}`} onPress={() => onEdit((x) => ({ ...x, inventory: it.qty <= 1 ? x.inventory.filter((y) => y.id !== it.id) : x.inventory.map((y) => (y.id === it.id ? { ...y, qty: y.qty - 1 } : y)) }))} />
              <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 15, color: fire.ink, minWidth: 24, textAlign: 'center' }}>{it.qty}</Text>
              <Round icon="plus" label={`One more ${it.name}`} onPress={() => onEdit((x) => ({ ...x, inventory: x.inventory.map((y) => (y.id === it.id ? { ...y, qty: y.qty + 1 } : y)) }))} />
            </>
          ) : it.qty > 1 ? (
            <Text size={13} weight="bold" style={{ color: fire.muted }}>
              ×{it.qty}
            </Text>
          ) : null}
        </View>
      ))}
      {editing ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field label="Add an item" value={item} onChange={setItem} placeholder="Rope (50 ft)" />
          </View>
          <FireButton label="Add" icon="plus" height={44} size={13} a11y="Add the item" onPress={() => {
            if (!item.trim()) return
            onEdit((x) => ({ ...x, inventory: [...x.inventory, { id: id(), name: item.trim(), qty: 1, notes: '' }] }), true)
            setItem('')
          }} />
        </View>
      ) : null}

      <SubHead title="Notes" />
      {editing ? (
        <TextInput
          value={s.notes}
          onChangeText={(v) => onEdit((x) => ({ ...x, notes: v }))}
          multiline
          placeholder="Allies, secrets, the name of that innkeeper…"
          placeholderTextColor={fire.muted}
          accessibilityLabel="Notes"
          style={[{ minHeight: 120, padding: 12, borderRadius: 12, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line, color: fire.ink, fontSize: 14, fontFamily: 'DMSans_400Regular', textAlignVertical: 'top' }, webNoOutline]}
        />
      ) : (
        <Text size={13} style={{ color: s.notes ? fire.ink : fire.muted, lineHeight: 19 }}>
          {s.notes || 'No notes yet. Write some with Edit.'}
        </Text>
      )}
    </>
  )
}

// ───────────── Pieces ─────────────

export function Portrait({ fileId, name, size }: { fileId: string | null; name: string; size: number }) {
  const fire = useFire()
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: fire.greenDeep, borderWidth: 3, borderColor: fire.green, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {fileId ? <Image source={fileSource(fileId)} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: Math.round(size * 0.38), color: '#fff' }}>{initialOf(name)}</Text>}
    </View>
  )
}

/** HP as a share of the maximum, with temp HP as a blue segment after it (SheetPhone board). */
function HpBar({ current, max, temp, still }: { current: number; max: number; temp: number; still: boolean }) {
  const fire = useFire()
  const total = Math.max(1, max)
  const hpPct = Math.max(0, Math.min(1, current / total))
  const tempPct = Math.max(0, Math.min(1 - hpPct, temp / total))
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: fire.track, overflow: 'hidden', flexDirection: 'row' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View layout={still ? undefined : LinearTransition.duration(260)} style={{ width: `${hpPct * 100}%`, backgroundColor: hpColor(fire, current, max) }} />
      <Animated.View layout={still ? undefined : LinearTransition.duration(260)} style={{ width: `${tempPct * 100}%`, backgroundColor: fire.temp }} />
    </View>
  )
}

function HpButton({ label, a11y, bg, fg, onPress, busy, narrow }: { label: string; a11y: string; bg: string; fg: string; onPress: () => void; busy?: boolean; narrow?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ busy: !!busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({ flex: narrow ? undefined : 1, width: narrow ? 60 : undefined, height: 48, borderRadius: 12, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text size={14} weight="bold" style={{ color: fg }}>
          {label}
        </Text>
      )}
    </Pressable>
  )
}

function Pill({ value, label, a11y, onPress, small }: { value: string; label: string; a11y: string; onPress?: () => void; small?: boolean }) {
  const fire = useFire()
  const inner = (
    <>
      <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: small ? 18 : 22, lineHeight: small ? 20 : 24, color: fire.ink }}>{value}</Text>
      <Text size={12} numberOfLines={1} style={{ color: fire.muted }}>
        {label}
      </Text>
    </>
  )
  const style = { flex: 1, minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 4, paddingVertical: small ? 10 : 12, paddingHorizontal: 6, borderRadius: 14, backgroundColor: fire.panel, borderWidth: 1, borderColor: onPress ? fire.amberLine : fire.line }
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={({ pressed }) => [style, { opacity: pressed ? 0.8 : 1 }]}>
      {inner}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={a11y} style={style}>
      {inner}
    </View>
  )
}

function SubHead({ title, right }: { title: string; right?: string }) {
  const fire = useFire()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
      <Text accessibilityRole="header" style={{ flex: 1, fontFamily: 'Outfit_700Bold', fontSize: 15, color: fire.ink }}>
        {title}
      </Text>
      {right ? (
        <Text size={11} style={{ color: fire.muted }}>
          {right}
        </Text>
      ) : null}
    </View>
  )
}

function ProfDot({ prof }: { prof: number }) {
  const fire = useFire()
  if (prof === 2) {
    return (
      <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: fire.accent, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fire.accent }} />
      </View>
    )
  }
  return <View style={{ width: 12, height: 12, margin: 1, borderRadius: 6, borderWidth: prof ? 0 : 2, borderColor: fire.muted, backgroundColor: prof ? fire.accent : 'transparent' }} />
}

function Legend({ prof, label }: { prof: number; label: string }) {
  const fire = useFire()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <ProfDot prof={prof} />
      <Text size={11} style={{ color: fire.muted }}>
        {label}
      </Text>
    </View>
  )
}

function SkillRow({ label, sub, prof, bonus, onPress, onLongPress, half }: { label: string; sub?: string; prof: number; bonus: number; onPress: () => void; onLongPress?: () => void; half?: boolean }) {
  const fire = useFire()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${signed(bonus)}${prof === 2 ? ', expertise' : prof === 1 ? ', proficient' : ''}. Roll it`}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({ width: half ? '48%' : '100%', flexGrow: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, borderRadius: 8, backgroundColor: pressed ? fire.card : 'transparent' })}
    >
      <ProfDot prof={prof} />
      <Text size={13} numberOfLines={1} style={{ flex: 1, color: fire.ink }}>
        {label}
        {sub ? <Text size={11} style={{ color: fire.muted }}>{`  ${sub}`}</Text> : null}
      </Text>
      <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 14, color: prof ? fire.amber : fire.ink }}>{signed(bonus)}</Text>
    </Pressable>
  )
}

function DeathSaves({ s, busy, big, onRoll }: { s: Sheet5e; busy: boolean; big?: boolean; onRoll: () => void }) {
  const fire = useFire()
  const ds = s.deathSaves
  const status = ds.dead ? 'Dead' : ds.stable ? 'Stable' : 'Death saves'
  const dot = big ? 26 : 14
  return (
    <View style={{ gap: big ? 12 : 8, padding: big ? 16 : 12, borderRadius: 14, backgroundColor: big ? fire.hurtSoft : fire.card, borderWidth: 1, borderColor: big ? fire.red : fire.line }}>
      <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', fontSize: big ? 20 : 15, color: ds.dead ? fire.redText : fire.ink }}>
        {status}
      </Text>
      {big && !ds.dead && !ds.stable ? (
        <Text size={13} style={{ color: fire.hurtText }}>
          You&apos;re down. Roll a death save at the start of each of your turns: 10 or more is a success, three of either decides.
        </Text>
      ) : null}
      <View style={{ gap: 8 }} accessible accessibilityLabel={`Death saves: ${ds.successes} of 3 successes, ${ds.failures} of 3 failures`}>
        {(
          [
            ['Successes', ds.successes, fire.green],
            ['Failures', ds.failures, fire.red],
          ] as const
        ).map(([label, n, color]) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text size={big ? 14 : 12} style={{ width: big ? 90 : 72, color: fire.muted }}>
              {label}
            </Text>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ width: dot, height: dot, borderRadius: dot / 2, borderWidth: 2, borderColor: color, backgroundColor: i < n ? color : 'transparent' }} />
            ))}
          </View>
        ))}
      </View>
      {!ds.dead && !ds.stable && s.hp.current <= 0 ? <FireButton label="Roll a death save" kind="primary" icon="dice" height={big ? 56 : 48} busy={busy} onPress={onRoll} /> : null}
    </View>
  )
}

function ConcIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
      <View style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 2, borderColor: color }} />
    </View>
  )
}

/** Name, race, class, abilities, AC, HP max, speed and the D&D Beyond link (Edit). */
function Basics({ s, locked, ddbUrl, onSheet, onDdb, name, onName }: { s: Sheet5e; locked: boolean; ddbUrl: string | null; onSheet: (x: Sheet5e) => void; onDdb: (v: string) => void; name: string; onName: (v: string) => void }) {
  const fire = useFire()
  const cls = s.classes[0] ?? { name: '', level: 1, hitDie: 8, caster: 'none' as const }
  const setClass = (c: Partial<typeof cls>) => onSheet({ ...s, classes: [{ ...cls, ...c }, ...s.classes.slice(1)] })
  return (
    <View style={{ gap: 12, padding: 14, borderRadius: 16, backgroundColor: fire.panel, borderWidth: 1, borderColor: fire.line }}>
      <Field label="Name" value={name} onChange={onName} />
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

function Counter({ label, sub, used, max, onChange, onSpend }: { label: string; sub?: string; used: number; max: number; onChange: (used: number) => void; onSpend?: () => void }) {
  const fire = useFire()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, backgroundColor: fire.card }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={13} weight="bold" style={{ color: fire.ink }} numberOfLines={2}>
          {label}
        </Text>
        {sub ? (
          <Text size={11} style={{ color: fire.muted }} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Text accessibilityLabel={`${label}: ${max - used} of ${max} left`} style={{ fontFamily: 'Outfit_700Bold', fontSize: 15, color: fire.ink, minWidth: 40, textAlign: 'center' }}>
        {max - used}/{max}
      </Text>
      <Round icon="minus" label={`Use one: ${label}`} disabled={used >= max} onPress={() => {
        onChange(Math.min(max, used + 1))
        onSpend?.()
      }} />
      <Round icon="plus" label={`Get one back: ${label}`} disabled={used <= 0} onPress={() => onChange(Math.max(0, used - 1))} />
    </View>
  )
}
