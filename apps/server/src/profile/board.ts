// Profiles 2.0 (0.9.1, canvas "Glofly profiles"): pronouns, the board, who sees what, mutual
// friends and constellations, and the Activity tab. Routes are in profile/routes.ts.
//
// Who sees what (Settings → Profile → Who sees what):
//   board     Everyone / Friends / Only me   (default Everyone)
//   activity  Everyone / Friends / Only me   (default Friends; games in it also follow My games)
//   mutuals   Everyone = anyone who shares them with you / Friends / Only me
// A family-managed (restricted) account never shows any of them to people who aren't its friends.
// Blocks look like "not found" before any of this runs (routes.ts).

import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import {
  BOARD_GAMES_MAX,
  BOARD_NOTE_MAX,
  BOARD_TAGS_MAX,
  BOARD_TILES_MAX,
  DEFAULT_PROFILE_PRIVACY,
  cleanInterestTag,
  gameKey,
  isConstellationAccent,
  isConstellationColor,
  type ActivityItem,
  type BoardTile,
  type BoardTileView,
  type MutualConstellation,
  type Mutuals,
  type ProfileAudience,
  type ProfileConstellation,
  type ProfilePrivacy,
} from "@glofly/shared";
import { db } from "../db";
import {
  constellationMemberRoles,
  constellationMembers,
  constellationRoles,
  constellations,
  userGames,
  users,
} from "../db/schema";
import { areFriends, blockedWith, isRestricted } from "../friends/rules";
import { friendIdsOf } from "../presence";
import { publicUsers } from "../constellations/views";
import { coversFor } from "../games/igdb";

const audience = z.enum(["everyone", "friends", "only_me"]);

/** Someone's stored privacy over the defaults. */
export function privacyOf(raw: unknown): ProfilePrivacy {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (k: keyof ProfilePrivacy) => {
    const p = audience.safeParse(r[k]);
    return p.success ? p.data : DEFAULT_PROFILE_PRIVACY[k];
  };
  return { board: pick("board"), activity: pick("activity"), mutuals: pick("mutuals") };
}

export const privacyChanges = z
  .object({ board: audience, activity: audience, mutuals: audience })
  .partial()
  .strict();

/** What a viewer stands to the profile's owner. */
export type Relation = { self: boolean; friend: boolean; restricted: boolean };

export async function relationOf(viewerId: string, ownerId: string): Promise<Relation> {
  if (viewerId === ownerId) return { self: true, friend: true, restricted: false };
  const [friend, restricted] = await Promise.all([areFriends(viewerId, ownerId), isRestricted(ownerId)]);
  return { self: false, friend, restricted };
}

/** Whether a part set to `who` shows to this viewer. */
export function shows(who: ProfileAudience, rel: Relation): boolean {
  if (rel.self) return true;
  if (who === "only_me") return false;
  if (who === "friends" || rel.restricted) return rel.friend;
  return true;
}

// ---- the board ----

const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/;
const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !HIDDEN.test(s), "That has hidden characters in it.");

const tileSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("games"),
    games: z
      .array(z.object({ name: plain(80) }).passthrough())
      .min(1, "Pick at least one game.")
      .max(BOARD_GAMES_MAX, `A games tile holds up to ${BOARD_GAMES_MAX} games.`),
  }),
  z.object({ kind: z.literal("constellation"), constellationId: z.uuid() }),
  z.object({ kind: z.literal("note"), text: plain(BOARD_NOTE_MAX).refine((t) => !t.includes("\n\n\n"), "Too many empty lines.") }),
  z.object({
    kind: z.literal("into"),
    tags: z.array(z.string()).min(1, "Add at least one thing you're into.").max(BOARD_TAGS_MAX, `Up to ${BOARD_TAGS_MAX} things.`),
  }),
  z.object({ kind: z.literal("playing") }),
]);

export const boardSchema = z.array(tileSchema).max(BOARD_TILES_MAX, `A board holds up to ${BOARD_TILES_MAX} tiles.`);

/**
 * Checks a board someone wants to save and returns what's stored (or a problem to show).
 * Constellation tiles: only public or ask-to-join constellations you're in (an invite-only one
 * stays private). One "playing" tile at most. Game keys are worked out here, never taken as sent.
 */
