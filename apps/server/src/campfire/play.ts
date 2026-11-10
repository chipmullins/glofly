import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import {
  ABILITIES,
  attackExpressions,
  critDice,
  DAMAGE_TYPES,
  deathSave,
  initiativeBonus,
  normalizeSheet,
  parseDice,
  rollDice,
  saveBonus,
  withBonus,
  type AttackResult,
  type CombatEntry,
  type CombatState,
  type DamageType,
  type HitEvent,
  type PendingDamage,
  type Roll,
  type RollVisibility,
  type SaveSpellResult,
  type Sheet5e,
} from "@glofly/shared";
import { db } from "../db";
import { campfireCampaigns, campfireCharacters, campfirePending, campfireRolls } from "../db/schema";
import { inHome, settingsOf, type Table } from "./perms";
import { bad, firstIssue, idParam, limiter, notFound, recordRoll, rollSlot, serverRng, tableOr, TOO_MANY_ROLLS, uuidList } from "./http";
import { charactersInfo, emitCharacter, emitCombat, emitPending, tokensWithScenes, visibleTokenIdsFor } from "./state";
import { applyHeal, applyHit, emitHit, syncTokensFromSheet } from "./sync";
import { tokenTable } from "./routes";
import { combatOut, controls, pendingOut, rollOut, tokenVisible, type CharacterRow, type TokenRow } from "./view";

// Campfire play: rolls, the hit flow (attack → hit or miss → damage → GM approves → applied),
// save spells, healing, death saves and the turn order. Every roll is made here with crypto
// randomness. Players learn whether they hit, never the target's AC.
//
//   POST /campfire/campaigns/:id/rolls       { expression, label?, characterId?, visibility, whisperTo? }
//   GET  /campfire/campaigns/:id/rolls?before=
//   POST /campfire/campaigns/:id/attack      { attackerTokenId, targetTokenId, attack, advantage? }
//   POST /campfire/campaigns/:id/save-spell  { casterTokenId, targetTokenIds, dc, ability, damage, half, damageType?, name? }
//   POST /campfire/pending/:id/apply  { amount? } · POST /campfire/pending/:id/skip   (GM)
//   POST /campfire/tokens/:id/damage  { amount, type?, kind? } · …/heal { amount }
//   POST /campfire/characters/:id/death-save
//   POST /campfire/campaigns/:id/combat      { op, … }

export const playRouter = Router();

const actLimiter = limiter("campfire:act", 300, 60 * 1000, "That's a lot at once. Wait a moment and try again.");

const viz = z.enum(["all", "gm", "whisper"]);

/** Players' rolls go only to GMs when the campaign says so. */
const visibilityFor = (t: Table, wanted: RollVisibility): RollVisibility => (!t.gm && settingsOf(t.campaign.settings).diceVisibility === "gm" ? "gm" : wanted);

async function characterIn(campaignId: string, id: string): Promise<CharacterRow | null> {
  const [row] = await db.select().from(campfireCharacters).where(and(eq(campfireCharacters.id, id), eq(campfireCharacters.campaignId, campaignId)));
  return row ?? null;
}

/** Rolls an expression on the server (the label may be given separately). */
function serverRoll(expression: string, label?: string | null) {
  const p = parseDice(expression);
  if (!p.ok) return p;
  const result = rollDice(p.expr, serverRng);
  if (label) result.label = label.slice(0, 100);
  return { ok: true as const, result };
}

// ───────────── Rolls ─────────────

