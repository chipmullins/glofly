// 0.9.3 Settings → Connections (approved boards 6, 8): link Steam, Twitch and Kick.
//
//   GET    /connections                     what's linked, and which sites this server has set up
//   POST   /connections/:provider/start     → { url } to open in the browser (sign in there)
//   GET    /connections/:provider/return    the site sends the browser back here (a small page)
//   PATCH  /connections/:provider           { settings } (ConnectionSettings, any of them)
//   DELETE /connections/:provider           unlink (Steam's part of My games goes too)
//   POST   /connections/steam/sync          Sync now
//   PUT    /connections/muted-live/:userId  { muted } "Mute Chip's live alerts"
//   GET    /connections/friends-live        friends live right now (LIVE badges)
//
// Glofly never sees a password (each site's own sign-in page), keeps no sign-in tokens (Twitch's
// and Kick's are used once to learn who you are, then revoked), and only stores the other site's
// id, name and page. Sign-ins are tied to the Glofly account that started them by a one-use
// state (10 minutes) kept in Redis.

import { createHash, randomBytes } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CONNECTION_NAMES,
  CONNECTION_PROVIDERS,
  connectionSettingsOf,
  streamUrl,
  type ConnectionProvider,
  type ConnectionsView,
  type LinkedAccount,
  type StreamLive,
} from "@glofly/shared";
import { db } from "../db";
import { linkedAccounts, users } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { friendIdsOf } from "../presence";
import { redis } from "../redis";
import { emitToUser } from "../realtime";
import { rateLimit } from "../rateLimit";
import { inBackground } from "../push/notify";
import {
  kickConfigured,
  kickSignInUrl,
  kickStream,
  kickWhoIs,
  steamConfigured,
  steamPlayers,
  steamSignInUrl,
  steamVerify,
  twitchConfigured,
  twitchSignInUrl,
  twitchStream,
  twitchWhoIs,
} from "./providers";
import {
  channelWentLive,
  friendStreamsFor,
  publicBase,
  unwatchIfUnused,
  watchChannel,
} from "./live";
import { forgetSteamGames, syncSteamGames } from "./steam";

type Me = { id: string };
const me = (res: Response): Me => res.locals.user as Me;
const STATE_SECONDS = 10 * 60;
const stateKey = (state: string) => `connect:${state}`;

const providerParam = z.enum(["steam", "twitch", "kick"]);
const available = (): Record<ConnectionProvider, boolean> => ({
  steam: steamConfigured(),
  twitch: twitchConfigured(),
  kick: kickConfigured(),
});
const baseOf = (req: Request) =>
  publicBase(`${req.protocol}://${req.get("host")}`);
const returnUrl = (req: Request, p: ConnectionProvider) =>
  `${baseOf(req)}/connections/${p}/return`;

/** Other parts of Glofly (constellation Live alerts) still listening to this channel? */
let neededElsewhere: (
  site: "twitch" | "kick",
  channelId: string,
) => Promise<boolean> = async () => false;
export function setChannelNeeded(fn: typeof neededElsewhere): void {
  neededElsewhere = fn;
}

function view(row: typeof linkedAccounts.$inferSelect): LinkedAccount {
  return {
    provider: row.provider as ConnectionProvider,
    login: row.login,
    displayName: row.displayName,
    profileUrl: row.profileUrl,
    linkedAt: row.createdAt.toISOString(),
    settings: connectionSettingsOf(row.settings),
    live: (row.live as StreamLive | null) ?? null,
    ...(row.provider === "steam"
      ? {
          syncedAt: row.syncedAt?.toISOString() ?? null,
          gameCount: row.gameCount ?? null,
        }
      : {}),
  };
}

export async function connectionsOf(userId: string): Promise<ConnectionsView> {
  const rows = await db
    .select()
    .from(linkedAccounts)
    .where(eq(linkedAccounts.userId, userId));
  return { available: available(), accounts: rows.map(view) };
}

/** Does this streamer need Glofly listening (they tell friends, or show LIVE)? */
const wantsListening = (raw: unknown) => {
  const s = connectionSettingsOf(raw);
  return s.tellFriends !== "off" || s.showLive || s.postInConstellations;
};

// ───────────── Signed in ─────────────

