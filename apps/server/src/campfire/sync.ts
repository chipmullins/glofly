import { eq } from "drizzle-orm";
import {
  instantDeath,
  applyDamage,
  concentrationDc,
  damageModsFor,
  deathSaveFailures,
  heal,
  hpState,
  normalizeSheet,
  NO_DEATH_SAVES,
  type AttackKind,
  type DamageType,
  type HitEvent,
  type Sheet5e,
  type TokenBar,
} from "@glofly/shared";
import { db } from "../db";
import { campfireCharacters, campfireTokens } from "../db/schema";
import { settingsOf, type CampaignRow, type Table } from "./perms";
import { broadcast, charactersInfo, emitCharacter, emitToken, sceneRow, tokensWithScenes } from "./state";
import { controls, tokenVisible, type CharacterInfo, type CharacterRow, type SceneRow, type TokenRow, type Viewer } from "./view";

// HP kept in step between sheets and tokens (a token's bar 0 is HP), and the hit flow's last
// step: applying damage or healing, telling every app to animate it.

const HP_COLOR = "#e0193a";

/** Every token linked to a character gets its HP (bar 0) from the sheet. */
export async function syncTokensFromSheet(campaign: CampaignRow, characterId: string, sheet: Sheet5e, skipTokenId?: string): Promise<void> {
  const linked = await db.select().from(campfireTokens).where(eq(campfireTokens.characterId, characterId));
  for (const token of linked) {
    if (token.id === skipTokenId) continue;
    const bar0 = token.bars[0];
    if (bar0 && bar0.value === sheet.hp.current && bar0.max === sheet.hp.max) continue;
    const bars: (TokenBar | null)[] = [
      { value: sheet.hp.current, max: sheet.hp.max, color: bar0?.color ?? HP_COLOR, show: bar0?.show ?? "all" },
      token.bars[1] ?? null,
      token.bars[2] ?? null,
    ];
    const [row] = await db.update(campfireTokens).set({ bars, updatedAt: new Date() }).where(eq(campfireTokens.id, token.id)).returning();
    const scene = await sceneRow(token.sceneId);
    if (scene && row) await emitToken(campaign, scene, token, row);
  }
}

/** A token's HP bar changed: its character's sheet follows (players can't raise a locked sheet's max). */
export async function syncSheetFromToken(t: Table, token: TokenRow, byPlayer: boolean): Promise<void> {
  if (!token.characterId) return;
  const [ch] = await db.select().from(campfireCharacters).where(eq(campfireCharacters.id, token.characterId));
  const bar = token.bars[0];
  if (!ch || !bar || bar.value === null) return;
  const sheet = normalizeSheet(ch.sheet);
  const max = byPlayer && sheet.locked ? sheet.hp.max : Math.max(0, bar.max ?? sheet.hp.max);
  sheet.hp = { ...sheet.hp, max, current: Math.min(max, Math.max(0, bar.value)) };
  await db.update(campfireCharacters).set({ sheet, updatedAt: new Date() }).where(eq(campfireCharacters.id, ch.id));
  await syncTokensFromSheet(t.campaign, ch.id, sheet, byPlayer && sheet.locked ? undefined : token.id);
  await emitCharacter(t.campaign, ch.id);
}

/** A token's HP: from its sheet when it has one, otherwise its own bar 0. */
async function hpOf(token: TokenRow): Promise<{ character: CharacterRow | null; sheet: Sheet5e | null; hp: number; max: number; temp: number }> {
  const [character] = token.characterId ? await db.select().from(campfireCharacters).where(eq(campfireCharacters.id, token.characterId)) : [];
  if (character) {
    const sheet = normalizeSheet(character.sheet);
    return { character, sheet, hp: sheet.hp.current, max: sheet.hp.max, temp: sheet.hp.temp };
  }
  const bar = token.bars[0];
  return { character: null, sheet: null, hp: bar?.value ?? 0, max: bar?.max ?? 0, temp: 0 };
}

export type HitInput = {
  attackerTokenId: string | null;
  targetTokenId: string;
  amount: number;
  damageType: DamageType | null;
  kind: AttackKind;
  crit: boolean;
};

const withMarker = (list: string[], marker: string, on: boolean) => (on ? [...new Set([...list, marker])] : list.filter((c) => c !== marker));

/**
 * Applies damage to a token: resistances from its sheet, temporary HP first, its sheet and every
 * token linked to it, death save failures for a PC already down, "unconscious" for a PC at 0 and
 * "defeated" for an NPC. Then `campfire:hit` so every app animates it. Null if the token is gone.
 */