playRouter.post("/campaigns/:id/rolls", async (req, res) => {
  const t = await tableOr(res, req.params.id, { write: true });
  if (!t) return;
  const parsed = z
    .object({
      expression: z.string().max(200),
      label: z.string().max(100).nullable().optional(),
      characterId: z.uuid().nullable().optional(),
      visibility: viz.default("all"),
      whisperTo: uuidList(20).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  if (!(await rollSlot(t.userId))) return bad(res, TOO_MANY_ROLLS, 429, "too_many_requests");
  if (d.characterId) {
    const ch = await characterIn(t.campaign.id, d.characterId);
    if (!ch || (!t.gm && ch.ownerId !== t.userId)) return bad(res, "That character isn't yours to roll for.", 403);
  }
  let whisperTo: string[] = [];
  if (d.visibility === "whisper") {
    whisperTo = await inHome(t.campaign, (d.whisperTo ?? []).filter((id) => id !== t.userId));
    if (!whisperTo.length) return bad(res, "Pick who to whisper to.");
  }
  const rolled = serverRoll(d.expression, d.label?.trim() || null);
  if (!rolled.ok) return bad(res, rolled.error);
  const roll = await recordRoll(t.campaign, { userId: t.userId, characterId: d.characterId ?? null, result: rolled.result, visibility: visibilityFor(t, d.visibility), whisperTo });
  res.status(201).json(roll);
});

playRouter.get("/campaigns/:id/rolls", async (req, res) => {
  const t = await tableOr(res, req.params.id);
  if (!t) return;
  const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
  const rows = await db
    .select()
    .from(campfireRolls)
    .where(
      and(
        eq(campfireRolls.campaignId, t.campaign.id),
        before ? lt(campfireRolls.createdAt, before) : undefined,
        t.gm
          ? undefined
          : or(
              eq(campfireRolls.visibility, "all"),
              eq(campfireRolls.userId, t.userId),
              and(eq(campfireRolls.visibility, "whisper"), sql`${t.userId}::uuid = any(${campfireRolls.whisperTo})`),
            ),
      ),
    )
    .orderBy(desc(campfireRolls.createdAt))
    .limit(50);
  res.json({ rolls: rows.map(rollOut) });
});

// ───────────── The hit flow ─────────────

const damageType = z.enum(DAMAGE_TYPES as unknown as [DamageType, ...DamageType[]]);
const attackInput = z.object({
  attackerTokenId: z.uuid(),
  targetTokenId: z.uuid(),
  attack: z.object({
    id: z.string().max(40).optional(),
    name: z.string().max(80).transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "Attack"),
    toHit: z.string().max(100),
    damage: z.string().max(100),
    damageType,
    kind: z.enum(["melee", "ranged", "spell"]),
  }),
  advantage: z.enum(["adv", "dis"]).nullable().optional(),
  visibility: z.enum(["all", "gm"]).optional(),
});

/** The tokens of an attack, on one scene of this campaign, that this person may use / aim at. */
async function attackTokens(t: Table, attackerId: string, targetIds: string[]) {
  const rows = await tokensWithScenes([attackerId, ...targetIds]);
  const attacker = rows.find((r) => r.token.id === attackerId);
  const targets = targetIds.map((id) => rows.find((r) => r.token.id === id));
  if (!attacker || attacker.scene.campaignId !== t.campaign.id || targets.some((x) => !x || x.scene.id !== attacker.scene.id)) return null;
  const chars = await charactersInfo(t.campaign.id);
  if (!t.gm) {
    if (attacker.scene.id !== t.campaign.activeSceneId || !controls(attacker.token, t.userId, chars)) return "notYours" as const;
    if (targets.some((x) => !tokenVisible(x!.token, x!.scene, t, chars))) return null;
  }
  return { attacker: attacker.token, targets: targets.map((x) => x!.token) };
}

async function sheetOf(token: TokenRow): Promise<Sheet5e | null> {
  if (!token.characterId) return null;
  const [ch] = await db.select({ sheet: campfireCharacters.sheet }).from(campfireCharacters).where(eq(campfireCharacters.id, token.characterId));
  return ch ? normalizeSheet(ch.sheet) : null;
}

/** The first d20 of a to-hit roll with advantage or disadvantage. */
const withAdvantage = (expr: string, adv: "adv" | "dis" | null | undefined) =>
  adv ? expr.replace(/(^|[^0-9a-z])1?d20(?![0-9a-z!])/i, (_m, pre: string) => `${pre}2d20${adv === "adv" ? "kh1" : "kl1"}`) : expr;

/** Pending damage for the GM, or applied at once when the campaign doesn't need approval. */
async function damageOrPending(t: Table, hit: Parameters<typeof applyHit>[1]): Promise<{ pending: PendingDamage | null; applied: HitEvent | null }> {
  if (settingsOf(t.campaign.settings).gmApprovesDamage) {
    const [row] = await db
      .insert(campfirePending)
      .values({ campaignId: t.campaign.id, attackerTokenId: hit.attackerTokenId, targetTokenId: hit.targetTokenId, amount: hit.amount, damageType: hit.damageType, kind: hit.kind, crit: hit.crit, createdBy: t.userId })
      .returning();
    await emitPending(t.campaign);
    return { pending: t.gm ? pendingOut(row) : null, applied: null };
  }
  return { pending: null, applied: await applyHit(t.campaign, hit) };
}

playRouter.post("/campaigns/:id/attack", actLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { write: true });
  if (!t) return;
  const parsed = attackInput.safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  const tokens = await attackTokens(t, d.attackerTokenId, [d.targetTokenId]);
  if (tokens === "notYours") return bad(res, "That token isn't yours to attack with.", 403);
  if (!tokens) return notFound(res, "Those tokens aren't on the map together.");
  if (!(await rollSlot(t.userId))) return bad(res, TOO_MANY_ROLLS, 429, "too_many_requests");
  const attackerSheet = await sheetOf(tokens.attacker);
  // An attack from the attacker's own sheet is worked out here; otherwise what the app sent.
  const fromSheet = d.attack.id ? attackerSheet?.attacks.find((a) => a.id === d.attack.id) : undefined;
  const exprs = fromSheet && attackerSheet ? attackExpressions(attackerSheet, fromSheet) : { toHit: d.attack.toHit, damage: d.attack.damage };
  const name = fromSheet?.name ?? d.attack.name;
  const kind = fromSheet?.kind ?? d.attack.kind;
  const type = fromSheet?.damageType ?? d.attack.damageType;
  const toHit = serverRoll(withAdvantage(exprs.toHit, d.advantage), `${name}: to hit`);
  if (!toHit.ok) return bad(res, `To hit: ${toHit.error}`);
  if (toHit.result.natural === null) return bad(res, "An attack roll needs a d20, like 1d20+5.");
  const damageCheck = parseDice(exprs.damage);
  if (!damageCheck.ok) return bad(res, `Damage: ${damageCheck.error}`);
  const visibility: RollVisibility = t.gm ? (d.visibility ?? "all") : visibilityFor(t, "all");
  const targetSheet = await sheetOf(tokens.targets[0]);
  const ac = targetSheet?.ac ?? 10;
  const crit = toHit.result.crit;
  const hit = crit || (!toHit.result.fumble && toHit.result.total >= ac);
  const toHitRoll = await recordRoll(t.campaign, { userId: t.userId, characterId: tokens.attacker.characterId, result: toHit.result, visibility });
  let damageRoll: Roll | null = null;
  let outcome: { pending: PendingDamage | null; applied: HitEvent | null } = { pending: null, applied: null };
  if (hit) {
    // A critical hit rolls the damage dice twice.
    const dmg = serverRoll(crit ? critDice(exprs.damage) : exprs.damage, `${name}: damage${crit ? " (critical)" : ""}`);
    if (!dmg.ok) return bad(res, `Damage: ${dmg.error}`);
    damageRoll = await recordRoll(t.campaign, { userId: t.userId, characterId: tokens.attacker.characterId, result: dmg.result, visibility });
    outcome = await damageOrPending(t, { attackerTokenId: tokens.attacker.id, targetTokenId: tokens.targets[0].id, amount: Math.max(0, dmg.result.total), damageType: type, kind, crit });
  } else {
    await emitHit(t.campaign, { attackerTokenId: tokens.attacker.id, targetTokenId: tokens.targets[0].id, amount: 0, kind, crit: false, defeated: false, bloodied: false, miss: true });
  }
  const out: AttackResult = { hit, crit, toHit: toHitRoll, damage: damageRoll, ...outcome };
  res.json(out);
});

