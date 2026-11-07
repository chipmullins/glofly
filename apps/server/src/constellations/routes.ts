import { randomBytes, randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "../rateLimit";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { FORUM_GUIDELINES_MAX, FORUM_TAG_NAME_MAX, FORUM_TAGS_MAX,
  ALL_PERMISSIONS,
  ONBOARDING_ANSWERS_MAX,
  ONBOARDING_QUESTIONS_MAX,
  CATEGORIES_MAX,
  CATEGORY_NAME_MAX,
  CONSTELLATION_DESCRIPTION_MAX,
  CONSTELLATION_NAME_MAX,
  CONSTELLATION_TAGS_MAX,
  CONSTELLATION_TEMPLATES,
  CONSTELLATIONS_OWNED_MAX,
  CUSTOM_ROLES_MAX,
  DEFAULT_ROLES,
  JOIN_REQUEST_NOTE_MAX,
  LINK_LIFETIMES,
  MODERATION_REASON_MAX,
  NEBULA_TOPIC_MAX,
  NEBULAS_MAX,
  ROLE_COLOR_CHOICES,
  ROLE_NAME_MAX,
  TIMEOUT_LENGTHS,
  VOICE_NEBULA_MAX,
  VOICE_PREVIEW_MS,
  type VoicePreviewPass,
  cleanNebulaName,
  cleanTag,
  colorForName,
  isConstellationColor,
  isConstellationType,
  isPermission,
  type ConstellationPermission,
  type NebulaKind,
  PINNED_NEBULAS_MAX,
  ACCENT_THEME,
  RULE_MAX,
  RULES_MAX,
  isConstellationAccent,
} from "@glofly/shared";
import { db } from "../db";
import {
  attachments,
  calls,
  constellationAuditLog,
  constellationBans,
  constellationCategories,
  constellationInvites,
  constellationJoinRequests,
  constellationLinks,
  constellationMemberRoles,
  constellationMembers,
  constellationRoles,
  constellations,
  conversationMembers,
  conversations,
  nebulas,
  users,
} from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { canMessage, deletionPending, isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { lockedDown, LOCKDOWN_MESSAGE } from "../admin/lockdown";
import { emitToUser } from "../realtime";
import { inBackground, notifyConstellationInvite } from "../push/notify";
import { sendStream, storage } from "../storage";
import { PHOTO_UPLOAD_MAX, squarePhoto } from "../profile/photo";
import { removeFiles } from "../messages/attachments";
import type { Tx } from "../messages/routes";
import { activeCallOf, closeCall, joinVoiceRoom, leaveCall, openVoiceRoom, peopleInCall } from "../calls/service";
import { joinDetails } from "../calls/routes";
import { LIVEKIT_URL, livekitConfigured, previewToken, removeFromRoom, setMicrophoneAllowed } from "../calls/livekit";
import { setVoiceMuted } from "../calls/voiceMutes";
import { nebulaOfChat, rememberNebulaChat } from "./chats";
import { can, OWNER_RANK, outranks, ranksOf, standingOf, type Standing , frozen, FROZEN_MESSAGE } from "./perms";
import { addMember, afterJoin, ConstellationFull, removeMember, TooManyConstellations } from "./members";
import { constellationChanged, logModeration, memberIdsOf, tellMembers } from "./activity";
import { cardsFor, detailFor, entriesFor, publicUsers, welcomeOf } from "./views";
import { bannerKey, memberCard } from "./community";
import { bannerPhoto } from "../profile/photo";
import { announceVoice, setSharing, voiceStatesOf } from "./voice";
import { mentionsFor, newsFor, pinCount, pinNebula, pinsFor, readAllMentions, unpinNebula } from "./home";
import { fireConstellationEvent } from "../integrations/events";
import { seesNebulaChat, syncNebulaAccess } from "./access";
import { knowsThreads } from "../threads/legacy";
import { answerOnboarding, onboardingInput, saveOnboarding, setNebulaShown } from "./onboarding";

// Constellations (Glofly 2.0): communities with nebulas, categories, members and roles.
// Every action is permission-checked here. Restricted (family) accounts can't use any of it.
//
//   GET    /constellations                          my cards + friends' invites
//   POST   /constellations                          create  { name, template, visibility, type?, tags?, color? }
//   PUT    /constellations/order                    { ids }  my dashboard / icon strip order
//   GET    /constellations/directory?q=&type=&tag=&offset=   public ones
//   GET    /constellations/discover                           top tags + 3 to try
//   GET    /constellations/pins                     nebulas pinned to the home dock
//   GET    /constellations/mentions?before=         @mentions of me, newest first
//   POST   /constellations/mentions/read            "Mark all read"
//   PUT    /constellations/:id/nebulas/:nid/pin     pin to the home dock · DELETE unpin
//   GET    /constellations/chats/:conversationId    which nebula a nebula chat is (phones' notifications)
//   GET    /constellations/links/:code              what an invite link is (preview)
//   POST   /constellations/links/:code/join         join with it
//   POST   /constellations/invites/:id/dismiss      "Not now"
//   GET    /constellations/:id                      everything (members only)
//   PATCH  /constellations/:id                      settings  { name?, description?, color?, visibility?, type?, tags? }
//   PUT    /constellations/:id/icon  · DELETE       the icon photo (image is the body)
//   GET    /constellations/:id/icon/:version
//   DELETE /constellations/:id                      { name } (Owner; typed name confirms)
//   POST   /constellations/:id/transfer             { userId } (Owner)
//   POST   /constellations/:id/join                 { note? } public / approval / invited
//   DELETE /constellations/:id/request              take back my request
//   POST   /constellations/:id/leave
//   POST   /constellations/:id/read                 everything read
//   PUT    /constellations/:id/notify               { level }
//   PUT    /constellations/:id/nebulas/:nid/notify  { level | null }
//   POST   /constellations/:id/categories           { name }   · PATCH/DELETE …/:cid
//   PUT    /constellations/:id/layout               { categories: [ids], nebulas: [{ id, categoryId }] }
//   POST   /constellations/:id/nebulas              { name, kind, categoryId?, topic?, readOnly? } · PATCH/DELETE …/:nid
//   POST   /constellations/:id/nebulas/:nid/voice   drop into a voice nebula → { call, token, url }
//   POST   /constellations/:id/voice/sharing        { callId, sharing }  (the LIVE badge)
//   POST   /constellations/:id/nebulas/:nid/voice/mute        { userId, muted }
//   POST   /constellations/:id/nebulas/:nid/voice/disconnect  { userId }
//   POST   /constellations/:id/roles                { name, color, permissions } · PATCH/DELETE …/:rid
//   PUT    /constellations/:id/roles/order          { ids }  highest first
//   PUT    /constellations/:id/members/:uid/roles   { roleIds }
//   POST   /constellations/:id/members/:uid/timeout { length, reason? } · DELETE
//   POST   /constellations/:id/members/:uid/kick    { reason? }
//   POST   /constellations/:id/members/:uid/ban     { reason? }
//   GET    /constellations/:id/bans                 · DELETE …/bans/:uid
//   GET    /constellations/:id/requests             · POST …/requests/:uid/approve | deny
//   POST   /constellations/:id/invites              { userIds }  invite friends
//   GET    /constellations/:id/links                · POST { lifetime, maxUses? } · DELETE …/links/:linkId
//   GET    /constellations/:id/moderation?before=   what moderators did
//   0.7.5 community and identity:
//   PATCH  /constellations/:id                      also { accent, rules, welcome }
//   PUT    /constellations/:id/banner · DELETE      the banner photo (image is the body)
//   GET    /constellations/:id/banner/:version
//   POST   /constellations/:id/welcome              { agreed?, roleIds? }  done with the welcome screen
//   PUT    /constellations/:id/me/roles             { roleIds }  the roles I picked myself
//   GET    /constellations/:id/members/:uid/card    mutual friends, for the member card

export const constellationsRouter = Router();
constellationsRouter.use(requireAuth);

type Me = { id: string; username: string; displayName: string };
const me = (res: Response): Me => res.locals.user as Me;

// Restricted (family-managed) accounts can't be in constellations at all (Chip, Oct 17).
constellationsRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return;
  }
  next();
});

const limiter = (name: string, limit: number, windowMs: number, message: string) =>
  rateLimit(name, {
    windowMs,
    limit,
    keyGenerator: (_req, res) => me(res).id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_requests", message },
  });
const createLimiter = limiter("constellations:create", 10, 60 * 60 * 1000, "That's a lot of new constellations. Try again later.");
const changeLimiter = limiter("constellations:change", 120, 10 * 60 * 1000, "That's a lot of changes. Wait a few minutes and try again.");
const joinLimiter = limiter("constellations:join", 30, 10 * 60 * 1000, "That's a lot of joining. Wait a few minutes and try again.");
const directoryLimiter = limiter("constellations:directory", 60, 60 * 1000, "That's a lot of searching. Try again in a minute.");
// 0.7.5: invite cards in chats look their link up (more often than joining).
const previewLimiter = limiter("constellations:preview", 240, 10 * 60 * 1000, "That's a lot of invite links. Wait a few minutes.");
const cardLimiter = limiter("constellations:card", 120, 60 * 1000, "That's a lot of profiles. Wait a minute.");

const idParam = z.uuid();
const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁩﻿]/;
const plainText = (max: number, label: string) =>
  z
    .string()
    .transform((s) => s.normalize("NFKC").trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(1, `${label} can't be empty.`)
        .max(max, `${label} can be up to ${max} characters.`)
        .refine((t) => !HIDDEN_CHARS.test(t), `${label} can't contain hidden characters.`),
    );
const optionalText = (max: number, label: string) =>
  z
    .string()
    .nullable()
    .transform((s) => (s ?? "").replace(/\r\n/g, "\n").trim())
    .pipe(z.string().max(max, `${label} can be up to ${max} characters.`))
    .transform((s) => s || null);
const tagsField = z
  .array(z.string().max(40))
  .max(CONSTELLATION_TAGS_MAX * 2)
  .transform((list, ctx) => {
    const out: string[] = [];
    for (const raw of list) {
      const t = cleanTag(raw);
      if (!t) {
        ctx.addIssue({ code: "custom", message: `"${raw}" won't work as a tag (letters and numbers, up to 20).` });
        return z.NEVER;
      }
      if (!out.includes(t)) out.push(t);
    }
    if (out.length > CONSTELLATION_TAGS_MAX) {
      ctx.addIssue({ code: "custom", message: `Up to ${CONSTELLATION_TAGS_MAX} tags.` });
      return z.NEVER;
    }
    return out;
  });
const visibilityField = z.enum(["invite", "public", "approval"]);
const notifyField = z.enum(["all", "mentions", "none"]);

const bad = (res: Response, message: string, status = 400) => res.status(status).json({ error: status === 403 ? "forbidden" : "invalid", message });
const notFound = (res: Response) => res.status(404).json({ error: "not_found", message: "That constellation isn't available." });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "That didn't work. Try again.";

/** I'm in this constellation (and, if asked, may do this). Answers the request otherwise. */
async function standingFor(req: Request, res: Response, permission?: ConstellationPermission): Promise<Standing | null> {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) {
    notFound(res);
    return null;
  }
  const s = await standingOf(id.data, me(res).id);
  if (!s) {
    notFound(res);
    return null;
  }
  if (permission && !can(s, permission)) {
    bad(res, "Your role doesn't allow that here.", 403);
    return null;
  }
  return s;
}

/** Someone else in the constellation (404s otherwise). */
async function targetFor(req: Request, res: Response, actor: Standing): Promise<Standing | null> {
  const uid = idParam.safeParse(req.params.uid ?? req.body?.userId);
  const t = uid.success ? await standingOf(actor.constellationId, uid.data) : null;
  if (!t) {
    res.status(404).json({ error: "not_found", message: "They're not in this constellation." });
    return null;
  }
  return t;
}

const tooHigh = (res: Response) => bad(res, "You can only do that to people with a lower role than yours.", 403);

// ───────────── Dashboard ─────────────

async function myInvites(userId: string) {
  const rows = await db
    .select({ id: constellationInvites.id, constellationId: constellationInvites.constellationId, inviterId: constellationInvites.inviterId, createdAt: constellationInvites.createdAt })
    .from(constellationInvites)
    .innerJoin(constellations, eq(constellations.id, constellationInvites.constellationId))
    .where(and(eq(constellationInvites.inviteeId, userId), isNull(constellationInvites.dismissedAt), isNull(constellations.takenDownAt)))
    .orderBy(desc(constellationInvites.createdAt))
    .limit(20);
  const entries = await entriesFor(userId, rows.map((r) => r.constellationId));
  const people = await publicUsers(rows.map((r) => r.inviterId));
  return rows
    .map((r) => ({ id: r.id, constellation: entries.find((e) => e.id === r.constellationId)!, by: people.get(r.inviterId)!, createdAt: r.createdAt.toISOString() }))
    .filter((i) => i.constellation && i.by && !i.constellation.joined);
}

// GET /constellations — my dashboard.
constellationsRouter.get("/", async (_req, res) => {
  const myId = me(res).id;
  res.json({ constellations: await cardsFor(myId), invites: await myInvites(myId) });
});

