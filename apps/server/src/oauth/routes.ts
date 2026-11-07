import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import { and, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  OAUTH_APP_NAME_MAX,
  OAUTH_APPS_PER_DEVELOPER_MAX,
  OAUTH_REDIRECTS_MAX,
  isOAuthScope,
  redirectUriProblem,
  type ConnectedApp,
  type DeveloperApp,
  type OAuthRequestInfo,
  type OAuthScope,
} from "@glofly/shared";
import { db } from "../db";
import {
  constellationMemberRoles,
  constellationMembers,
  constellationRoles,
  constellations,
  oauthApps,
  oauthCodes,
  oauthGrants,
  oauthTokens,
  users,
} from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { rateLimit } from "../rateLimit";
import { sendStream, storage } from "../storage";
import { jwks, signJwt } from "./jwt";

// Communities round (Nov 2026): Sign in with Glofly, an OAuth 2.0 + OpenID Connect provider
// (approved canvas boards 5, 6, 10, 12, 14). The authorization-code flow with PKCE (S256) only:
// no implicit flow, no passwords given to apps. The consent page is part of Glofly in a browser
// (chat.glofly.app/oauth/authorize), which signs in with its own cookie; it asks this server:
//
//   GET  /oauth/request?<authorize params>        (signed in) what the app wants → OAuthRequestInfo
//   POST /oauth/approve { <params>, email, constellationIds }  → { redirect } (with ?code&state)
//   POST /oauth/deny    { <params> }                            → { redirect } (error=access_denied)
//
// Apps then use (no Glofly sign-in; CORS open, nothing is in cookies):
//   GET  /.well-known/openid-configuration · GET /oauth/jwks
//   POST /oauth/token     authorization_code (code + code_verifier) | refresh_token
//   GET  /oauth/userinfo  Authorization: Bearer gfo_…
//   POST /oauth/revoke    token
//   GET  /oauth/picture/:userId/:version   the photo, for people who signed in to an app
//
// Codes: 60 s, one use, SHA-256 stored, bound to the app, return address and PKCE challenge.
// Access tokens 1 h; refresh tokens 60 days and replaced each use (an old one used again revokes
// the whole family). Tokens never work as a Glofly sign-in and sessions never work here.
// People: Settings → Connected apps (/account/connected-apps). Developers: Settings → Developer
// (/developer/apps). Glofly Control can switch any app off and mark Glofly's own apps.

export const oauthRouter = Router();
export const connectedAppsRouter = Router();
export const developerRouter = Router();

const CODE_MS = 60_000;
const ACCESS_MS = 60 * 60_000;
const REFRESH_MS = 60 * 24 * 3600_000;

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const token = (prefix: string) => prefix + randomBytes(32).toString("base64url");
const issuer = (req: Request) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
const webOrigin = () => (process.env.WEB_ORIGIN || "https://chat.glofly.app").replace(/\/+$/, "");
const me = (res: Response) => res.locals.user as { id: string };

// ───────────── Open to apps: CORS, discovery, keys ─────────────

oauthRouter.use(["/oauth/token", "/oauth/userinfo", "/oauth/revoke", "/oauth/jwks", "/.well-known/openid-configuration"], (req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return void res.status(204).end();
  next();
});

oauthRouter.get("/.well-known/openid-configuration", (req, res) => {
  const iss = issuer(req);
  res.json({
    issuer: iss,
    authorization_endpoint: `${webOrigin()}/oauth/authorize`,
    token_endpoint: `${iss}/oauth/token`,
    userinfo_endpoint: `${iss}/oauth/userinfo`,
    revocation_endpoint: `${iss}/oauth/revoke`,
    jwks_uri: `${iss}/oauth/jwks`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email", "roles"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    code_challenge_methods_supported: ["S256"],
    claims_supported: ["sub", "name", "preferred_username", "picture", "email", "email_verified", "constellations"],
  });
});

oauthRouter.get("/oauth/jwks", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.json(await jwks());
});

// ───────────── The consent page's questions (signed in to Glofly in a browser) ─────────────