playRouter.post("/campaigns/:id/save-spell", actLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { write: true });
  if (!t) return;
  const parsed = z
    .object({
      casterTokenId: z.uuid(),
      targetTokenIds: uuidList(20).pipe(z.array(z.uuid()).min(1, "Pick who it hits.")),
      dc: z.number().int().min(1).max(40),
      ability: z.enum(ABILITIES as unknown as ["str", "dex", "con", "int", "wis", "cha"]),
      damage: z.string().max(100),
      half: z.boolean(),
      damageType: damageType.nullable().optional(),
      name: z.string().max(80).optional(),
      visibility: z.enum(["all", "gm"]).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  const tokens = await attackTokens(t, d.casterTokenId, d.targetTokenIds);
  if (tokens === "notYours") return bad(res, "That token isn't yours to cast with.", 403);
  if (!tokens) return notFound(res, "Those tokens aren't on the map together.");
  if (!(await rollSlot(t.userId))) return bad(res, TOO_MANY_ROLLS, 429, "too_many_requests");
  const name = d.name?.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "Spell";
  const dmg = serverRoll(d.damage, `${name}: damage`);
  if (!dmg.ok) return bad(res, `Damage: ${dmg.error}`);
  const visibility: RollVisibility = t.gm ? (d.visibility ?? "all") : visibilityFor(t, "all");
  const damageRoll = await recordRoll(t.campaign, { userId: t.userId, characterId: tokens.attacker.characterId, result: dmg.result, visibility });
  const chars = await charactersInfo(t.campaign.id);
  const targets: SaveSpellResult["targets"] = [];
  for (const target of tokens.targets) {
    const sheet = await sheetOf(target);
    const save = serverRoll(withBonus("1d20", sheet ? saveBonus(sheet, d.ability) : 0), `${target.name}: ${d.ability.toUpperCase()} save`);
    if (!save.ok) continue;
    // A monster's save shows its bonus, so it goes to GMs only; players' saves to everyone.
    const pc = !!target.characterId && chars.get(target.characterId)?.kind === "pc";
    const saveRoll = await recordRoll(t.campaign, { userId: t.userId, characterId: target.characterId, result: save.result, visibility: pc ? visibility : "gm" });
    const saved = save.result.total >= d.dc;
    const amount = saved ? (d.half ? Math.floor(Math.max(0, dmg.result.total) / 2) : 0) : Math.max(0, dmg.result.total);
    let outcome: { pending: PendingDamage | null; applied: HitEvent | null } = { pending: null, applied: null };
    if (amount > 0) outcome = await damageOrPending(t, { attackerTokenId: tokens.attacker.id, targetTokenId: target.id, amount, damageType: d.damageType ?? null, kind: "spell", crit: false });
    else await emitHit(t.campaign, { attackerTokenId: tokens.attacker.id, targetTokenId: target.id, amount: 0, kind: "spell", crit: false, defeated: false, bloodied: false, miss: true });
    targets.push({ tokenId: target.id, save: pc || t.gm ? saveRoll : { ...saveRoll, result: { ...saveRoll.result, terms: [], breakdown: "", natural: null, crit: false, fumble: false } }, saved, amount, ...outcome });
  }
  res.json({ damage: damageRoll, targets } satisfies SaveSpellResult);
});