// PUT /constellations/order  { ids } — drag to reorder (dashboard and icon strip).
constellationsRouter.put("/order", changeLimiter, async (req, res) => {
  const parsed = z.object({ ids: z.array(idParam).min(1).max(200) }).safeParse(req.body);
  if (!parsed.success || new Set(parsed.data.ids).size !== parsed.data.ids.length) {
    bad(res, "That order didn't make sense. Try again.");
    return;
  }
  const myId = me(res).id;
  await db.transaction(async (tx) => {
    let position = 0;
    for (const id of parsed.data.ids) {
      await tx
        .update(constellationMembers)
        .set({ position: position++ })
        .where(and(eq(constellationMembers.constellationId, id), eq(constellationMembers.userId, myId)));
    }
  });
  emitToUser(myId, "constellations:changed", {}, true);
  res.status(204).end();
});

// ───────────── Creating ─────────────

/** A nebula and its conversation; everyone in the constellation is in it. */
export async function createNebula(
  tx: Tx,
  constellationId: string,
  values: {
    name: string;
    kind: NebulaKind;
    categoryId: string | null;
    topic: string | null;
    position: number;
    readOnly?: boolean;
    visibility?: "everyone" | "roles";
    roleIds?: string[];
    /** Communities round (tickets): people who see it whatever their roles */
    userIds?: string[];
  } & Partial<Pick<typeof nebulas.$inferInsert, "threadsStaffOnly" | "threadCloseDays" | "forumTags" | "forumGuidelines" | "forumRequireTag" | "forumSort">>,
) {
  const [chat] = await tx.insert(conversations).values({ kind: "nebula", name: values.name }).returning({ id: conversations.id });
  rememberNebulaChat(chat.id);
  const [row] = await tx
    .insert(nebulas)
    .values({ constellationId, conversationId: chat.id, ...values, readOnly: values.readOnly ?? false })
    .returning();
  const members = await tx
    .select({ userId: constellationMembers.userId })
    .from(constellationMembers)
    .where(eq(constellationMembers.constellationId, constellationId));
  if (members.length) {
    await tx.insert(conversationMembers).values(members.map((m) => ({ conversationId: chat.id, userId: m.userId })));
  }
  // 0.8.0: a role-only nebula (or one in a role-only category) keeps only the people who can see it.
  const category = values.categoryId
    ? (await tx.select({ visibility: constellationCategories.visibility }).from(constellationCategories).where(eq(constellationCategories.id, values.categoryId)))[0]
    : undefined;
  if (values.visibility === "roles" || category?.visibility === "roles") await syncNebulaAccess(constellationId, { tx });
  return row;
}

/** 0.8.0: everyone's access to role-only nebulas again, after roles, members or settings changed. */
async function resync(constellationId: string, userIds?: string[]): Promise<void> {
  await syncNebulaAccess(constellationId, userIds ? { userIds } : {});
}

/** 0.8.0: the "Who can see this" fields (nebulas and categories). Role ids must be this constellation's (not Member). */
const visibilityFields = {
  visibility: z.enum(["everyone", "roles"]).optional(),
  roleIds: z.array(idParam).max(CUSTOM_ROLES_MAX + 2).optional(),
};
async function cleanRoleIds(constellationId: string, ids: string[] | undefined): Promise<string[] | undefined> {
  if (ids === undefined) return undefined;
  const rows = await db
    .select({ id: constellationRoles.id })
    .from(constellationRoles)
    .where(and(eq(constellationRoles.constellationId, constellationId), ne(constellationRoles.kind, "member")));
  return [...new Set(ids)].filter((id) => rows.some((r) => r.id === id));
}

const createBody = z.object({
  name: plainText(CONSTELLATION_NAME_MAX, "The name"),
  template: z.enum(["friends", "gaming", "study", "blank"]).default("blank"),
  visibility: visibilityField.default("invite"),
  type: z.string().nullable().optional(),
  tags: tagsField.optional(),
  description: optionalText(CONSTELLATION_DESCRIPTION_MAX, "The description").optional(),
  color: z.string().optional(),
});

// POST /constellations — create one. I'm its Owner.
constellationsRouter.post("/", createLimiter, async (req, res) => {
  const myId = me(res).id;
  if (await lockedDown(myId)) {
    bad(res, LOCKDOWN_MESSAGE.message, 403);
    return;
  }
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    bad(res, firstIssue(parsed.error));
    return;
  }
  const { name, template, visibility, tags, description } = parsed.data;
  const type = parsed.data.type ?? null;
  if (type !== null && !isConstellationType(type)) {
    bad(res, "Pick what kind of constellation it is.");
    return;
  }
  if (visibility !== "invite" && !type) {
    bad(res, "Public constellations need a type, so people can find them in the directory.");
    return;
  }
  if (await deletionPending(myId)) {
    bad(res, "Your account is set to be deleted.", 403);
    return;
  }
  const owned = await db.$count(constellations, and(eq(constellations.ownerId, myId), isNull(constellations.takenDownAt)));
  if (owned >= CONSTELLATIONS_OWNED_MAX) {
    bad(res, `You can own up to ${CONSTELLATIONS_OWNED_MAX} constellations.`, 409);
    return;
  }
  const color = isConstellationColor(parsed.data.color) ? parsed.data.color : colorForName(name);
  const plan = CONSTELLATION_TEMPLATES.find((t) => t.id === template)!;
  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(constellations)
        .values({ name, description: description ?? null, color, ownerId: myId, visibility, type, tags: tags ?? [] })
        .returning({ id: constellations.id });
      await tx.insert(constellationRoles).values(
        DEFAULT_ROLES.map((r) => ({
          constellationId: c.id,
          kind: r.kind,
          name: r.name,
          color: r.color,
          position: r.kind === "admin" ? 2 : r.kind === "moderator" ? 1 : 0,
          permissions: [...r.permissions],
        })),
      );
      await addMember(tx, c.id, myId, { welcomed: true });
      // 0.8.0 templates: starter roles members pick themselves (labels only, never permissions),
      // just above Member, the first one highest; Moderator and Admin move above them.
      const roleIds = new Map<string, string>();
      if (plan.roles.length) {
        await tx
          .update(constellationRoles)
          .set({ position: sql`${constellationRoles.position} + ${plan.roles.length}` })
          .where(and(eq(constellationRoles.constellationId, c.id), ne(constellationRoles.kind, "member")));
        const made = await tx
          .insert(constellationRoles)
          .values(
            plan.roles.map((r, i) => ({
              constellationId: c.id,
              kind: "custom" as const,
              name: r.name,
              color: r.color,
              position: plan.roles.length - i,
              permissions: [],
              selfAssign: r.selfAssign,
            })),
          )
          .returning({ id: constellationRoles.id, name: constellationRoles.name });
        for (const r of made) roleIds.set(r.name, r.id);
      }
      // House rules, the welcome new members see (the about; a description typed in wins), accent.
      await tx
        .update(constellations)
        .set({
          rules: [...plan.rules],
          accent: plan.accent,
          ...(isConstellationColor(parsed.data.color) ? {} : { color: ACCENT_THEME[plan.accent].legacy }),
          ...(description ? {} : plan.welcome ? { description: plan.welcome } : {}),
        })
        .where(eq(constellations.id, c.id));
      let nebulaPosition = 0;
      for (const [i, category] of plan.categories.entries()) {
        const [cat] = await tx
          .insert(constellationCategories)
          .values({ constellationId: c.id, name: category.name, position: i })
          .returning({ id: constellationCategories.id });
        for (const n of category.nebulas) {
          const only = (n.roles ?? []).map((name) => roleIds.get(name)).filter((id): id is string => !!id);
          await createNebula(tx, c.id, {
            name: n.name,
            kind: n.kind,
            categoryId: cat.id,
            topic: n.topic ?? null,
            position: nebulaPosition++,
            ...(only.length ? { visibility: "roles" as const, roleIds: only } : {}),
          });
        }
      }
      return c.id;
    });
  } catch (err) {
    if (err instanceof TooManyConstellations) {
      bad(res, "You're in a lot of constellations already. Leave one first.", 409);
      return;
    }
    throw err;
  }
  emitToUser(myId, "constellations:changed", {}, true);
  res.status(201).json({ constellation: await detailFor(id, myId) });
});

// GET /constellations/chats/:conversationId — which constellation and nebula a nebula's chat
// belongs to (0.7.0 phones: a nebula notification opens glofly://chat/<conversationId>, and the
// app asks here where that is). Members only; anything else is a 404.
constellationsRouter.get("/chats/:conversationId", async (req, res) => {
  const cid = idParam.safeParse(req.params.conversationId);
  const nebula = cid.success ? await nebulaOfChat(cid.data) : null;
  const s = nebula ? await standingOf(nebula.constellationId, me(res).id) : null;
  // 0.8.0: a role-only nebula I can't see is as good as not there.
  if (!nebula || !s || !(await seesNebulaChat(s.userId, String(cid.data)))) {
    res.status(404).json({ error: "not_found", message: "That nebula isn't available." });
    return;
  }
  res.json({ constellationId: nebula.constellationId, nebulaId: nebula.id, kind: nebula.kind });
});

// ───────────── Directory, links and invites ─────────────

// GET /constellations/directory?q=&type=&tag=&offset= — public constellations, most members first.
constellationsRouter.get("/directory", directoryLimiter, async (req, res) => {
  const myId = me(res).id;
  const q = z.string().trim().max(60).catch("").parse(req.query.q);
  const type = isConstellationType(req.query.type) ? req.query.type : null;
  const tag = typeof req.query.tag === "string" ? cleanTag(req.query.tag) : null;
  const offset = z.coerce.number().int().min(0).max(2000).catch(0).parse(req.query.offset);
  const PAGE = 24;
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const memberCount = sql<number>`(select count(*)::int from ${constellationMembers} cm where cm.constellation_id = ${constellations.id})`;
  const rows = await db
    .select({ id: constellations.id })
    .from(constellations)
    .where(
      and(
        ne(constellations.visibility, "invite"),
        isNull(constellations.takenDownAt),
        q ? or(ilike(constellations.name, pattern), sql`${q.toLowerCase()} = any(${constellations.tags})`) : undefined,
        type ? eq(constellations.type, type) : undefined,
        tag ? sql`${tag} = any(${constellations.tags})` : undefined,
        // Not ones that banned me.
        sql`not exists (select 1 from ${constellationBans} b where b.constellation_id = ${constellations.id} and b.user_id = ${myId})`,
      ),
    )
    .orderBy(desc(memberCount), desc(constellations.lastActivityAt))
    .offset(offset)
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  res.json({ results: await entriesFor(myId, page.map((r) => r.id)), hasMore: rows.length > PAGE });
});

// ───────────── The nebula dock on Glofly home ─────────────

// GET /constellations/pins — nebulas I pinned to the home dock, with unread counts.
constellationsRouter.get("/pins", async (_req, res) => {
  res.json({ pins: await pinsFor(me(res).id) });
});

// GET /constellations/mentions?before= — @mentions of me across my nebulas, newest first.
// GET /constellations/news — 0.7.1: nebulas with news for you (the phone's Chats list).
constellationsRouter.get("/news", async (_req, res) => {
  res.json({ news: await newsFor(me(res).id) });
});

constellationsRouter.get("/mentions", async (req, res) => {
  const before = typeof req.query.before === "string" ? new Date(req.query.before) : undefined;
  res.json(await mentionsFor(me(res).id, before && !Number.isNaN(before.getTime()) ? before : undefined));
});

// POST /constellations/mentions/read — "Mark all read" (every nebula with an unread @mention of me).
constellationsRouter.post("/mentions/read", async (_req, res) => {
  const myId = me(res).id;
  const touched = await readAllMentions(myId);
  for (const constellationId of touched) emitToUser(myId, "constellation:updated", { constellationId }, true);
  emitToUser(myId, "constellations:changed", {}, true);
  res.status(204).end();
});

// GET /constellations/discover — the dashboard's "Adventure to new constellations": the most-used
// genre tags in the directory, and up to 3 public constellations to try (friends in them first,
// then the biggest, then the most active). Ones I'm in, banned from or taken down are left out.
constellationsRouter.get("/discover", directoryLimiter, async (_req, res) => {
  const myId = me(res).id;
  const listed = and(
    ne(constellations.visibility, "invite"),
    isNull(constellations.takenDownAt),
    sql`not exists (select 1 from ${constellationBans} b where b.constellation_id = ${constellations.id} and b.user_id = ${myId})`,
  );
  const tagRows = await db.execute<{ tag: string; uses: number }>(
    sql`select t.tag, count(*)::int as uses
        from ${constellations}, unnest(${constellations.tags}) as t(tag)
        where ${constellations.visibility} <> 'invite' and ${constellations.takenDownAt} is null
        group by t.tag order by uses desc, t.tag asc limit 10`,
  );
  const memberCount = sql<number>`(select count(*)::int from ${constellationMembers} cm where cm.constellation_id = ${constellations.id})`;
  const candidates = await db
    .select({ id: constellations.id })
    .from(constellations)
    .where(
      and(
        listed,
        sql`not exists (select 1 from ${constellationMembers} m where m.constellation_id = ${constellations.id} and m.user_id = ${myId})`,
      ),
    )
    .orderBy(desc(memberCount), desc(constellations.lastActivityAt))
    .limit(30);
  const entries = await entriesFor(myId, candidates.map((r) => r.id));
  // Friends in it first; otherwise keep the biggest / most active order.
  const suggestions = entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (b.e.friends.length > 0 ? 1 : 0) - (a.e.friends.length > 0 ? 1 : 0) || a.i - b.i)
    .map((x) => x.e)
    .filter((e) => !e.joined)
    .slice(0, 3);
  res.json({ tags: tagRows.rows.map((r) => r.tag), suggestions });
});