export const connectionsRouter = Router();

const startLimiter = rateLimit("connections:start", {
  windowMs: 10 * 60 * 1000,
  limit: 20,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "too_many_requests",
    message: "That's a lot of linking. Wait a few minutes.",
  },
});
const syncLimiter = rateLimit("connections:sync", {
  windowMs: 60 * 1000,
  limit: 2,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "too_many_requests",
    message: "Synced a moment ago. Try again in a minute.",
  },
});

connectionsRouter.get("/", requireAuth, async (_req, res) => {
  res.json(await connectionsOf(me(res).id));
});

// Friends live on Twitch or Kick right now (the LIVE badges when an app starts or reconnects).
connectionsRouter.get("/friends-live", requireAuth, async (_req, res) => {
  const myId = me(res).id;
  const [row] = await db
    .select({ muted: users.mutedLiveAlerts })
    .from(users)
    .where(eq(users.id, myId));
  res.json({
    streams: await friendStreamsFor(myId),
    mutedLive: row?.muted ?? [],
  });
});

connectionsRouter.post(
  "/:provider/start",
  requireAuth,
  startLimiter,
  async (req, res) => {
    const p = providerParam.safeParse(req.params.provider);
    if (!p.success) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const myId = me(res).id;
    if (await isRestricted(myId)) {
      res.status(403).json(MANAGED_BY_FAMILY);
      return;
    }
    if (!available()[p.data]) {
      res
        .status(503)
        .json({
          error: "unavailable",
          message: `${CONNECTION_NAMES[p.data]} linking isn't set up on this server yet.`,
        });
      return;
    }
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    await redis.set(
      stateKey(state),
      JSON.stringify({ userId: myId, provider: p.data, verifier }),
      { EX: STATE_SECONDS },
    );
    let url: string;
    if (p.data === "steam")
      url = steamSignInUrl(
        `${returnUrl(req, "steam")}?state=${state}`,
        baseOf(req),
      );
    else if (p.data === "twitch")
      url = twitchSignInUrl(returnUrl(req, "twitch"), state);
    else
      url = kickSignInUrl(
        returnUrl(req, "kick"),
        state,
        createHash("sha256").update(verifier).digest("base64url"),
      );
    res.json({ url });
  },
);

const settingsBody = z
  .object({
    myGames: z.boolean(),
    playing: z.boolean(),
    showLink: z.boolean(),
    tellFriends: z.enum(["all", "chosen", "off"]),
    chosen: z.array(z.uuid()).max(200),
    showLive: z.boolean(),
    postInConstellations: z.boolean(),
  })
  .partial()
  .strict();

connectionsRouter.patch("/:provider", requireAuth, async (req, res) => {
  const p = providerParam.safeParse(req.params.provider);
  const body = settingsBody.safeParse(req.body?.settings);
  if (!p.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!body.success) {
    res
      .status(400)
      .json({
        error: "invalid",
        message: "Those settings didn't make sense. Try again.",
      });
    return;
  }
  const myId = me(res).id;
  const [row] = await db
    .select()
    .from(linkedAccounts)
    .where(
      and(eq(linkedAccounts.userId, myId), eq(linkedAccounts.provider, p.data)),
    );
  if (!row) {
    res
      .status(404)
      .json({
        error: "not_found",
        message: `${CONNECTION_NAMES[p.data]} isn't linked.`,
      });
    return;
  }
  const changes = { ...body.data };
  // Only friends can be chosen (anyone else is quietly left out).
  if (changes.chosen) {
    const friends = new Set(await friendIdsOf(myId));
    changes.chosen = [...new Set(changes.chosen)].filter((id) =>
      friends.has(id),
    );
  }
  const settings = connectionSettingsOf({
    ...connectionSettingsOf(row.settings),
    ...changes,
  });
  const [updated] = await db
    .update(linkedAccounts)
    .set({ settings })
    .where(eq(linkedAccounts.id, row.id))
    .returning();
  if (p.data !== "steam") {
    if (wantsListening(settings))
      await watchChannel(p.data, row.externalId, baseOf(req));
    else
      await unwatchIfUnused(
        p.data,
        row.externalId,
        await neededElsewhere(p.data, row.externalId),
      );
  }
  if (p.data === "steam" && changes.myGames !== undefined)
    emitToUser(myId, "games:changed", {});
  emitToUser(myId, "connections:changed", {}, true);
  res.json({ account: view(updated) });
});

