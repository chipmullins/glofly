import { Router } from "express";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { oauthApps, oauthGrants, oauthTokens, users } from "../db/schema";
import { logAction, noteSchema } from "./audit";
import { admin, invalid, ip } from "./routes";

// Communities round (Nov 2026): Glofly Control → Sign in with Glofly apps. The Glofly team can switch
// any app off (nobody can sign in with it; its tokens stop working) and mark Glofly's own apps
// ("Made by Glofly" on the consent page, e.g. Gloslate).
//
//   GET  /admin/oauth-apps
//   POST /admin/oauth-apps/:id  { disabled?, reason?, firstParty?, note? }

export const oauthAppsAdminRouter = Router();

oauthAppsAdminRouter.get("/oauth-apps", async (_req, res) => {
  const rows = await db
    .select({ a: oauthApps, owner: users.username })
    .from(oauthApps)
    .innerJoin(users, eq(users.id, oauthApps.ownerId))
    .orderBy(desc(oauthApps.createdAt));
  const apps = [];
  for (const r of rows) {
    const [n] = await db.select({ n: count() }).from(oauthGrants).where(eq(oauthGrants.appId, r.a.id));
    apps.push({
      id: r.a.id,
      clientId: r.a.clientId,
      name: r.a.name,
      website: r.a.website,
      privacyUrl: r.a.privacyUrl,
      termsUrl: r.a.termsUrl,
      devTermsVersion: r.a.devTermsVersion,
      devTermsAcceptedAt: r.a.devTermsAcceptedAt?.toISOString() ?? null,
      owner: r.owner,
      redirectUris: r.a.redirectUris,
      scopes: r.a.scopes,
      confidential: !!r.a.clientSecretHash,
      firstParty: r.a.firstParty,
      disabled: !!r.a.disabledAt,
      disabledReason: r.a.disabledReason,
      people: Number(n?.n ?? 0),
      createdAt: r.a.createdAt.toISOString(),
    });
  }
  res.json({ apps });
});

oauthAppsAdminRouter.post("/oauth-apps/:id", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  const parsed = z
    .object({ disabled: z.boolean().optional(), reason: z.string().trim().max(200).optional(), firstParty: z.boolean().optional(), note: noteSchema })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  if (!id.success) return void res.status(404).json({ error: "not_found", message: "That app isn't there any more." });
  const [a] = await db.select().from(oauthApps).where(eq(oauthApps.id, id.data));
  if (!a) return void res.status(404).json({ error: "not_found", message: "That app isn't there any more." });
  const d = parsed.data;
  await db
    .update(oauthApps)
    .set({
      ...(d.disabled !== undefined ? { disabledAt: d.disabled ? new Date() : null, disabledReason: d.disabled ? (d.reason ?? null) : null } : {}),
      ...(d.firstParty !== undefined ? { firstParty: d.firstParty } : {}),
    })
    .where(eq(oauthApps.id, a.id));
  // Switched off: every token stops working at once.
  if (d.disabled) await db.delete(oauthTokens).where(eq(oauthTokens.appId, a.id));
  await logAction({
    adminId: admin(res).id,
    action: d.disabled === true ? "Switched off a Sign in with Glofly app" : d.disabled === false ? "Switched a Sign in with Glofly app back on" : "Changed a Sign in with Glofly app",
    targetUserId: a.ownerId,
    targetLabel: a.name,
    details: { appId: a.id, ...(d.firstParty !== undefined ? { firstParty: d.firstParty } : {}) },
    note: d.note,
    ip: ip(res),
  });
  res.json({ ok: true });
});