/** A link that still works (null otherwise). */
async function liveLink(code: string) {
  if (!/^[A-Za-z0-9]{6,16}$/.test(code)) return null;
  const [link] = await db
    .select({ link: constellationLinks, takenDownAt: constellations.takenDownAt, invitesOffAt: constellations.invitesOffAt })
    .from(constellationLinks)
    .innerJoin(constellations, eq(constellations.id, constellationLinks.constellationId))
    .where(eq(constellationLinks.code, code));
  if (!link || link.takenDownAt || link.invitesOffAt || link.link.revokedAt) return null;
  if (link.link.expiresAt && link.link.expiresAt.getTime() <= Date.now()) return null;
  if (link.link.maxUses !== null && link.link.uses >= link.link.maxUses) return null;
  return link.link;
}

/** 0.8.2: invites turned off (or the constellation frozen) in Glofly Control. Answers and returns true. */
async function invitesBlocked(res: Response, constellationId: string): Promise<boolean> {
  const [c] = await db.select({ invitesOffAt: constellations.invitesOffAt, frozenAt: constellations.frozenAt }).from(constellations).where(eq(constellations.id, constellationId));
  if (c?.frozenAt) {
    bad(res, FROZEN_MESSAGE, 403);
    return true;
  }
  if (c?.invitesOffAt) {
    bad(res, "The Glofly team turned off invites for this constellation for now.", 403);
    return true;
  }
  return false;
}

const deadLink = (res: Response) =>
  res.status(404).json({ error: "not_found", message: "That invite has expired or doesn't exist. Ask for a new one." });

async function isBanned(constellationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: constellationBans.userId })
    .from(constellationBans)
    .where(and(eq(constellationBans.constellationId, constellationId), eq(constellationBans.userId, userId)));
  return !!row;
}

// GET /constellations/links/:code — what an invite link is (0.7.5: also who made it and when it
// runs out, for the invite card in chats).
constellationsRouter.get("/links/:code", previewLimiter, async (req, res) => {
  const link = await liveLink(String(req.params.code));
  if (!link) {
    deadLink(res);
    return;
  }
  const [entry] = await entriesFor(me(res).id, [link.constellationId]);
  if (!entry) {
    deadLink(res);
    return;
  }
  const by = link.createdBy ? ((await publicUsers([link.createdBy])).get(link.createdBy) ?? null) : null;
  res.json({ constellation: entry, by, expiresAt: link.expiresAt?.toISOString() ?? null });
});

/** Joins, answering the request (shared by links, public joins and invites). */
async function joinNow(res: Response, constellationId: string, userId: string, afterAdd?: (tx: Tx) => Promise<void>) {
  // 0.8.2, Glofly Control: no joining a frozen constellation, or as a new account during Lockdown.
  if (await frozen(constellationId)) {
    bad(res, FROZEN_MESSAGE, 403);
    return;
  }
  if (await lockedDown(userId)) {
    bad(res, LOCKDOWN_MESSAGE.message, 403);
    return;
  }
  if (await isBanned(constellationId, userId)) {
    bad(res, "You can't join this constellation.", 403);
    return;
  }
  if (await deletionPending(userId)) {
    bad(res, "Your account is set to be deleted.", 403);
    return;
  }
  try {
    const added = await db.transaction(async (tx) => {
      await tx.select({ id: constellations.id }).from(constellations).where(eq(constellations.id, constellationId)).for("update");
      const fresh = await addMember(tx, constellationId, userId);
      if (fresh && afterAdd) await afterAdd(tx);
      return fresh;
    });
    if (added) {
      await afterJoin(constellationId, userId);
      await logModeration(constellationId, userId, "joined", userId);
    }
    res.json({ constellation: await detailFor(constellationId, userId) });
  } catch (err) {
    if (err instanceof ConstellationFull) {
      bad(res, "This constellation is full.", 409);
      return;
    }
    if (err instanceof TooManyConstellations) {
      bad(res, "You're in a lot of constellations already. Leave one first.", 409);
      return;
    }
    throw err;
  }
}

// POST /constellations/links/:code/join — join with an invite link.
constellationsRouter.post("/links/:code/join", joinLimiter, async (req, res) => {
  const link = await liveLink(String(req.params.code));
  if (!link) {
    deadLink(res);
    return;
  }
  try {
    await joinNow(res, link.constellationId, me(res).id, async (tx) => {
      // Counted only while it still has uses left, so two people joining at once can't go past
      // its limit (the join is undone if it ran out in the meantime).
      const counted = await tx
        .update(constellationLinks)
        .set({ uses: sql`${constellationLinks.uses} + 1` })
        .where(
          and(
            eq(constellationLinks.id, link.id),
            isNull(constellationLinks.revokedAt),
            or(isNull(constellationLinks.maxUses), lt(constellationLinks.uses, constellationLinks.maxUses)),
          ),
        )
        .returning({ id: constellationLinks.id });
      if (!counted.length) throw new LinkUsedUp();
    });
  } catch (err) {
    if (err instanceof LinkUsedUp) {
      deadLink(res);
      return;
    }
    throw err;
  }
});

class LinkUsedUp extends Error {}

/** Where a deleted category's nebulas go, and the new constellation's first category (0.7.1). */
const GENERAL_CATEGORY = "General";

// POST /constellations/invites/:inviteId/dismiss — "Not now".
constellationsRouter.post("/invites/:inviteId/dismiss", async (req, res) => {
  const id = idParam.safeParse(req.params.inviteId);
  if (id.success) {
    await db
      .update(constellationInvites)
      .set({ dismissedAt: new Date() })
      .where(and(eq(constellationInvites.id, id.data), eq(constellationInvites.inviteeId, me(res).id)));
    emitToUser(me(res).id, "constellations:changed", {}, true);
  }
  res.status(204).end();
});

// ───────────── One constellation ─────────────

// GET /constellations/:id
constellationsRouter.get("/:id", async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  res.set("Cache-Control", "no-store");
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// PATCH /constellations/:id — settings (Overview).
constellationsRouter.patch("/:id", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageConstellation");
  if (!s) return;
  const parsed = z
    .object({
      name: plainText(CONSTELLATION_NAME_MAX, "The name").optional(),
      description: optionalText(CONSTELLATION_DESCRIPTION_MAX, "The description").optional(),
      color: z.string().optional(),
      visibility: visibilityField.optional(),
      type: z.string().nullable().optional(),
      tags: tagsField.optional(),
      // 0.7.5 identity and welcome
      accent: z.string().nullable().optional(),
      rules: z.array(z.string().max(RULE_MAX * 2)).max(RULES_MAX * 2).optional(),
      welcome: z
        .object({ screen: z.boolean(), joinLines: z.boolean(), milestones: z.boolean(), preview: z.boolean() })
        .partial()
        .strict()
        .optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    bad(res, firstIssue(parsed.error));
    return;
  }
  const d = parsed.data;
  if (d.accent !== undefined && d.accent !== null && !isConstellationAccent(d.accent)) {
    bad(res, "Pick one of the accent colors.");
    return;
  }
  let rules: string[] | undefined;
  if (d.rules !== undefined) {
    rules = [];
    for (const raw of d.rules) {
      const t = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
      if (!t) continue;
      if (t.length > RULE_MAX) {
        bad(res, `Each rule can be up to ${RULE_MAX} characters.`);
        return;
      }
      if (HIDDEN_CHARS.test(t)) {
        bad(res, "Rules can't contain hidden characters.");
        return;
      }
      rules.push(t);
    }
    if (rules.length > RULES_MAX) {
      bad(res, `Up to ${RULES_MAX} rules.`);
      return;
    }
  }
  if (d.color !== undefined && !isConstellationColor(d.color)) {
    bad(res, "Pick one of the colors.");
    return;
  }
  if (d.type !== undefined && d.type !== null && !isConstellationType(d.type)) {
    bad(res, "Pick what kind of constellation it is.");
    return;
  }
  const [current] = await db.select().from(constellations).where(eq(constellations.id, s.constellationId));
  const visibility = d.visibility ?? current.visibility;
  const type = d.type === undefined ? current.type : d.type;
  if (visibility !== "invite" && !type) {
    bad(res, "Public constellations need a type, so people can find them in the directory.");
    return;
  }
  await db
    .update(constellations)
    .set({
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.color !== undefined ? { color: d.color } : {}),
      ...(d.visibility !== undefined ? { visibility: d.visibility } : {}),
      ...(d.type !== undefined ? { type: d.type } : {}),
      ...(d.tags !== undefined ? { tags: d.tags } : {}),
      // An accent also sets the nearest older color, so apps before 0.7.5 look close.
      ...(d.accent !== undefined ? { accent: d.accent, ...(d.accent ? { color: ACCENT_THEME[d.accent as keyof typeof ACCENT_THEME].legacy } : {}) } : {}),
      ...(rules !== undefined ? { rules } : {}),
      ...(d.welcome !== undefined ? { welcome: { ...welcomeOf(current.welcome), ...d.welcome } } : {}),
    })
    .where(eq(constellations.id, s.constellationId));
  // 0.7.5: what changed goes in the moderation log (visibility has its own line below).
  const changed = (["name", "description", "color", "type", "tags", "accent", "rules", "welcome"] as const).filter((k) => d[k] !== undefined);
  if (changed.length) await logModeration(s.constellationId, s.userId, "settings_changed", null, { fields: changed });
  // No longer asking first: people waiting are let in? No: their requests stay for a moderator
  // to approve (opening the doors shouldn't add people nobody checked).
  if (d.visibility && d.visibility !== current.visibility) {
    await logModeration(s.constellationId, s.userId, "visibility_changed", null, { from: current.visibility, to: d.visibility });
  }
  await constellationChanged(s.constellationId);
  for (const id of await memberIdsOf(s.constellationId)) emitToUser(id, "constellations:changed", {}, true);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

const iconKey = (constellationId: string, version: string) => `constellation-icons/${constellationId}/${version}.webp`;

// PUT /constellations/:id/icon — a new icon photo (the image itself is the body).
constellationsRouter.put("/:id/icon", changeLimiter, express.raw({ type: "image/*", limit: PHOTO_UPLOAD_MAX }), async (req, res) => {
  const s = await standingFor(req, res, "manageConstellation");
  if (!s) return;
  const photo = Buffer.isBuffer(req.body) && req.body.length ? await squarePhoto(req.body) : null;
  if (!photo) {
    bad(res, "That file isn't a photo Glofly can use.");
    return;
  }
  const version = randomUUID();
  await storage.put(iconKey(s.constellationId, version), photo, "image/webp");
  const [old] = await db.select({ v: constellations.iconVersion }).from(constellations).where(eq(constellations.id, s.constellationId));
  await db.update(constellations).set({ iconVersion: version }).where(eq(constellations.id, s.constellationId));
  if (old?.v) await storage.remove(iconKey(s.constellationId, old.v)).catch(() => undefined);
  await constellationChanged(s.constellationId);
  for (const id of await memberIdsOf(s.constellationId)) emitToUser(id, "constellations:changed", {}, true);
  res.json({ iconVersion: version });
});

// DELETE /constellations/:id/icon — back to its initials.
constellationsRouter.delete("/:id/icon", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageConstellation");
  if (!s) return;
  const [old] = await db.select({ v: constellations.iconVersion }).from(constellations).where(eq(constellations.id, s.constellationId));
  await db.update(constellations).set({ iconVersion: null }).where(eq(constellations.id, s.constellationId));
  if (old?.v) await storage.remove(iconKey(s.constellationId, old.v)).catch(() => undefined);
  await constellationChanged(s.constellationId);
  for (const id of await memberIdsOf(s.constellationId)) emitToUser(id, "constellations:changed", {}, true);
  res.json({ iconVersion: null });
});

// GET /constellations/:id/icon/:version — members, public ones (directory), people invited, or
// anyone holding a working invite link to it (?code=).
constellationsRouter.get("/:id/icon/:version", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const version = idParam.safeParse(req.params.version);
  if (!id.success || !version.success) {
    res.status(404).end();
    return;
  }
  const [c] = await db.select().from(constellations).where(eq(constellations.id, id.data));
  if (!c || c.takenDownAt || c.iconVersion !== version.data) {
    res.status(404).end();
    return;
  }
  const myId = me(res).id;
  let allowed = c.visibility !== "invite" || !!(await standingOf(c.id, myId));
  if (!allowed) {
    const [invite] = await db
      .select({ id: constellationInvites.id })
      .from(constellationInvites)
      .where(and(eq(constellationInvites.constellationId, c.id), eq(constellationInvites.inviteeId, myId)));
    allowed = !!invite;
  }
  if (!allowed && typeof req.query.code === "string") allowed = (await liveLink(req.query.code))?.constellationId === c.id;
  const file = allowed ? await storage.get(iconKey(c.id, version.data)) : null;
  if (!file) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  sendStream(file.stream, res);
});

// ───────────── 0.7.5: banner, welcome, my roles, member card ─────────────