connectionsRouter.delete("/:provider", requireAuth, async (req, res) => {
  const p = providerParam.safeParse(req.params.provider);
  if (!p.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const myId = me(res).id;
  const [row] = await db
    .delete(linkedAccounts)
    .where(
      and(eq(linkedAccounts.userId, myId), eq(linkedAccounts.provider, p.data)),
    )
    .returning();
  if (row && p.data === "steam") await forgetSteamGames(myId);
  if (row && p.data !== "steam") {
    await unwatchIfUnused(
      p.data,
      row.externalId,
      await neededElsewhere(p.data, row.externalId),
    );
    for (const id of await friendIdsOf(myId))
      emitToUser(
        id,
        "friend:live",
        { userId: myId, source: p.data, live: null },
        true,
      );
  }
  emitToUser(myId, "connections:changed", {}, true);
  res.status(204).end();
});

connectionsRouter.post(
  "/steam/sync",
  requireAuth,
  syncLimiter,
  async (_req, res) => {
    const r = await syncSteamGames(me(res).id);
    if (!r.ok) {
      res
        .status(503)
        .json({
          error: "unavailable",
          message: "Couldn't reach Steam. Try again in a few minutes.",
        });
      return;
    }
    res.json({ count: r.count, publicGames: r.publicGames });
  },
);

connectionsRouter.put("/muted-live/:userId", requireAuth, async (req, res) => {
  const id = z.uuid().safeParse(req.params.userId);
  if (!id.success || typeof req.body?.muted !== "boolean") {
    res.status(400).json({ error: "invalid" });
    return;
  }
  const myId = me(res).id;
  // Only friends can be muted (and the list can't grow past them); unmuting always works.
  if (req.body.muted && !(await friendIdsOf(myId)).includes(id.data)) {
    res
      .status(400)
      .json({
        error: "invalid",
        message: "You can only mute a friend's live alerts.",
      });
    return;
  }
  await db
    .update(users)
    .set({
      mutedLiveAlerts: req.body.muted
        ? sql`(select array(select distinct unnest(array_append(${users.mutedLiveAlerts}, ${id.data}::uuid))))`
        : sql`array_remove(${users.mutedLiveAlerts}, ${id.data}::uuid)`,
    })
    .where(eq(users.id, myId));
  res.json({ muted: req.body.muted });
});

// ───────────── The browser comes back here ─────────────

/** A plain page (no scripts) the browser shows after signing in on the other site. */
function page(
  res: Response,
  status: number,
  title: string,
  text: string,
  form?: { token: string; button: string; extra?: string },
): void {
  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  res
    .status(status)
    .set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    )
    .set("Cache-Control", "no-store")
    .set("Referrer-Policy", "no-referrer")
    .type("html")
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Glofly</title>` +
        `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1c1210;color:#f5ede6;font:16px/1.5 system-ui,sans-serif}main{max-width:440px;padding:32px;text-align:center}h1{font-size:24px;margin:0 0 8px}p{margin:0 0 10px;color:#d9c2b1}form{display:flex;gap:10px;justify-content:center;margin-top:18px}button{font:inherit;font-weight:700;min-height:44px;padding:0 18px;border-radius:12px;border:1px solid #3a2a22;background:#2a1c17;color:#f5ede6;cursor:pointer}button.go{background:#f47a1f;border-color:#f47a1f;color:#2a1406}</style>` +
        `</head><body><main><h1>${esc(title)}</h1><p>${esc(text)}</p>` +
        (form?.extra ? `<p>${esc(form.extra)}</p>` : "") +
        (form
          ? `<form method="post" action="/connections/confirm"><input type="hidden" name="token" value="${esc(form.token)}"><button type="submit" name="answer" value="no">Cancel</button><button class="go" type="submit" name="answer" value="yes">${esc(form.button)}</button></form>`
          : "") +
        `</main></body></html>`,
    );
}

