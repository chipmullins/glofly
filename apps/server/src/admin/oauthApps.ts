import { Router } from "express";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { oauthApps, oauthGrants, oauthTokens, users } from "../db/schema";
import { appFields, hashSecret, newClientId, newClientSecret, redirectProblem } from "../oauth/routes";
import { logAction, noteSchema } from "./audit";
import { admin, invalid, ip } from "./routes";

// Communities round (Nov 2026): Glofly Control → Sign in with Glofly apps. Since 0.9.0 this is the only
// place apps are made: Sign in with Glofly is only for Glofly's own apps (Gloslate, Tablespin). The team
// can also edit them, give a new client secret, switch one off (nobody can sign in; its tokens stop
// working) or delete it. An app not marked "Made by Glofly" can't sign anyone in.
//
//   GET  /admin/oauth-apps
//   POST /admin/oauth-apps/new          { name, website?, privacyUrl, termsUrl?, redirectUris, scopes, confidential, note } → { app, secret }
//   POST /admin/oauth-apps/:id          { disabled?, reason?, firstParty?, name?, website?, privacyUrl?, termsUrl?, redirectUris?, scopes?, note }
//   POST /admin/oauth-apps/:id/secret   { note } → { secret }
//   POST /admin/oauth-apps/:id/delete   { note }

export const oauthAppsAdminRouter = Router();

oauthAppsAdminRouter.get("/oauth-apps", async (_req, res) => {
  const rows = await db
    .select({ a: oauthApps, owner: users.username })
    .from(oauthApps)
    .leftJoin(users, eq(users.id, oauthApps.ownerId))
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
      owner: r.owner ?? null,
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

const notFound = (res: import("express").Response) => void res.status(404).json({ error: "not_found", message: "That app isn't there any more." });

oauthAppsAdminRouter.post("/oauth-apps/new", async (req, res) => {
  const parsed = appFields.extend({ note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const d = parsed.data;
  if (!d.privacyUrl) return void res.status(400).json({ error: "invalid", message: "Add a link to the app's privacy policy (people see it when they sign in)." });
  const problem = redirectProblem(d.redirectUris);
  if (problem) return void res.status(400).json({ error: "invalid", message: problem });
  const secret = d.confidential ? newClientSecret() : null;
  const [row] = await db
    .insert(oauthApps)
    .values({
      clientId: newClientId(),
      ownerId: null,
      name: d.name,
      website: d.website,
      privacyUrl: d.privacyUrl,
      termsUrl: d.termsUrl,
      redirectUris: [...new Set(d.redirectUris)],
      scopes: d.scopes,
      clientSecretHash: secret ? hashSecret(secret) : null,
      firstParty: true,
    })
    .returning();
  await logAction({ adminId: admin(res).id, action: "Made a Sign in with Glofly app", targetLabel: row.name, details: { appId: row.id, clientId: row.clientId }, note: d.note, ip: ip(res) });
  res.set("Cache-Control", "no-store");
  res.status(201).json({ app: { id: row.id, clientId: row.clientId, name: row.name }, secret });
});

oauthAppsAdminRouter.post("/oauth-apps/:id/secret", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  const parsed = z.object({ note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const [a] = id.success ? await db.select().from(oauthApps).where(eq(oauthApps.id, id.data)) : [];
  if (!a) return notFound(res);
  const secret = newClientSecret();
  await db.update(oauthApps).set({ clientSecretHash: hashSecret(secret) }).where(eq(oauthApps.id, a.id));
  await logAction({ adminId: admin(res).id, action: "Gave a Sign in with Glofly app a new client secret", targetLabel: a.name, details: { appId: a.id }, note: parsed.data.note, ip: ip(res) });
  res.set("Cache-Control", "no-store");
  res.json({ secret });
});

oauthAppsAdminRouter.post("/oauth-apps/:id/delete", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  const parsed = z.object({ note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const [a] = id.success ? await db.select().from(oauthApps).where(eq(oauthApps.id, id.data)) : [];
  if (!a) return notFound(res);
  // Grants, codes and tokens go with it (cascade): everyone is signed out of it.
  await db.delete(oauthApps).where(eq(oauthApps.id, a.id));
  await logAction({ adminId: admin(res).id, action: "Deleted a Sign in with Glofly app", targetLabel: a.name, details: { appId: a.id }, note: parsed.data.note, ip: ip(res) });
  res.json({ ok: true });
});

const edits = appFields.omit({ confidential: true }).partial();

oauthAppsAdminRouter.post("/oauth-apps/:id", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  const parsed = z
    .object({ disabled: z.boolean().optional(), reason: z.string().trim().max(200).optional(), firstParty: z.boolean().optional(), note: noteSchema })
    .safeParse(req.body);
  const sent = (k: string) => typeof req.body === "object" && req.body !== null && Object.hasOwn(req.body, k);
  const changed = edits.safeParse(req.body);
  if (!changed.success) return invalid(res, changed.error);
  // .partial() fills in defaults, so only fields Control actually sent change.
  const e = Object.fromEntries(Object.entries(changed.data).filter(([k]) => sent(k))) as Partial<typeof changed.data>;
  if ("privacyUrl" in e && !e.privacyUrl) return void res.status(400).json({ error: "invalid", message: "An app needs a link to its privacy policy." });
  if (e.redirectUris) {
    const problem = redirectProblem(e.redirectUris);
    if (problem) return void res.status(400).json({ error: "invalid", message: problem });
  }
  if (!parsed.success) return invalid(res, parsed.error);
  if (!id.success) return notFound(res);
  const [a] = await db.select().from(oauthApps).where(eq(oauthApps.id, id.data));
  if (!a) return notFound(res);
  const d = parsed.data;
  await db
    .update(oauthApps)
    .set({
      ...(d.disabled !== undefined ? { disabledAt: d.disabled ? new Date() : null, disabledReason: d.disabled ? (d.reason ?? null) : null } : {}),
      ...(d.firstParty !== undefined ? { firstParty: d.firstParty } : {}),
      ...(e.name ? { name: e.name } : {}),
      ...("website" in e ? { website: e.website ?? null } : {}),
      ...("privacyUrl" in e ? { privacyUrl: e.privacyUrl } : {}),
      ...("termsUrl" in e ? { termsUrl: e.termsUrl ?? null } : {}),
      ...(e.redirectUris ? { redirectUris: [...new Set(e.redirectUris)] } : {}),
      ...(e.scopes ? { scopes: e.scopes } : {}),
    })
    .where(eq(oauthApps.id, a.id));
  // Switched off: every token stops working at once.
  if (d.disabled) await db.delete(oauthTokens).where(eq(oauthTokens.appId, a.id));
  await logAction({
    adminId: admin(res).id,
    action: d.disabled === true ? "Switched off a Sign in with Glofly app" : d.disabled === false ? "Switched a Sign in with Glofly app back on" : "Changed a Sign in with Glofly app",
    targetUserId: a.ownerId ?? undefined,
    targetLabel: a.name,
    details: { appId: a.id, ...(d.firstParty !== undefined ? { firstParty: d.firstParty } : {}), ...(Object.keys(e).length ? { changed: Object.keys(e) } : {}) },
    note: d.note,
    ip: ip(res),
  });
  res.json({ ok: true });
});