const authorizeParams = z.object({
  client_id: z.string().max(40),
  redirect_uri: z.string().max(300),
  response_type: z.string().max(20),
  scope: z.string().max(200).default("openid profile"),
  state: z.string().max(500).optional(),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/).optional(),
  code_challenge_method: z.string().max(10).optional(),
  nonce: z.string().max(200).optional(),
});
type AuthorizeParams = z.infer<typeof authorizeParams>;

type Checked = { app: typeof oauthApps.$inferSelect; params: AuthorizeParams; scopes: OAuthScope[] };

/** Checks an authorization request. Problems are shown on the page, never sent to the app. */
async function checkRequest(raw: unknown): Promise<Checked | { problem: string }> {
  const p = authorizeParams.safeParse(raw);
  if (!p.success) return { problem: "This sign-in link is broken. Go back to the app and try again." };
  const [app] = await db.select().from(oauthApps).where(eq(oauthApps.clientId, p.data.client_id));
  if (!app) return { problem: "Glofly doesn't know this app." };
  if (app.disabledAt) return { problem: "The Glofly team switched this app off." };
  // Exact match only: no prefixes, no added paths.
  if (!app.redirectUris.includes(p.data.redirect_uri)) return { problem: "This app sent you here from an address it didn't register. For your safety, nothing was shared." };
  if (p.data.response_type !== "code") return { problem: "This app asked in a way Glofly doesn't allow (response_type must be code)." };
  if (!p.data.code_challenge || p.data.code_challenge_method !== "S256") return { problem: "This app needs to use PKCE (S256) to sign in with Glofly." };
  const asked = [...new Set(p.data.scope.split(/\s+/).filter(Boolean))];
  if (!asked.every(isOAuthScope)) return { problem: "This app asked for something Glofly doesn't have." };
  const allowed = new Set<string>(["openid", "profile", ...app.scopes]);
  if (!asked.every((s) => allowed.has(s))) return { problem: "This app asked for more than it registered." };
  const scopes = [...new Set<OAuthScope>(["profile", ...(asked as OAuthScope[])])];
  return { app, params: p.data, scopes };
}

const requestLimiter = rateLimit("oauth:approve", {
  windowMs: 10 * 60_000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of signing in. Wait a few minutes." },
});

async function myConstellations(userId: string) {
  return db
    .select({ id: constellations.id, name: constellations.name })
    .from(constellationMembers)
    .innerJoin(constellations, eq(constellations.id, constellationMembers.constellationId))
    .where(and(eq(constellationMembers.userId, userId), isNull(constellations.takenDownAt)))
    .orderBy(constellations.name);
}

oauthRouter.get("/oauth/request", requireAuth, async (req, res) => {
  if (await isRestricted(me(res).id)) return void res.status(403).json(MANAGED_BY_FAMILY);
  const c = await checkRequest(req.query);
  if ("problem" in c) return void res.status(400).json({ error: "invalid", message: c.problem });
  const [grant] = await db.select().from(oauthGrants).where(and(eq(oauthGrants.userId, me(res).id), eq(oauthGrants.appId, c.app.id)));
  const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, c.app.ownerId));
  const mine = c.scopes.includes("roles") ? await myConstellations(me(res).id) : [];
  const info: OAuthRequestInfo = {
    app: { name: c.app.name, website: c.app.website, firstParty: c.app.firstParty, madeBy: c.app.firstParty ? null : (c.app.website ?? (owner ? `@${owner.username}` : null)) },
    scopes: c.scopes,
    constellations: mine.map((x) => ({ id: x.id, name: x.name, picked: !!grant?.constellationIds.includes(x.id) })),
    allowedBefore: !!grant && c.scopes.every((s) => grant.scopes.includes(s)),
  };
  res.set("Cache-Control", "no-store");
  res.json(info);
});

const back = (redirectUri: string, params: Record<string, string | undefined>) => {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join("&");
  return `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}${q}`;
};