async function takeState(
  state: unknown,
  provider: ConnectionProvider,
): Promise<{ userId: string; verifier: string } | null> {
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{20,80}$/.test(state))
    return null;
  const raw = await redis.getDel(stateKey(state));
  if (!raw) return null;
  const v = JSON.parse(raw) as {
    userId?: string;
    provider?: string;
    verifier?: string;
  };
  return v.provider === provider &&
    typeof v.userId === "string" &&
    typeof v.verifier === "string"
    ? { userId: v.userId, verifier: v.verifier }
    : null;
}

type Who = {
  id: string;
  login: string;
  displayName: string;
  profileUrl: string | null;
};
const confirmKey = (token: string) => `connect-confirm:${token}`;

/**
 * Signed in on the other site: before anything is linked, the browser shows which Glofly account
 * it's for and asks. (Someone could send a stranger their own Link page; the stranger sees it
 * isn't their account.) Signing in there proves the account is theirs, so it can also move a
 * link away from another Glofly account.
 */
async function askToLink(
  res: Response,
  userId: string,
  provider: ConnectionProvider,
  who: Who,
): Promise<void> {
  const name = CONNECTION_NAMES[provider];
  if (await isRestricted(userId))
    return page(res, 403, `${name} wasn't linked`, MANAGED_BY_FAMILY.message);
  const [account] = await db
    .select({ username: users.username, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId));
  if (!account)
    return page(
      res,
      400,
      "That sign-in ran out",
      `Go back to Glofly and press Link ${name} again.`,
    );
  const [taken] = await db
    .select({ userId: linkedAccounts.userId })
    .from(linkedAccounts)
    .where(
      and(
        eq(linkedAccounts.provider, provider),
        eq(linkedAccounts.externalId, who.id),
        ne(linkedAccounts.userId, userId),
      ),
    );
  const token = randomBytes(24).toString("base64url");
  await redis.set(
    confirmKey(token),
    JSON.stringify({ userId, provider, who }),
    { EX: STATE_SECONDS },
  );
  page(
    res,
    200,
    `Link ${name} to Glofly?`,
    `${name}: ${who.displayName}. Glofly account: ${account.displayName} (@${account.username}). Only link it if that Glofly account is yours.`,
    {
      token,
      button: `Link ${name}`,
      extra: taken
        ? `This ${name} account is linked to another Glofly account now. Linking it here removes it there.`
        : undefined,
    },
  );
}

async function finishLink(
  req: Request,
  res: Response,
  userId: string,
  provider: ConnectionProvider,
  who: Who,
): Promise<void> {
  const name = CONNECTION_NAMES[provider];
  if (await isRestricted(userId))
    return page(res, 403, `${name} wasn't linked`, MANAGED_BY_FAMILY.message);
  let moved: string | null = null;
  let row: typeof linkedAccounts.$inferSelect;
  try {
    row = await db.transaction(async (tx) => {
      const [old] = await tx
        .delete(linkedAccounts)
        .where(
          and(
            eq(linkedAccounts.provider, provider),
            eq(linkedAccounts.externalId, who.id),
            ne(linkedAccounts.userId, userId),
          ),
        )
        .returning({ userId: linkedAccounts.userId });
      moved = old?.userId ?? null;
      const [r] = await tx
        .insert(linkedAccounts)
        .values({
          userId,
          provider,
          externalId: who.id,
          login: who.login,
          displayName: who.displayName,
          profileUrl: who.profileUrl,
        })
        .onConflictDoUpdate({
          target: [linkedAccounts.userId, linkedAccounts.provider],
          set: {
            externalId: who.id,
            login: who.login,
            displayName: who.displayName,
            profileUrl: who.profileUrl,
            live: null,
            syncedAt: null,
            gameCount: null,
          },
        })
        .returning();
      return r;
    });
  } catch (err) {
    // Linked by someone at the very same moment (the unique index): say so instead of a 500.
    if ((err as { code?: string }).code === "23505")
      return page(
        res,
        409,
        `That ${name} account was just linked`,
        "Try again in a moment.",
      );
    throw err;
  }
  if (moved) {
    const from = moved;
    if (provider === "steam") inBackground(forgetSteamGames(from));
    else
      for (const id of await friendIdsOf(from))
        emitToUser(
          id,
          "friend:live",
          { userId: from, source: provider, live: null },
          true,
        );
    emitToUser(from, "connections:changed", {}, true);
  }
  if (provider === "steam")
    inBackground(syncSteamGames(userId).then(() => undefined));
  else if (wantsListening(row.settings)) {
    inBackground(
      watchChannel(provider, who.id, baseOf(req)).then(async () => {
        // Live already when linking: counts as going live now.
        const s =
          provider === "twitch"
            ? await twitchStream(who.id)
            : await kickStream(who.id);
        if (s)
          await channelWentLive(provider, who.id, {
            login: who.login,
            title: s.title,
            startedAt: s.startedAt,
          });
      }),
    );
  }
  emitToUser(userId, "connections:changed", {}, true);
  page(
    res,
    200,
    `${name} is linked`,
    `${who.displayName} is now linked to your Glofly account. Go back to Glofly; you can close this tab.`,
  );
}