export async function applyHit(campaign: CampaignRow, hit: HitInput): Promise<HitEvent | null> {
  const [found] = await tokensWithScenes([hit.targetTokenId]);
  if (!found || found.scene.campaignId !== campaign.id) return null;
  const { token, scene } = found;
  const { character, sheet, hp, max, temp } = await hpOf(token);
  const result = applyDamage(hp, temp, hit.amount, damageModsFor(sheet, hit.damageType));
  const pc = character?.kind === "pc";
  let conditions = token.conditions;
  if (sheet && character) {
    sheet.hp = { max, current: result.hp, temp: result.temp };
    if (pc && result.taken > 0) {
      if (instantDeath(hp, temp, result.taken, max)) sheet.deathSaves = { ...NO_DEATH_SAVES, failures: 3, dead: true };
      else if (hp === 0) sheet.deathSaves = deathSaveFailures(sheet.deathSaves, hit.crit ? 2 : 1).state;
      else if (result.hp === 0) sheet.deathSaves = { ...NO_DEATH_SAVES };
      if (result.hp === 0 && !sheet.conditions.includes("unconscious")) sheet.conditions = [...sheet.conditions, "unconscious"];
    }
    await db.update(campfireCharacters).set({ sheet, updatedAt: new Date() }).where(eq(campfireCharacters.id, character.id));
    await syncTokensFromSheet(campaign, character.id, sheet, token.id);
    await emitCharacter(campaign, character.id);
  }
  if (!pc) conditions = withMarker(conditions, "defeated", result.hp <= 0);
  const bar0 = token.bars[0];
  const bars: (TokenBar | null)[] = [
    { value: result.hp, max, color: bar0?.color ?? HP_COLOR, show: bar0?.show ?? "all" },
    token.bars[1] ?? null,
    token.bars[2] ?? null,
  ];
  const [row] = await db.update(campfireTokens).set({ bars, conditions, updatedAt: new Date() }).where(eq(campfireTokens.id, token.id)).returning();
  const event: HitEvent = {
    attackerTokenId: hit.attackerTokenId,
    targetTokenId: token.id,
    amount: result.taken,
    kind: hit.kind,
    crit: hit.crit,
    defeated: result.hp <= 0,
    bloodied: hpState(result.hp, max) === "bloodied",
    ...(sheet?.concentration && result.taken > 0 ? { concentrationDc: concentrationDc(result.taken) } : {}),
  };
  await emitToken(campaign, scene, token, row);
  await emitHit(campaign, event);
  return event;
}

type HitTokens = { target: { token: TokenRow; scene: SceneRow } | undefined; attacker: { token: TokenRow; scene: SceneRow } | undefined; chars: CharacterInfo };

async function hitTokens(campaign: CampaignRow, event: HitEvent): Promise<HitTokens> {
  const ids = [event.targetTokenId, ...(event.attackerTokenId ? [event.attackerTokenId] : [])];
  const rows = await tokensWithScenes(ids);
  return {
    target: rows.find((r) => r.token.id === event.targetTokenId),
    attacker: rows.find((r) => r.token.id === event.attackerTokenId),
    chars: await charactersInfo(campaign.id),
  };
}

/** A hit as this viewer may see it (null: they can't see the target). */
function hitFor(campaign: CampaignRow, event: HitEvent, v: Viewer, { target, attacker, chars }: HitTokens): HitEvent | null {
  if (!target) return null;
  if (!v.gm && target.scene.id !== campaign.activeSceneId) return null;
  if (!tokenVisible(target.token, target.scene, v, chars)) return null;
  const { concentrationDc: dc, ...rest } = event;
  const seesAttacker = !!attacker && tokenVisible(attacker.token, attacker.scene, v, chars);
  // The concentration prompt is for whoever plays the target, and the GMs.
  const theirs = v.gm || controls(target.token, v.userId, chars);
  // A monster's exact HP may be hidden from players (campaign setting): then so is the number,
  // and with "none" whether it's bloodied too.
  const pcTarget = !!target.token.characterId && chars.get(target.token.characterId)?.kind === "pc";
  const showHp = settingsOf(campaign.settings).showMonsterHp;
  const hideAmount = !theirs && !pcTarget && showHp !== "exact" && !rest.miss;
  return {
    ...rest,
    ...(hideAmount ? { amount: 0, amountHidden: true } : {}),
    ...(!theirs && !pcTarget && showHp === "none" ? { bloodied: false } : {}),
    attackerTokenId: seesAttacker ? event.attackerTokenId : null,
    ...(dc !== undefined && theirs ? { concentrationDc: dc } : {}),
  };
}

/** A hit for the person who caused it (their answer is filtered like the live event). */
export async function hitForTable(t: Table, event: HitEvent | null): Promise<HitEvent | null> {
  if (!event || t.gm) return event;
  return hitFor(t.campaign, event, { userId: t.userId, gm: false }, await hitTokens(t.campaign, event));
}

/** `campfire:hit` to everyone who can see the target (attackers they can't see become null). */
export async function emitHit(campaign: CampaignRow, event: HitEvent): Promise<void> {
  const tokens = await hitTokens(campaign, event);
  if (!tokens.target) return;
  await broadcast(campaign, "campfire:hit", (v) => hitFor(campaign, event, v, tokens));
}

/** Healing a token (and its sheet): a PC back above 0 is no longer unconscious or dying. */
export async function applyHeal(campaign: CampaignRow, tokenId: string, amount: number): Promise<TokenRow | null> {
  const [found] = await tokensWithScenes([tokenId]);
  if (!found || found.scene.campaignId !== campaign.id) return null;
  const { token, scene } = found;
  const { character, sheet, hp, max } = await hpOf(token);
  // The dead stay dead (a GM can change the sheet by hand).
  if (sheet?.deathSaves.dead) return token;
  const next = heal(hp, max, amount);
  if (sheet && character) {
    sheet.hp = { ...sheet.hp, current: next };
    if (next > 0) {
      sheet.deathSaves = { ...NO_DEATH_SAVES };
      sheet.conditions = sheet.conditions.filter((c) => c !== "unconscious");
    }
    await db.update(campfireCharacters).set({ sheet, updatedAt: new Date() }).where(eq(campfireCharacters.id, character.id));
    await syncTokensFromSheet(campaign, character.id, sheet, token.id);
    await emitCharacter(campaign, character.id);
  }
  const bar0 = token.bars[0];
  const bars: (TokenBar | null)[] = [{ value: next, max, color: bar0?.color ?? HP_COLOR, show: bar0?.show ?? "all" }, token.bars[1] ?? null, token.bars[2] ?? null];
  const conditions = character?.kind === "pc" ? token.conditions : withMarker(token.conditions, "defeated", next <= 0);
  const [row] = await db.update(campfireTokens).set({ bars, conditions, updatedAt: new Date() }).where(eq(campfireTokens.id, token.id)).returning();
  await emitToken(campaign, scene, token, row);
  return row;
}
