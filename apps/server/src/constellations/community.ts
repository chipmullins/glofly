import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { MEMBER_MILESTONES, constellationInitials, type MemberCardInfo, type PublicUser } from "@glofly/shared";
import { db } from "../db";
import {
  blocks,
  constellationCategories,
  constellationLinks,
  constellationMembers,
  constellations,
  nebulas,
  users,
} from "../db/schema";
import { announce, postEvent } from "../messages/routes";
import { friendIdsOf } from "../presence";
import { sendStream, storage } from "../storage";
import { memberIdsOf } from "./activity";
import { entriesFor, publicUsers, welcomeOf } from "./views";

// 0.7.5 Constellations polish, "community and identity": the join line ("Priya joined. Say hi!")
// and member milestones / birthdays posted in the first text nebula, the member card's mutual
// friends, banner photos, and the public invite page (glofly.app/c/<code>).

// ───────────── Join lines and celebrations ─────────────

/** Where join lines and celebrations go: the first text nebula anyone can post in. */
export async function welcomeNebula(constellationId: string): Promise<{ id: string; conversationId: string } | null> {
  const rows = await db
    .select({
      id: nebulas.id,
      conversationId: nebulas.conversationId,
      position: nebulas.position,
      categoryPosition: constellationCategories.position,
    })
    .from(nebulas)
    .leftJoin(constellationCategories, eq(constellationCategories.id, nebulas.categoryId))
    .where(and(eq(nebulas.constellationId, constellationId), eq(nebulas.kind, "text"), eq(nebulas.readOnly, false)))
    .orderBy(asc(sql`coalesce(${constellationCategories.position}, -1)`), asc(nebulas.position));
  return rows[0] ? { id: rows[0].id, conversationId: rows[0].conversationId } : null;
}

/** The milestone a constellation of `count` members has reached (0 = none yet). */
export const milestoneFor = (count: number): number => MEMBER_MILESTONES.filter((m) => m <= count).at(-1) ?? 0;

/**
 * Someone just joined: "Priya joined Firefly Guild. Say hi!" and, if this join reached a member
 * milestone nobody celebrated yet, "Firefly Guild just reached 100 members!" (once, ever).
 */
export async function celebrateJoin(constellationId: string, userId: string): Promise<void> {
  const [c] = await db
    .select({ name: constellations.name, welcome: constellations.welcome, takenDownAt: constellations.takenDownAt })
    .from(constellations)
    .where(eq(constellations.id, constellationId));
  if (!c || c.takenDownAt) return;
  const settings = welcomeOf(c.welcome);
  if (!settings.joinLines && !settings.milestones) return;
  const nebula = await welcomeNebula(constellationId);
  if (!nebula) return;
  const count = await db.$count(constellationMembers, eq(constellationMembers.constellationId, constellationId));
  const lines = await db.transaction(async (tx) => {
    const out = [];
    if (settings.joinLines) out.push(await postEvent(tx, nebula.conversationId, userId, { type: "cxJoined", name: c.name }));
    const reached = milestoneFor(count);
    if (settings.milestones && reached) {
      // Claimed in the same step, so two people joining at once can't both post it.
      const claimed = await tx
        .update(constellations)
        .set({ celebratedMembers: reached })
        .where(and(eq(constellations.id, constellationId), lt(constellations.celebratedMembers, reached)))
        .returning({ id: constellations.id });
      if (claimed.length) {
        out.push(
          await postEvent(tx, nebula.conversationId, userId, { type: "cxMilestone", name: c.name, members: reached, years: null }, 5),
        );
      }
    }
    return out;
  });
  if (!lines.length) return;
  const ids = await memberIdsOf(constellationId);
  for (const line of lines) await announce(line, ids);
}

/** Whole years since `from` (birthdays count from the moment it was made). */
export function yearsSince(from: Date, now = new Date()): number {
  let years = now.getUTCFullYear() - from.getUTCFullYear();
  const anniversary = new Date(from);
  anniversary.setUTCFullYear(from.getUTCFullYear() + years);
  if (anniversary.getTime() > now.getTime()) years -= 1;
  return Math.max(0, years);
}

/** Every few minutes: constellations that just turned 1 (2, 3…) get a birthday line. */
export async function sweepConstellationBirthdays(now = new Date()): Promise<void> {
  const due = await db
    .select({
      id: constellations.id,
      name: constellations.name,
      ownerId: constellations.ownerId,
      createdAt: constellations.createdAt,
      celebratedYears: constellations.celebratedYears,
      welcome: constellations.welcome,
    })
    .from(constellations)
    .where(
      and(
        isNull(constellations.takenDownAt),
        sql`${constellations.createdAt} <= ${now.toISOString()}::timestamptz - (((${constellations.celebratedYears} + 1) || ' years')::interval)`,
      ),
    )
    .limit(50);
  for (const c of due) {
    const years = yearsSince(c.createdAt, now);
    if (years <= c.celebratedYears) continue;
    const claimed = await db
      .update(constellations)
      .set({ celebratedYears: years })
      .where(and(eq(constellations.id, c.id), lt(constellations.celebratedYears, years)))
      .returning({ id: constellations.id });
    if (!claimed.length || !welcomeOf(c.welcome).milestones) continue;
    const nebula = await welcomeNebula(c.id);
    if (!nebula) continue;
    const line = await db.transaction((tx) =>
      postEvent(tx, nebula.conversationId, c.ownerId, { type: "cxMilestone", name: c.name, members: null, years }),
    );
    await announce(line, await memberIdsOf(c.id));
  }
}