oauthRouter.post("/oauth/approve", requireAuth, requestLimiter, async (req, res) => {
  const userId = me(res).id;
  if (await isRestricted(userId)) return void res.status(403).json(MANAGED_BY_FAMILY);
  const c = await checkRequest(req.body);
  if ("problem" in c) return void res.status(400).json({ error: "invalid", message: c.problem });
  const choices = z
    .object({ email: z.boolean().default(false), constellationIds: z.array(z.uuid()).max(50).default([]) })
    .safeParse({ email: req.body?.email, constellationIds: req.body?.constellationIds });
  if (!choices.success) return void res.status(400).json({ error: "invalid", message: "Check what you picked." });
  // Email only if the app asked and I agreed; roles only for constellations I'm in and picked.
  let scopes = c.scopes.filter((s) => s !== "email" || choices.data.email);
  let picked: string[] = [];
  if (scopes.includes("roles")) {
    const mine = new Set((await myConstellations(userId)).map((x) => x.id));
    picked = choices.data.constellationIds.filter((id) => mine.has(id));
    if (!picked.length) scopes = scopes.filter((s) => s !== "roles");
  }
  await db
    .insert(oauthGrants)
    .values({ userId, appId: c.app.id, scopes, constellationIds: picked })
    .onConflictDoUpdate({ target: [oauthGrants.userId, oauthGrants.appId], set: { scopes, constellationIds: picked } });
  const code = token("gfc_");
  await db.insert(oauthCodes).values({
    codeHash: sha(code),
    appId: c.app.id,
    userId,
    redirectUri: c.params.redirect_uri,
    scopes,
    codeChallenge: c.params.code_challenge!,
    nonce: c.params.nonce ?? null,
    expiresAt: new Date(Date.now() + CODE_MS),
  });
  res.set("Cache-Control", "no-store");
  res.json({ redirect: back(c.params.redirect_uri, { code, state: c.params.state, iss: issuer(req) }) });
});

oauthRouter.post("/oauth/deny", requireAuth, async (req, res) => {
  const c = await checkRequest(req.body);
  if ("problem" in c) return void res.status(400).json({ error: "invalid", message: c.problem });
  res.json({ redirect: back(c.params.redirect_uri, { error: "access_denied", state: c.params.state }) });
});

// ───────────── Tokens (apps) ─────────────

const tokenLimiter = rateLimit("oauth:token", {
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "slow_down", error_description: "Too many requests. Try again in a minute." },
});

const oauthError = (res: Response, status: number, error: string, description: string) => res.status(status).json({ error, error_description: description });

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The calling app: client_id (+ secret for apps that have one), from Basic auth or the body. */
async function clientFor(req: Request): Promise<typeof oauthApps.$inferSelect | null> {
  let id = typeof req.body?.client_id === "string" ? req.body.client_id : null;
  let secret = typeof req.body?.client_secret === "string" ? req.body.client_secret : null;
  const basic = /^Basic\s+(\S+)$/.exec(req.get("authorization") ?? "");
  if (basic) {
    const [u, p] = Buffer.from(basic[1], "base64").toString().split(":");
    id = decodeURIComponent(u ?? "");
    secret = decodeURIComponent(p ?? "");
  }
  if (!id || id.length > 40) return null;
  const [app] = await db.select().from(oauthApps).where(eq(oauthApps.clientId, id));
  if (!app || app.disabledAt) return null;
  if (app.clientSecretHash) {
    if (!secret || !same(sha(secret), app.clientSecretHash)) return null;
  }
  return app;
}

async function issue(req: Request, app: typeof oauthApps.$inferSelect, userId: string, scopes: string[], family: string, nonce: string | null) {
  const access = token("gfo_");
  const refresh = token("gfr_");
  const now = Date.now();
  await db.insert(oauthTokens).values({
    appId: app.id,
    userId,
    family,
    accessHash: sha(access),
    accessExpiresAt: new Date(now + ACCESS_MS),
    refreshHash: sha(refresh),
    refreshExpiresAt: new Date(now + REFRESH_MS),
    scopes,
  });
  await db.update(oauthGrants).set({ lastUsedAt: new Date() }).where(and(eq(oauthGrants.userId, userId), eq(oauthGrants.appId, app.id)));
  const out: Record<string, unknown> = { access_token: access, token_type: "Bearer", expires_in: ACCESS_MS / 1000, refresh_token: refresh, scope: scopes.join(" ") };
  if (scopes.includes("openid")) {
    const claims = await claimsFor(req, userId, scopes, app.id);
    if (!claims) return null;
    out.id_token = await signJwt({
      iss: issuer(req),
      aud: app.clientId,
      iat: Math.floor(now / 1000),
      exp: Math.floor((now + ACCESS_MS) / 1000),
      auth_time: Math.floor(now / 1000),
      ...(nonce ? { nonce } : {}),
      ...claims,
    });
  }
  return out;
}