export async function cleanBoard(userId: string, tiles: z.infer<typeof boardSchema>): Promise<BoardTile[] | string> {
  const out: BoardTile[] = [];
  const seen = new Set<string>();
  for (const t of tiles) {
    switch (t.kind) {
      case "games": {
        const games = [...new Map(t.games.map((g) => [gameKey(g.name), { key: gameKey(g.name), name: g.name.replace(/\s+/g, " ") }])).values()];
        out.push({ kind: "games", games });
        break;
      }
      case "constellation": {
        if (seen.has(t.constellationId)) return "That constellation is on your board already.";
        seen.add(t.constellationId);
        const [row] = await db
          .select({ visibility: constellations.visibility })
          .from(constellations)
          .innerJoin(
            constellationMembers,
            and(eq(constellationMembers.constellationId, constellations.id), eq(constellationMembers.userId, userId)),
          )
          .where(and(eq(constellations.id, t.constellationId), isNull(constellations.takenDownAt)));
        if (!row) return "You can only show constellations you're in.";
        if (row.visibility === "invite") return "Invite-only constellations stay off profiles. Pick a public one.";
        out.push({ kind: "constellation", constellationId: t.constellationId });
        break;
      }
      case "note":
        out.push({ kind: "note", text: t.text });
        break;
      case "into": {
        const tags = [...new Set(t.tags.map(cleanInterestTag).filter((x) => x && !HIDDEN.test(x)))];
        if (!tags.length) return "Add at least one thing you're into.";
        out.push({ kind: "into", tags });
        break;
      }
      case "playing":
        if (out.some((x) => x.kind === "playing")) return "One \"Playing now\" tile is enough.";
        out.push({ kind: "playing" });
        break;
    }
  }
  return out;
}

/** Stored tiles, keeping only ones that still parse (never trust old rows blindly). */
export function storedBoard(raw: unknown): BoardTile[] {
  if (!Array.isArray(raw)) return [];
  const out: BoardTile[] = [];
  for (const item of raw.slice(0, BOARD_TILES_MAX)) {
    const p = tileSchema.safeParse(item);
    if (!p.success) continue;
    if (p.data.kind === "games")
      out.push({ kind: "games", games: p.data.games.map((g) => ({ key: gameKey(g.name), name: g.name })) });
    else if (p.data.kind === "into") out.push({ kind: "into", tags: p.data.tags });
    else out.push(p.data as BoardTile);
  }
  return out;
}

const colorOf = (x: string) => (isConstellationColor(x) ? x : "ember");

/** Member counts, people only (bots aren't members). */
async function memberCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const rows = await db
    .select({ id: constellationMembers.constellationId })
    .from(constellationMembers)
    .innerJoin(users, eq(users.id, constellationMembers.userId))
    .where(and(inArray(constellationMembers.constellationId, ids), eq(users.bot, false)));
  for (const r of rows) out.set(r.id, (out.get(r.id) ?? 0) + 1);
  return out;
}

/**
 * The board as this viewer sees it. Constellation tiles that turned invite-only, got taken down
 * or that the owner left drop out. Game playtime only shows when their My games is shared with you.
 */
