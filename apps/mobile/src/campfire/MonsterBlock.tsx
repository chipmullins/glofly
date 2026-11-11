import { useState, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ABILITIES,
  ABILITY_NAMES,
  SKILLS,
  SKILL_IDS,
  abilityMod,
  attackExpressions,
  attackToHit,
  crLabel,
  hpState,
  saveBonus,
  skillBonus,
  withBonus,
  type Character,
  type SheetFeature,
} from '@glofly/shared'
import { Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { rollAtTable } from './actions'
import { useCampfire } from './store'
import { creditFor, rulesOf } from '@glofly/shared'
import { hpColor, initialOf, signed, useFire } from './lib'
import { RollModeSwitch, modeLabel, withMode, type RollMode } from './sheetParts'

// A monster's stat block for game masters on a phone (SheetNpc board): read-only, tap a number to
// roll it. Rolls go to game masters only, so players never learn the numbers.


export function MonsterBlockView({ campaignId, initial }: { campaignId: string; initial: Character }) {
  const fire = useFire()
  const insets = useSafeAreaInsets()
  const live = useCampfire((st) => st.tables[campaignId]?.characters.find((c) => c.id === initial.id))
  const ch = live && 'sheet' in live ? (live as Character) : initial
  const [mode, setMode] = useState<RollMode>('normal')
  const s = ch.sheet
  const m = s.monster
  const roll = (expr: string, label: string) => rollAtTable(campaignId, expr, { label: `${ch.name}: ${label}`, characterId: ch.id, visibility: 'gm' })
  const d20 = (bonus: number, label: string) => roll(withMode(withBonus('1d20', bonus), mode), modeLabel(label, mode))
  const state = hpState(s.hp.current, s.hp.max)
  const line = [m ? [s.size[0].toUpperCase() + s.size.slice(1), m.type].filter(Boolean).join(' ') : null, m?.alignment || s.alignment || null, m ? `Challenge ${crLabel(m.cr)} (${m.xp.toLocaleString('en-US')} XP)` : null].filter(Boolean).join(' · ')
  const saves = ABILITIES.filter((a) => s.saveOverrides[a] !== undefined || s.saves[a])
  const skills = SKILL_IDS.filter((k) => s.skillOverrides[k] !== undefined || (s.skills[k] ?? 0) > 0)
  const rule = { height: 1, backgroundColor: fire.monsterLine }

  // Stat block actions with their roll buttons: attack m<i> belongs to action x<i> (srd.ts), else by name.
  const attackFor = (f: SheetFeature, i: number) => s.attacks.find((a) => a.id === `m${f.id.startsWith('x') ? f.id.slice(1) : i}`) ?? s.attacks.find((a) => a.name.toLowerCase() === f.name.toLowerCase())
  const actions = m?.actions.length ? m.actions : s.attacks.map((a) => ({ id: a.id, name: a.name, text: [a.kind === 'ranged' ? 'Ranged attack' : a.kind === 'spell' ? 'Spell attack' : 'Melee attack', a.range, a.notes].filter(Boolean).join(', ') }))
  const unmatched = m?.actions.length ? s.attacks.filter((a) => !m.actions.some((f, i) => attackFor(f, i)?.id === a.id)) : []

  return (
    <View style={{ flex: 1, backgroundColor: fire.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to the table" onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/campfire/[id]', params: { id: campaignId } }))} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: fire.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevronLeft" size={20} color={fire.ink} />
        </Pressable>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#5C1F1A', borderWidth: 3, borderColor: fire.red, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 20, color: '#fff' }}>{initialOf(ch.name)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ fontFamily: 'Outfit_700Bold', fontSize: 19, lineHeight: 22, color: fire.ink }}>
            {ch.name}
          </Text>
          <Text size={12} numberOfLines={2} style={{ color: fire.muted }}>
            {line || 'Creature'}
          </Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: fire.gmSoft }}>
          <Icon name="eyeOff" size={14} color={fire.spell} />
          <Text size={12} weight="bold" style={{ color: fire.spell }}>
            Only game masters see this
          </Text>
        </View>
        <RollModeSwitch mode={mode} onChange={setMode} />
        <View style={{ gap: 10, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 14, backgroundColor: fire.monster, borderWidth: 1, borderColor: fire.monsterLine }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Box value={String(s.ac)} label="AC" a11y={`Armor class ${s.ac}`} />
            <Box value={`${s.speed} ft`} label={s.otherSpeeds ? `speed · ${s.otherSpeeds}` : 'speed'} a11y={`Speed ${s.speed} feet${s.otherSpeeds ? `, ${s.otherSpeeds}` : ''}`} />
          </View>
          <View style={{ gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: fire.card }} accessible accessibilityLabel={`${s.hp.current} of ${s.hp.max} hit points, ${state}${s.hp.temp ? `, plus ${s.hp.temp} temporary` : ''}`}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 18, color: fire.ink }}>{s.hp.current}</Text>
              <Text size={12} style={{ color: fire.muted, flex: 1 }}>
                / {s.hp.max} HP · {state === 'healthy' ? 'Healthy' : state === 'bloodied' ? 'Bloodied' : 'Defeated'}
                {s.hp.temp ? ` · +${s.hp.temp} temp` : ''}
              </Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: fire.track, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(0, Math.min(1, s.hp.max ? s.hp.current / s.hp.max : 0)) * 100}%`, height: '100%', backgroundColor: hpColor(fire, s.hp.current, s.hp.max) }} />
            </View>
          </View>
          <View style={rule} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {ABILITIES.map((a) => (
              <Pressable
                key={a}
                accessibilityRole="button"
                accessibilityLabel={`${ABILITY_NAMES[a]} ${s.abilities[a]}, ${signed(abilityMod(s.abilities[a]))}. Roll a check`}
                onPress={() => void d20(abilityMod(s.abilities[a]), `${ABILITY_NAMES[a]} check`)}
                style={({ pressed }) => ({ width: '33.33%', minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 8, backgroundColor: pressed ? fire.card : 'transparent' })}
              >
                <Text size={11} weight="bold" style={{ color: fire.monsterText }}>
                  {a.toUpperCase()}
                </Text>
                <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 15, color: fire.ink }}>
                  {s.abilities[a]} ({signed(abilityMod(s.abilities[a]))})
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={rule} />
          {saves.length ? (
            <Chips title="Saving throws" items={saves.map((a) => ({ key: a, label: `${a.toUpperCase()} ${signed(saveBonus(s, a))}`, a11y: `${ABILITY_NAMES[a]} save ${signed(saveBonus(s, a))}. Roll it`, onPress: () => void d20(saveBonus(s, a), `${ABILITY_NAMES[a]} save`) }))} />
          ) : null}
          {skills.length ? (
            <Chips title="Skills" items={skills.map((k) => ({ key: k, label: `${SKILLS[k].name} ${signed(skillBonus(s, k))}`, a11y: `${SKILLS[k].name} ${signed(skillBonus(s, k))}. Roll it`, onPress: () => void d20(skillBonus(s, k), `${SKILLS[k].name} check`) }))} />
          ) : null}
          {s.resist.length ? <Line title="Resistances" text={s.resist.join(', ')} /> : null}
          {s.immune.length ? <Line title="Immunities" text={s.immune.join(', ')} /> : null}
          {s.vulnerable.length ? <Line title="Vulnerabilities" text={s.vulnerable.join(', ')} /> : null}
          {m?.conditionImmunities.length ? <Line title="Condition immunities" text={m.conditionImmunities.join(', ')} /> : null}
          {m?.senses ? <Line title="Senses" text={m.senses} /> : null}
          {m?.languages ? <Line title="Languages" text={m.languages} /> : null}
          {s.notes ? <Line title="Notes" text={s.notes} /> : null}
          {m?.traits.map((f) => <Feature key={f.id} f={f} />)}

          {actions.length ? <Heading title="Actions" /> : null}
          {actions.map((f, i) => {
            const a = attackFor(f, i)
            return <Feature key={f.id} f={f} buttons={a ? <RollPair name={a.name} toHit={attackToHit(s, a)} damage={attackExpressions(s, a).damage} onHit={() => void roll(withMode(attackExpressions(s, a).toHit, mode), modeLabel(`${a.name}: to hit`, mode))} onDamage={() => void roll(attackExpressions(s, a).damage, `${a.name}: damage`)} /> : null} />
          })}
          {unmatched.map((a) => (
            <Feature key={a.id} f={{ id: a.id, name: a.name, text: a.range }} buttons={<RollPair name={a.name} toHit={attackToHit(s, a)} damage={attackExpressions(s, a).damage} onHit={() => void roll(withMode(attackExpressions(s, a).toHit, mode), modeLabel(`${a.name}: to hit`, mode))} onDamage={() => void roll(attackExpressions(s, a).damage, `${a.name}: damage`)} />} />
          ))}
          {m?.reactions.length ? <Heading title="Reactions" /> : null}
          {m?.reactions.map((f) => <Feature key={f.id} f={f} />)}
          {m?.legendary.length ? <Heading title="Legendary actions" /> : null}
          {m?.legendary.map((f) => <Feature key={f.id} f={f} />)}
        </View>
        <Text size={12} style={{ color: fire.muted, lineHeight: 18 }}>
          Players see the name, a health state (Healthy, Bloodied, Defeated) and whether attacks hit, never these numbers. Rolls from here go to game masters only. Change HP and place monsters from the map on a computer.
          {ch.srdMonster || m ? ` ${creditFor(rulesOf(useCampfire.getState().tables[campaignId]?.campaign.settings))}` : ''}
        </Text>
      </ScrollView>
    </View>
  )
}

function Box({ value, label, a11y }: { value: string; label: string; a11y: string }) {
  const fire = useFire()
  return (
    <View accessible accessibilityLabel={a11y} style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: fire.card }}>
      <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 18, color: fire.ink }}>{value}</Text>
      <Text size={12} numberOfLines={2} style={{ flex: 1, color: fire.muted }}>
        {label}
      </Text>
    </View>
  )
}

function Heading({ title }: { title: string }) {
  const fire = useFire()
  return (
    <View style={{ marginTop: 6, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: fire.monsterLine }}>
      <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', fontSize: 16, color: fire.monsterText }}>
        {title}
      </Text>
    </View>
  )
}

function Line({ title, text }: { title: string; text: string }) {
  const fire = useFire()
  return (
    <Text size={14} style={{ color: fire.ink, lineHeight: 21 }}>
      <Text size={14} weight="bold" style={{ color: fire.monsterText }}>
        {title}{' '}
      </Text>
      {text}
    </Text>
  )
}

function Feature({ f, buttons }: { f: SheetFeature; buttons?: ReactNode }) {
  const fire = useFire()
  return (
    <View style={{ gap: 6 }}>
      <Text size={14} style={{ color: fire.ink, lineHeight: 21 }}>
        <Text size={14} weight="bold" style={{ color: fire.ink, fontStyle: 'italic' }}>
          {f.name}.{' '}
        </Text>
        {f.text}
      </Text>
      {buttons}
    </View>
  )
}

function RollPair({ name, toHit, damage, onHit, onDamage }: { name: string; toHit: number; damage: string; onHit: () => void; onDamage: () => void }) {
  const fire = useFire()
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Roll ${name} to hit, ${signed(toHit)}`} onPress={onHit} style={({ pressed }) => ({ minWidth: 64, height: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: fire.amberSoft, borderWidth: 1, borderColor: fire.amberLine, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
        <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 15, color: fire.amber }}>{signed(toHit)}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Roll ${name} damage, ${damage}`} onPress={onDamage} style={({ pressed }) => ({ minWidth: 80, height: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: fire.well, borderWidth: 1, borderColor: fire.line, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
        <Text size={13} weight="bold" style={{ color: fire.ink }}>
          {damage}
        </Text>
      </Pressable>
    </View>
  )
}

function Chips({ title, items }: { title: string; items: { key: string; label: string; a11y: string; onPress: () => void }[] }) {
  const fire = useFire()
  return (
    <View style={{ gap: 6 }}>
      <Text size={14} weight="bold" style={{ color: fire.monsterText }}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {items.map((it) => (
          <Pressable key={it.key} accessibilityRole="button" accessibilityLabel={it.a11y} onPress={it.onPress} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, borderRadius: 22, justifyContent: 'center', backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line, opacity: pressed ? 0.8 : 1 })}>
            <Text size={13} weight="bold" style={{ color: fire.ink }}>
              {it.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}