oauthRouter.post("/oauth/token", express.urlencoded({ extended: false, limit: "10kb" }), tokenLimiter, async (req, res) => {
  const app = await clientFor(req);
  if (!app) return void oauthError(res, 401, "invalid_client", "Unknown app, wrong client secret, or the app is switched off.");
  const grantType = String(req.body?.grant_type ?? "");
  if (grantType === "authorization_code") {
    const code = String(req.body?.code ?? "");
    const verifier = String(req.body?.code_verifier ?? "");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return void oauthError(res, 400, "invalid_request", "code_verifier is missing or malformed.");
    // One use: the row is taken out as it's read.
    const [row] = await db.delete(oauthCodes).where(eq(oauthCodes.codeHash, sha(code))).returning();
    if (!row || row.appId !== app.id || row.expiresAt.getTime() < Date.now()) return void oauthError(res, 400, "invalid_grant", "That code doesn't work (used, expired, or for another app).");
    if (row.redirectUri !== String(req.body?.redirect_uri ?? "")) return void oauthError(res, 400, "invalid_grant", "redirect_uri doesn't match.");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (!same(challenge, row.codeChallenge)) return void oauthError(res, 400, "invalid_grant", "code_verifier doesn't match.");
    const out = await issue(req, app, row.userId, row.scopes, randomUUID(), row.nonce);
    if (!out) return void oauthError(res, 400, "invalid_grant", "That account isn't available.");
    return void res.json(out);
  }
  if (grantType === "refresh_token") {
    const refresh = String(req.body?.refresh_token ?? "");
    const [row] = await db.select().from(oauthTokens).where(eq(oauthTokens.refreshHash, sha(refresh)));
    if (!row || row.appId !== app.id) return void oauthError(res, 400, "invalid_grant", "That refresh token doesn't work.");
    if (row.replacedAt) {
      // Used twice: someone else may have it. Sign this app out for that person.
      await db.delete(oauthTokens).where(eq(oauthTokens.family, row.family));
      return void oauthError(res, 400, "invalid_grant", "That refresh token was already used, so it was cancelled for safety.");
    }
    if (!row.refreshExpiresAt || row.refreshExpiresAt.getTime() < Date.now()) return void oauthError(res, 400, "invalid_grant", "That refresh token expired.");
    const [grant] = await db.select().from(oauthGrants).where(and(eq(oauthGrants.userId, row.userId), eq(oauthGrants.appId, app.id)));
    if (!grant) return void oauthError(res, 400, "invalid_grant", "The person disconnected this app.");
    const taken = await db.update(oauthTokens).set({ replacedAt: new Date() }).where(and(eq(oauthTokens.id, row.id), isNull(oauthTokens.replacedAt))).returning({ id: oauthTokens.id });
    if (!taken.length) return void oauthError(res, 400, "invalid_grant", "That refresh token was already used.");
    // Never more than the person currently allows.
    const scopes = row.scopes.filter((s) => s === "openid" || grant.scopes.includes(s));
    const out = await issue(req, app, row.userId, scopes, row.family, null);
    if (!out) return void oauthError(res, 400, "invalid_grant", "That account isn't available.");
    return void res.json(out);
  }
  oauthError(res, 400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
});

oauthRouter.post("/oauth/revoke", express.urlencoded({ extended: false, limit: "10kb" }), tokenLimiter, async (req, res) => {
  const app = await clientFor(req);
  if (!app) return void oauthError(res, 401, "invalid_client", "Unknown app or wrong client secret.");
  const t = String(req.body?.token ?? "");
  const [row] = await db
    .select({ family: oauthTokens.family, appId: oauthTokens.appId })
    .from(oauthTokens)
    .where(t.startsWith("gfr_") ? eq(oauthTokens.refreshHash, sha(t)) : eq(oauthTokens.accessHash, sha(t)));
  if (row && row.appId === app.id) await db.delete(oauthTokens).where(eq(oauthTokens.family, row.family));
  res.status(200).json({});
});

/** What an app may know about someone (null if the account can't be used). */
async function claimsFor(req: Request, userId: string, scopes: string[], appId: string): Promise<Record<string, unknown> | null> {
  const [u] = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName, avatarVersion: users.avatarVersion, email: users.email, emailVerifiedAt: users.emailVerifiedAt, suspendedAt: users.suspendedAt, deleteAfter: users.deleteAfter, bot: users.bot })
    .from(users)
    .where(eq(users.id, userId));
  if (!u || u.bot || u.suspendedAt || u.deleteAfter) return null;
  const out: Record<string, unknown> = {
    sub: u.id,
    name: u.displayName,
    preferred_username: u.username,
    ...(u.avatarVersion ? { picture: `${issuer(req)}/oauth/picture/${u.id}/${u.avatarVersion}` } : {}),
  };
  if (scopes.includes("email")) {
    out.email = u.email;
    out.email_verified = !!u.emailVerifiedAt;
  }
  if (scopes.includes("roles")) {
    const [grant] = await db.select({ ids: oauthGrants.constellationIds }).from(oauthGrants).where(and(eq(oauthGrants.userId, userId), eq(oauthGrants.appId, appId)));
    const ids = grant?.ids ?? [];
    const list: { id: string; name: string; roles: { id: string; name: string }[] }[] = [];
    if (ids.length) {
      const still = await db
        .select({ id: constellations.id, name: constellations.name })
        .from(constellationMembers)
        .innerJoin(constellations, eq(constellations.id, constellationMembers.constellationId))
        .where(and(eq(constellationMembers.userId, userId), inArray(constellationMembers.constellationId, ids), isNull(constellations.takenDownAt)));
      for (const c of still) {
        const roles = await db
          .select({ id: constellationRoles.id, name: constellationRoles.name })
          .from(constellationMemberRoles)
          .innerJoin(constellationRoles, eq(constellationRoles.id, constellationMemberRoles.roleId))
          .where(and(eq(constellationMemberRoles.constellationId, c.id), eq(constellationMemberRoles.userId, userId)));
        list.push({ id: c.id, name: c.name, roles });
      }
    }
    out.constellations = list;
  }
  return out;
}

