import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ABILITIES,
  ABILITY_NAMES,
  SKILLS,
  STANDARD_ARRAY,
  abilityMod,
  asiFeats,
  asiLevels,
  backgroundBonusOk,
  blankSheet,
  buildSheet,
  finalScores,
  normalizeSheet,
  parseClassLevel,
  pickFrom,
  rulesOf,
  sheetSpellFrom,
  slotsForClasses,
  spellCounts,
  type Ability,
  type AsiChoice,
  type BuildChoices,
  type BuilderRules,
  type RulesItem,
  type RulesSet,
  type SheetSpell,
  type SkillId,
  type SrdSpellSummary,
  type TableState,
  emptyGear,
  gearFor,
  pickChoices,
  pickKeys,
  resolveGear,
  type ClassGear,
  type GearPick,
  type GearSelection,
  type ResolvedGear,
} from '@glofly/shared'
import { Text, webNoOutline } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { inform } from '@/ui/dialogs'
import { upsertCharacter } from '@/campfire/store'
import { FireButton } from '@/campfire/ui'
import { useFire } from '@/campfire/lib'
import { builderFor, roundA } from '@/campfire/roundA'

// Round A on phones (approved board "BuilderPhone", "SwitchOver"): bringing your character to the
// table. Build one step by step (one screen per step, the same 8 steps and the same shared math
// as the desktop builder), or copy the numbers in from another sheet (Roll20, paper). Importing a
// character sheet PDF is on a computer.

const STEPS = ['Species', 'Class', 'Background', 'Ability scores', 'Skills', 'Equipment', 'Spells', 'Name'] as const

export function BringCharacter({ campaignId, table }: { campaignId: string; table: TableState | undefined }) {
  const fire = useFire()
  const [mode, setMode] = useState<'choose' | 'build' | 'copy'>('choose')
  const rules: RulesSet = rulesOf(table?.campaign.settings)
  const [level, setLevel] = useState(1)
  useEffect(() => {
    void roundA.hub(campaignId).then((r) => r.ok && setLevel(Math.max(1, r.data.progress.level)))
  }, [campaignId])
  if (mode === 'build') return <Builder campaignId={campaignId} rules={rules} startLevel={level} onBack={() => setMode('choose')} />
  if (mode === 'copy') return <CopyIn campaignId={campaignId} rules={rules} level={level} onBack={() => setMode('choose')} />
  return (
    <Frame title="Your character" sub={table?.campaign.name ?? ''} onClose={() => router.back()}>
      <Text size={15} style={{ color: fire.muted }}>
        {level > 1 ? `The party is level ${level}. ` : ''}Pick how you’d like to bring your hero to the table.
      </Text>
      <Choice
        title={level > 1 ? `Build one at level ${level}` : 'Build a new character'}
        text="The builder walks you through every choice, one screen at a time."
        main
        onPress={() => setMode('build')}
      />
      <Choice title="Copy it in from another sheet" text="For Roll20 or paper: one page with the numbers that matter. About five minutes." onPress={() => setMode('copy')} />
      <Text size={13} style={{ color: fire.muted }}>
        Have a character sheet PDF? Import it from Campfire on a computer: it’s read there and never uploaded.
      </Text>
    </Frame>
  )
}

function Frame({ title, sub, onClose, children, foot }: { title: string; sub: string; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  const fire = useFire()
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flex: 1, backgroundColor: fire.bg, paddingTop: insets.top + 8 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 16,
          paddingBottom: 10,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: fire.card,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="close" size={18} color={fire.ink} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{
              fontFamily: 'Outfit_700Bold',
              fontSize: 18,
              color: fire.ink,
            }}
          >
            {title}
          </Text>
          {sub ? (
            <Text size={12} numberOfLines={1} style={{ color: fire.muted }}>
              {sub}
            </Text>
          ) : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {foot ? (
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: insets.bottom + 12,
            gap: 8,
            borderTopWidth: 1,
            borderTopColor: fire.line,
          }}
        >
          {foot}
        </View>
      ) : null}
    </View>
  )
}

function Choice({ title, text, main, onPress }: { title: string; text: string; main?: boolean; onPress: () => void }) {
  const fire = useFire()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        padding: 16,
        borderRadius: 18,
        backgroundColor: main ? fire.amberSoft : fire.card,
        borderWidth: main ? 2 : 1,
        borderColor: main ? fire.amber : fire.line,
        gap: 6,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 17, color: fire.ink }}>{title}</Text>
      <Text size={14} style={{ color: fire.muted }}>
        {text}
      </Text>
    </Pressable>
  )
}