// PUT /constellations/:id/banner — a new banner photo (the image itself is the body).
constellationsRouter.put("/:id/banner", changeLimiter, express.raw({ type: "image/*", limit: PHOTO_UPLOAD_MAX }), async (req, res) => {
  const s = await standingFor(req, res, "manageConstellation");
  if (!s) return;
  const photo = Buffer.isBuffer(req.body) && req.body.length ? await bannerPhoto(req.body) : null;
  if (!photo) {
    bad(res, "That file isn't a photo Glofly can use.");
    return;
  }
  const version = randomUUID();
  await storage.put(bannerKey(s.constellationId, version), photo, "image/webp");
  const [old] = await db.select({ v: constellations.bannerVersion }).from(constellations).where(eq(constellations.id, s.constellationId));
  await db.update(constellations).set({ bannerVersion: version }).where(eq(constellations.id, s.constellationId));
  if (old?.v) await storage.remove(bannerKey(s.constellationId, old.v)).catch(() => undefined);
  await logModeration(s.constellationId, s.userId, "settings_changed", null, { fields: ["banner"] });
  await constellationChanged(s.constellationId);
  for (const id of await memberIdsOf(s.constellationId)) emitToUser(id, "constellations:changed", {}, true);
  res.json({ bannerVersion: version });
});

// DELETE /constellations/:id/banner — back to the drawn sky.
constellationsRouter.delete("/:id/banner", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageConstellation");
  if (!s) return;
  const [old] = await db.select({ v: constellations.bannerVersion }).from(constellations).where(eq(constellations.id, s.constellationId));
  await db.update(constellations).set({ bannerVersion: null }).where(eq(constellations.id, s.constellationId));
  if (old?.v) await storage.remove(bannerKey(s.constellationId, old.v)).catch(() => undefined);
  await logModeration(s.constellationId, s.userId, "settings_changed", null, { fields: ["banner"] });
  await constellationChanged(s.constellationId);
  for (const id of await memberIdsOf(s.constellationId)) emitToUser(id, "constellations:changed", {}, true);
  res.json({ bannerVersion: null });
});

// GET /constellations/:id/banner/:version — the same people who may see its icon.
constellationsRouter.get("/:id/banner/:version", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const version = idParam.safeParse(req.params.version);
  if (!id.success || !version.success) {
    res.status(404).end();
    return;
  }
  const [c] = await db.select().from(constellations).where(eq(constellations.id, id.data));
  if (!c || c.takenDownAt || c.bannerVersion !== version.data) {
    res.status(404).end();
    return;
  }
  const myId = me(res).id;
  let allowed = c.visibility !== "invite" || !!(await standingOf(c.id, myId));
  if (!allowed) {
    const [invite] = await db
      .select({ id: constellationInvites.id })
      .from(constellationInvites)
      .where(and(eq(constellationInvites.constellationId, c.id), eq(constellationInvites.inviteeId, myId)));
    allowed = !!invite;
  }
  if (!allowed && typeof req.query.code === "string") allowed = (await liveLink(req.query.code))?.constellationId === c.id;
  const file = allowed ? await storage.get(bannerKey(c.id, version.data)) : null;
  if (!file) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  sendStream(file.stream, res);
});

/** Sets my self-picked roles to exactly `wanted` (only roles members may pick themselves). */
async function setMyPickedRoles(tx: Tx, constellationId: string, userId: string, wanted: string[]): Promise<string[]> {
  const pickable = await tx
    .select({ id: constellationRoles.id, name: constellationRoles.name })
    .from(constellationRoles)
    .where(and(eq(constellationRoles.constellationId, constellationId), eq(constellationRoles.selfAssign, true), eq(constellationRoles.kind, "custom")));
  const want = new Set(wanted.filter((id) => pickable.some((p) => p.id === id)));
  for (const p of pickable) {
    if (want.has(p.id)) {
      await tx.insert(constellationMemberRoles).values({ constellationId, userId, roleId: p.id }).onConflictDoNothing();
    } else {
      await tx
        .delete(constellationMemberRoles)
        .where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, userId), eq(constellationMemberRoles.roleId, p.id)));
    }
  }
  return pickable.filter((p) => want.has(p.id)).map((p) => p.name);
}

// POST /constellations/:id/welcome  { agreed?, roleIds? } — done with the welcome screen: agreed
// to the house rules (needed when it has some), and the roles I picked.
constellationsRouter.post("/:id/welcome", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const parsed = z.object({ agreed: z.boolean().optional(), roleIds: z.array(idParam).max(CUSTOM_ROLES_MAX).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    bad(res, "That didn't work. Try again.");
    return;
  }
  const [c] = await db.select({ rules: constellations.rules }).from(constellations).where(eq(constellations.id, s.constellationId));
  if (c?.rules.length && parsed.data.agreed !== true) {
    bad(res, "Agree to the house rules to continue.");
    return;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(constellationMembers)
      .set({ welcomedAt: now, ...(c?.rules.length ? { rulesAgreedAt: now } : {}) })
      .where(and(eq(constellationMembers.constellationId, s.constellationId), eq(constellationMembers.userId, s.userId)));
    if (parsed.data.roleIds) await setMyPickedRoles(tx, s.constellationId, s.userId, parsed.data.roleIds);
  });
  // 0.8.0: picked roles unlock role-only nebulas.
  if (parsed.data.roleIds) await resync(s.constellationId, [s.userId]);
  if (parsed.data.roleIds?.length) await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// PUT /constellations/:id/me/roles  { roleIds } — the roles I picked myself (any time).
constellationsRouter.put("/:id/me/roles", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const parsed = z.object({ roleIds: z.array(idParam).max(CUSTOM_ROLES_MAX) }).safeParse(req.body);
  if (!parsed.success) {
    bad(res, "Pick roles from the list.");
    return;
  }
  await db.transaction((tx) => setMyPickedRoles(tx, s.constellationId, s.userId, parsed.data.roleIds));
  fireConstellationEvent(s.constellationId, "member.roles", s.userId, await heldRoleIds(s.constellationId, s.userId));
  await resync(s.constellationId, [s.userId]);
  await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// ───────────── Onboarding (Communities round 4.3, approved boards 25–28) ─────────────

// PUT /constellations/:id/onboarding  { enabled, questions, optionalNebulaIds } — the questions new
// members answer, and which nebulas for everyone are optional (Owner / Edit constellation settings
// + Manage nebulas: it decides who sees what).
constellationsRouter.put("/:id/onboarding", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageConstellation");
  if (!s) return;
  if (!can(s, "manageNebulas")) {
    bad(res, "Your role doesn't allow that here.", 403);
    return;
  }
  if (await frozen(s.constellationId)) {
    bad(res, FROZEN_MESSAGE, 403);
    return;
  }
  const parsed = onboardingInput.safeParse(req.body);
  if (!parsed.success) {
    bad(res, firstIssue(parsed.error));
    return;
  }
  const problem = await saveOnboarding(s.constellationId, parsed.data);
  if (problem) {
    bad(res, problem);
    return;
  }
  await logModeration(s.constellationId, s.userId, "onboarding_changed", null, { enabled: parsed.data.enabled });
  await resync(s.constellationId);
  await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// POST /constellations/:id/onboarding/answers  { answers: { questionId: answerIds }, done? } — my
// answers (all of them after the welcome screen, or one question from "Your answers").
constellationsRouter.post("/:id/onboarding/answers", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const parsed = z
    .object({
      answers: z.record(z.string().max(40), z.array(z.string().max(40)).max(ONBOARDING_ANSWERS_MAX)).refine((o) => Object.keys(o).length <= ONBOARDING_QUESTIONS_MAX),
      done: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    bad(res, "Pick answers from the list.");
    return;
  }
  const r = await answerOnboarding(s.constellationId, s.userId, parsed.data.answers, parsed.data.done === true);
  if ("problem" in r) {
    bad(res, r.problem);
    return;
  }
  if (r.rolesChanged) fireConstellationEvent(s.constellationId, "member.roles", s.userId, await heldRoleIds(s.constellationId, s.userId));
  await resync(s.constellationId, [s.userId]);
  if (r.rolesChanged) await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// PUT /constellations/:id/me/nebulas/:nid  { shown } — Browse nebulas: an optional nebula, for me.
constellationsRouter.put("/:id/me/nebulas/:nid", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const nid = idParam.safeParse(req.params.nid);
  const shown = z.boolean().safeParse(req.body?.shown);
  if (!nid.success || !shown.success) {
    bad(res, "Pick a nebula to show or hide.");
    return;
  }
  const problem = await setNebulaShown(s.constellationId, s.userId, nid.data, shown.data);
  if (problem) {
    bad(res, problem);
    return;
  }
  await resync(s.constellationId, [s.userId]);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// GET /constellations/:id/members/:uid/card — the member card's mutual friends.
constellationsRouter.get("/:id/members/:uid/card", cardLimiter, async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const t = await targetFor(req, res, s);
  if (!t) return;
  res.json(t.userId === s.userId ? { mutualFriends: [], mutualCount: 0, friend: false } : await memberCard(s.userId, t.userId));
});

/** Removes a constellation for good: its nebulas, their messages and files, its icon. */
export async function deleteConstellation(constellationId: string): Promise<void> {
  const chats = await db.select({ id: nebulas.conversationId }).from(nebulas).where(eq(nebulas.constellationId, constellationId));
  const chatIds = chats.map((c) => c.id);
  const memberIds = await memberIdsOf(constellationId);
  // Anyone in a voice nebula is hung up first.
  if (chatIds.length) {
    const open = await db
      .select({ id: calls.id })
      .from(calls)
      .where(and(inArray(calls.conversationId, chatIds), inArray(calls.status, ["ringing", "ongoing"])));
    for (const call of open) await closeCall(call.id, "hang_up");
  }
  const files = chatIds.length
    ? await db
        .select({ id: attachments.id, conversationId: attachments.conversationId, kind: attachments.kind })
        .from(attachments)
        .where(inArray(attachments.conversationId, chatIds))
    : [];
  const [c] = await db
    .select({ icon: constellations.iconVersion, banner: constellations.bannerVersion })
    .from(constellations)
    .where(eq(constellations.id, constellationId));
  await db.transaction(async (tx) => {
    if (chatIds.length) await tx.delete(conversations).where(inArray(conversations.id, chatIds));
    await tx.delete(constellations).where(eq(constellations.id, constellationId));
  });
  await removeFiles(files);
  if (c?.icon) await storage.remove(iconKey(constellationId, c.icon)).catch(() => undefined);
  if (c?.banner) await storage.remove(bannerKey(constellationId, c.banner)).catch(() => undefined);
  for (const id of memberIds) {
    emitToUser(id, "constellation:removed", { constellationId }, true);
    emitToUser(id, "constellations:changed", {}, true);
  }
}

// DELETE /constellations/:id  { name } — the Owner deletes it (they type its name to confirm).
constellationsRouter.delete("/:id", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  if (!s.owner) {
    bad(res, "Only the Owner can delete a constellation.", 403);
    return;
  }
  const [c] = await db.select({ name: constellations.name }).from(constellations).where(eq(constellations.id, s.constellationId));
  const typed = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (typed !== c.name) {
    bad(res, "Type the constellation's name exactly to delete it.");
    return;
  }
  await deleteConstellation(s.constellationId);
  res.status(204).end();
});

// POST /constellations/:id/transfer  { userId } — the Owner hands it to someone else.
constellationsRouter.post("/:id/transfer", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  if (!s.owner) {
    bad(res, "Only the Owner can transfer ownership.", 403);
    return;
  }
  const t = await targetFor(req, res, s);
  if (!t) return;
  if (t.userId === s.userId) {
    bad(res, "You're already the Owner.");
    return;
  }
  // 0.7.3: the new Owner must be able to own it (not leaving Glofly, not a family account, under the limit).
  if (await deletionPending(t.userId)) {
    bad(res, "Their account is set to be deleted, so they can't own it.", 409);
    return;
  }
  if (await isRestricted(t.userId)) {
    bad(res, "A family-managed account can't own a constellation.", 409);
    return;
  }
  const theirs = await db.$count(constellations, and(eq(constellations.ownerId, t.userId), isNull(constellations.takenDownAt)));
  if (theirs >= CONSTELLATIONS_OWNED_MAX) {
    bad(res, `They already own ${CONSTELLATIONS_OWNED_MAX} constellations, the most anyone can.`, 409);
    return;
  }
  await transferOwnership(s.constellationId, s.userId, t.userId);
  await resync(s.constellationId, [s.userId, t.userId]);
  await logModeration(s.constellationId, s.userId, "ownership_transferred", t.userId);
  await constellationChanged(s.constellationId);
  for (const id of [s.userId, t.userId]) emitToUser(id, "constellations:changed", {}, true);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

/** The new Owner takes over; the old one keeps an Admin role (if it still exists). */
export async function transferOwnership(constellationId: string, fromId: string, toId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(constellations).set({ ownerId: toId }).where(eq(constellations.id, constellationId));
    const [admin] = await tx
      .select({ id: constellationRoles.id })
      .from(constellationRoles)
      .where(and(eq(constellationRoles.constellationId, constellationId), eq(constellationRoles.kind, "admin")));
    if (admin) {
      await tx.insert(constellationMemberRoles).values({ constellationId, userId: fromId, roleId: admin.id }).onConflictDoNothing();
    }
  });
}

// POST /constellations/:id/join  { note? } — join a public one, ask to join one that asks first,
// or accept a friend's invite.
constellationsRouter.post("/:id/join", joinLimiter, async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const myId = me(res).id;
  const [c] = id.success ? await db.select().from(constellations).where(eq(constellations.id, id.data)) : [];
  if (!c || c.takenDownAt) {
    notFound(res);
    return;
  }
  const [invite] = await db
    .select({ id: constellationInvites.id })
    .from(constellationInvites)
    .where(and(eq(constellationInvites.constellationId, c.id), eq(constellationInvites.inviteeId, myId)));
  if (invite || c.visibility === "public") {
    await joinNow(res, c.id, myId);
    return;
  }
  if (c.visibility === "invite") {
    bad(res, "This constellation is invite only.", 403);
    return;
  }
  // Public, approval needed: a request for a moderator.
  if (await isBanned(c.id, myId)) {
    bad(res, "You can't join this constellation.", 403);
    return;
  }
  const note = optionalText(JOIN_REQUEST_NOTE_MAX, "Your note").catch(null).parse(req.body?.note ?? null);
  await db
    .insert(constellationJoinRequests)
    .values({ constellationId: c.id, userId: myId, note })
    .onConflictDoUpdate({ target: [constellationJoinRequests.constellationId, constellationJoinRequests.userId], set: { note } });
  // People who can approve see the count change.
  await constellationChanged(c.id);
  const [entry] = await entriesFor(myId, [c.id]);
  res.status(202).json({ requested: true, constellation: entry });
});

// DELETE /constellations/:id/request — take back my request to join.
constellationsRouter.delete("/:id/request", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (id.success) {
    await db
      .delete(constellationJoinRequests)
      .where(and(eq(constellationJoinRequests.constellationId, id.data), eq(constellationJoinRequests.userId, me(res).id)));
    await constellationChanged(id.data);
  }
  res.status(204).end();
});

// POST /constellations/:id/leave
constellationsRouter.post("/:id/leave", async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  if (s.owner) {
    bad(res, "Transfer ownership to someone else first (or delete the constellation).", 409);
    return;
  }
  await removeMember(s.constellationId, s.userId);
  await logModeration(s.constellationId, s.userId, "left", s.userId);
  res.status(204).end();
});