// ───────────── The member card ─────────────

/**
 * Friends `viewerId` and `targetId` both have. Only accepted friendships; never anyone either of
 * them blocked or was blocked by, family-managed accounts or accounts on their way out.
 */
export async function memberCard(viewerId: string, targetId: string): Promise<MemberCardInfo> {
  const [mine, theirs] = await Promise.all([friendIdsOf(viewerId), friendIdsOf(targetId)]);
  const friend = mine.includes(targetId);
  const theirSet = new Set(theirs);
  let common = mine.filter((id) => theirSet.has(id) && id !== viewerId && id !== targetId);
  if (common.length) {
    const hidden = await db
      .select({ blocker: blocks.blockerId, blocked: blocks.blockedId })
      .from(blocks)
      .where(
        or(
          and(inArray(blocks.blockerId, [viewerId, targetId]), inArray(blocks.blockedId, common)),
          and(inArray(blocks.blockedId, [viewerId, targetId]), inArray(blocks.blockerId, common)),
        ),
      );
    const out = new Set(hidden.flatMap((h) => [h.blocker, h.blocked]));
    const ok = await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, common), eq(users.restricted, false), isNull(users.deleteAfter)));
    const okIds = new Set(ok.map((u) => u.id));
    common = common.filter((id) => !out.has(id) && okIds.has(id));
  }
  const people = await publicUsers(common.slice(0, 3));
  return {
    mutualFriends: common.slice(0, 3).map((id) => people.get(id)).filter((p): p is PublicUser => !!p),
    mutualCount: common.length,
    friend,
  };
}

// ───────────── Banner photos ─────────────

export const bannerKey = (constellationId: string, version: string) => `constellation-banners/${constellationId}/${version}.webp`;
export const iconKeyOf = (constellationId: string, version: string) => `constellation-icons/${constellationId}/${version}.webp`;

// ───────────── The public invite page (glofly.app/c/<code>) ─────────────
//
// Anyone with the link can open it, signed in or not. It shows only what the link's preview
// may show: the name, picture, banner, about and the member / online counts, and who made the
// link. Nothing from inside. Invite-only constellations that turned previews off show nothing
// at all but "You've been invited". Dead links (expired, used up, turned off, taken down) say so.

const NOBODY = "00000000-0000-0000-0000-000000000000";

const pageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).type("text/plain").send("Too many tries. Wait a few minutes and try again."),
});

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** A link that still works, with what its preview may show (null = dead). */
export async function invitePreviewOf(code: string) {
  if (!/^[A-Za-z0-9]{6,16}$/.test(code)) return null;
  const [row] = await db
    .select({ link: constellationLinks, c: constellations })
    .from(constellationLinks)
    .innerJoin(constellations, eq(constellations.id, constellationLinks.constellationId))
    .where(eq(constellationLinks.code, code));
  if (!row || row.c.takenDownAt || row.link.revokedAt) return null;
  if (row.link.expiresAt && row.link.expiresAt.getTime() <= Date.now()) return null;
  if (row.link.maxUses !== null && row.link.uses >= row.link.maxUses) return null;
  const previewOk = row.c.visibility !== "invite" || welcomeOf(row.c.welcome).preview;
  return { link: row.link, c: row.c, previewOk };
}

export const invitePageRouter = Router();
invitePageRouter.use(pageLimiter);

function sendPage(res: Response, status: number, title: string, body: string): void {
  res
    .status(status)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    })
    .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Glofly</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px 16px 48px;color:#f5ede6;font:400 16px/1.5 'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;