async function pendingTable(res: Parameters<typeof tableOr>[0], id: unknown) {
  const pid = idParam.safeParse(id);
  const [row] = pid.success ? await db.select().from(campfirePending).where(eq(campfirePending.id, pid.data)) : [];
  if (!row) {
    notFound(res, "That damage was already dealt with.");
    return null;
  }
  const t = await tableOr(res, row.campaignId, { gm: true });
  return t ? { t, row } : null;
}

playRouter.post("/pending/:id/apply", actLimiter, async (req, res) => {
  const found = await pendingTable(res, req.params.id);
  if (!found) return;
  const amount = z.number().int().min(0).max(99_999).optional().safeParse(req.body?.amount ?? undefined);
  if (!amount.success) return bad(res, "Damage is a whole number from 0.");
  const { t, row } = found;
  // Taken by one GM only, even if two press Apply together.
  const [taken] = await db.delete(campfirePending).where(eq(campfirePending.id, row.id)).returning();
  if (!taken) return notFound(res, "That damage was already dealt with.");
  const applied = await applyHit(t.campaign, {
    attackerTokenId: row.attackerTokenId,
    targetTokenId: row.targetTokenId,
    amount: amount.data ?? row.amount,
    damageType: (row.damageType as DamageType | null) ?? null,
    kind: row.kind as "melee" | "ranged" | "spell",
    crit: row.crit,
  });
  await emitPending(t.campaign);
  res.json({ applied });
});