// POST /constellations/:id/read — everything in it read.
constellationsRouter.post("/:id/read", async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const chats = await db.select({ id: nebulas.conversationId }).from(nebulas).where(eq(nebulas.constellationId, s.constellationId));
  if (chats.length) {
    await db
      .update(conversationMembers)
      .set({ lastReadAt: new Date() })
      .where(and(eq(conversationMembers.userId, s.userId), inArray(conversationMembers.conversationId, chats.map((c) => c.id))));
  }
  emitToUser(s.userId, "constellations:changed", {}, true);
  res.status(204).end();
});

// PUT /constellations/:id/notify  { level?, mute?, ignoreEveryone?, ignoreRoles?, followAlerts? }
// My notification window for its nebulas (4.2, approved board 23). Older apps send only `level`.
// mute: "1h" | "8h" | "24h" | "forever" | null (null = unmute).
const notifySettingsField = z
  .object({
    level: notifyField.optional(),
    mute: z.enum(["1h", "8h", "24h", "forever"]).nullable().optional(),
    ignoreEveryone: z.boolean().optional(),
    ignoreRoles: z.boolean().optional(),
    followAlerts: z.boolean().optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined));
const CONSTELLATION_MUTE_HOURS = { "1h": 1, "8h": 8, "24h": 24 } as const;
const MUTED_FOREVER = new Date("2100-01-01T00:00:00Z"); // like a chat's "until I turn it back on"
constellationsRouter.put("/:id/notify", async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const body = notifySettingsField.safeParse(req.body);
  if (!body.success) {
    bad(res, "Pick All messages, Only @mentions or Nothing.");
    return;
  }
  const { level, mute, ignoreEveryone, ignoreRoles, followAlerts } = body.data;
  await db
    .update(constellationMembers)
    .set({
      ...(level !== undefined ? { notify: level } : {}),
      ...(mute !== undefined
        ? { mutedUntil: mute === null ? null : mute === "forever" ? MUTED_FOREVER : new Date(Date.now() + CONSTELLATION_MUTE_HOURS[mute] * 3_600_000) }
        : {}),
      ...(ignoreEveryone !== undefined ? { ignoreEveryone } : {}),
      ...(ignoreRoles !== undefined ? { ignoreRoles } : {}),
      ...(followAlerts !== undefined ? { followAlerts } : {}),
    })
    .where(and(eq(constellationMembers.constellationId, s.constellationId), eq(constellationMembers.userId, s.userId)));
  emitToUser(s.userId, "constellation:updated", { constellationId: s.constellationId }, true);
  emitToUser(s.userId, "constellations:changed", {}, true);
  res.status(204).end();
});

/** A nebula of this constellation (404s otherwise). */
async function nebulaFor(req: Request, res: Response, s: Standing) {
  const nid = idParam.safeParse(req.params.nid);
  const [n] = nid.success
    ? await db.select().from(nebulas).where(and(eq(nebulas.id, nid.data), eq(nebulas.constellationId, s.constellationId)))
    : [];
  // 0.8.0: a role-only nebula I can't see is as good as not there.
  if (!n || !(await seesNebulaChat(s.userId, n.conversationId))) {
    res.status(404).json({ error: "not_found", message: "That nebula isn't there any more." });
    return null;
  }
  return n;
}

// PUT /constellations/:id/nebulas/:nid/notify  { level | null } — this nebula only.
constellationsRouter.put("/:id/nebulas/:nid/notify", async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const n = await nebulaFor(req, res, s);
  if (!n) return;
  const level = req.body?.level === null ? null : notifyField.safeParse(req.body?.level);
  if (level !== null && !level.success) {
    bad(res, "Pick All messages, Only @mentions or Nothing.");
    return;
  }
  await db
    .update(conversationMembers)
    .set({ notifyLevel: level === null ? null : level.data })
    .where(and(eq(conversationMembers.conversationId, n.conversationId), eq(conversationMembers.userId, s.userId)));
  emitToUser(s.userId, "constellation:updated", { constellationId: s.constellationId }, true);
  emitToUser(s.userId, "constellations:changed", {}, true);
  res.status(204).end();
});

// PUT /constellations/:id/nebulas/:nid/pin — "Pin to Glofly dock".  DELETE — unpin.
constellationsRouter.put("/:id/nebulas/:nid/pin", async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const n = await nebulaFor(req, res, s);
  if (!n) return;
  if ((await pinCount(s.userId)) >= PINNED_NEBULAS_MAX) {
    bad(res, `You can pin up to ${PINNED_NEBULAS_MAX} nebulas. Unpin one first.`);
    return;
  }
  await pinNebula(s.userId, n.id);
  emitToUser(s.userId, "constellations:changed", {}, true);
  res.json({ pins: await pinsFor(s.userId) });
});
constellationsRouter.delete("/:id/nebulas/:nid/pin", async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const nid = idParam.safeParse(req.params.nid);
  if (nid.success) await unpinNebula(s.userId, nid.data);
  emitToUser(s.userId, "constellations:changed", {}, true);
  res.json({ pins: await pinsFor(s.userId) });
});

// ───────────── Categories and nebulas ─────────────

constellationsRouter.post("/:id/categories", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageNebulas");
  if (!s) return;
  const name = plainText(CATEGORY_NAME_MAX, "The category name").safeParse(req.body?.name);
  if (!name.success) {
    bad(res, firstIssue(name.error));
    return;
  }
  const count = await db.$count(constellationCategories, eq(constellationCategories.constellationId, s.constellationId));
  if (count >= CATEGORIES_MAX) {
    bad(res, `A constellation can have up to ${CATEGORIES_MAX} categories.`, 409);
    return;
  }
  await db.insert(constellationCategories).values({ constellationId: s.constellationId, name: name.data, position: count });
  await constellationChanged(s.constellationId);
  res.status(201).json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// PATCH …/categories/:cid  { name?, visibility?, roleIds? } — 0.8.0: who can see it ("Only these
// roles" hides every nebula inside from everyone else). Left out = unchanged (older apps send a name).
constellationsRouter.patch("/:id/categories/:cid", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageNebulas");
  if (!s) return;
  const cid = idParam.safeParse(req.params.cid);
  const parsed = z
    .object({ name: plainText(CATEGORY_NAME_MAX, "The category name").optional(), ...visibilityFields })
    .safeParse(req.body ?? {});
  if (!cid.success || !parsed.success) {
    bad(res, parsed.success ? "That category isn't there." : firstIssue(parsed.error));
    return;
  }
  const roleIds = await cleanRoleIds(s.constellationId, parsed.data.roleIds);
  const gateChanged = parsed.data.visibility !== undefined || roleIds !== undefined;
  await db
    .update(constellationCategories)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.visibility !== undefined ? { visibility: parsed.data.visibility } : {}),
      ...(roleIds !== undefined ? { roleIds } : {}),
    })
    .where(and(eq(constellationCategories.id, cid.data), eq(constellationCategories.constellationId, s.constellationId)));
  if (gateChanged) {
    await logModeration(s.constellationId, s.userId, "category_visibility_changed", null, { visibility: parsed.data.visibility ?? null });
    await resync(s.constellationId);
  }
  await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// DELETE …/categories/:cid — 0.7.1: its nebulas move to the "General" category (made if there
// isn't one; if General itself is deleted they're left without a category), all in one
// transaction, and it goes in the moderation log.
constellationsRouter.delete("/:id/categories/:cid", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageNebulas");
  if (!s) return;
  const cid = idParam.safeParse(req.params.cid);
  if (cid.success) {
    const done = await db.transaction(async (tx) => {
      const cats = await tx
        .select({ id: constellationCategories.id, name: constellationCategories.name, position: constellationCategories.position })
        .from(constellationCategories)
        .where(eq(constellationCategories.constellationId, s.constellationId))
        .for("update");
      const gone = cats.find((c) => c.id === cid.data);
      if (!gone) return null;
      const moving = await tx
        .select({ id: nebulas.id })
        .from(nebulas)
        .where(and(eq(nebulas.constellationId, s.constellationId), eq(nebulas.categoryId, gone.id)));
      let targetId: string | null = null;
      let targetName: string | null = null;
      if (moving.length && gone.name.trim().toLowerCase() !== GENERAL_CATEGORY.toLowerCase()) {
        const general = cats.find((c) => c.id !== gone.id && c.name.trim().toLowerCase() === GENERAL_CATEGORY.toLowerCase());
        if (general) {
          targetId = general.id;
          targetName = general.name;
        } else {
          const [made] = await tx
            .insert(constellationCategories)
            .values({ constellationId: s.constellationId, name: GENERAL_CATEGORY, position: gone.position })
            .returning({ id: constellationCategories.id });
          targetId = made.id;
          targetName = GENERAL_CATEGORY;
        }
        await tx
          .update(nebulas)
          .set({ categoryId: targetId })
          .where(and(eq(nebulas.constellationId, s.constellationId), eq(nebulas.categoryId, gone.id)));
      }
      await tx.delete(constellationCategories).where(eq(constellationCategories.id, gone.id));
      await tx.insert(constellationAuditLog).values({
        constellationId: s.constellationId,
        actorId: s.userId,
        action: "category_deleted",
        targetUserId: null,
        details: { name: gone.name, nebulas: moving.length, movedTo: targetName },
      });
      return true;
    });
    if (done) {
      await resync(s.constellationId);
      await constellationChanged(s.constellationId);
    }
  }
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// PUT /constellations/:id/layout — drag to reorder categories and nebulas (and move nebulas
// between categories) in one go.
constellationsRouter.put("/:id/layout", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageNebulas");
  if (!s) return;
  const parsed = z
    .object({
      categories: z.array(idParam).max(CATEGORIES_MAX),
      nebulas: z.array(z.object({ id: idParam, categoryId: idParam.nullable() })).max(NEBULAS_MAX),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    bad(res, "That order didn't make sense. Try again.");
    return;
  }
  const cats = await db.select({ id: constellationCategories.id }).from(constellationCategories).where(eq(constellationCategories.constellationId, s.constellationId));
  const catIds = new Set(cats.map((c) => c.id));
  const nebs = await db.select({ id: nebulas.id }).from(nebulas).where(eq(nebulas.constellationId, s.constellationId));
  const nebIds = new Set(nebs.map((n) => n.id));
  await db.transaction(async (tx) => {
    let i = 0;
    for (const id of parsed.data.categories) {
      if (catIds.has(id)) await tx.update(constellationCategories).set({ position: i++ }).where(eq(constellationCategories.id, id));
    }
    let j = 0;
    for (const n of parsed.data.nebulas) {
      if (!nebIds.has(n.id)) continue;
      const categoryId = n.categoryId && catIds.has(n.categoryId) ? n.categoryId : null;
      await tx.update(nebulas).set({ position: j++, categoryId }).where(eq(nebulas.id, n.id));
    }
  });
  // 0.8.0: moving a nebula in or out of a role-only category changes who sees it.
  await resync(s.constellationId);
  await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// Communities round: forum settings (forums) and thread settings (text nebulas).
const forumTagBody = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  name: z.string().trim().min(1).max(FORUM_TAG_NAME_MAX),
  color: z.enum(["blue", "red", "green", "violet", "amber", "gray"]),
  staffOnly: z.boolean().default(false),
});
const threadFields = {
  threadsStaffOnly: z.boolean().optional(),
  threadCloseDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(30)]).optional(),
  forum: z
    .object({
      tags: z.array(forumTagBody).max(FORUM_TAGS_MAX).optional(),
      guidelines: z.string().max(FORUM_GUIDELINES_MAX).nullable().optional(),
      requireTag: z.boolean().optional(),
      sort: z.enum(["activity", "newest"]).optional(),
    })
    .optional(),
};
/** Forum fields → columns (new tags get ids; names unique, case ignored). */
type ForumColumns = Partial<Pick<typeof nebulas.$inferInsert, "forumTags" | "forumGuidelines" | "forumRequireTag" | "forumSort">>;
function forumColumns(f: z.infer<typeof threadFields.forum>): ForumColumns | string {
  if (!f) return {};
  const out: ForumColumns = {};
  if (f.tags) {
    const seen = new Set<string>();
    const tags = [];
    for (const t of f.tags) {
      const key = t.name.toLowerCase();
      if (seen.has(key)) return `There are two tags called ${t.name}.`;
      seen.add(key);
      tags.push({ id: t.id ?? randomUUID().slice(0, 8), name: t.name, color: t.color, staffOnly: t.staffOnly });
    }
    out.forumTags = tags;
  }
  if (f.guidelines !== undefined) out.forumGuidelines = f.guidelines?.trim() || null;
  if (f.requireTag !== undefined) out.forumRequireTag = f.requireTag;
  if (f.sort !== undefined) out.forumSort = f.sort;
  return out;
}