export async function boardView(
  viewerId: string,
  ownerId: string,
  tiles: BoardTile[],
  opts: { gamesShared: boolean; playing: string | null },
): Promise<BoardTileView[]> {
  const cIds = tiles.flatMap((t) => (t.kind === "constellation" ? [t.constellationId] : []));
  const cRows = cIds.length
    ? await db
        .select({
          id: constellations.id,
          name: constellations.name,
          color: constellations.color,
          iconVersion: constellations.iconVersion,
          accent: constellations.accent,
          visibility: constellations.visibility,
        })
        .from(constellations)
        .innerJoin(
          constellationMembers,
          and(eq(constellationMembers.constellationId, constellations.id), eq(constellationMembers.userId, ownerId)),
        )
        .where(and(inArray(constellations.id, cIds), isNull(constellations.takenDownAt), ne(constellations.visibility, "invite")))
    : [];
  const mine = cRows.length
    ? new Set(
        (
          await db
            .select({ id: constellationMembers.constellationId })
            .from(constellationMembers)
            .where(and(eq(constellationMembers.userId, viewerId), inArray(constellationMembers.constellationId, cRows.map((c) => c.id))))
        ).map((r) => r.id),
      )
    : new Set<string>();
  const counts = await memberCounts(cRows.map((c) => c.id));
  const gameNames = tiles.flatMap((t) => (t.kind === "games" ? t.games.map((g) => g.key) : []));
  const played =
    opts.gamesShared && gameNames.length
      ? new Map(
          (
            await db
              .select({ key: userGames.gameKey, seconds: userGames.seconds })
              .from(userGames)
              .where(and(eq(userGames.userId, ownerId), eq(userGames.hidden, false), inArray(userGames.gameKey, gameNames)))
          ).map((r) => [r.key, r.seconds]),
        )
      : new Map<string, number>();

  const covers = await coversFor([
    ...tiles.flatMap((t) => (t.kind === "games" ? t.games : [])),
    ...(opts.playing ? [{ key: gameKey(opts.playing), name: opts.playing }] : []),
  ]);
  const art = (key: string) => (covers.has(key) ? { cover: covers.get(key)! } : {});
  const out: BoardTileView[] = [];
  for (const t of tiles) {
    if (t.kind === "constellation") {
      const c = cRows.find((r) => r.id === t.constellationId);
      if (!c) continue;
      const constellation: ProfileConstellation = {
        id: c.id,
        name: c.name,
        color: colorOf(c.color),
        iconVersion: c.iconVersion,
        accent: isConstellationAccent(c.accent) ? c.accent : null,
        memberCount: counts.get(c.id) ?? 0,
        joined: mine.has(c.id),
        visibility: c.visibility === "approval" ? "approval" : "public",
      };
      out.push({ kind: "constellation", constellation });
    } else if (t.kind === "games") {
      out.push({
        kind: "games",
        games: t.games.map((g) => ({
          key: g.key,
          name: g.name,
          ...(played.has(g.key) ? { seconds: played.get(g.key)! } : {}),
          ...art(g.key),
        })),
      });
    } else if (t.kind === "playing") {
      out.push({ kind: "playing", game: opts.playing, ...(opts.playing ? art(gameKey(opts.playing)) : {}) });
    } else out.push(t);
  }
  return out;
}

// ---- mutuals ----

/** Friends both people have (never the two of them; blocked people and pending deletions left out). */
async function mutualFriendIds(viewerId: string, ownerId: string): Promise<string[]> {
  const [a, b, blocked] = await Promise.all([friendIdsOf(viewerId), friendIdsOf(ownerId), blockedWith(viewerId)]);
  const theirs = new Set(b);
  const ids = a.filter((id) => theirs.has(id) && id !== ownerId && id !== viewerId && !blocked.has(id));
  if (!ids.length) return [];
  const live = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), isNull(users.deleteAfter), isNull(users.suspendedAt)));
  return live.map((r) => r.id);
}

/** Constellations both are in (not taken down). Any kind: you're in it too, so nothing new leaks. */
async function mutualConstellationRows(viewerId: string, ownerId: string) {
  const mine = db
    .select({ id: constellationMembers.constellationId })
    .from(constellationMembers)
    .where(eq(constellationMembers.userId, viewerId));
  return db
    .select({
      id: constellations.id,
      name: constellations.name,
      color: constellations.color,
      iconVersion: constellations.iconVersion,
      accent: constellations.accent,
    })
    .from(constellationMembers)
    .innerJoin(constellations, eq(constellations.id, constellationMembers.constellationId))
    .where(
      and(
        eq(constellationMembers.userId, ownerId),
        inArray(constellationMembers.constellationId, mine),
        isNull(constellations.takenDownAt),
      ),
    )
    .orderBy(constellations.name);
}

export async function mutualCounts(viewerId: string, ownerId: string) {
  if (viewerId === ownerId) return { mutualFriends: 0, mutualConstellations: 0 };
  const [f, c] = await Promise.all([mutualFriendIds(viewerId, ownerId), mutualConstellationRows(viewerId, ownerId)]);
  return { mutualFriends: f.length, mutualConstellations: c.length };
}

