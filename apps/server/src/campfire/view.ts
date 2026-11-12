import { liveOf } from "./liveState";
import { createHash } from "node:crypto";
import {
  builtForPlayer,
  classLine,
  hpState,
  isFogged,
  normalizeBuilt,
  normalizeFog,
  normalizeGrid,
  normalizeSheet,
  tokenCenter,
  totalLevel,
  type Campaign,
  type CampaignSettings,
  type CharacterView,
  type CombatState,
  type CombatView,
  type Handout,
  type HandoutSummary,
  type MapTheme,
  type PendingDamage,
  type Roll,
  type Scene,
  type Token,
  type TokenBar,
  type Track,
  type BuiltMap,
  type FogState,
} from "@glofly/shared";
import type {
  campfireCharacters,
  campfireHandouts,
  campfirePending,
  campfireRolls,
  campfireScenes,
  campfireTokens,
  campfireTracks,
} from "../db/schema";
import { settingsOf, type CampaignRow } from "./perms";
import { openCallOf } from "./live";

// What each viewer may see. EVERY response and live event about a table goes through here:
// players never receive hidden tokens (GM layer, centre under fog unless it's theirs), GM notes,
// built-map pieces fully under fog, NPC sheets, monster HP numbers (unless the campaign allows),
// bars only GMs or owners see, GM-only rolls, or handouts not shared with them.

export type SceneRow = typeof campfireScenes.$inferSelect;
export type TokenRow = typeof campfireTokens.$inferSelect;
export type CharacterRow = typeof campfireCharacters.$inferSelect;
export type RollRow = typeof campfireRolls.$inferSelect;
export type HandoutRow = typeof campfireHandouts.$inferSelect;
export type PendingRow = typeof campfirePending.$inferSelect;
export type TrackRow = typeof campfireTracks.$inferSelect;

/** Who's looking. */
export type Viewer = { userId: string; gm: boolean };

const iso = (d: Date) => d.toISOString();

/** A campaign's settings as this person may see them: GM-only preferences stay with GMs. */
function settingsFor(raw: unknown, role: "gm" | "player"): CampaignSettings {
  const s = settingsOf(raw);
  if (role !== "gm") delete s.placeHidden;
  return s;
}

export function campaignOut(c: CampaignRow, viewer: { role: "gm" | "player" }): Campaign {
  return {
    id: c.id,
    name: c.name,
    home: c.constellationId ? { kind: "nebula", id: c.homeConversationId! } : { kind: "chat", id: c.conversationId! },
    createdBy: c.createdBy,
    activeSceneId: c.activeSceneId,
    openInCallId: openCallOf(c.id),
    myRole: viewer.role,
    updatedAt: iso(c.updatedAt),
    settings: settingsFor(c.settings, viewer.role),
    createdAt: iso(c.createdAt),
    live: liveOf(c),
  };
}

const THEMES: MapTheme[] = ["stone", "wood", "grass", "cave", "snow", "sand", "night"];

// A scene row is cleaned up (and its players' map worked out) once, not once per viewer or token:
// an event about a scene builds the same thing for everyone at the table.
const fogs = new WeakMap<object, FogState>();
export function fogOf(row: Pick<SceneRow, "fog">): FogState {
  const raw = row.fog;
  if (!raw || typeof raw !== "object") return normalizeFog(raw);
  let fog = fogs.get(raw);
  if (!fog) fogs.set(raw, (fog = normalizeFog(raw)));
  return fog;
}
// Keyed by what it's worked out from, so every event about one change shares it.
const playerBuilt = new Map<string, BuiltMap>();
export function builtForPlayers(row: SceneRow, fog: FogState, grid: { size: number }): BuiltMap {
  const key = createHash("sha256").update(JSON.stringify([row.id, row.fog, row.built, row.grid])).digest("base64url");
  let built = playerBuilt.get(key);
  if (!built) {
    built = builtForPlayer(normalizeBuilt(row.built), fog, Math.max(10, grid.size / 2));
    if (playerBuilt.size >= 64) playerBuilt.delete(playerBuilt.keys().next().value!);
    playerBuilt.set(key, built);
  }
  return built;
}