playRouter.post("/pending/:id/skip", actLimiter, async (req, res) => {
  const found = await pendingTable(res, req.params.id);
  if (!found) return;
  await db.delete(campfirePending).where(eq(campfirePending.id, found.row.id));
  await emitPending(found.t.campaign);
  res.json({ ok: true });
});

const amountInput = z.object({
  amount: z.number().int().min(0).max(99_999),
  type: damageType.nullable().optional(),
  kind: z.enum(["melee", "ranged", "spell"]).optional(),
});

/** GMs, or players for tokens they control. */
async function hpTokenTable(res: Parameters<typeof tableOr>[0], id: unknown) {
  const found = await tokenTable(res, id, { write: true });
  if (!found) return null;
  if (!found.t.gm && !controls(found.token, found.t.userId, found.chars)) {
    bad(res, "That token isn't yours.", 403);
    return null;
  }
  return found;
}

playRouter.post("/tokens/:id/damage", actLimiter, async (req, res) => {
  const found = await hpTokenTable(res, req.params.id);
  if (!found) return;
  const parsed = amountInput.safeParse(req.body);
  if (!parsed.success) return bad(res, "Damage is a whole number from 0.");
  const applied = await applyHit(found.t.campaign, {
    attackerTokenId: null,
    targetTokenId: found.token.id,
    amount: parsed.data.amount,
    damageType: parsed.data.type ?? null,
    kind: parsed.data.kind ?? "melee",
    crit: false,
  });
  res.json({ applied });
});

playRouter.post("/tokens/:id/heal", actLimiter, async (req, res) => {
  const found = await hpTokenTable(res, req.params.id);
  if (!found) return;
  const parsed = amountInput.safeParse(req.body);
  if (!parsed.success) return bad(res, "Healing is a whole number from 0.");
  await applyHeal(found.t.campaign, found.token.id, parsed.data.amount);
  res.json({ ok: true });
});

playRouter.post("/characters/:id/death-save", actLimiter, async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const [ch] = id.success ? await db.select().from(campfireCharacters).where(eq(campfireCharacters.id, id.data)) : [];
  if (!ch) return notFound(res);
  const t = await tableOr(res, ch.campaignId, { write: true });
  if (!t) return;
  if (!t.gm && ch.ownerId !== t.userId) return notFound(res);
  const sheet = normalizeSheet(ch.sheet);
  if (ch.kind !== "pc" || sheet.hp.current > 0 || sheet.deathSaves.stable || sheet.deathSaves.dead) return bad(res, "Death saves are for characters at 0 HP who are still dying.", 409);
  if (!(await rollSlot(t.userId))) return bad(res, TOO_MANY_ROLLS, 429, "too_many_requests");
  const rolled = serverRoll("1d20", `${ch.name}: death save`);
  if (!rolled.ok) return bad(res, rolled.error);
  const out = deathSave(rolled.result.natural ?? rolled.result.total, sheet.deathSaves);
  sheet.deathSaves = out.state;
  if (out.outcome === "revived") {
    sheet.hp = { ...sheet.hp, current: 1 };
    sheet.conditions = sheet.conditions.filter((c) => c !== "unconscious");
  }
  await db.update(campfireCharacters).set({ sheet, updatedAt: new Date() }).where(eq(campfireCharacters.id, ch.id));
  const roll = await recordRoll(t.campaign, { userId: t.userId, characterId: ch.id, result: rolled.result, visibility: "all" });
  await syncTokensFromSheet(t.campaign, ch.id, sheet);
  await emitCharacter(t.campaign, ch.id);
  res.json({ roll, outcome: out.outcome, deathSaves: sheet.deathSaves });
});