export const connectionsReturnRouter = Router();

connectionsReturnRouter.get("/steam/return", async (req, res) => {
  const s = await takeState(req.query.state, "steam");
  if (!s)
    return page(
      res,
      400,
      "That sign-in ran out",
      "Go back to Glofly and press Link Steam again.",
    );
  const params = new URLSearchParams(req.url.split("?")[1] ?? "");
  const steamId = await steamVerify(
    params,
    `${returnUrl(req, "steam")}?state=${req.query.state}`,
  );
  if (!steamId)
    return page(
      res,
      400,
      "Steam didn't confirm it",
      "Go back to Glofly and press Link Steam again.",
    );
  const player = (await steamPlayers([steamId]))?.[0];
  await askToLink(res, s.userId, "steam", {
    id: steamId,
    login: player?.name ?? steamId,
    displayName: player?.name ?? "Steam player",
    profileUrl:
      player?.profileUrl ?? `https://steamcommunity.com/profiles/${steamId}`,
  });
});

connectionsReturnRouter.get("/:provider/return", async (req, res) => {
  const p = z.enum(["twitch", "kick"]).safeParse(req.params.provider);
  if (!p.success)
    return page(res, 404, "Not found", "That page isn't part of Glofly.");
  const name = CONNECTION_NAMES[p.data];
  const s = await takeState(req.query.state, p.data);
  if (!s)
    return page(
      res,
      400,
      "That sign-in ran out",
      `Go back to Glofly and press Link ${name} again.`,
    );
  if (
    typeof req.query.error === "string" ||
    typeof req.query.code !== "string"
  ) {
    return page(
      res,
      400,
      `${name} wasn't linked`,
      "Nothing changed. You can try again from Glofly any time.",
    );
  }
  const who =
    p.data === "twitch"
      ? await twitchWhoIs(req.query.code, returnUrl(req, "twitch"))
      : await kickWhoIs(req.query.code, returnUrl(req, "kick"), s.verifier);
  if (!who)
    return page(
      res,
      502,
      `Couldn't reach ${name}`,
      `Go back to Glofly and press Link ${name} again.`,
    );
  await askToLink(res, s.userId, p.data, {
    ...who,
    profileUrl: streamUrl(p.data, who.login),
  });
});

// The "Link Steam?" page's answer (a one-use token from askToLink).
connectionsReturnRouter.post(
  "/confirm",
  express.urlencoded({ extended: false, limit: "2kb" }),
  async (req, res) => {
    const token =
      typeof req.body?.token === "string" &&
      /^[A-Za-z0-9_-]{20,80}$/.test(req.body.token)
        ? req.body.token
        : null;
    const raw = token ? await redis.getDel(confirmKey(token)) : null;
    if (!raw)
      return page(
        res,
        400,
        "That sign-in ran out",
        "Go back to Glofly and press Link again.",
      );
    const v = JSON.parse(raw) as {
      userId: string;
      provider: ConnectionProvider;
      who: Who;
    };
    const name = CONNECTION_NAMES[v.provider];
    if (req.body?.answer !== "yes")
      return page(
        res,
        200,
        `${name} wasn't linked`,
        "Nothing changed. You can close this tab.",
      );
    await finishLink(req, res, v.userId, v.provider, v.who);
  },
);

export const CONNECTION_LIST = CONNECTION_PROVIDERS;