export function sceneOut(row: SceneRow, viewer: Viewer): Scene {
  const grid = normalizeGrid(row.grid);
  const fog = fogOf(row);
  const built = viewer.gm ? normalizeBuilt(row.built) : builtForPlayers(row, fog, grid);
  return {
    id: row.id,
    campaignId: row.campaignId,
    name: row.name,
    position: row.position,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    grid,
    backgroundFileId: row.backgroundFileId,
    theme: THEMES.includes(row.theme as MapTheme) ? (row.theme as MapTheme) : "stone",
    built,
    fog,
    musicTrackId: row.musicTrackId,
    updatedAt: iso(row.updatedAt),
  };
}

/** What the token rules need to know about the characters tokens are linked to. */
export type CharacterInfo = Map<string, { kind: string; ownerId: string | null }>;

/** Does this person control the token (listed, or it's their own PC)? */
export function controls(t: Pick<TokenRow, "controlledBy" | "characterId">, userId: string, chars: CharacterInfo): boolean {
  return t.controlledBy.includes(userId) || (!!t.characterId && chars.get(t.characterId)?.ownerId === userId);
}

/** Can this viewer see the token at all? */
export function tokenVisible(t: TokenRow, scene: Pick<SceneRow, "fog" | "grid">, viewer: Viewer, chars: CharacterInfo): boolean {
  if (viewer.gm) return true;
  if (t.layer === "gm") return false;
  if (controls(t, viewer.userId, chars)) return true;
  return !isFogged(fogOf(scene), tokenCenter(t, normalizeGrid(scene.grid)));
}

function barFor(bar: TokenBar | null, index: number, isNpc: boolean, mine: boolean, settings: CampaignSettings): TokenBar | null {
  if (!bar) return null;
  if (bar.show === "gm") return null;
  if (bar.show === "owner" && !mine) return null;
  // Monsters' HP (bar 0): exact numbers only when the campaign says so.
  if (index === 0 && isNpc && !mine) {
    if (settings.showMonsterHp === "none") return null;
    if (settings.showMonsterHp === "bloodied") {
      return { value: null, max: null, color: bar.color, show: bar.show, state: hpState(bar.value ?? 0, bar.max ?? 0) };
    }
  }
  return { value: bar.value, max: bar.max, color: bar.color, show: bar.show };
}

/** A token's name as this viewer sees it ("" when the GM hid it from players). */
export const shownName = (t: Pick<TokenRow, "name" | "showName" | "controlledBy" | "characterId">, viewer: Viewer, chars: CharacterInfo): string =>
  !viewer.gm && !t.showName && !controls(t, viewer.userId, chars) ? "" : t.name;

/** A token as this viewer sees it (call tokenVisible first). */
export function tokenOut(t: TokenRow, viewer: Viewer, chars: CharacterInfo, settings: CampaignSettings): Token {
  const char = t.characterId ? chars.get(t.characterId) : undefined;
  const isNpc = char?.kind !== "pc";
  const mine = controls(t, viewer.userId, chars);
  const bars = viewer.gm
    ? t.bars.slice(0, 3).map((b) => (b ? { value: b.value, max: b.max, color: b.color, show: b.show } : null))
    : [0, 1, 2].map((i) => barFor(t.bars[i] ?? null, i, isNpc, mine, settings));
  while (bars.length < 3) bars.push(null);
  return {
    id: t.id,
    sceneId: t.sceneId,
    layer: t.layer as Token["layer"],
    // An NPC's sheet is GM-only, so players don't get which one it is.
    characterId: viewer.gm || (char && (char.kind === "pc" || mine)) ? t.characterId : null,
    name: shownName(t, viewer, chars),
    imageFileId: t.imageFileId,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    rotation: t.rotation,
    bars,
    conditions: t.conditions,
    aura: t.aura,
    showName: t.showName,
    controlledBy: t.controlledBy,
    z: t.z,
    updatedAt: iso(t.updatedAt),
    elevation: t.elevation,
    locked: t.locked,
    ...(viewer.gm || mine ? { conditionTimers: t.conditionTimers ?? {} } : {}),
  };
}

export const charInfo = (rows: Pick<CharacterRow, "id" | "kind" | "ownerId">[]): CharacterInfo => new Map(rows.map((r) => [r.id, { kind: r.kind, ownerId: r.ownerId }]));