oauthRouter.get("/oauth/userinfo", async (req, res) => {
  const bearer = /^Bearer\s+(gfo_[A-Za-z0-9_-]{43})$/.exec(req.get("authorization") ?? "");
  if (!bearer) return void res.status(401).set("WWW-Authenticate", 'Bearer error="invalid_token"').json({ error: "invalid_token" });
  const [row] = await db
    .select({ t: oauthTokens, disabledAt: oauthApps.disabledAt })
    .from(oauthTokens)
    .innerJoin(oauthApps, eq(oauthApps.id, oauthTokens.appId))
    .where(and(eq(oauthTokens.accessHash, sha(bearer[1])), gt(oauthTokens.accessExpiresAt, new Date())));
  if (!row || row.disabledAt) return void res.status(401).set("WWW-Authenticate", 'Bearer error="invalid_token"').json({ error: "invalid_token" });
  const [grant] = await db.select({ u: oauthGrants.userId }).from(oauthGrants).where(and(eq(oauthGrants.userId, row.t.userId), eq(oauthGrants.appId, row.t.appId)));
  const claims = grant ? await claimsFor(req, row.t.userId, row.t.scopes, row.t.appId) : null;
  if (!claims) return void res.status(401).set("WWW-Authenticate", 'Bearer error="invalid_token"').json({ error: "invalid_token" });
  res.json(claims);
});

// The photo, for an app's <img> (no Glofly sign-in). Only for people who signed in to at least one
// app, and only the current photo (its version is random, so it can't be guessed).
oauthRouter.get("/oauth/picture/:userId/:version", async (req, res) => {
  const userId = z.uuid().safeParse(req.params.userId);
  const version = z.uuid().safeParse(req.params.version);
  if (!userId.success || !version.success) return void res.status(404).end();
  const [u] = await db.select({ v: users.avatarVersion }).from(users).where(eq(users.id, userId.data));
  const [shared] = await db.select({ n: count() }).from(oauthGrants).where(eq(oauthGrants.userId, userId.data));
  if (u?.v !== version.data || !shared?.n) return void res.status(404).end();
  const file = await storage.get(`avatars/${userId.data}/${version.data}.webp`);
  if (!file) return void res.status(404).end();
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  sendStream(file.stream, res);
});