export async function mutualsOf(viewerId: string, ownerId: string): Promise<Mutuals> {
  if (viewerId === ownerId) return { friends: [], constellations: [] };
  const [fIds, cRows] = await Promise.all([mutualFriendIds(viewerId, ownerId), mutualConstellationRows(viewerId, ownerId)]);
  const people = await publicUsers(fIds);
  const friends = fIds
    .map((id) => people.get(id)!)
    .filter(Boolean)
    .sort((x, y) => x.displayName.localeCompare(y.displayName));
  // The owner's own roles there (not the everyone "Member" role), highest first.
  const roleRows = cRows.length
    ? await db
        .select({ constellationId: constellationRoles.constellationId, name: constellationRoles.name, position: constellationRoles.position })
        .from(constellationMemberRoles)
        .innerJoin(constellationRoles, eq(constellationRoles.id, constellationMemberRoles.roleId))
        .where(
          and(
            eq(constellationMemberRoles.userId, ownerId),
            inArray(constellationMemberRoles.constellationId, cRows.map((c) => c.id)),
            ne(constellationRoles.kind, "member"),
          ),
        )
        .orderBy(desc(constellationRoles.position))
    : [];
  const constellationsOut: MutualConstellation[] = cRows.map((c) => ({
    id: c.id,
    name: c.name,
    color: colorOf(c.color),
    iconVersion: c.iconVersion,
    accent: isConstellationAccent(c.accent) ? c.accent : null,
    roles: roleRows.filter((r) => r.constellationId === c.id).map((r) => r.name).slice(0, 3),
  }));
  return { friends, constellations: constellationsOut };
}

// ---- activity ----

const ACTIVITY_MAX = 20;
const ACTIVITY_DAYS = 30;

/**
 * Recent things on someone's profile: games played or started (only when their My games is shared
 * with you; hidden games never) and public / ask-to-join constellations they joined.
 */
export async function activityOf(ownerId: string, gamesShared: boolean): Promise<ActivityItem[]> {
  const since = new Date(Date.now() - ACTIVITY_DAYS * 86_400_000);
  const items: ActivityItem[] = [];
  if (gamesShared) {
    const games = await db
      .select()
      .from(userGames)
      .where(and(eq(userGames.userId, ownerId), eq(userGames.hidden, false)))
      .orderBy(desc(userGames.lastPlayedAt))
      .limit(ACTIVITY_MAX);
    for (const g of games) {
      if (g.firstPlayedAt >= since) items.push({ kind: "started", at: g.firstPlayedAt.toISOString(), game: g.name });
      // "Played" only once there's real playtime, and not twice for a game started the same day.
      if (g.lastPlayedAt >= since && g.seconds >= 60 && g.lastPlayedAt.getTime() - g.firstPlayedAt.getTime() > 3_600_000)
        items.push({ kind: "played", at: g.lastPlayedAt.toISOString(), game: g.name, seconds: g.seconds });
    }
  }
  const joined = await db
    .select({
      at: constellationMembers.joinedAt,
      id: constellations.id,
      name: constellations.name,
      color: constellations.color,
      iconVersion: constellations.iconVersion,
    })
    .from(constellationMembers)
    .innerJoin(constellations, eq(constellations.id, constellationMembers.constellationId))
    .where(
      and(
        eq(constellationMembers.userId, ownerId),
        isNull(constellations.takenDownAt),
        ne(constellations.visibility, "invite"),
      ),
    )
    .orderBy(desc(constellationMembers.joinedAt))
    .limit(ACTIVITY_MAX);
  for (const j of joined) {
    if (j.at < since) continue;
    // Their own new constellation shows as joined too (they're its first member).
    items.push({
      kind: "joined",
      at: j.at.toISOString(),
      constellation: { id: j.id, name: j.name, color: colorOf(j.color), iconVersion: j.iconVersion },
    });
  }
  const shown = items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTIVITY_MAX);
  const covers = await coversFor(shown.flatMap((i) => (i.kind === "joined" ? [] : [{ key: gameKey(i.game), name: i.game }])));
  return shown.map((i) => (i.kind !== "joined" && covers.has(gameKey(i.game)) ? { ...i, cover: covers.get(gameKey(i.game))! } : i));
}