/** A character as this viewer sees it: GMs and the owner everything, others a PC's public part, NPCs nothing. */
export function characterOut(row: CharacterRow, viewer: Viewer): CharacterView | null {
  const full = viewer.gm || (row.ownerId !== null && row.ownerId === viewer.userId);
  if (!full && row.kind !== "pc") return null;
  const sheet = normalizeSheet(row.sheet);
  const base = {
    id: row.id,
    campaignId: row.campaignId,
    ownerId: row.ownerId,
    kind: row.kind as "pc" | "npc",
    name: row.name,
    portraitFileId: row.portraitFileId,
    ddbUrl: row.ddbUrl,
    summary: {
      race: sheet.race,
      classLine: classLine(sheet),
      level: totalLevel(sheet),
      ac: sheet.ac,
      hp: sheet.hp,
      conditions: sheet.conditions,
      concentration: sheet.concentration,
      deathSaves: sheet.deathSaves,
    },
    updatedAt: iso(row.updatedAt),
  };
  return full ? { ...base, sheet, srdMonster: row.srdMonster, full: true } : base;
}

export function rollVisible(r: Pick<RollRow, "visibility" | "userId" | "whisperTo">, viewer: Viewer): boolean {
  if (viewer.gm || r.userId === viewer.userId || r.visibility === "all") return true;
  return r.visibility === "whisper" && r.whisperTo.includes(viewer.userId);
}

export const rollOut = (r: RollRow): Roll => ({
  id: r.id,
  campaignId: r.campaignId,
  userId: r.userId,
  characterId: r.characterId,
  label: r.label,
  expression: r.expression,
  result: r.result,
  total: r.total,
  visibility: r.visibility as Roll["visibility"],
  whisperTo: r.whisperTo,
  createdAt: iso(r.createdAt),
});

export function handoutVisible(h: Pick<HandoutRow, "shared" | "sharedWith">, viewer: Viewer): boolean {
  return viewer.gm || h.shared === "all" || (h.shared === "some" && h.sharedWith.includes(viewer.userId));
}
export const handoutSummary = (h: HandoutRow): HandoutSummary => ({
  id: h.id,
  title: h.title,
  imageFileId: h.imageFileId,
  shared: h.shared as HandoutSummary["shared"],
  updatedAt: iso(h.updatedAt),
});
export const handoutOut = (h: HandoutRow, viewer: Viewer): Handout => ({
  ...handoutSummary(h),
  campaignId: h.campaignId,
  body: h.body,
  // Players don't learn who else a handout went to.
  sharedWith: viewer.gm ? h.sharedWith : h.sharedWith.filter((id) => id === viewer.userId),
  createdBy: h.createdBy,
  createdAt: iso(h.createdAt),
});

export const pendingOut = (p: PendingRow): PendingDamage => ({
  id: p.id,
  campaignId: p.campaignId,
  attackerTokenId: p.attackerTokenId,
  targetTokenId: p.targetTokenId,
  amount: p.amount,
  damageType: (p.damageType as PendingDamage["damageType"]) ?? null,
  kind: p.kind as PendingDamage["kind"],
  crit: p.crit,
  createdBy: p.createdBy,
  createdAt: iso(p.createdAt),
});

export const trackOut = (t: TrackRow): Track => ({
  id: t.id,
  campaignId: t.campaignId,
  fileId: t.fileId,
  title: t.title,
  durationSec: t.durationSec,
  createdAt: iso(t.createdAt),
});

/**
 * The turn order as this viewer sees it: players get no hidden entries (or tokens they can't see),
 * and names as the tokens show them. `visible`: the tokens they can see, with their shown names.
 */
export function combatOut(combat: CombatState | null, viewer: Viewer, visible: Map<string, string>): CombatView | null {
  if (!combat) return null;
  // While players roll initiative (0.11.4), it's nobody's turn yet.
  const current = combat.rolling ? null : (combat.entries[combat.turn]?.tokenId ?? null);
  if (viewer.gm) return { ...combat, current };
  const entries = combat.entries
    .filter((e) => !e.hidden && visible.has(e.tokenId))
    // Players get the turn's movement (for the ring), not the GM's bookkeeping.
    .map((e) => ({ tokenId: e.tokenId, name: visible.get(e.tokenId) ?? "", init: e.init, dex: e.dex, hidden: e.hidden, ...(e.player ? { player: true } : {}), ...(e.moved ? { moved: e.moved } : {}), ...(e.dashed ? { dashed: true } : {}), ...(e.lastMove ? { lastMove: { x: 0, y: 0, cost: e.lastMove.cost } } : {}) }));
  const turn = entries.findIndex((e) => e.tokenId === current);
  return { round: combat.round, turn, entries, current: turn >= 0 ? current : null, ...(combat.rolling ? { rolling: true } : {}) };
}