// ───────────── Settings → Connected apps ─────────────

connectedAppsRouter.use(requireAuth);

connectedAppsRouter.get("/", async (_req, res) => {
  const rows = await db
    .select({ g: oauthGrants, name: oauthApps.name, website: oauthApps.website, firstParty: oauthApps.firstParty })
    .from(oauthGrants)
    .innerJoin(oauthApps, eq(oauthApps.id, oauthGrants.appId))
    .where(eq(oauthGrants.userId, me(res).id))
    .orderBy(desc(oauthGrants.createdAt));
  const names = new Map<string, string>();
  const ids = [...new Set(rows.flatMap((r) => r.g.constellationIds))];
  if (ids.length) for (const c of await db.select({ id: constellations.id, name: constellations.name }).from(constellations).where(inArray(constellations.id, ids))) names.set(c.id, c.name);
  const apps: ConnectedApp[] = rows.map((r) => ({
    appId: r.g.appId,
    name: r.name,
    website: r.website,
    firstParty: r.firstParty,
    scopes: r.g.scopes.filter(isOAuthScope),
    constellations: r.g.constellationIds.map((id) => names.get(id)).filter((x): x is string => !!x),
    since: r.g.createdAt.toISOString(),
    lastUsedAt: r.g.lastUsedAt?.toISOString() ?? null,
  }));
  res.json({ apps });
});

connectedAppsRouter.delete("/:appId", async (req, res) => {
  const appId = z.uuid().safeParse(req.params.appId);
  if (!appId.success) return void res.status(404).json({ error: "not_found" });
  await db.delete(oauthGrants).where(and(eq(oauthGrants.userId, me(res).id), eq(oauthGrants.appId, appId.data)));
  await db.delete(oauthTokens).where(and(eq(oauthTokens.userId, me(res).id), eq(oauthTokens.appId, appId.data)));
  res.json({ ok: true });
});

// ───────────── Settings → Developer ─────────────

developerRouter.use(requireAuth);
developerRouter.use(async (_req, res, next) => {
  if (await isRestricted(me(res).id)) return void res.status(403).json(MANAGED_BY_FAMILY);
  next();
});

const devLimiter = rateLimit("developer:change", {
  windowMs: 60 * 60_000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of changes. Try again later." },
});

const appFields = z.object({
  name: z
    .string()
    .transform((s) => s.normalize("NFKC").trim().replace(/\s+/g, " "))
    .pipe(z.string().min(1, "Give the app a name.").max(OAUTH_APP_NAME_MAX, `Names can be up to ${OAUTH_APP_NAME_MAX} characters.`)),
  website: z
    .string()
    .trim()
    .max(200)
    .refine((w) => !w || /^https:\/\/[^\s/@]+\.[^\s/@]+/.test(w), "Websites start with https://")
    .nullable()
    .default(null),
  redirectUris: z.array(z.string().trim()).min(1, "Add at least one return address.").max(OAUTH_REDIRECTS_MAX, `Up to ${OAUTH_REDIRECTS_MAX} return addresses.`),
  scopes: z.array(z.enum(["email", "roles"])).max(2).default([]),
  confidential: z.boolean().default(true),
});

async function devApps(userId: string): Promise<DeveloperApp[]> {
  const rows = await db.select().from(oauthApps).where(eq(oauthApps.ownerId, userId)).orderBy(oauthApps.createdAt);
  const out: DeveloperApp[] = [];
  for (const a of rows) {
    const [n] = await db.select({ n: count() }).from(oauthGrants).where(eq(oauthGrants.appId, a.id));
    out.push({
      id: a.id,
      clientId: a.clientId,
      name: a.name,
      website: a.website,
      redirectUris: a.redirectUris,
      scopes: a.scopes.filter((s): s is "email" | "roles" => s === "email" || s === "roles"),
      confidential: !!a.clientSecretHash,
      firstParty: a.firstParty,
      disabled: !!a.disabledAt,
      disabledReason: a.disabledReason,
      people: Number(n?.n ?? 0),
      createdAt: a.createdAt.toISOString(),
    });
  }
  return out;
}

const uriProblem = (uris: string[]) => uris.map(redirectUriProblem).find((p) => p) ?? null;