const nebulaBody = z.object({
  name: z.string().max(100),
  kind: z.enum(["text", "voice", "forum"]),
  ...threadFields,
  categoryId: idParam.nullable().optional(),
  topic: optionalText(NEBULA_TOPIC_MAX, "The topic").optional(),
  readOnly: z.boolean().optional(),
  // 0.8.0 role-only nebulas
  ...visibilityFields,
});

constellationsRouter.post("/:id/nebulas", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageNebulas");
  if (!s) return;
  const parsed = nebulaBody.safeParse(req.body);
  if (!parsed.success) {
    bad(res, firstIssue(parsed.error));
    return;
  }
  const name = cleanNebulaName(parsed.data.name, parsed.data.kind);
  if (!name) {
    bad(res, "Give the nebula a name (up to 32 characters).");
    return;
  }
  const count = await db.$count(nebulas, eq(nebulas.constellationId, s.constellationId));
  if (count >= NEBULAS_MAX) {
    bad(res, `A constellation can have up to ${NEBULAS_MAX} nebulas.`, 409);
    return;
  }
  let categoryId = parsed.data.categoryId ?? null;
  if (categoryId) {
    const [cat] = await db
      .select({ id: constellationCategories.id })
      .from(constellationCategories)
      .where(and(eq(constellationCategories.id, categoryId), eq(constellationCategories.constellationId, s.constellationId)));
    if (!cat) categoryId = null;
  }
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${nebulas.position}), -1)::int` })
    .from(nebulas)
    .where(eq(nebulas.constellationId, s.constellationId));
  const roleIds = await cleanRoleIds(s.constellationId, parsed.data.roleIds);
  const forum = forumColumns(parsed.data.forum);
  if (typeof forum === "string") {
    bad(res, forum);
    return;
  }
  const extras = {
    ...(parsed.data.kind === "forum" ? forum : {}),
    ...(parsed.data.threadsStaffOnly !== undefined ? { threadsStaffOnly: parsed.data.threadsStaffOnly } : {}),
    ...(parsed.data.threadCloseDays !== undefined ? { threadCloseDays: parsed.data.threadCloseDays } : {}),
  };
  const nebula = await db.transaction((tx) =>
    createNebula(tx, s.constellationId, {
      name,
      kind: parsed.data.kind,
      categoryId,
      topic: parsed.data.topic ?? null,
      position: max + 1,
      readOnly: parsed.data.readOnly,
      visibility: parsed.data.visibility,
      roleIds,
      ...extras,
    }),
  );
  await constellationChanged(s.constellationId);
  res.status(201).json({ nebulaId: nebula.id, constellation: await detailFor(s.constellationId, s.userId) });
});

constellationsRouter.patch("/:id/nebulas/:nid", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageNebulas");
  if (!s) return;
  const n = await nebulaFor(req, res, s);
  if (!n) return;
  const parsed = nebulaBody.partial().safeParse(req.body);
  if (!parsed.success) {
    bad(res, firstIssue(parsed.error));
    return;
  }
  const changes: Partial<typeof nebulas.$inferInsert> = {};
  if (parsed.data.name !== undefined) {
    const name = cleanNebulaName(parsed.data.name, n.kind);
    if (!name) {
      bad(res, "Give the nebula a name (up to 32 characters).");
      return;
    }
    changes.name = name;
  }
  if (parsed.data.topic !== undefined) changes.topic = parsed.data.topic;
  if (parsed.data.kind !== undefined && parsed.data.kind !== n.kind) {
    bad(res, "A nebula's kind can't be changed. Make a new one instead.");
    return;
  }
  if (parsed.data.threadsStaffOnly !== undefined) changes.threadsStaffOnly = parsed.data.threadsStaffOnly;
  if (parsed.data.threadCloseDays !== undefined) changes.threadCloseDays = parsed.data.threadCloseDays;
  if (parsed.data.forum !== undefined) {
    if (n.kind !== "forum") {
      bad(res, "Only forums have tags and guidelines.");
      return;
    }
    const forum = forumColumns(parsed.data.forum);
    if (typeof forum === "string") {
      bad(res, forum);
      return;
    }
    Object.assign(changes, forum);
  }
  if (parsed.data.readOnly !== undefined) changes.readOnly = parsed.data.readOnly;
  // 0.8.0: who can see it. Left out = unchanged, so older apps editing a nebula keep it.
  if (parsed.data.visibility !== undefined) changes.visibility = parsed.data.visibility;
  const roleIds = await cleanRoleIds(s.constellationId, parsed.data.roleIds);
  if (roleIds !== undefined) changes.roleIds = roleIds;
  if (parsed.data.categoryId !== undefined) {
    const cid = parsed.data.categoryId;
    const [cat] = cid
      ? await db
          .select({ id: constellationCategories.id })
          .from(constellationCategories)
          .where(and(eq(constellationCategories.id, cid), eq(constellationCategories.constellationId, s.constellationId)))
      : [];
    changes.categoryId = cat?.id ?? null;
  }
  const gateChanged = changes.visibility !== undefined || changes.roleIds !== undefined || changes.categoryId !== undefined;
  if (Object.keys(changes).length) {
    await db.update(nebulas).set(changes).where(eq(nebulas.id, n.id));
    if (changes.name) await db.update(conversations).set({ name: changes.name }).where(eq(conversations.id, n.conversationId));
  }
  if (gateChanged) {
    if (changes.visibility !== undefined || changes.roleIds !== undefined) {
      await logModeration(s.constellationId, s.userId, "nebula_visibility_changed", null, { name: n.name, visibility: changes.visibility ?? n.visibility });
    }
    await resync(s.constellationId);
  }
  await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// DELETE …/nebulas/:nid — the nebula and all its messages, for good.
constellationsRouter.delete("/:id/nebulas/:nid", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageNebulas");
  if (!s) return;
  const n = await nebulaFor(req, res, s);
  if (!n) return;
  const room = await openVoiceRoom(n.conversationId);
  if (room) await closeCall(room.id, "hang_up");
  const files = await db
    .select({ id: attachments.id, conversationId: attachments.conversationId, kind: attachments.kind })
    .from(attachments)
    .where(eq(attachments.conversationId, n.conversationId));
  await db.delete(conversations).where(eq(conversations.id, n.conversationId)); // takes the nebula row with it
  await removeFiles(files);
  await logModeration(s.constellationId, s.userId, "nebula_deleted", null, { name: n.name, kind: n.kind });
  await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// ───────────── Voice nebulas ─────────────

// POST /constellations/:id/nebulas/:nid/voice — drop in (no ringing). Leave with POST /calls/:callId/leave.
constellationsRouter.post("/:id/nebulas/:nid/voice", joinLimiter, async (req, res) => {
  if (!livekitConfigured) {
    res.status(503).json({ error: "calls_unavailable", message: "Voice isn't set up on this server yet." });
    return;
  }
  const s = await standingFor(req, res);
  if (!s) return;
  const n = await nebulaFor(req, res, s);
  if (!n) return;
  if (n.kind !== "voice") {
    bad(res, "That's a text nebula.");
    return;
  }
  if (s.timedOutUntil) {
    bad(res, "You're timed out for now, so you can't join voice.", 403);
    return;
  }
  const room = await openVoiceRoom(n.conversationId);
  const other = await activeCallOf(s.userId);
  if (other && other.id !== room?.id) {
    res.status(409).json({ error: "busy", message: "Leave your other call first." });
    return;
  }
  if (room && !(await peopleInCall(room.id)).includes(s.userId) && (await peopleInCall(room.id)).length >= VOICE_NEBULA_MAX) {
    bad(res, `${n.name} is full (${VOICE_NEBULA_MAX} people).`, 409);
    return;
  }
  const joined = await joinVoiceRoom(n.conversationId, s.userId);
  if (!joined) {
    res.status(409).json({ error: "call_over", message: "That didn't work. Try again." });
    return;
  }
  res.json(await joinDetails(joined, me(res), { kind: "nebula" }));
});

// POST /constellations/:id/voice/sharing  { callId, sharing } — I started or stopped sharing my
// screen in a voice nebula (the LIVE badge everyone sees).
constellationsRouter.post("/:id/voice/sharing", async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const parsed = z.object({ callId: idParam, sharing: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    bad(res, "That didn't work.");
    return;
  }
  const [row] = await db
    .select({ conversationId: calls.conversationId })
    .from(calls)
    .innerJoin(nebulas, eq(nebulas.conversationId, calls.conversationId))
    .where(and(eq(calls.id, parsed.data.callId), eq(nebulas.constellationId, s.constellationId)));
  if (!row || !(await peopleInCall(parsed.data.callId)).includes(s.userId)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  setSharing(parsed.data.callId, s.userId, parsed.data.sharing);
  await announceVoice(row.conversationId);
  res.status(204).end();
});

// POST …/nebulas/:nid/voice/preview — 0.7.5 LIVE preview: a watch-only pass to peek at a screen
// share before joining. Hidden from the room, can't send anything, ended after VOICE_PREVIEW_MS.
const previews = new Map<string, { room: string; identity: string; timer: ReturnType<typeof setTimeout> }>();
constellationsRouter.post("/:id/nebulas/:nid/voice/preview", joinLimiter, async (req, res) => {
  if (!livekitConfigured) {
    res.status(503).json({ error: "calls_unavailable", message: "Voice isn't set up on this server yet." });
    return;
  }
  const s = await standingFor(req, res);
  if (!s) return;
  const n = await nebulaFor(req, res, s);
  if (!n) return;
  if (n.kind !== "voice") {
    bad(res, "That's a text nebula.");
    return;
  }
  if (s.timedOutUntil) {
    bad(res, "You're timed out for now, so you can't watch voice.", 403);
    return;
  }
  const state = (await voiceStatesOf(s.constellationId)).find((v) => v.nebulaId === n.id);
  if (!state?.callId || !state.sharing.length) {
    res.status(409).json({ error: "not_live", message: "Nobody is sharing their screen there right now." });
    return;
  }
  // One peek at a time per person: a new one ends the last.
  const old = previews.get(s.userId);
  if (old) {
    clearTimeout(old.timer);
    void removeFromRoom(old.room, old.identity);
  }
  const room = state.callId;
  const identity = `preview:${s.userId}:${randomBytes(4).toString("hex")}`;
  const token = await previewToken(room, identity, me(res).displayName);
  const timer = setTimeout(() => {
    if (previews.get(s.userId)?.identity === identity) previews.delete(s.userId);
    void removeFromRoom(room, identity);
  }, VOICE_PREVIEW_MS);
  timer.unref?.();
  previews.set(s.userId, { room, identity, timer });
  const pass: VoicePreviewPass = { url: LIVEKIT_URL, token, sharing: state.sharing, lastsMs: VOICE_PREVIEW_MS };
  res.json(pass);
});

// POST …/nebulas/:nid/voice/mute  { userId, muted } — a moderator mutes someone in voice.
constellationsRouter.post("/:id/nebulas/:nid/voice/mute", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "muteVoice");
  if (!s) return;
  const n = await nebulaFor(req, res, s);
  if (!n) return;
  const t = await targetFor(req, res, s);
  if (!t) return;
  if (!outranks(s, t)) {
    tooHigh(res);
    return;
  }
  const muted = req.body?.muted === true;
  const room = await openVoiceRoom(n.conversationId);
  if (!room || !(await peopleInCall(room.id)).includes(t.userId)) {
    bad(res, "They're not in that voice nebula.");
    return;
  }
  setVoiceMuted(room.id, t.userId, muted);
  await setMicrophoneAllowed(room.id, t.userId, !muted);
  await logModeration(s.constellationId, s.userId, muted ? "voice_muted" : "voice_unmuted", t.userId, { nebula: n.name });
  await announceVoice(n.conversationId);
  res.status(204).end();
});

// POST …/nebulas/:nid/voice/disconnect  { userId } — a moderator takes someone out of voice.
constellationsRouter.post("/:id/nebulas/:nid/voice/disconnect", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "muteVoice");
  if (!s) return;
  const n = await nebulaFor(req, res, s);
  if (!n) return;
  const t = await targetFor(req, res, s);
  if (!t) return;
  if (!outranks(s, t)) {
    tooHigh(res);
    return;
  }
  const room = await openVoiceRoom(n.conversationId);
  if (room) {
    await leaveCall(room.id, t.userId, [t.userId]);
    void removeFromRoom(room.id, t.userId);
  }
  await logModeration(s.constellationId, s.userId, "voice_disconnected", t.userId, { nebula: n.name });
  res.status(204).end();
});

// ───────────── Roles ─────────────

const permissionsField = z.array(z.string()).max(ALL_PERMISSIONS.length).transform((l) => [...new Set(l.filter(isPermission))]);

/** Permissions I may hand out: the Owner any; others only ones they have. */
const grantable = (s: Standing, wanted: ConstellationPermission[]) => s.owner || wanted.every((p) => s.permissions.has(p));

async function roleFor(req: Request, res: Response, s: Standing) {
  const rid = idParam.safeParse(req.params.rid);
  const [r] = rid.success
    ? await db.select().from(constellationRoles).where(and(eq(constellationRoles.id, rid.data), eq(constellationRoles.constellationId, s.constellationId)))
    : [];
  if (!r) {
    res.status(404).json({ error: "not_found", message: "That role isn't there any more." });
    return null;
  }
  // Only roles below mine (the Owner: any). The Member role sits at 0, so it's below everyone's
  // role except a plain member's.
  if (!s.owner && r.position >= s.rank) {
    bad(res, "You can only change roles below yours.", 403);
    return null;
  }
  return r;
}

constellationsRouter.post("/:id/roles", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageRoles");
  if (!s) return;
  const parsed = z
    .object({
      name: plainText(ROLE_NAME_MAX, "The role name"),
      color: z.enum(ROLE_COLOR_CHOICES as [string, ...string[]]),
      permissions: permissionsField,
      selfAssign: z.boolean().optional(),
      mentionable: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    bad(res, firstIssue(parsed.error));
    return;
  }
  // 0.7.5: a role members pick themselves can't carry permissions (it's a label).
  if (parsed.data.selfAssign && parsed.data.permissions.length) {
    bad(res, "Roles members pick themselves can't have permissions.");
    return;
  }
  if (!grantable(s, parsed.data.permissions)) {
    bad(res, "You can't give a role permissions you don't have.", 403);
    return;
  }
  const count = await db.$count(constellationRoles, and(eq(constellationRoles.constellationId, s.constellationId), ne(constellationRoles.kind, "member")));
  if (count >= CUSTOM_ROLES_MAX) {
    bad(res, `A constellation can have up to ${CUSTOM_ROLES_MAX} roles.`, 409);
    return;
  }
  // A new role starts just above Member (everything else moves up one).
  await db.transaction(async (tx) => {
    await tx
      .update(constellationRoles)
      .set({ position: sql`${constellationRoles.position} + 1` })
      .where(and(eq(constellationRoles.constellationId, s.constellationId), ne(constellationRoles.kind, "member")));
    await tx.insert(constellationRoles).values({
      constellationId: s.constellationId,
      kind: "custom",
      name: parsed.data.name,
      color: parsed.data.color,
      position: 1,
      permissions: parsed.data.permissions,
      selfAssign: parsed.data.selfAssign ?? false,
      mentionable: parsed.data.mentionable ?? false,
    });
  });
  await logModeration(s.constellationId, s.userId, "role_created", null, { name: parsed.data.name });
  await constellationChanged(s.constellationId);
  res.status(201).json({ constellation: await detailFor(s.constellationId, s.userId) });
});

constellationsRouter.patch("/:id/roles/:rid", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageRoles");
  if (!s) return;
  const r = await roleFor(req, res, s);
  if (!r) return;
  const parsed = z
    .object({
      name: plainText(ROLE_NAME_MAX, "The role name").optional(),
      color: z.enum(ROLE_COLOR_CHOICES as [string, ...string[]]).optional(),
      permissions: permissionsField.optional(),
      selfAssign: z.boolean().optional(),
      mentionable: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    bad(res, firstIssue(parsed.error));
    return;
  }
  // 0.7.5: only custom roles can be picked by members, and then without permissions.
  const selfAssign = parsed.data.selfAssign ?? r.selfAssign;
  if (parsed.data.selfAssign && r.kind !== "custom") {
    bad(res, "Only roles you made can be picked by members.");
    return;
  }
  if (selfAssign && (parsed.data.permissions ?? r.permissions).length) {
    bad(res, "Roles members pick themselves can't have permissions. Turn their permissions off first.");
    return;
  }
  // 4.2: apps from before this round don't know "Mention @everyone, @here and all roles"; saving
  // a role from one of them keeps it as it was.
  if (parsed.data.permissions && !knowsThreads(req)) {
    const kept = r.permissions.includes("mentionEveryone");
    parsed.data.permissions = [...parsed.data.permissions.filter((p) => p !== "mentionEveryone"), ...(kept ? (["mentionEveryone"] as const) : [])];
  }
  if (parsed.data.permissions) {
    // Only what I have myself can be added or taken away.
    const changed = ALL_PERMISSIONS.filter((p) => r.permissions.includes(p) !== parsed.data.permissions!.includes(p));
    if (!grantable(s, changed)) {
      bad(res, "You can't change permissions you don't have.", 403);
      return;
    }
  }
  await db
    .update(constellationRoles)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      // The Member role is always gray.
      ...(parsed.data.color !== undefined && r.kind !== "member" ? { color: parsed.data.color } : {}),
      ...(parsed.data.permissions !== undefined ? { permissions: parsed.data.permissions } : {}),
      ...(parsed.data.selfAssign !== undefined ? { selfAssign: parsed.data.selfAssign } : {}),
      // The Member role is everyone: "@Member" isn't a mention.
      ...(parsed.data.mentionable !== undefined && r.kind !== "member" ? { mentionable: parsed.data.mentionable } : {}),
    })
    .where(eq(constellationRoles.id, r.id));
  await logModeration(s.constellationId, s.userId, "role_changed", null, { name: parsed.data.name ?? r.name });
  // 0.8.0: "Manage nebulas" shows every role-only nebula; picking-yourself doesn't change who sees.
  if (parsed.data.permissions !== undefined || parsed.data.selfAssign !== undefined) await resync(s.constellationId);
  await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

constellationsRouter.delete("/:id/roles/:rid", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageRoles");
  if (!s) return;
  const r = await roleFor(req, res, s);
  if (!r) return;
  if (r.kind === "member") {
    bad(res, "Everyone has the Member role, so it can't be deleted.");
    return;
  }
  await db.delete(constellationRoles).where(eq(constellationRoles.id, r.id));
  // 0.8.0: nebulas and categories only for this role lose it (only the Owner and admins see one
  // left with no roles, until someone picks new ones).
  await db
    .update(nebulas)
    .set({ roleIds: sql`array_remove(${nebulas.roleIds}, ${r.id}::uuid)` })
    .where(and(eq(nebulas.constellationId, s.constellationId), sql`${r.id}::uuid = any(${nebulas.roleIds})`));
  await db
    .update(constellationCategories)
    .set({ roleIds: sql`array_remove(${constellationCategories.roleIds}, ${r.id}::uuid)` })
    .where(and(eq(constellationCategories.constellationId, s.constellationId), sql`${r.id}::uuid = any(${constellationCategories.roleIds})`));
  await logModeration(s.constellationId, s.userId, "role_deleted", null, { name: r.name });
  await resync(s.constellationId);
  await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// PUT /constellations/:id/roles/order  { ids } — highest first. Only roles below mine can move,
// and they stay below mine (they swap places among themselves).
constellationsRouter.put("/:id/roles/order", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageRoles");
  if (!s) return;
  const parsed = z.object({ ids: z.array(idParam).max(CUSTOM_ROLES_MAX + 1) }).safeParse(req.body);
  if (!parsed.success) {
    bad(res, "That order didn't make sense. Try again.");
    return;
  }
  const movable = await db
    .select({ id: constellationRoles.id, position: constellationRoles.position })
    .from(constellationRoles)
    .where(
      and(
        eq(constellationRoles.constellationId, s.constellationId),
        ne(constellationRoles.kind, "member"),
        s.owner ? undefined : lt(constellationRoles.position, s.rank),
      ),
    );
  const ids = [...new Set(parsed.data.ids)].filter((id) => movable.some((m) => m.id === id));
  if (ids.length !== movable.length) {
    bad(res, "That order didn't make sense. Try again.");
    return;
  }
  const slots = movable.map((m) => m.position).sort((a, b) => b - a);
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) await tx.update(constellationRoles).set({ position: slots[i] }).where(eq(constellationRoles.id, id));
  });
  await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

// PUT /constellations/:id/members/:uid/roles  { roleIds } — someone's roles. Roles at or above
// mine stay as they are.
constellationsRouter.put("/:id/members/:uid/roles", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageRoles");
  if (!s) return;
  const t = await targetFor(req, res, s);
  if (!t) return;
  if (t.userId !== s.userId && !outranks(s, t)) {
    tooHigh(res);
    return;
  }
  if (t.userId === s.userId && !s.owner) {
    bad(res, "Ask someone with a higher role to change your roles.", 403);
    return;
  }
  const parsed = z.object({ roleIds: z.array(idParam).max(CUSTOM_ROLES_MAX) }).safeParse(req.body);
  if (!parsed.success) {
    bad(res, "Pick roles from the list.");
    return;
  }
  const roles = await db.select().from(constellationRoles).where(eq(constellationRoles.constellationId, s.constellationId));
  const mine = (r: (typeof roles)[number]) => s.owner || r.position < s.rank;
  const wanted = new Set(parsed.data.roleIds.filter((id) => roles.some((r) => r.id === id && r.kind !== "member")));
  await db.transaction(async (tx) => {
    for (const r of roles) {
      if (r.kind === "member" || !mine(r)) continue;
      const has = t.roleIds.includes(r.id);
      if (wanted.has(r.id) && !has) {
        await tx.insert(constellationMemberRoles).values({ constellationId: s.constellationId, userId: t.userId, roleId: r.id }).onConflictDoNothing();
      } else if (!wanted.has(r.id) && has) {
        await tx
          .delete(constellationMemberRoles)
          .where(and(eq(constellationMemberRoles.userId, t.userId), eq(constellationMemberRoles.roleId, r.id)));
      }
    }
  });
  await logModeration(s.constellationId, s.userId, "roles_changed", t.userId, {
    roles: roles.filter((r) => wanted.has(r.id)).map((r) => r.name),
  });
  // 0.8.0: their roles decide which role-only nebulas they see.
  await resync(s.constellationId, [t.userId]);
  await constellationChanged(s.constellationId);
  emitToUser(t.userId, "constellations:changed", {}, true);
  // Communities round: outgoing webhooks (a game server updates permissions).
  fireConstellationEvent(s.constellationId, "member.roles", t.userId, await heldRoleIds(s.constellationId, t.userId));
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

/** Communities round: someone's roles now (for outgoing webhooks). */
async function heldRoleIds(constellationId: string, userId: string): Promise<string[]> {
  const rows = await db
    .select({ roleId: constellationMemberRoles.roleId })
    .from(constellationMemberRoles)
    .where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, userId)));
  return rows.map((r) => r.roleId);
}

// ───────────── Moderation ─────────────

const reasonField = optionalText(MODERATION_REASON_MAX, "The reason").catch(null);

constellationsRouter.post("/:id/members/:uid/timeout", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "timeoutKick");
  if (!s) return;
  const t = await targetFor(req, res, s);
  if (!t) return;
  if (!outranks(s, t)) {
    tooHigh(res);
    return;
  }
  const length = TIMEOUT_LENGTHS.find((l) => l.id === req.body?.length);
  if (!length) {
    bad(res, "Pick how long.");
    return;
  }
  const until = new Date(Date.now() + length.ms);
  await db
    .update(constellationMembers)
    .set({ timedOutUntil: until })
    .where(and(eq(constellationMembers.constellationId, s.constellationId), eq(constellationMembers.userId, t.userId)));
  // A timed-out person leaves voice.
  const chats = await db.select({ id: nebulas.conversationId }).from(nebulas).where(and(eq(nebulas.constellationId, s.constellationId), eq(nebulas.kind, "voice")));
  for (const c of chats) {
    const room = await openVoiceRoom(c.id);
    if (room && (await peopleInCall(room.id)).includes(t.userId)) {
      await leaveCall(room.id, t.userId, [t.userId]);
      void removeFromRoom(room.id, t.userId);
    }
  }
  await logModeration(s.constellationId, s.userId, "timed_out", t.userId, { length: length.name, reason: reasonField.parse(req.body?.reason ?? null) });
  await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

constellationsRouter.delete("/:id/members/:uid/timeout", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "timeoutKick");
  if (!s) return;
  const t = await targetFor(req, res, s);
  if (!t) return;
  if (!outranks(s, t)) {
    tooHigh(res);
    return;
  }
  await db
    .update(constellationMembers)
    .set({ timedOutUntil: null })
    .where(and(eq(constellationMembers.constellationId, s.constellationId), eq(constellationMembers.userId, t.userId)));
  await logModeration(s.constellationId, s.userId, "timeout_removed", t.userId);
  await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

constellationsRouter.post("/:id/members/:uid/kick", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "timeoutKick");
  if (!s) return;
  const t = await targetFor(req, res, s);
  if (!t) return;
  if (!outranks(s, t)) {
    tooHigh(res);
    return;
  }
  await removeMember(s.constellationId, t.userId);
  emitToUser(t.userId, "constellation:removed", { constellationId: s.constellationId, reason: "kicked" }, true);
  await logModeration(s.constellationId, s.userId, "kicked", t.userId, { reason: reasonField.parse(req.body?.reason ?? null) });
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

constellationsRouter.post("/:id/members/:uid/ban", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "ban");
  if (!s) return;
  const t = await targetFor(req, res, s);
  if (!t) return;
  if (!outranks(s, t)) {
    tooHigh(res);
    return;
  }
  const reason = reasonField.parse(req.body?.reason ?? null);
  await db
    .insert(constellationBans)
    .values({ constellationId: s.constellationId, userId: t.userId, bannedBy: s.userId, reason })
    .onConflictDoNothing();
  await db.delete(constellationInvites).where(and(eq(constellationInvites.constellationId, s.constellationId), eq(constellationInvites.inviteeId, t.userId)));
  await removeMember(s.constellationId, t.userId);
  emitToUser(t.userId, "constellation:removed", { constellationId: s.constellationId, reason: "banned" }, true);
  await logModeration(s.constellationId, s.userId, "banned", t.userId, { reason });
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

constellationsRouter.get("/:id/bans", async (req, res) => {
  const s = await standingFor(req, res, "ban");
  if (!s) return;
  const rows = await db.select().from(constellationBans).where(eq(constellationBans.constellationId, s.constellationId)).orderBy(desc(constellationBans.createdAt));
  const people = await publicUsers(rows.flatMap((r) => [r.userId, ...(r.bannedBy ? [r.bannedBy] : [])]));
  res.json({
    bans: rows
      .map((r) => ({ user: people.get(r.userId)!, by: r.bannedBy ? (people.get(r.bannedBy) ?? null) : null, reason: r.reason, createdAt: r.createdAt.toISOString() }))
      .filter((b) => b.user),
  });
});

constellationsRouter.delete("/:id/bans/:uid", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "ban");
  if (!s) return;
  const uid = idParam.safeParse(req.params.uid);
  if (uid.success) {
    // 0.7.3: a ban by someone ranked at or above you stays (only they, or higher, can lift it).
    const [ban] = await db
      .select({ bannedBy: constellationBans.bannedBy })
      .from(constellationBans)
      .where(and(eq(constellationBans.constellationId, s.constellationId), eq(constellationBans.userId, uid.data)));
    if (ban?.bannedBy && ban.bannedBy !== s.userId && !s.owner) {
      const bannerRank = ban.bannedBy === s.ownerId ? OWNER_RANK : ((await ranksOf(s.constellationId, [ban.bannedBy])).get(ban.bannedBy) ?? -1);
      if (bannerRank >= s.rank) {
        bad(res, "Someone ranked at or above you banned them, so only they (or someone higher) can unban.", 403);
        return;
      }
    }
    await db.delete(constellationBans).where(and(eq(constellationBans.constellationId, s.constellationId), eq(constellationBans.userId, uid.data)));
    await logModeration(s.constellationId, s.userId, "unbanned", uid.data);
  }
  res.status(204).end();
});

constellationsRouter.get("/:id/requests", async (req, res) => {
  const s = await standingFor(req, res, "approveRequests");
  if (!s) return;
  const rows = await db
    .select()
    .from(constellationJoinRequests)
    .where(eq(constellationJoinRequests.constellationId, s.constellationId))
    .orderBy(asc(constellationJoinRequests.createdAt));
  const people = await publicUsers(rows.map((r) => r.userId));
  res.json({ requests: rows.map((r) => ({ user: people.get(r.userId)!, note: r.note, createdAt: r.createdAt.toISOString() })).filter((r) => r.user) });
});

constellationsRouter.post("/:id/requests/:uid/:decision", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "approveRequests");
  if (!s) return;
  const uid = idParam.safeParse(req.params.uid);
  const decision = req.params.decision;
  if (!uid.success || (decision !== "approve" && decision !== "deny")) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const [request] = await db
    .delete(constellationJoinRequests)
    .where(and(eq(constellationJoinRequests.constellationId, s.constellationId), eq(constellationJoinRequests.userId, uid.data)))
    .returning();
  if (!request) {
    res.status(404).json({ error: "not_found", message: "That request isn't there any more." });
    return;
  }
  if (decision === "approve" && !(await isBanned(s.constellationId, uid.data)) && !(await isRestricted(uid.data))) {
    try {
      const added = await db.transaction(async (tx) => {
        await tx.select({ id: constellations.id }).from(constellations).where(eq(constellations.id, s.constellationId)).for("update");
        return addMember(tx, s.constellationId, uid.data);
      });
      if (added) await afterJoin(s.constellationId, uid.data);
    } catch (err) {
      if (err instanceof ConstellationFull) {
        bad(res, "This constellation is full.", 409);
        return;
      }
      if (!(err instanceof TooManyConstellations)) throw err;
    }
  } else {
    emitToUser(uid.data, "constellations:changed", {}, true);
  }
  await logModeration(s.constellationId, s.userId, decision === "approve" ? "request_approved" : "request_denied", uid.data);
  await constellationChanged(s.constellationId);
  res.json({ constellation: await detailFor(s.constellationId, s.userId) });
});

const MOD_VIEWERS: ConstellationPermission[] = ["deleteMessages", "timeoutKick", "ban", "muteVoice", "manageRoles", "manageConstellation"];

// GET /constellations/:id/moderation?before= — what moderators and admins did, newest first.
constellationsRouter.get("/:id/moderation", async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  if (!MOD_VIEWERS.some((p) => can(s, p))) {
    bad(res, "Your role doesn't allow that here.", 403);
    return;
  }
  const before = z.iso.datetime({ offset: true }).safeParse(req.query.before);
  const rows = await db
    .select()
    .from(constellationAuditLog)
    .where(and(eq(constellationAuditLog.constellationId, s.constellationId), before.success ? lt(constellationAuditLog.createdAt, new Date(before.data)) : undefined))
    .orderBy(desc(constellationAuditLog.createdAt))
    .limit(51);
  const page = rows.slice(0, 50);
  const people = await publicUsers(page.flatMap((r) => [r.actorId, r.targetUserId].filter((x): x is string => !!x)));
  res.json({
    entries: page.map((r) => ({
      id: r.id,
      actor: r.actorId ? (people.get(r.actorId) ?? null) : null,
      action: r.action,
      target: r.targetUserId ? (people.get(r.targetUserId) ?? null) : null,
      details: r.details ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    hasMore: rows.length > 50,
  });
});

// ───────────── Inviting ─────────────

// POST /constellations/:id/invites  { userIds } — invite friends (they see it on their dashboard).
constellationsRouter.post("/:id/invites", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "invite");
  if (!s) return;
  if (await invitesBlocked(res, s.constellationId)) return;
  const parsed = z.object({ userIds: z.array(idParam).min(1).max(50) }).safeParse(req.body);
  if (!parsed.success) {
    bad(res, "Pick friends to invite.");
    return;
  }
  const members = new Set(await memberIdsOf(s.constellationId));
  let invited = 0;
  const invitedIds: string[] = [];
  for (const id of new Set(parsed.data.userIds)) {
    if (members.has(id) || !(await canMessage(s.userId, id)) || (await isRestricted(id)) || (await isBanned(s.constellationId, id))) continue;
    await db
      .insert(constellationInvites)
      .values({ constellationId: s.constellationId, inviterId: s.userId, inviteeId: id })
      .onConflictDoUpdate({
        target: [constellationInvites.constellationId, constellationInvites.inviteeId],
        set: { inviterId: s.userId, createdAt: new Date(), dismissedAt: null },
      });
    emitToUser(id, "constellations:changed", {}, true);
    invitedIds.push(id);
    invited++;
  }
  res.json({ invited });
  // 0.7.1: it pops up for them live (newer apps only), and on their phones as a notification.
  if (invitedIds.length) {
    const [c] = await db.select({ name: constellations.name }).from(constellations).where(eq(constellations.id, s.constellationId));
    const [by] = await db
      .select({ id: users.id, displayName: users.displayName, avatarVersion: users.avatarVersion })
      .from(users)
      .where(eq(users.id, s.userId));
    for (const id of invitedIds) {
      const invite = (await myInvites(id)).find((i) => i.constellation.id === s.constellationId);
      if (invite) emitToUser(id, "constellation:invited", { invite }, true);
      if (c && by) inBackground(notifyConstellationInvite(id, by, { id: s.constellationId, name: c.name }));
    }
  }
});

function newCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

constellationsRouter.get("/:id/links", async (req, res) => {
  const s = await standingFor(req, res, "invite");
  if (!s) return;
  const rows = await db
    .select()
    .from(constellationLinks)
    .where(
      and(
        eq(constellationLinks.constellationId, s.constellationId),
        isNull(constellationLinks.revokedAt),
        or(isNull(constellationLinks.expiresAt), gt(constellationLinks.expiresAt, new Date())),
      ),
    )
    .orderBy(desc(constellationLinks.createdAt));
  const live = rows.filter((r) => r.maxUses === null || r.uses < r.maxUses);
  const people = await publicUsers(live.map((r) => r.createdBy).filter((x): x is string => !!x));
  res.json({
    links: live.map((r) => ({
      id: r.id,
      code: r.code,
      createdBy: r.createdBy ? (people.get(r.createdBy) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
      maxUses: r.maxUses,
      uses: r.uses,
    })),
  });
});

constellationsRouter.post("/:id/links", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "invite");
  if (!s) return;
  if (await invitesBlocked(res, s.constellationId)) return;
  const lifetime = LINK_LIFETIMES.find((l) => l.id === (req.body?.lifetime ?? "7d"));
  const maxUses = z.number().int().min(1).max(1000).nullable().optional().safeParse(req.body?.maxUses);
  if (!lifetime || !maxUses.success) {
    bad(res, "Pick how long the link works.");
    return;
  }
  const [row] = await db
    .insert(constellationLinks)
    .values({
      constellationId: s.constellationId,
      code: newCode(),
      createdBy: s.userId,
      expiresAt: lifetime.ms === null ? null : new Date(Date.now() + lifetime.ms),
      maxUses: maxUses.data ?? null,
    })
    .returning();
  res.status(201).json({
    link: { id: row.id, code: row.code, createdBy: null, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null, maxUses: row.maxUses, uses: 0 },
  });
});

constellationsRouter.delete("/:id/links/:linkId", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "invite");
  if (!s) return;
  const lid = idParam.safeParse(req.params.linkId);
  if (lid.success) {
    await db
      .update(constellationLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(constellationLinks.id, lid.data), eq(constellationLinks.constellationId, s.constellationId)));
  }
  res.status(204).end();
});

// ───────────── Accounts going away ─────────────

/**
 * Someone's account is being removed for good: constellations they own pass to their highest-ranked
 * member (or are deleted when nobody else is in them); they leave the rest.
 */
export async function constellationsOnAccountRemoval(userId: string): Promise<void> {
  const owned = await db.select({ id: constellations.id }).from(constellations).where(eq(constellations.ownerId, userId));
  for (const c of owned) {
    const others = (await memberIdsOf(c.id)).filter((id) => id !== userId);
    if (!others.length) {
      await deleteConstellation(c.id);
      continue;
    }
    const ranks = await db
      .select({ userId: constellationMembers.userId, joinedAt: constellationMembers.joinedAt })
      .from(constellationMembers)
      .where(and(eq(constellationMembers.constellationId, c.id), ne(constellationMembers.userId, userId)));
    const roleRanks = new Map<string, number>();
    for (const r of await db
      .select({ userId: constellationMemberRoles.userId, position: constellationRoles.position })
      .from(constellationMemberRoles)
      .innerJoin(constellationRoles, eq(constellationRoles.id, constellationMemberRoles.roleId))
      .where(eq(constellationMemberRoles.constellationId, c.id))) {
      roleRanks.set(r.userId, Math.max(roleRanks.get(r.userId) ?? 0, r.position));
    }
    ranks.sort((a, b) => (roleRanks.get(b.userId) ?? 0) - (roleRanks.get(a.userId) ?? 0) || a.joinedAt.getTime() - b.joinedAt.getTime());
    await db.update(constellations).set({ ownerId: ranks[0].userId }).where(eq(constellations.id, c.id));
    await logModeration(c.id, null, "ownership_transferred", ranks[0].userId, { reason: "account_removed" });
  }
  const joined = await db.select({ id: constellationMembers.constellationId }).from(constellationMembers).where(eq(constellationMembers.userId, userId));
  for (const c of joined) await removeMember(c.id, userId);
}