background:radial-gradient(2px 2px at 12% 18%,#ffd27a,transparent 70%),radial-gradient(1.5px 1.5px at 78% 12%,#fff,transparent 70%),radial-gradient(1.5px 1.5px at 30% 70%,#ffb347,transparent 70%),radial-gradient(1px 1px at 88% 60%,#fff,transparent 70%),radial-gradient(1px 1px at 55% 88%,#ffd27a,transparent 70%),radial-gradient(1px 1px at 6% 82%,#fff,transparent 70%),#120c0a}
.brand{align-self:stretch;max-width:880px;margin:0 auto 28px;display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px;color:#f5ede6;text-decoration:none}
.brand img{width:30px;height:30px}
.card{width:100%;max-width:440px;border-radius:22px;overflow:hidden;background:#1c1210;border:1px solid #3a2a22;box-shadow:0 0 0 1px rgba(255,179,71,.08),0 30px 80px rgba(0,0,0,.55),0 0 60px rgba(255,165,74,.12);text-align:center}
.banner{height:112px;background:radial-gradient(circle at 70% 40%,rgba(255,179,71,.35),transparent 45%),linear-gradient(160deg,#2b1a3a,#1a1020 55%,#120c0a);background-size:cover;background-position:center}
.icon{width:72px;height:72px;margin:-40px auto 0;border-radius:20px;background:#120c0a;border:3px solid #1c1210;display:grid;place-items:center;overflow:hidden;color:#ffb347;font-weight:700;font-size:26px;box-shadow:0 0 22px rgba(255,165,74,.45)}
.icon img{width:100%;height:100%;object-fit:cover}
.body{padding:16px 26px 26px}
.by{color:#d9c2b1;font-size:15px;margin:6px 0 2px}
h1{margin:0 0 8px;font-size:30px;line-height:1.2}
.about{color:#d9c2b1;margin:0 0 12px}
.counts{display:flex;justify-content:center;gap:16px;font-size:15px;color:#d9c2b1;margin:0 0 18px}
.online{color:#6fd39a;font-weight:700}
.online::before{content:'';display:inline-block;width:9px;height:9px;border-radius:50%;background:#3dba6e;margin-right:7px;vertical-align:1px}
.join{display:block;padding:15px 18px;border-radius:999px;background:#ffb347;color:#1c1210;font-weight:700;font-size:17px;text-decoration:none;box-shadow:0 0 24px rgba(255,165,74,.35)}
.join:focus-visible{outline:3px solid #ffd27a;outline-offset:3px}
.small{margin:14px 0 0;color:#b8a699;font-size:14px}
.small a{color:#ffb347}
</style></head>
<body>
<a class="brand" href="https://glofly.app"><img src="/logo.svg" alt="">Glofly</a>
<main class="card">${body}</main>
</body></html>`);
}

/** Where "use it in your browser" goes (Glofly in a browser opens the join screen). */
const browserJoin = (code: string) => `${(process.env.WEB_ORIGIN?.trim() || "https://chat.glofly.app").replace(/\/+$/, "")}/?join=${encodeURIComponent(code)}`;

// GET /c/:code — the invite page.
invitePageRouter.get("/:code", async (req, res) => {
  const code = String(req.params.code);
  const found = await invitePreviewOf(code);
  if (!found) {
    sendPage(
      res,
      404,
      "Invite expired",
      `<div class="banner"></div><div class="icon">✦</div><div class="body"><h1>This invite has expired</h1><p class="about">It may have run out, been turned off, or the constellation isn't available any more. Ask whoever sent it for a new one.</p><a class="join" href="https://glofly.app">Visit Glofly</a></div>`,
    );
    return;
  }
  const open = `glofly://c/${code}`;
  const small = `<p class="small">Opens Glofly. No Glofly yet? <a href="https://glofly.app">Get the app</a> or <a href="${esc(browserJoin(code))}">use it in your browser</a></p>`;
  if (!found.previewOk) {
    sendPage(
      res,
      200,
      "You're invited",
      `<div class="banner"></div><div class="icon">✦</div><div class="body"><p class="by">You've been invited to a constellation on Glofly</p><h1>Come on in</h1><p class="about">Open Glofly to see where this invite takes you.</p><a class="join" href="${open}">Open in Glofly</a>${small}</div>`,
    );
    return;
  }
  const [entry] = await entriesFor(NOBODY, [found.c.id]);
  const by = found.link.createdBy ? (await publicUsers([found.link.createdBy])).get(found.link.createdBy) : undefined;
  const name = found.c.name;
  const banner = found.c.bannerVersion ? ` style="background-image:url('/c/${esc(code)}/banner/${esc(found.c.bannerVersion)}')"` : "";
  const icon = found.c.iconVersion
    ? `<img src="/c/${esc(code)}/icon/${esc(found.c.iconVersion)}" alt="">`
    : esc(constellationInitials(name));
  sendPage(
    res,
    200,
    `Join ${name}`,
    `<div class="banner"${banner}></div><div class="icon">${icon}</div><div class="body">
<p class="by">${by ? `${esc(by.displayName)} invited you to join` : "You're invited to join"}</p>
<h1>${esc(name)}</h1>
${found.c.description ? `<p class="about">${esc(found.c.description)}</p>` : ""}
<p class="counts"><span class="online">${entry?.onlineCount ?? 0} online now</span><span>${entry?.memberCount ?? 0} ${entry?.memberCount === 1 ? "member" : "members"}</span></p>
<a class="join" href="${open}">Join ${esc(name)}</a>${small}</div>`,
  );
});

// GET /c/:code/icon/:version and /c/:code/banner/:version — its pictures, only for a live link
// whose preview may show them.
invitePageRouter.get("/:code/:kind/:version", async (req, res) => {
  const kind = String(req.params.kind);
  const version = String(req.params.version);
  const found = await invitePreviewOf(String(req.params.code));
  const current = kind === "icon" ? found?.c.iconVersion : kind === "banner" ? found?.c.bannerVersion : null;
  if (!found || !found.previewOk || !current || current !== version) {
    res.status(404).end();
    return;
  }
  const file = await storage.get(kind === "icon" ? iconKeyOf(found.c.id, version) : bannerKey(found.c.id, version));
  if (!file) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("Cache-Control", "public, max-age=3600");
  sendStream(file.stream, res);
});