/** A selectable card (species, class, background). */
function Card({ title, meta, text, on, tag, onPress, children }: { title: string; meta?: string; text?: string; on: boolean; tag?: string; onPress: () => void; children?: ReactNode }) {
  const fire = useFire()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={title}
      onPress={onPress}
      style={{
        padding: 14,
        borderRadius: 16,
        backgroundColor: on ? fire.amberSoft : fire.card,
        borderWidth: on ? 2 : 1,
        borderColor: on ? fire.amber : fire.line,
        gap: 4,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <Text
          style={{
            fontFamily: 'Outfit_700Bold',
            fontSize: 16,
            color: fire.ink,
          }}
        >
          {title}
        </Text>
        {meta ? (
          <Text size={12} style={{ color: fire.amber }}>
            {meta}
          </Text>
        ) : null}
        {tag ? (
          <Text size={11} weight="bold" style={{ color: fire.green }}>
            {tag}
          </Text>
        ) : null}
      </View>
      {text ? (
        <Text size={13} numberOfLines={on ? undefined : 2} style={{ color: fire.muted }}>
          {text}
        </Text>
      ) : null}
      {on && children ? <View style={{ marginTop: 8, gap: 8 }}>{children}</View> : null}
    </Pressable>
  )
}

function Chip({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  const fire = useFire()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 40,
        paddingHorizontal: 12,
        borderRadius: 20,
        justifyContent: 'center',
        backgroundColor: on ? fire.amberSoft : fire.raised,
        borderWidth: 1,
        borderColor: on ? fire.amber : fire.line,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text size={14} weight="bold" style={{ color: on ? fire.amber : fire.ink }}>
        {label}
      </Text>
    </Pressable>
  )
}

const Chips = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>

function Field({
  label,
  value,
  onChange,
  numeric,
  placeholder,
  multiline,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  numeric?: boolean
  placeholder?: string
  multiline?: boolean
}) {
  const fire = useFire()
  return (
    <View style={{ gap: 6, flex: numeric ? 1 : undefined }}>
      <Text size={12} weight="bold" style={{ color: fire.muted }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={fire.muted}
        keyboardType={numeric ? 'number-pad' : 'default'}
        multiline={multiline}
        style={[
          {
            minHeight: multiline ? 88 : 48,
            paddingHorizontal: 12,
            paddingVertical: multiline ? 10 : 0,
            borderRadius: 12,
            backgroundColor: fire.card,
            borderWidth: 1,
            borderColor: fire.line,
            color: fire.ink,
            fontSize: 16,
            fontFamily: 'DMSans_500Medium',
            textAlignVertical: multiline ? 'top' : 'center',
          },
          webNoOutline,
        ]}
      />
    </View>
  )
}

type Draft = {
  speciesId: string
  subId: string | null
  speciesSkill: SkillId | null
  classId: string
  subclassId: string | null
  level: number
  backgroundId: string
  bonus: Partial<Record<Ability, number>>
  assign: Partial<Record<Ability, number>>
  asi: Partial<Record<Ability, number>>[]
  /** A feat instead of the ASI at that index */
  asiFeat: (string | null)[]
  skills: SkillId[]
  /** Only for classes without starting-gear data (homebrew) */
  equipment: RulesItem[]
  /** 0.11.3: the class's starting gear choices */
  gear: GearSelection
  spells: SheetSpell[]
  name: string
}

function Builder({ campaignId, rules, startLevel, onBack }: { campaignId: string; rules: RulesSet; startLevel: number; onBack: () => void }) {
  const fire = useFire()
  const [data, setData] = useState<BuilderRules | null>(null)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [d, setD] = useState<Draft>({
    speciesId: '',
    subId: null,
    speciesSkill: null,
    classId: '',
    subclassId: null,
    level: startLevel,
    backgroundId: '',
    bonus: {},
    assign: {},
    asi: [],
    asiFeat: [],
    skills: [],
    equipment: [],
    gear: emptyGear(),
    spells: [],
    name: '',
  })
  const [items, setItems] = useState<RulesItem[] | null>(null)
  useEffect(() => {
    let on = true
    void roundA.mundaneItems(rules).then((x) => on && setItems(x))
    return () => {
      on = false
    }
  }, [rules])
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  useEffect(() => {
    void builderFor(campaignId, rules).then(setData)
  }, [campaignId, rules])
  useEffect(() => set({ level: startLevel }), [startLevel])

  const pick = useMemo(() => (data ? pickFrom(data, d) : null), [data, d])
  if (!data || !pick)
    return (
      <Frame title="Make your character" sub="Loading the rules…" onClose={onBack}>
        <Text style={{ color: fire.muted }}>Loading the rules…</Text>
      </Frame>
    )

  const asiCount = pick.cls ? asiLevels(pick.cls, d.level).length : 0
  const base = Object.fromEntries(ABILITIES.map((a) => [a, d.assign[a] !== undefined ? STANDARD_ARRAY[d.assign[a]!] : 8])) as Record<Ability, number>
  const asi: AsiChoice[] = Array.from({ length: asiCount }, (_, i): AsiChoice => {
    const feat = d.asiFeat[i]
    return feat ? { kind: 'feat', featId: feat } : { kind: 'asi', plus: d.asi[i] ?? {} }
  })
  // 0.11.3 (Chip): each class starts with its own gear (SRD), not the whole armory.
  const classGear = pick.cls && items?.length !== 0 ? gearFor(rules, pick.cls.id) : null
  const gearOut = classGear && items ? resolveGear(classGear, d.gear, items) : null
  const choices: BuildChoices = {
    rules,
    name: d.name,
    speciesId: d.speciesId,
    subId: d.subId,
    classId: d.classId,
    subclassId: d.subclassId,
    level: d.level,
    backgroundId: d.backgroundId,
    base,
    bonus: d.bonus,
    skills: [...d.skills, ...(d.speciesSkill ? [d.speciesSkill] : [])],
    asi,
    hp: 'average',
    spells: d.spells,
    equipment: classGear ? (gearOut?.equipment ?? []) : d.equipment,
    gold: gearOut?.gold ?? 0,
  }
  const scores = finalScores(data, choices)
  const sum = (p: Partial<Record<Ability, number>>) => Object.values(p).reduce((n: number, v) => n + (v ?? 0), 0)
  const done = [
    !!pick.species && (!pick.species.subs.length || !!pick.sub) && (!pick.species.skillChoice || !!d.speciesSkill),
    !!pick.cls && (d.level < pick.cls.subclassLevel || !!d.subclassId),
    !!pick.bg && backgroundBonusOk(pick.bg, d.bonus),
    ABILITIES.every((a) => d.assign[a] !== undefined) && asi.every((a) => (a.kind === 'feat' ? !!a.featId : sum(a.plus) === 2)),
    !!pick.cls && d.skills.length === pick.cls.skillChoice.count,
    !!pick.cls && (!classGear || (!!gearOut && !gearOut.open)),
    !pick.cls?.spellAbility ||
      (() => {
        const need = spellCounts(pick.cls, d.level, abilityMod(scores[pick.cls.spellAbility]))
        return d.spells.filter((x) => x.level === 0).length >= need.cantrips && d.spells.filter((x) => x.level > 0).length >= need.spells
      })(),
    !!d.name.trim(),
  ]
  // 0.11.3 (Chip: "choose everything before Next"): what's still open on this step.
  const openText = [
    'Pick a species (and its subspecies or skill).',
    'Pick a class (and subclass at this level).',
    'Pick a background and place its bonuses.',
    'Set all six ability scores.',
    'Pick the rest of your skills.',
    !pick.cls ? 'Pick a class first.' : classGear && !gearOut ? 'Loading your class’s gear…' : (gearOut?.open ?? ''),
    'Pick the rest of your spells.',
    'Give them a name.',
  ]
  const ready = done.every(Boolean)

  const make = async () => {
    if (!pick.cls) return
    setBusy(true)
    const sheet = buildSheet(data, choices)
    const r = await roundA.makeCharacter(campaignId, d.name.trim(), sheet)
    setBusy(false)
    if (!r.ok) return void inform("Couldn't make your character", r.message)
    upsertCharacter(campaignId, r.data)
    router.replace({
      pathname: '/campfire/character/[id]',
      params: { id: r.data.id, campaign: campaignId },
    })
  }

  const foot = (
    <>
      <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <Pressable
            key={s}
            accessibilityLabel={`Go to ${s}`}
            onPress={() => {
              // Steps further on open once the ones before them are done.
              if (i <= step || done.slice(0, i).every(Boolean)) setStep(i)
            }}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === step ? fire.amber : done[i] ? fire.green : fire.track,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {step > 0 ? <FireButton label="Back" onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : null}
        {step < STEPS.length - 1 ? (
          <FireButton label={`Next: ${STEPS[step + 1].toLowerCase()}`} kind="primary" disabled={!done[step]} style={{ flex: 2 }} onPress={() => setStep(step + 1)} />
        ) : (
          <FireButton label={ready ? 'Bring them to the table' : 'Finish the steps marked open'} kind="primary" busy={busy} disabled={!ready} style={{ flex: 2 }} onPress={() => void make()} />
        )}
      </View>
      {step < STEPS.length - 1 && !done[step] && openText[step] ? (
        <Text size={13} accessibilityRole="alert" style={{ color: fire.amber, textAlign: 'center' }}>
          {openText[step]}
        </Text>
      ) : null}
      <Text size={11} style={{ color: fire.muted, textAlign: 'center' }}>
        {data.credit}
      </Text>
    </>
  )

  const summary = pick.cls ? `${pick.species?.name ?? ''} · ${pick.cls.name} ${d.level}` : (pick.species?.name ?? '')
  return (
    <Frame title="Make your character" sub={`Step ${step + 1} of 8 · ${STEPS[step]}${summary ? ` · ${summary}` : ''}`} onClose={onBack} foot={foot}>
      {step === 0 ? (
        <>
          <Text size={14} style={{ color: fire.muted }}>
            Your species gives you traits like darkvision and how fast you move.
          </Text>
          {data.species.map((s) => (
            <Card
              key={s.id}
              title={s.name}
              meta={`Speed ${s.speed} ft${s.darkvision ? ` · Darkvision ${s.darkvision} ft` : ''}`}
              text={s.traits.map((t) => t.name).join(', ')}
              tag={s.homebrew ? 'Your game master’s' : undefined}
              on={d.speciesId === s.id}
              onPress={() => set({ speciesId: s.id, subId: null, speciesSkill: null })}
            >
              {s.subs.length ? (
                <Chips>
                  {s.subs.map((sub) => (
                    <Chip key={sub.id} label={sub.name.replace(/^[^:]+:\s*/, '')} on={d.subId === sub.id} onPress={() => set({ subId: sub.id })} />
                  ))}
                </Chips>
              ) : null}
              {s.skillChoice ? (
                <>
                  <Text size={12} weight="bold" style={{ color: fire.muted }}>
                    A skill from your species
                  </Text>
                  <Chips>
                    {s.skillChoice.from.map((k) => (
                      <Chip key={k} label={SKILLS[k].name} on={d.speciesSkill === k} onPress={() => set({ speciesSkill: k })} />
                    ))}
                  </Chips>
                </>
              ) : null}
            </Card>
          ))}
        </>
      ) : step === 1 ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text size={14} style={{ flex: 1, color: fire.muted }}>
              What your character does best. The level is the party’s.
            </Text>
            <FireButton label="−" a11y="One level lower" height={44} onPress={() => set({ level: Math.max(1, d.level - 1) })} />
            <Text
              style={{
                fontFamily: 'Outfit_700Bold',
                fontSize: 18,
                color: fire.ink,
              }}
            >
              {d.level}
            </Text>
            <FireButton label="+" a11y="One level higher" height={44} onPress={() => set({ level: Math.min(20, d.level + 1) })} />
          </View>
          {data.classes.map((c) => (
            <Card
              key={c.id}
              title={c.name}
              meta={`d${c.hitDie} · ${c.primary.map((a) => ABILITY_NAMES[a]).join(c.id === 'fighter' ? ' or ' : ' and ')}`}
              text={c.levels[0]?.features.map((f) => f.name).join(', ')}
              on={d.classId === c.id}
              onPress={() =>
                set({
                  classId: c.id,
                  subclassId: null,
                  skills: [],
                  spells: [],
                  asi: [],
                  asiFeat: [],
                  ...(c.id === d.classId ? {} : { gear: emptyGear() }),
                })
              }
            >
              {d.level >= c.subclassLevel ? (
                <>
                  <Text size={12} weight="bold" style={{ color: fire.muted }}>
                    {c.subclassLabel || 'Subclass'}
                  </Text>
                  <Chips>
                    {c.subclasses.map((s) => (
                      <Chip key={s.id} label={s.name} on={d.subclassId === s.id} onPress={() => set({ subclassId: s.id })} />
                    ))}
                  </Chips>
                </>
              ) : null}
            </Card>
          ))}
        </>
      ) : step === 2 ? (
        <>
          <Text size={14} style={{ color: fire.muted }}>
            What your character did before adventuring
            {rules === '2024' ? ': skills, an origin feat and +3 to abilities.' : '.'}
          </Text>
          {data.backgrounds.map((b) => (
            <Card
              key={b.id}
              title={b.name}
              meta={b.skills.map((s) => SKILLS[s].name).join(', ')}
              text={b.feat ? `Feat: ${b.feat.name}` : b.feature?.name}
              tag={b.homebrew ? 'Your game master’s' : undefined}
              on={d.backgroundId === b.id}
              onPress={() => set({ backgroundId: b.id, bonus: {} })}
            >
              {b.abilities?.length ? (
                <>
                  <Text size={12} weight="bold" style={{ color: fire.muted }}>
                    Tap an ability for +1, again for +2 (+3 in all)
                  </Text>
                  <Chips>
                    {b.abilities.map((a) => {
                      const v = d.bonus[a] ?? 0
                      return (
                        <Chip
                          key={a}
                          label={`${a.toUpperCase()} ${v ? `+${v}` : ''}`.trim()}
                          on={v > 0}
                          onPress={() => {
                            const total = sum(d.bonus)
                            const nextV = v >= 2 || (total >= 3 && v > 0) ? 0 : total >= 3 ? v : v + 1
                            set({ bonus: { ...d.bonus, [a]: nextV } })
                          }}
                        />
                      )
                    })}
                  </Chips>
                </>
              ) : null}
            </Card>
          ))}
        </>
      ) : step === 3 ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text size={14} style={{ flex: 1, color: fire.muted }}>
              Give each ability one of the standard numbers.
              {pick.cls ? ` ${pick.cls.name}s want ${pick.cls.primary.map((a) => ABILITY_NAMES[a]).join(pick.cls.id === 'fighter' ? ' or ' : ' and ')} first.` : ''}
            </Text>
            {pick.cls ? (
              <FireButton
                label="Suggest"
                kind="amber"
                onPress={() => {
                  const order: Ability[] = [...pick.cls!.primary, 'con', ...ABILITIES.filter((a) => !pick.cls!.primary.includes(a) && a !== 'con')]
                  set({
                    assign: Object.fromEntries(order.slice(0, 6).map((a, k) => [a, k])) as Partial<Record<Ability, number>>,
                  })
                }}
              />
            ) : null}
          </View>
          {ABILITIES.map((a) => (
            <View
              key={a}
              style={{
                padding: 12,
                borderRadius: 14,
                backgroundColor: fire.card,
                gap: 8,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text weight="bold" size={15} style={{ flex: 1, color: fire.ink }}>
                  {ABILITY_NAMES[a]}
                </Text>
                <Text
                  style={{
                    fontFamily: 'Outfit_700Bold',
                    fontSize: 18,
                    color: fire.amber,
                  }}
                >
                  {scores[a]}
                </Text>
                <Text size={13} style={{ color: fire.muted }}>
                  {abilityMod(scores[a]) >= 0 ? '+' : ''}
                  {abilityMod(scores[a])}
                </Text>
              </View>
              <Chips>
                {STANDARD_ARRAY.map((v, i) => {
                  const owner = ABILITIES.find((x) => d.assign[x] === i)
                  return (
                    <Chip
                      key={i}
                      label={String(v)}
                      on={owner === a}
                      onPress={() => {
                        const assign = { ...d.assign }
                        for (const x of ABILITIES) if (assign[x] === i) delete assign[x]
                        if (owner !== a) assign[a] = i
                        set({ assign })
                      }}
                    />
                  )
                })}
              </Chips>
            </View>
          ))}
          {Array.from({ length: asiCount }, (_, i) => (
            <View
              key={i}
              style={{
                padding: 12,
                borderRadius: 14,
                backgroundColor: fire.card,
                gap: 8,
              }}
            >
              <Text weight="bold" size={14} style={{ color: fire.ink }}>
                Ability Score Improvement {i + 1}: +2 in all
              </Text>
              <Chips>
                {ABILITIES.map((a) => {
                  const plus = d.asi[i] ?? {}
                  const v = plus[a] ?? 0
                  return (
                    <Chip
                      key={a}
                      label={`${a.toUpperCase()} ${v ? `+${v}` : ''}`.trim()}
                      on={v > 0}
                      onPress={() => {
                        const total = sum(plus)
                        const nextV = v >= 2 || (total >= 2 && v > 0) ? 0 : total >= 2 ? v : v + 1
                        const list = [...d.asi]
                        list[i] = { ...plus, [a]: nextV }
                        set({ asi: list })
                      }}
                    />
                  )
                })}
              </Chips>
              {asiFeats(data).length ? (
                <>
                  <Text size={12} weight="bold" style={{ color: fire.muted }}>
                    Or take a feat instead
                  </Text>
                  <Chips>
                    {asiFeats(data).map((f) => (
                      <Chip
                        key={f.id}
                        label={f.name}
                        on={d.asiFeat[i] === f.id}
                        onPress={() => {
                          const list = [...d.asiFeat]
                          list[i] = list[i] === f.id ? null : f.id
                          set({ asiFeat: list })
                        }}
                      />
                    ))}
                  </Chips>
                  {d.asiFeat[i] ? (
                    <Text size={12} style={{ color: fire.muted }}>
                      {asiFeats(data)
                        .find((f) => f.id === d.asiFeat[i])
                        ?.text.slice(0, 220)}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </View>
          ))}
        </>
      ) : step === 4 ? (
        pick.cls ? (
          <>
            <Text size={14} style={{ color: fire.muted }}>
              Pick {pick.cls.skillChoice.count} {pick.cls.name.toLowerCase()} skills. Your background already gives {pick.bg ? pick.bg.skills.map((s) => SKILLS[s].name).join(' and ') : 'two more'}.
            </Text>
            <Chips>
              {pick.cls.skillChoice.from.map((k) => {
                const on = d.skills.includes(k)
                const have = !!pick.bg?.skills.includes(k) || d.speciesSkill === k
                return (
                  <Chip
                    key={k}
                    label={SKILLS[k].name}
                    on={on || have}
                    disabled={have || (!on && d.skills.length >= pick.cls!.skillChoice.count)}
                    onPress={() =>
                      set({
                        skills: on ? d.skills.filter((x) => x !== k) : [...d.skills, k],
                      })
                    }
                  />
                )
              })}
            </Chips>
          </>
        ) : (
          <Text style={{ color: fire.muted }}>Pick a class first.</Text>
        )
      ) : step === 5 ? (
        classGear && items && gearOut ? (
          <StartingGear gear={classGear} className={pick.cls?.name ?? ''} bgGold={pick.bg?.gold ?? 0} items={items} sel={d.gear} out={gearOut} onChange={(gear) => set({ gear })} />
        ) : (
          <Equipment rules={rules} chosen={d.equipment} onChange={(equipment) => set({ equipment })} />
        )
      ) : step === 6 ? (
        pick.cls?.spellAbility ? (
          <Spells
            rules={rules}
            cls={pick.cls.name}
            counts={spellCounts(pick.cls, d.level, abilityMod(scores[pick.cls.spellAbility]))}
            maxLevel={Math.max(1, pick.cls.levels.find((l) => l.level === d.level)?.slots.filter((n) => n > 0).length ?? 1)}
            chosen={d.spells}
            onChange={(spells) => set({ spells })}
          />
        ) : (
          <Text style={{ color: fire.muted }}>{pick.cls ? `${pick.cls.name}s don’t cast spells at this level. On to the name.` : 'Pick a class first.'}</Text>
        )
      ) : (
        <>
          <Field label="Name" value={d.name} onChange={(name) => set({ name: name.slice(0, 60) })} placeholder="Lyra" />
          <Text size={13} style={{ color: fire.muted }}>
            Hit points after level 1 take the average. Add a portrait on the sheet once you’re in.
          </Text>
          <View
            style={{
              padding: 12,
              borderRadius: 14,
              backgroundColor: fire.card,
              gap: 6,
            }}
          >
            {done.map((ok, i) => (
              <Text key={STEPS[i]} size={14} style={{ color: ok ? fire.green : fire.amber }}>
                {ok ? '✓' : '!'} {STEPS[i]}
              </Text>
            ))}
          </View>
        </>
      )}
    </Frame>
  )
}

const PICK_LABEL: Record<GearPick['from'], string> = {
  simple: 'a simple weapon',
  martial: 'a martial weapon',
  'simple-melee': 'a simple melee weapon',
  'martial-melee': 'a martial melee weapon',
  'holy-symbol': 'a holy symbol',
  'arcane-focus': 'an arcane focus',
  'druidic-focus': 'a druidic focus',
}
const costText = (gp: number) => (gp >= 1 ? `${Math.round(gp * 100) / 100} gp` : gp >= 0.1 ? `${Math.round(gp * 10)} sp` : `${Math.round(gp * 100)} cp`)

function GearPicks({ prefix, picks, items, sel, onChange }: { prefix: string; picks?: GearPick[]; items: RulesItem[]; sel: GearSelection; onChange: (g: GearSelection) => void }) {
  const fire = useFire()
  return (
    <>
      {pickKeys(prefix, picks).map(({ key, pick }) => (
        <View key={key} style={{ gap: 6 }}>
          <Text size={12} weight="bold" style={{ color: sel.picks[key] ? fire.muted : fire.amber }}>
            Choose {PICK_LABEL[pick.from]}
          </Text>
          <Chips>
            {pickChoices(pick, items).map((it) => (
              <Chip key={it.id} label={it.name} on={sel.picks[key] === it.id} onPress={() => onChange({ ...sel, picks: { ...sel.picks, [key]: it.id } })} />
            ))}
          </Chips>
        </View>
      ))}
    </>
  )
}

function StartingGear({
  gear,
  className,
  bgGold,
  items,
  sel,
  out,
  onChange,
}: {
  gear: ClassGear
  className: string
  bgGold: number
  items: RulesItem[]
  sel: GearSelection
  out: ResolvedGear
  onChange: (g: GearSelection) => void
}) {
  const fire = useFire()
  const [q, setQ] = useState('')
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const name = (id: string, qty?: number) => {
    const n = byId.get(id)?.name ?? id
    return qty && qty > 1 ? `${qty} ${/s$/i.test(n) ? n : `${n}s`}` : n
  }
  const choose = (line: number, o: number) => {
    const options = [...sel.options]
    options[line] = o
    const picks = Object.fromEntries(Object.entries(sel.picks).filter(([k]) => !k.startsWith(`c${line}.`)))
    onChange({
      options,
      picks,
      bought: gear.choices[line].options[o]?.shop ? sel.bought : [],
    })
  }
  const needle = q.trim().toLowerCase()
  const shop = out.shopping
    ? items
        .filter((it) => (needle ? it.name.toLowerCase().includes(needle) : it.kind !== 'gear'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 40)
    : []
  return (
    <>
      <Text size={14} style={{ color: fire.muted }}>
        What a new {className.toLowerCase() || 'adventurer'} starts with. {gear.choices.length > 1 ? 'Choose one option on each line.' : 'Take the gear, or the gold to buy your own.'}
      </Text>
      <View
        style={{
          padding: 12,
          borderRadius: 14,
          backgroundColor: fire.card,
          gap: 6,
        }}
        accessibilityLiveRegion="polite"
      >
        <Text weight="bold" style={{ color: fire.ink }}>
          Your gear
        </Text>
        <Text size={13} style={{ color: out.equipment.length ? fire.green : fire.muted }}>
          {out.equipment.length ? out.equipment.map((it) => `✓ ${name(it.id, it.qty)}`).join('   ') : 'Nothing yet. Choose below.'}
        </Text>
        <Text size={12} style={{ color: fire.muted }}>
          Gold: {out.gold + bgGold} gp
          {bgGold ? ` (${bgGold} from your background)` : ''}
          {out.shopping ? ` · ${costText(out.budget)} left to spend` : ''}
        </Text>
      </View>
      {gear.choices.map((c, ci) => (
        <View key={ci} style={{ gap: 8 }}>
          {gear.choices.length > 1 ? (
            <Text size={13} weight="bold" style={{ color: fire.muted }}>
              Choose one ({ci + 1} of {gear.choices.length})
            </Text>
          ) : null}
          {c.options.map((o, oi) => (
            <Card
              key={oi}
              title={o.label}
              tag={sel.options[ci] === oi ? '✓ Chosen' : undefined}
              text={[o.items.map((x) => name(x.id, x.qty)).join(', '), o.gold && !o.shop ? `${o.gold} GP` : ''].filter(Boolean).join(' · ')}
              on={sel.options[ci] === oi}
              onPress={() => choose(ci, oi)}
            >
              {o.picks?.length ? <GearPicks prefix={`c${ci}`} picks={o.picks} items={items} sel={sel} onChange={onChange} /> : null}
            </Card>
          ))}
        </View>
      ))}
      {gear.always.length || gear.alwaysPicks?.length ? (
        <View
          style={{
            padding: 12,
            borderRadius: 14,
            backgroundColor: fire.card,
            gap: 8,
          }}
        >
          <Text weight="bold" style={{ color: fire.ink }}>
            Every {className.toLowerCase()} also gets
          </Text>
          {gear.always.length ? (
            <Text size={13} style={{ color: fire.muted }}>
              {gear.always.map((x) => name(x.id, x.qty)).join(', ')}
            </Text>
          ) : null}
          <GearPicks prefix="a" picks={gear.alwaysPicks} items={items} sel={sel} onChange={onChange} />
        </View>
      ) : null}
      {out.shopping ? (
        <>
          <Text weight="bold" style={{ color: fire.ink }}>
            Shop · {costText(out.budget)} left
          </Text>
          <Field label="Search the shop" value={q} onChange={setQ} placeholder="Rope, longsword…" />
          {shop.map((it) => {
            const count = sel.bought.filter((id) => id === it.id).length
            return (
              <View
                key={it.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  padding: 12,
                  borderRadius: 12,
                  backgroundColor: fire.card,
                  borderLeftWidth: count ? 3 : 0,
                  borderLeftColor: fire.green,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text weight="bold" style={{ color: fire.ink }}>
                    {it.name}
                  </Text>
                  <Text size={12} style={{ color: fire.muted }}>
                    {costText(it.cost)} · {it.weight} lb
                  </Text>
                </View>
                {count ? (
                  <>
                    <FireButton
                      label="−"
                      kind="quiet"
                      height={40}
                      onPress={() => {
                        const at = sel.bought.lastIndexOf(it.id)
                        onChange({
                          ...sel,
                          bought: sel.bought.filter((_, j) => j !== at),
                        })
                      }}
                    />
                    <Text weight="bold" style={{ color: fire.green }}>
                      ✓ Added{count > 1 ? ` ×${count}` : ''}
                    </Text>
                  </>
                ) : null}
                <FireButton label={count ? '+' : '+ Add'} height={40} disabled={it.cost > out.budget + 1e-9} onPress={() => onChange({ ...sel, bought: [...sel.bought, it.id] })} />
              </View>
            )
          })}
        </>
      ) : null}
    </>
  )
}

function Equipment({ rules, chosen, onChange }: { rules: RulesSet; chosen: RulesItem[]; onChange: (v: RulesItem[]) => void }) {
  const fire = useFire()
  const [q, setQ] = useState('')
  const [found, setFound] = useState<RulesItem[]>([])
  useEffect(() => {
    const t = setTimeout(() => void roundA.items(rules, q).then(setFound), 250)
    return () => clearTimeout(t)
  }, [rules, q])
  return (
    <>
      <Text size={14} style={{ color: fire.muted }}>
        Armor and weapons you start with. Armor sets your armor class; weapons show up in your actions.
      </Text>
      {chosen.map((it, i) => (
        <View
          key={`${it.id}${i}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            padding: 12,
            borderRadius: 12,
            backgroundColor: fire.amberSoft,
          }}
        >
          <Text weight="bold" style={{ flex: 1, color: fire.ink }}>
            {it.name}
          </Text>
          <FireButton label="Remove" kind="quiet" height={40} onPress={() => onChange(chosen.filter((_, k) => k !== i))} />
        </View>
      ))}
      <Field label="Search the rules" value={q} onChange={setQ} placeholder="Longsword, chain mail…" />
      {found.slice(0, 25).map((it) => (
        <View
          key={it.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            padding: 12,
            borderRadius: 12,
            backgroundColor: fire.card,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text weight="bold" style={{ color: fire.ink }}>
              {it.name}
            </Text>
            <Text size={12} style={{ color: fire.muted }}>
              {it.weapon ? `${it.weapon.damage} ${it.weapon.type}` : it.armor ? `AC ${it.armor.base}${it.armor.dex ? ' + Dex' : ''}` : it.kind} · {it.weight} lb
            </Text>
          </View>
          {chosen.some((x) => x.id === it.id) ? (
            <Text weight="bold" style={{ color: fire.green }}>
              ✓ Added
            </Text>
          ) : null}
          <FireButton label={chosen.some((x) => x.id === it.id) ? '+' : '+ Add'} height={40} onPress={() => onChange([...chosen, it])} />
        </View>
      ))}
    </>
  )
}

function Spells({
  rules,
  cls,
  counts,
  maxLevel,
  chosen,
  onChange,
}: {
  rules: RulesSet
  cls: string
  counts: { cantrips: number; spells: number }
  maxLevel: number
  chosen: SheetSpell[]
  onChange: (v: SheetSpell[]) => void
}) {
  const fire = useFire()
  const [level, setLevel] = useState(counts.cantrips ? 0 : 1)
  const [found, setFound] = useState<SrdSpellSummary[]>([])
  useEffect(() => {
    void roundA.spells(rules, '', { level, cls }).then(setFound)
  }, [rules, level, cls])
  const cantrips = chosen.filter((s) => s.level === 0).length
  const spells = chosen.filter((s) => s.level > 0).length
  const full = level === 0 ? cantrips >= counts.cantrips : spells >= counts.spells
  return (
    <>
      <Text size={14} style={{ color: fire.muted }}>
        Cantrips {cantrips} of {counts.cantrips} · spells {spells} of {counts.spells}
      </Text>
      <Chips>
        {Array.from({ length: maxLevel + 1 }, (_, i) => i)
          .filter((i) => i > 0 || counts.cantrips > 0)
          .map((i) => (
            <Chip key={i} label={i === 0 ? 'Cantrips' : `Level ${i}`} on={level === i} onPress={() => setLevel(i)} />
          ))}
      </Chips>
      {found.slice(0, 60).map((s) => {
        const on = chosen.some((c) => c.slug === s.slug)
        return (
          <Pressable
            key={s.slug}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: !on && full }}
            disabled={!on && full}
            onPress={async () => {
              if (on) return onChange(chosen.filter((c) => c.slug !== s.slug))
              const full2 = await roundA.spell(rules, s.slug)
              if (full2) onChange([...chosen, sheetSpellFrom(full2)])
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              padding: 12,
              borderRadius: 12,
              backgroundColor: on ? fire.amberSoft : fire.card,
              borderWidth: 1,
              borderColor: on ? fire.amber : fire.line,
              opacity: !on && full ? 0.45 : 1,
            }}
          >
            <Text weight="bold" style={{ flex: 1, color: fire.ink }}>
              {s.name}
            </Text>
            <Text size={12} style={{ color: fire.muted }}>
              {s.school}
            </Text>
            {on ? <Icon name="check" size={16} color={fire.amber} /> : null}
          </Pressable>
        )
      })}
    </>
  )
}

/** "Copy it in from another sheet": the numbers that matter, then onto the table. */
function CopyIn({ campaignId, rules, level, onBack }: { campaignId: string; rules: RulesSet; level: number; onBack: () => void }) {
  const fire = useFire()
  const [name, setName] = useState('')
  const [classLine, setClassLine] = useState(level > 1 ? `Fighter ${level}` : '')
  const [species, setSpecies] = useState('')
  const [scores, setScores] = useState<Record<Ability, string>>({
    str: '10',
    dex: '10',
    con: '10',
    int: '10',
    wis: '10',
    cha: '10',
  })
  const [ac, setAc] = useState('10')
  const [hp, setHp] = useState('10')
  const [speed, setSpeed] = useState('30')
  const [saves, setSaves] = useState<Ability[]>([])
  const [skills, setSkills] = useState<SkillId[]>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const num = (v: string, lo: number, hi: number, dflt: number) => Math.max(lo, Math.min(hi, Number.parseInt(v, 10) || dflt))

  const save = async () => {
    setBusy(true)
    const data = await builderFor(campaignId, rules)
    const s = blankSheet()
    s.rules = rules
    s.race = species.trim().slice(0, 60)
    s.classes = parseClassLevel(classLine, data)
    s.abilities = Object.fromEntries(ABILITIES.map((a) => [a, num(scores[a], 1, 30, 10)])) as Record<Ability, number>
    s.ac = num(ac, 1, 40, 10)
    const max = num(hp, 1, 999, 10)
    s.hp = { current: max, max, temp: 0 }
    s.speed = num(speed, 0, 200, 30)
    s.saves = Object.fromEntries(saves.map((a) => [a, true]))
    s.skills = Object.fromEntries(skills.map((k) => [k, 1]))
    s.hitDice = s.classes.map((c) => ({
      die: c.hitDie,
      max: c.level,
      used: 0,
    }))
    const slots = slotsForClasses(s.classes)
    s.spellcasting.slots = slots.slots.map((m) => ({ max: m, used: 0 }))
    s.spellcasting.pact = slots.pact ? { level: slots.pact.level, max: slots.pact.slots, used: 0 } : null
    s.spellcasting.ability = data?.classes.find((c) => c.name === s.classes[0]?.name)?.spellAbility ?? null
    s.notes = notes.slice(0, 20000)
    const r = await roundA.makeCharacter(campaignId, name.trim(), normalizeSheet(s))
    setBusy(false)
    if (!r.ok) return void inform("Couldn't bring them over", r.message)
    upsertCharacter(campaignId, r.data)
    router.replace({
      pathname: '/campfire/character/[id]',
      params: { id: r.data.id, campaign: campaignId },
    })
  }

  return (
    <Frame
      title="Copy your character in"
      sub="From Roll20, paper or another app"
      onClose={onBack}
      foot={
        <FireButton
          label={name.trim() ? `Bring ${name.trim()} to the table` : 'Bring them to the table'}
          kind="primary"
          busy={busy}
          disabled={!name.trim() || !classLine.trim()}
          onPress={() => void save()}
        />
      }
    >
      <Field label="Name" value={name} onChange={setName} placeholder="Bram Ashford" />
      <Field label="Class and level" value={classLine} onChange={setClassLine} placeholder="Cleric 6 (Life Domain)" />
      <Field label="Species" value={species} onChange={setSpecies} placeholder="Hill dwarf" />
      <Text size={12} weight="bold" style={{ color: fire.muted }}>
        Ability scores
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ABILITIES.map((a) => (
          <View key={a} style={{ width: '31%' }}>
            <Field label={a.toUpperCase()} numeric value={scores[a]} onChange={(v) => setScores({ ...scores, [a]: v.replace(/\D/g, '').slice(0, 2) })} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Field label="AC" numeric value={ac} onChange={setAc} />
        <Field label="HP max" numeric value={hp} onChange={setHp} />
        <Field label="Speed" numeric value={speed} onChange={setSpeed} />
      </View>
      <Text size={12} weight="bold" style={{ color: fire.muted }}>
        Saving throws you’re proficient in
      </Text>
      <Chips>
        {ABILITIES.map((a) => (
          <Chip key={a} label={a.toUpperCase()} on={saves.includes(a)} onPress={() => setSaves(saves.includes(a) ? saves.filter((x) => x !== a) : [...saves, a])} />
        ))}
      </Chips>
      <Text size={12} weight="bold" style={{ color: fire.muted }}>
        Skills you’re proficient in
      </Text>
      <Chips>
        {(Object.keys(SKILLS) as SkillId[]).map((k) => (
          <Chip key={k} label={SKILLS[k].name} on={skills.includes(k)} onPress={() => setSkills(skills.includes(k) ? skills.filter((x) => x !== k) : [...skills, k])} />
        ))}
      </Chips>
      <Field label="Notes (features, items, spells)" value={notes} onChange={setNotes} multiline />
      <Text size={12} style={{ color: fire.muted }}>
        Attacks and spells go on the sheet afterwards (Edit on the sheet, or “Add from the rules”).
      </Text>
    </Frame>
  )
}