// ───────────── Turn order ─────────────

const combatInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("start"), tokenIds: uuidList(100).optional() }),
  z.object({ op: z.literal("add"), tokenIds: uuidList(100) }),
  z.object({ op: z.literal("remove"), tokenId: z.uuid() }),
  z.object({ op: z.literal("rollAll") }),
  z.object({ op: z.literal("roll"), tokenId: z.uuid() }),
  z.object({ op: z.literal("set"), tokenId: z.uuid(), init: z.number().int().min(-99).max(999).nullable().optional(), hidden: z.boolean().optional() }),
  z.object({ op: z.literal("reorder"), tokenIds: uuidList(100) }),
  z.object({ op: z.literal("next") }),
  z.object({ op: z.literal("prev") }),
  z.object({ op: z.literal("end") }),
]);

/** Highest initiative first; ties by Dexterity, then by the random tie-break rolled with it. */
const tieBreaks = new Map<string, number>();
function sortEntries(entries: CombatEntry[]): CombatEntry[] {
  return [...entries].sort(
    (a, b) => (b.init ?? -Infinity) - (a.init ?? -Infinity) || b.dex - a.dex || (tieBreaks.get(b.tokenId) ?? 0) - (tieBreaks.get(a.tokenId) ?? 0),
  );
}

/** A token's turn order entry (name, Dexterity score from its sheet, hidden if it's on the GM layer). */
async function entryFor(token: TokenRow): Promise<CombatEntry & { sheet: Sheet5e | null }> {
  const sheet = await sheetOf(token);
  return { tokenId: token.id, name: token.name, init: null, dex: sheet?.abilities.dex ?? 10, hidden: token.layer === "gm", sheet };
}

