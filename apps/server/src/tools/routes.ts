import { Router, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { constellationCategories, constellationGiveaways, constellationRoles, constellationTools, nebulas } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { rateLimit } from "../rateLimit";
import { can, frozen, FROZEN_MESSAGE, standingOf, type Standing } from "../constellations/perms";
import { logIntegration } from "../integrations/keys";
import { postAsTool, startGiveaway, TOOL_NAMES, toolBot, type ToolName } from "./tools";

// Communities round (Nov 2026): Integrations → Glofly tools (approved canvas board 15). Owner or
// "Edit constellation settings" only; everything is checked against this constellation.
//
//   GET  /constellations/:id/tools                       switches, settings, recent giveaways
//   PUT  /constellations/:id/tools/:tool                 { enabled?, settings? }
//   POST /constellations/:id/tools/:tool/post            tickets / buttonRoles: post the message with its buttons
//   POST /constellations/:id/giveaways                   { nebulaId, prize, winners, hours, roleId }

export const toolsRouter = Router();
toolsRouter.use(["/:id/tools", "/:id/giveaways"], requireAuth);

const me = (res: Response) => res.locals.user as { id: string };
const bad = (res: Response, message: string, status = 400) =>
  res.status(status).json({ error: status === 403 ? "forbidden" : status === 404 ? "not_found" : "invalid", message });
const idParam = z.uuid();

const limiter = rateLimit("tools:change", {
  windowMs: 10 * 60_000,
  limit: 60,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of changes. Wait a few minutes." },
});

async function manager(req: Request, res: Response): Promise<Standing | null> {
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return null;
  }
  const id = idParam.safeParse(req.params.id);
  const s = id.success ? await standingOf(id.data, me(res).id) : null;
  if (!s) {
    bad(res, "That constellation isn't available.", 404);
    return null;
  }
  if (!can(s, "manageConstellation")) {
    bad(res, "Only people who can edit this constellation's settings can set up Glofly tools.", 403);
    return null;
  }
  return s;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const SETTINGS: Record<ToolName, z.ZodTypeAny> = {
  tickets: z.object({
    nebulaId: idParam,
    staffRoleId: idParam.nullable().default(null),
    categoryId: idParam.nullable().default(null),
    label: text(40).default("Open a ticket"),
    text: text(300).default("Need help from staff? Open a private ticket."),
  }),
  welcome: z.object({ nebulaId: idParam, message: text(1000) }),
  buttonRoles: z.object({ nebulaId: idParam, text: text(300), roleIds: z.array(idParam).min(1).max(10) }),
  logging: z.object({ nebulaId: idParam, joins: z.boolean().default(true), messages: z.boolean().default(true), roles: z.boolean().default(true), moderation: z.boolean().default(true) }),
  giveaways: z.object({}).strip(),
};

/** Checks the settings point at this constellation's nebulas, roles and categories. */
async function problemWith(constellationId: string, tool: ToolName, st: Record<string, unknown>): Promise<string | null> {
  const nebulaId = st.nebulaId as string | undefined;
  if (nebulaId) {
    const [n] = await db.select({ kind: nebulas.kind }).from(nebulas).where(and(eq(nebulas.id, nebulaId), eq(nebulas.constellationId, constellationId)));
    if (n?.kind !== "text") return "Pick a text nebula from this constellation.";
  }
  if (tool === "tickets") {
    if (st.staffRoleId) {
      const [r] = await db.select({ kind: constellationRoles.kind }).from(constellationRoles).where(and(eq(constellationRoles.id, st.staffRoleId as string), eq(constellationRoles.constellationId, constellationId)));
      if (!r || r.kind === "member") return "Pick a staff role from this constellation.";
    }
    if (st.categoryId) {
      const [cat] = await db.select({ id: constellationCategories.id }).from(constellationCategories).where(and(eq(constellationCategories.id, st.categoryId as string), eq(constellationCategories.constellationId, constellationId)));
      if (!cat) return "Pick a category from this constellation.";
    }
  }
  if (tool === "buttonRoles") {
    const ids = st.roleIds as string[];
    const rows = await db
      .select({ id: constellationRoles.id, selfAssign: constellationRoles.selfAssign, kind: constellationRoles.kind })
      .from(constellationRoles)
      .where(and(eq(constellationRoles.constellationId, constellationId), inArray(constellationRoles.id, ids)));
    // Only roles members may pick themselves: labels, never permissions or rank.
    if (rows.length !== new Set(ids).size || rows.some((r) => !r.selfAssign || r.kind !== "custom")) return "Button roles can only be roles members can pick themselves (Roles → \"Members can pick this\").";
  }
  return null;
}

toolsRouter.get("/:id/tools", async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const rows = await db.select().from(constellationTools).where(eq(constellationTools.constellationId, s.constellationId));
  const tools = Object.fromEntries(
    TOOL_NAMES.map((t) => {
      const r = rows.find((x) => x.tool === t);
      return [t, { enabled: !!r?.enabled, settings: r?.settings ?? {}, posted: !!r?.messageId }];
    }),
  );
  const giveaways = await db
    .select({ id: constellationGiveaways.id, prize: constellationGiveaways.prize, winners: constellationGiveaways.winners, endsAt: constellationGiveaways.endsAt, endedAt: constellationGiveaways.endedAt, winnerIds: constellationGiveaways.winnerIds })
    .from(constellationGiveaways)
    .where(eq(constellationGiveaways.constellationId, s.constellationId))
    .orderBy(desc(constellationGiveaways.createdAt))
    .limit(10);
  res.json({ tools, giveaways: giveaways.map((g) => ({ ...g, endsAt: g.endsAt.toISOString(), endedAt: g.endedAt?.toISOString() ?? null })) });
});

