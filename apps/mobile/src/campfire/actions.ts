import { ammoStack, attackExpressions, checkRange, isFullCharacter, needsBothHands, reachOfAttack, type ArmedAttack, type Character, type GridSettings, type RollVisibility, type SheetAttack, type Token } from '@glofly/shared'
import { inform } from '@/ui/dialogs'
import { haptic } from '@/constellations/motion'
import { campfireApi } from './api'
import { upsertCharacter } from './store'

// Rolling at the table: every die is rolled on the server (everyone sees the same number).

export async function rollAtTable(campaignId: string, expression: string, opts: { label?: string | null; characterId?: string | null; visibility?: RollVisibility } = {}): Promise<boolean> {
  haptic.light()
  const r = await campfireApi.roll(campaignId, { expression, label: opts.label ?? null, characterId: opts.characterId ?? null, visibility: opts.visibility ?? 'all' })
  if (!r.ok) {
    void inform("Couldn't roll", r.message)
    return false
  }
  return true
}

/**
 * An action from the sheet: with a target picked on the map, the server rolls to hit against its
 * AC (players learn hit or miss, never the AC) and then the damage. Without one, it's two plain
 * rolls (to hit, then damage) for the table to see.
 */
export async function takeAction(campaignId: string, ch: Character, attack: SheetAttack, attacker: Token | null, targetId: string | null): Promise<void> {
  const ex = attackExpressions(ch.sheet, attack)
  if (attacker && targetId && targetId !== attacker.id) {
    haptic.medium()
    const r = await campfireApi.attack(campaignId, {
      attackerTokenId: attacker.id,
      targetTokenId: targetId,
      attack: { id: attack.id, name: attack.name, toHit: ex.toHit, damage: ex.damage, damageType: attack.damageType, kind: attack.kind },
    })
    if (!r.ok) void inform("Couldn't attack", r.message)
    return
  }
  if (!(await rollAtTable(campaignId, ex.toHit, { label: `${attack.name}: to hit`, characterId: ch.id }))) return
  await rollAtTable(campaignId, ex.damage, { label: `${attack.name}: damage`, characterId: ch.id })
}

/**
 * 0.11.4 (desktop's 0.11.3 flow on phones): tap a weapon, then the creature to attack. The range is
 * checked first (past normal range = disadvantage), a two-handed weapon needs the shield off, and
 * each shot uses one arrow / bolt / bullet when the sheet tracks them (the count shows on its row). With a target already picked,
 * it attacks at once; with no token on the map, it's two plain rolls. Returns the armed attack to
 * wait for a tap, or null when it's already done (or refused, with a message).
 */
export async function startAttack(
  campaignId: string,
  ch: Character,
  attack: SheetAttack,
  attacker: Token | null,
  target: Token | null,
  grid: Pick<GridSettings, 'size' | 'feet'>,
  say: (title: string, text: string) => void,
): Promise<ArmedAttack | null> {
  const sheet = isFullCharacter(ch) && ch.kind !== 'npc' ? ch.sheet : null
  const label = attack.name.replace(/ \(two hands\)$/, '')
  if (sheet && needsBothHands(attack) && sheet.inventory.some((i) => i.equipped && i.kind === 'shield')) {
    say('Both hands needed', `${ch.name} has a shield equipped. Unequip it (Equipment) to use ${label} with both hands.`)
    return null
  }
  const ammo = sheet ? ammoStack(sheet.inventory, attack) : null
  if (ammo && ammo.qty <= 0) {
    say('Out of ammunition', `${ch.name} is out of ${ammo.name.toLowerCase()}.`)
    return null
  }
  if (!attacker) {
    await takeAction(campaignId, ch, attack, null, null)
    return null
  }
  const ex = attackExpressions(ch.sheet, attack)
  const fire = async (t: Token, dis: boolean): Promise<void> => {
    haptic.medium()
    const r = await campfireApi.attack(campaignId, {
      attackerTokenId: attacker.id,
      targetTokenId: t.id,
      attack: { id: attack.id, name: attack.name, toHit: ex.toHit, damage: ex.damage, damageType: attack.damageType, kind: attack.kind },
      ...(dis ? { advantage: 'dis' as const } : {}),
    })
    if (!r.ok) return void inform("Couldn't attack", r.message)
    if (!ammo) return
    // The sheet as it is now (it can change while the attack waits for its target).
    const fresh = await campfireApi.character(ch.id)
    const now = fresh.ok ? fresh.data : null
    if (!now || !isFullCharacter(now)) return
    const inventory = now.sheet.inventory.map((i) => (i.id === ammo.id ? { ...i, qty: Math.max(0, i.qty - 1) } : i))
    const saved = await campfireApi.saveCharacter(ch.id, { sheet: { ...now.sheet, inventory } })
    if (saved.ok) upsertCharacter(campaignId, saved.data)
    const left = inventory.find((i) => i.id === ammo.id)?.qty ?? 0
    // How many are left shows on the attack's row; only running out gets a message.
    if (!left) say(ammo.name, `That was the last of the ${ammo.name.toLowerCase()}.`)
  }
  const reach = reachOfAttack(attack)
  if (target && target.id !== attacker.id) {
    const c = checkRange(reach, attacker, target, grid, label)
    if (!c.ok) {
      say('Out of range', c.why.replace(/^Out of range: /, ''))
      return null
    }
    await fire(target, c.dis)
    return null
  }
  haptic.light()
  return { attackerId: attacker.id, name: label, reach, fire }
}