playRouter.post("/campaigns/:id/combat", actLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { write: true });
  if (!t) return;
  const parsed = combatInput.safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  // Players may only roll initiative for their own token.
  if (!t.gm && d.op !== "roll") return bad(res, "Only the game master runs the turn order.", 403);
  const current = t.campaign.combat;
  if (!current && d.op !== "start") return bad(res, "Start combat first.", 409);
  let combat: CombatState | null = current ? { ...current, entries: [...current.entries] } : null;
  const currentId = combat?.entries[combat.turn]?.tokenId ?? null;
  const keepTurn = (c: CombatState) => {
    const i = currentId ? c.entries.findIndex((e) => e.tokenId === currentId) : -1;
    c.turn = i >= 0 ? i : Math.min(c.turn, Math.max(0, c.entries.length - 1));
  };
  const tokensIn = async (ids: string[]) => (await tokensWithScenes(ids)).filter((r) => r.scene.campaignId === t.campaign.id).map((r) => r.token);
  const rollInit = async (entry: CombatEntry, sheet: Sheet5e | null) => {
    const rolled = serverRoll(withBonus("1d20", sheet ? initiativeBonus(sheet) : 0), `${entry.name}: initiative`);
    if (!rolled.ok) return entry;
    tieBreaks.set(entry.tokenId, serverRng());
    if (tieBreaks.size > 50_000) tieBreaks.clear();
    await recordRoll(t.campaign, { userId: t.userId, characterId: null, result: rolled.result, visibility: entry.hidden ? "gm" : "all" });
    return { ...entry, init: rolled.result.total };
  };
  switch (d.op) {
    case "start": {
      let ids = d.tokenIds;
      if (!ids?.length) {
        const scene = t.campaign.activeSceneId;
        ids = scene ? (await db.execute<{ id: string }>(sql`select id from campfire_tokens where scene_id = ${scene} and layer = 'tokens' order by z, created_at limit 100`)).rows.map((r) => r.id) : [];
      }
      const entries = [];
      for (const tk of await tokensIn(ids)) {
        const { sheet: _s, ...e } = await entryFor(tk);
        entries.push(e);
      }
      combat = { round: 1, turn: 0, entries };
      break;
    }
    case "add": {
      for (const tk of await tokensIn(d.tokenIds)) {
        if (combat!.entries.some((e) => e.tokenId === tk.id)) continue;
        const { sheet: _s, ...e } = await entryFor(tk);
        combat!.entries.push(e);
      }
      break;
    }
    case "remove":
      combat!.entries = combat!.entries.filter((e) => e.tokenId !== d.tokenId);
      keepTurn(combat!);
      break;
    case "rollAll": {
      const rows = await tokensIn(combat!.entries.map((e) => e.tokenId));
      const next: CombatEntry[] = [];
      for (const e of combat!.entries) {
        const tk = rows.find((r) => r.id === e.tokenId);
        const sheet = tk ? await sheetOf(tk) : null;
        next.push(await rollInit({ ...e, dex: sheet?.abilities.dex ?? e.dex }, sheet));
      }
      combat!.entries = sortEntries(next);
      combat!.turn = 0;
      break;
    }
    case "roll": {
      const i = combat!.entries.findIndex((e) => e.tokenId === d.tokenId);
      if (i < 0) return notFound(res, "That token isn't in the turn order.");
      const [tk] = await tokensIn([d.tokenId]);
      if (!tk) return notFound(res);
      if (!t.gm && !controls(tk, t.userId, await charactersInfo(t.campaign.id))) return bad(res, "That token isn't yours.", 403);
      combat!.entries[i] = await rollInit(combat!.entries[i], await sheetOf(tk));
      combat!.entries = sortEntries(combat!.entries);
      keepTurn(combat!);
      break;
    }
    case "set": {
      const i = combat!.entries.findIndex((e) => e.tokenId === d.tokenId);
      if (i < 0) return notFound(res, "That token isn't in the turn order.");
      combat!.entries[i] = { ...combat!.entries[i], ...(d.init !== undefined ? { init: d.init } : {}), ...(d.hidden !== undefined ? { hidden: d.hidden } : {}) };
      if (d.init !== undefined) combat!.entries = sortEntries(combat!.entries);
      keepTurn(combat!);
      break;
    }
    case "reorder": {
      const have = combat!.entries.map((e) => e.tokenId);
      if (d.tokenIds.length !== have.length || !have.every((id) => d.tokenIds.includes(id))) return bad(res, "Send every token in the turn order, in the new order.");
      combat!.entries = d.tokenIds.map((id) => combat!.entries.find((e) => e.tokenId === id)!);
      keepTurn(combat!);
      break;
    }
    case "next":
      if (combat!.entries.length) {
        combat!.turn += 1;
        if (combat!.turn >= combat!.entries.length) {
          combat!.turn = 0;
          combat!.round += 1;
        }
      }
      break;
    case "prev":
      if (combat!.entries.length) {
        combat!.turn -= 1;
        if (combat!.turn < 0) {
          if (combat!.round > 1) {
            combat!.round -= 1;
            combat!.turn = combat!.entries.length - 1;
          } else combat!.turn = 0;
        }
      }
      break;
    case "end":
      combat = null;
      break;
  }
  const [row] = await db.update(campfireCampaigns).set({ combat, updatedAt: new Date() }).where(eq(campfireCampaigns.id, t.campaign.id)).returning();
  await emitCombat(row);
  res.json({ combat: combatOut(row.combat, t, (await visibleTokenIdsFor(row))(t)) });
});

