import { nicknamesFor, withNicknames } from "../profile/nicknames";
import { createHash, randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import { appVersionFrom, platformFrom, refuseIfTooOld } from "../app-version";
import { phoneActed } from "../presence";

const DAY = 24 * 60 * 60 * 1000;
const PERSISTENT_LIFETIME = 30 * DAY; // "Keep me signed in"
const SHORT_LIFETIME = 1 * DAY;

/** Only the hash is stored, so the database never holds a usable token. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export { appVersionFrom, platformFrom };

/** The session's platform column: null for desktop (as older rows are). */
export const platformColumn = (header: unknown) => {
  const p = platformFrom(header);
  return p === "desktop" ? null : p;
};

export async function createSession(
  userId: string,
  persistent: boolean,
  deviceName: string | null,
  appVersion: string | null = null,
  platform: string | null = null,
) {
  // 32 random bytes: far too many possibilities to ever guess.
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (persistent ? PERSISTENT_LIFETIME : SHORT_LIFETIME));

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    persistent,
    deviceName,
    appVersion,
    platform,
    expiresAt,
  });

  // Tidy up this user's expired sessions while we're here.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));

  return { token, expiresAt };
}

/** Looks up a token. Returns the session and its user, or null if it's unknown or expired. */
export async function findSession(token: string) {
  const now = new Date();
  const [row] = await db
    .select({
      session: sessions,
      user: {
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarVersion: users.avatarVersion,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;

  // "Keep me signed in" sessions renew as long as the app keeps being used.
  // Written at most once an hour so every request doesn't cost a database write.
  if (now.getTime() - row.session.lastUsedAt.getTime() > 60 * 60 * 1000) {
    const lifetime = row.session.persistent ? PERSISTENT_LIFETIME : null;
    await db
      .update(sessions)
      .set({
        lastUsedAt: now,
        ...(lifetime ? { expiresAt: new Date(now.getTime() + lifetime) } : {}),
      })
      .where(eq(sessions.id, row.session.id));
  }

  return row;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Reads "Authorization: Bearer <token>" from a request. */
export function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 && token.length <= 200 ? token : null;
}

/** Put this in front of any route that needs a signed-in user. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = bearerToken(req.headers.authorization);
  const found = token ? await findSession(token) : null;
  if (!found) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  // Too old for this server (Control → minimum app version): "Please update Glofly".
  if (await refuseIfTooOld(req, res)) return;
  // Which app version this device runs (Control → App versions in use).
  const version = appVersionFrom(req.headers["x-glofly-version"]);
  const platform = platformColumn(req.headers["x-glofly-platform"]);
  if (version && (version !== found.session.appVersion || platform !== found.session.platform)) {
    await db.update(sessions).set({ appVersion: version, platform }).where(eq(sessions.id, found.session.id));
  }
  res.locals.user = found.user;
  res.locals.sessionToken = token;
  res.locals.sessionId = found.session.id;
  // A phone doing something (sending, replying from a notification) while Glofly isn't open on it.
  if (platform && req.method !== "GET") {
    await phoneActed(found.user.id, found.session.id).catch(() => undefined);
  }
  // Nicknames this person gave others go into everything sent back to them (profile/nicknames.ts).
  try {
    const nicks = await nicknamesFor(found.user.id);
    if (nicks.size) {
      const send = res.json.bind(res);
      res.json = (body?: unknown) => send(withNicknames(body, found.user.id, nicks));
    }
  } catch (err) {
    console.error("Couldn't load nicknames:", err); // names show as people set them; fine
  }
  next();
};