developerRouter.get("/apps", async (_req, res) => res.json({ apps: await devApps(me(res).id) }));

developerRouter.post("/apps", devLimiter, async (req, res) => {
  const p = appFields.safeParse(req.body);
  if (!p.success) return void res.status(400).json({ error: "invalid", message: p.error.issues[0]?.message ?? "Check the app's details." });
  const problem = uriProblem(p.data.redirectUris);
  if (problem) return void res.status(400).json({ error: "invalid", message: problem });
  const [n] = await db.select({ n: count() }).from(oauthApps).where(eq(oauthApps.ownerId, me(res).id));
  if (Number(n?.n ?? 0) >= OAUTH_APPS_PER_DEVELOPER_MAX) return void res.status(400).json({ error: "invalid", message: `Up to ${OAUTH_APPS_PER_DEVELOPER_MAX} apps.` });
  const secret = p.data.confidential ? token("gfs_") : null;
  const [row] = await db
    .insert(oauthApps)
    .values({
      clientId: "gfa_" + randomBytes(9).toString("base64url"),
      ownerId: me(res).id,
      name: p.data.name,
      website: p.data.website,
      redirectUris: [...new Set(p.data.redirectUris)],
      scopes: p.data.scopes,
      clientSecretHash: secret ? sha(secret) : null,
    })
    .returning({ id: oauthApps.id });
  res.set("Cache-Control", "no-store");
  res.status(201).json({ app: (await devApps(me(res).id)).find((a) => a.id === row.id), secret });
});

async function myApp(req: Request, res: Response) {
  const id = z.uuid().safeParse(req.params.id);
  const [a] = id.success ? await db.select().from(oauthApps).where(and(eq(oauthApps.id, id.data), eq(oauthApps.ownerId, me(res).id))) : [];
  if (!a) res.status(404).json({ error: "not_found", message: "That app isn't there any more." });
  return a ?? null;
}

developerRouter.patch("/apps/:id", devLimiter, async (req, res) => {
  const a = await myApp(req, res);
  if (!a) return;
  const p = appFields.partial().safeParse(req.body);
  if (!p.success) return void res.status(400).json({ error: "invalid", message: p.error.issues[0]?.message ?? "Check the app's details." });
  if (p.data.redirectUris) {
    const problem = uriProblem(p.data.redirectUris);
    if (problem) return void res.status(400).json({ error: "invalid", message: problem });
  }
  await db
    .update(oauthApps)
    .set({
      ...(p.data.name ? { name: p.data.name } : {}),
      ...(p.data.website !== undefined ? { website: p.data.website } : {}),
      ...(p.data.redirectUris ? { redirectUris: [...new Set(p.data.redirectUris)] } : {}),
      ...(p.data.scopes ? { scopes: p.data.scopes } : {}),
    })
    .where(eq(oauthApps.id, a.id));
  res.json({ app: (await devApps(me(res).id)).find((x) => x.id === a.id) });
});

// A new client secret (the old one stops working); also turns a phone app into a server app.
developerRouter.post("/apps/:id/secret", devLimiter, async (req, res) => {
  const a = await myApp(req, res);
  if (!a) return;
  const secret = token("gfs_");
  await db.update(oauthApps).set({ clientSecretHash: sha(secret) }).where(eq(oauthApps.id, a.id));
  res.set("Cache-Control", "no-store");
  res.json({ secret });
});

developerRouter.delete("/apps/:id", devLimiter, async (req, res) => {
  const a = await myApp(req, res);
  if (!a) return;
  await db.delete(oauthApps).where(eq(oauthApps.id, a.id));
  res.json({ ok: true });
});

// ───────────── Housekeeping ─────────────

/** Expired codes and tokens are cleared out (index.ts, hourly). */
export async function sweepOAuth(): Promise<void> {
  const now = new Date();
  await db.delete(oauthCodes).where(sql`${oauthCodes.expiresAt} < ${now}`);
  await db.delete(oauthTokens).where(sql`coalesce(${oauthTokens.refreshExpiresAt}, ${oauthTokens.accessExpiresAt}) < ${now} or (${oauthTokens.replacedAt} is not null and ${oauthTokens.accessExpiresAt} < ${now})`);
}
