import { attackExpressions, type Character, type RollVisibility, type SheetAttack, type Token } from '@glofly/shared'
import { inform } from '@/ui/dialogs'
import { haptic } from '@/constellations/motion'
import { campfireApi } from './api'

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