toolsRouter.put("/:id/tools/:tool", limiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const tool = req.params.tool as ToolName;
  if (!TOOL_NAMES.includes(tool)) return void bad(res, "There's no such tool.", 404);
  if (await frozen(s.constellationId)) return void bad(res, FROZEN_MESSAGE, 403);
  const body = z.object({ enabled: z.boolean().optional(), settings: z.record(z.string(), z.unknown()).optional() }).safeParse(req.body);
  if (!body.success) return void bad(res, "Check the tool's settings.");
  const [current] = await db.select().from(constellationTools).where(and(eq(constellationTools.constellationId, s.constellationId), eq(constellationTools.tool, tool)));
  let settings = (current?.settings ?? {}) as Record<string, unknown>;
  if (body.data.settings) {
    const parsed = SETTINGS[tool].safeParse(body.data.settings);
    if (!parsed.success) return void bad(res, parsed.error.issues[0]?.message ?? "Check the tool's settings.");
    settings = parsed.data as Record<string, unknown>;
    const problem = await problemWith(s.constellationId, tool, settings);
    if (problem) return void bad(res, problem);
  }
  const enabled = body.data.enabled ?? current?.enabled ?? false;
  if (enabled && tool !== "giveaways" && !SETTINGS[tool].safeParse(settings).success) return void bad(res, "Set it up first, then switch it on.");
  if (enabled) await toolBot(s.constellationId);
  await db
    .insert(constellationTools)
    .values({ constellationId: s.constellationId, tool, enabled, settings })
    .onConflictDoUpdate({ target: [constellationTools.constellationId, constellationTools.tool], set: { enabled, settings, updatedAt: new Date() } });
  await logIntegration({ constellationId: s.constellationId, keyName: "Glofly tools", actorId: s.userId, action: "tool.changed", details: { tool, enabled } });
  res.json({ ok: true });
});

toolsRouter.post("/:id/tools/:tool/post", limiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const tool = req.params.tool;
  if (tool !== "tickets" && tool !== "buttonRoles") return void bad(res, "Only tickets and button roles post a message.", 404);
  const [row] = await db.select().from(constellationTools).where(and(eq(constellationTools.constellationId, s.constellationId), eq(constellationTools.tool, tool)));
  const st = (row?.settings ?? {}) as Record<string, unknown>;
  if (!row?.enabled || !SETTINGS[tool].safeParse(st).success) return void bad(res, "Set it up and switch it on first.");
  let posted: { messageId: string } | { reason: string };
  if (tool === "tickets") {
    posted = await postAsTool(s.constellationId, st.nebulaId as string, st.text as string, [{ id: "tool-ticket-open", label: st.label as string, style: "primary" }]);
  } else {
    const roles = await db
      .select({ id: constellationRoles.id, name: constellationRoles.name })
      .from(constellationRoles)
      .where(and(eq(constellationRoles.constellationId, s.constellationId), inArray(constellationRoles.id, st.roleIds as string[])));
    const ordered = (st.roleIds as string[]).map((id) => roles.find((r) => r.id === id)).filter((r): r is { id: string; name: string } => !!r);
    posted = await postAsTool(s.constellationId, st.nebulaId as string, st.text as string, ordered.slice(0, 10).map((r) => ({ id: `tool-role-${r.id}`, label: r.name.slice(0, 40), style: "secondary" as const })));
  }
  if ("reason" in posted) return void bad(res, posted.reason, 403);
  await db.update(constellationTools).set({ messageId: posted.messageId }).where(and(eq(constellationTools.constellationId, s.constellationId), eq(constellationTools.tool, tool)));
  res.status(201).json({ ok: true, messageId: posted.messageId });
});

toolsRouter.post("/:id/giveaways", limiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  if (await frozen(s.constellationId)) return void bad(res, FROZEN_MESSAGE, 403);
  const g = await db.select().from(constellationTools).where(and(eq(constellationTools.constellationId, s.constellationId), eq(constellationTools.tool, "giveaways")));
  if (!g[0]?.enabled) return void bad(res, "Switch Giveaways on first.");
  const body = z
    .object({ nebulaId: idParam, prize: text(100), winners: z.number().int().min(1).max(20), hours: z.number().int().min(1).max(24 * 30), roleId: idParam.nullable().default(null) })
    .safeParse(req.body);
  if (!body.success) return void bad(res, body.error.issues[0]?.message ?? "Check the giveaway.");
  const problem = await problemWith(s.constellationId, "giveaways", { nebulaId: body.data.nebulaId });
  if (problem) return void bad(res, problem);
  const r = await startGiveaway(s.constellationId, s.userId, body.data);
  if ("reason" in r) return void bad(res, r.reason, 403);
  res.status(201).json(r);
});
