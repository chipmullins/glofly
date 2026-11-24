import { useState } from 'react'
import { ammoStack, withTwoHanded } from '@glofly/shared/campfire/builder'
import { Pressable, ScrollView, View } from 'react-native'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import Animated, { LinearTransition } from 'react-native-reanimated'
import { attackExpressions, attackToHit, reachText, type ArmedAttack, type Character, type SheetAttack, type TableState, type Token } from '@glofly/shared'
import { Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { inform } from '@/ui/dialogs'
import { haptic } from '@/constellations/motion'
import { campfireApi, fileSource } from './api'
import { rollAtTable } from './actions'
import { storeToken } from './store'
import { Bar, FireButton } from './ui'
import { MovementRow } from './BoardB'
import { useMovement } from './roundB'
import { useSession } from '@/state/session'
import { hpColor, initialOf, signed, tokenName, useFire, useStill } from './lib'

// The Phone board's bottom sheet: whose turn it is (yours glows), your HP, your actions (0.11.4:
// tap one, then the creature to attack on the map; a target already picked is attacked at once),
// the dice row, your character sheet and End my turn. Game masters can hide or show the picked
// token. Tap the handle to fold it down and see more of the map.

const DICE = ['d4', 'd6', 'd8', 'd12', 'd20'] as const

export function TableSheet({
  campaignId,
  table,
  character,
  token,
  targetId,
  armed,
  onAttack,
  onCancelAttack,
  collapsed,
  onToggle,
  onOpenPanel,
  bottomPad,
}: {
  campaignId: string
  table: TableState
  character: Character | null
  token: Token | null
  targetId: string | null
  /** An attack waiting for its target (tap a creature on the map) */
  armed: ArmedAttack | null
  onAttack: (a: SheetAttack) => Promise<void>
  onCancelAttack: () => void
  collapsed: boolean
  onToggle: () => void
  onOpenPanel: (p: 'order' | 'rolls') => void
  bottomPad: number
}) {
  const fire = useFire()
  const still = useStill()
  const [busy, setBusy] = useState<string | null>(null)
  const combat = table.combat
  const myTurn = !!combat && !!token && combat.current === token.id
  const currentToken = combat?.current ? table.tokens.find((t) => t.id === combat.current) : undefined
  const myEntry = combat && token ? combat.entries.find((e) => e.tokenId === token.id) : undefined
  const sheet = character?.sheet
  const hp = sheet?.hp ?? character?.summary.hp
  const target = targetId ? table.tokens.find((t) => t.id === targetId) : undefined
  const gm = table.myRole === 'gm'
  const meId = useSession((s) => s.user?.id ?? '')
  const mv = useMovement(table, meId)
  const paused = !!table.campaign.live?.paused && !gm
  // Game masters get the full NPC sheets: the picked creature's stat block opens from here.
  const targetSheet = gm && target?.characterId ? table.characters.find((c) => c.id === target.characterId && c.kind === 'npc') : undefined
  const name = character?.name ?? (gm ? 'Game master' : 'You')

  const title = myTurn ? 'Your turn' : combat ? (currentToken ? `${tokenName(currentToken)}'s turn` : 'Someone’s turn') : gm ? 'Game master' : 'Exploring'
  const subtitle = paused
    ? 'The table is paused · you can still look at your sheet'
    : armed
      ? `Tap who to attack with ${armed.name} · ${reachText(armed.reach)}`
      : myTurn
      ? mv
        ? `Drag ${character?.name ?? 'your token'} to plan a move · rest your finger to turn a corner`
        : `Drag ${character?.name ?? 'your token'} on the map to move · ${sheet?.speed ?? 30} ft`
      : target
        ? `Targeting ${tokenName(target)} · tap an action to attack`
        : combat
          ? `Round ${combat.round}${myEntry && myEntry.init === null ? ' · roll your initiative' : ''}`
          : token
            ? 'Tap a token to target it · long-press to ping'
            : gm
              ? 'Run the game on a computer; roll from here.'
              : 'You don’t have a token on this map yet.'

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  const portrait = character?.portraitFileId ?? token?.imageFileId ?? null
  const attacks = withTwoHanded(sheet?.attacks ?? [])
  return (
    <Animated.View
      layout={still ? undefined : LinearTransition.duration(220)}
      style={{
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        backgroundColor: fire.panel,
        boxShadow: '0 -10px 30px rgba(0,0,0,0.5)',
        paddingTop: 10,
        paddingHorizontal: 16,
        paddingBottom: bottomPad + 14,
        gap: 12,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={collapsed ? 'Show actions and dice' : 'Fold the actions down'}
        accessibilityState={{ expanded: !collapsed }}
        onPress={onToggle}
        hitSlop={8}
        style={{ alignSelf: 'stretch', alignItems: 'center', height: 20, justifyContent: 'center', marginTop: -6 }}
      >
        <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: fire.handle }} />
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} accessible accessibilityLabel={`${title}. ${subtitle}${hp ? `. ${hp.current} of ${hp.max} hit points` : ''}`}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: fire.greenDeep,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            borderWidth: 3,
            borderColor: fire.green,
            boxShadow: myTurn ? '0 0 16px 4px rgba(255,179,71,0.5)' : undefined,
          }}
        >
          {portrait ? (
            <Image source={fileSource(portrait)} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          ) : (
            <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 18, color: '#fff' }}>{initialOf(name)}</Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text numberOfLines={1} style={{ fontFamily: 'Outfit_700Bold', fontSize: 17, color: myTurn ? fire.amber : fire.ink }}>
            {title}
          </Text>
          <Text size={13} numberOfLines={2} style={{ color: fire.muted }}>
            {subtitle}
          </Text>
        </View>
        {hp ? (
          <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 14, color: fire.ink }}>
            {hp.current}/{hp.max}
            {hp.temp ? <Text style={{ color: fire.amber, fontFamily: 'Outfit_700Bold', fontSize: 13 }}>{` +${hp.temp}`}</Text> : null}
          </Text>
        ) : null}
      </View>
      {hp && hp.max > 0 ? <Bar fraction={hp.current / hp.max} color={hpColor(fire, hp.current, hp.max)} /> : null}
      {mv && !paused ? <MovementRow campaignId={campaignId} mv={mv} /> : null}

      {armed ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(239,90,74,0.55)', backgroundColor: 'rgba(239,90,74,0.12)' }}>
          <Icon name="target" size={18} color={fire.red} />
          <Text size={14} weight="bold" numberOfLines={2} style={{ flex: 1, color: fire.ink }} accessibilityLiveRegion="polite">
            {armed.name}: tap a creature on the map
          </Text>
          <FireButton label="Cancel" height={36} size={13} onPress={onCancelAttack} />
        </View>
      ) : null}
      {collapsed ? null : (
        <>
          {character && attacks.length ? (
            <ScrollView style={{ maxHeight: 2 * 52 + 8 }} contentContainerStyle={{ gap: 8 }} nestedScrollEnabled>
              {attacks.map((a) => {
                const toHit = attackToHit(character.sheet, a)
                const ammo = ammoStack(character.sheet.inventory, a)
                return (
                  <Pressable
                    key={a.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${a.name}, ${signed(toHit)} to hit, ${a.damage} ${a.damageType}${ammo ? `, ${ammo.qty} ${ammo.name.toLowerCase()} left` : ''}${target ? `. Attack ${tokenName(target)}` : token ? '. Then tap who to attack' : '. Roll it'}`}
                    accessibilityState={{ selected: armed?.name === a.name.replace(/ \(two hands\)$/, '') }}
                    disabled={busy !== null}
                    onPress={() => void run(a.id, () => onAttack(a))}
                    style={({ pressed }) => ({
                      minHeight: 44,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: target || armed?.name === a.name.replace(/ \(two hands\)$/, '') ? 'rgba(239,90,74,0.45)' : fire.line,
                      backgroundColor: fire.card,
                      opacity: pressed || busy === a.id ? 0.75 : 1,
                    })}
                  >
                    <Text size={14} weight="bold" numberOfLines={1} style={{ flex: 1, color: fire.ink }}>
                      {a.name}
                    </Text>
                    <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 13, color: fire.amber }}>{signed(toHit)}</Text>
                    <Text size={13} style={{ color: fire.muted }}>
                      {attackDamageText(character, a)}
                    </Text>
                    {ammo ? (
                      <Text size={12} weight="bold" style={{ color: ammo.qty ? fire.muted : fire.red }}>
                        {`×${ammo.qty}`}
                      </Text>
                    ) : null}
                    <Icon name={target || token ? 'target' : 'dice'} size={16} color={target ? fire.red : fire.muted} />
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : null}
          {gm && target ? (
            <FireButton
              label={target.layer === 'gm' ? `Show ${tokenName(target)} to players` : `Hide ${tokenName(target)} from players`}
              icon={target.layer === 'gm' ? 'eye' : 'eyeOff'}
              busy={busy === 'hide'}
              onPress={() =>
                void run('hide', async () => {
                  haptic.light()
                  const r = await campfireApi.setTokenLayer(target.id, target.layer === 'gm' ? 'tokens' : 'gm')
                  if (!r.ok) void inform("Couldn't change that", r.message)
                  else storeToken(campaignId, r.data)
                })
              }
            />
          ) : null}
          {gm && targetSheet ? (
            <FireButton
              label={`${tokenName(target)}'s stat block`}
              icon="scroll"
              a11y={`Open ${tokenName(target)}'s stat block (game masters only)`}
              onPress={() => router.push({ pathname: '/campfire/character/[id]', params: { id: targetSheet.id, campaign: campaignId } })}
            />
          ) : null}
          {character && attacks.length ? null : !character && !gm ? (
            <FireButton label="Make your character" icon="plus" onPress={() => router.push({ pathname: '/campfire/character/[id]', params: { id: 'new', campaign: campaignId } })} />
          ) : null}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {DICE.map((d) => (
              <FireButton
                key={d}
                label={d}
                a11y={`Roll a ${d}`}
                kind={d === 'd20' ? 'amber' : 'card'}
                height={44}
                size={14}
                style={{ flex: 1, paddingHorizontal: 0, borderRadius: 12 }}
                onPress={() => void rollAtTable(campaignId, `1${d}`, { characterId: character?.id ?? null })}
              />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {character ? (
              <FireButton label="Character sheet" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/campfire/character/[id]', params: { id: character.id, campaign: campaignId } })} />
            ) : (
              <FireButton label="Rolls" icon="dice" style={{ flex: 1 }} onPress={() => onOpenPanel('rolls')} />
            )}
            {myTurn ? (
              <FireButton
                label="End my turn"
                kind="primary"
                busy={busy === 'end'}
                style={{ flex: 1 }}
                onPress={() =>
                  void run('end', async () => {
                    haptic.medium()
                    const r = await campfireApi.combat(campaignId, { op: 'next' })
                    if (!r.ok) void inform("Couldn't end your turn", r.message)
                  })
                }
              />
            ) : myEntry && myEntry.init === null && token ? (
              <FireButton
                label="Roll initiative"
                kind="primary"
                busy={busy === 'init'}
                style={{ flex: 1 }}
                onPress={() =>
                  void run('init', async () => {
                    const r = await campfireApi.combat(campaignId, { op: 'roll', tokenId: token.id })
                    if (!r.ok) void inform("Couldn't roll initiative", r.message)
                  })
                }
              />
            ) : (
              <FireButton label="Turn order" icon="order" style={{ flex: 1 }} onPress={() => onOpenPanel('order')} disabled={!combat} a11y={combat ? 'Turn order' : 'Turn order (no fight going on)'} />
            )}
          </View>
        </>
      )}
    </Animated.View>
  )
}

/** "1d8+4" like the board: the attack's damage with the ability modifier worked in. */
const attackDamageText = (ch: Character, a: Character['sheet']['attacks'][number]): string => attackExpressions(ch.sheet, a).damage
