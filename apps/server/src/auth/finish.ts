import type { Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { createSession } from "./sessions";
import { csrfFor, setSessionCookie } from "../web/session";
import { noteSignIn } from "./signInAlert";
import { inBackground } from "../push/notify";
import type { PendingLogin } from "./twoStep";

/** The answer to a sign-in: the apps get the token; the browser gets it as a cookie it can't read. */
export function signedIn(
  res: Response,
  web: "web" | null,
  session: { token: string; expiresAt: Date },
  persistent: boolean,
  user: Record<string, unknown>,
  status = 200,
) {
  if (web) {
    setSessionCookie(res, session.token, persistent, session.expiresAt);
    res.status(status).json({ expiresAt: session.expiresAt.toISOString(), user, csrf: csrfFor(session.token) });
    return;
  }
  res.status(status).json({ token: session.token, expiresAt: session.expiresAt.toISOString(), user });
}

/** Signs in: a new session for this device, its token (or cookie), and the "new device" email. */
export async function finishSignIn(res: Response, userId: string, login: PendingLogin, status = 200): Promise<void> {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarVersion: users.avatarVersion,
      restricted: users.restricted,
    })
    .from(users)
    .where(eq(users.id, userId));
  const session = await createSession(userId, login.keepSignedIn, login.deviceName, login.appVersion, login.platform);
  signedIn(res, login.web, session, login.keepSignedIn, {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarVersion: user.avatarVersion,
    // 0.4.0: a family-managed account (the apps hide Add friend). Older apps ignore it.
    ...(user.restricted ? { restricted: true } : {}),
  }, status);
  inBackground(noteSignIn(userId, login.deviceName, login.platform));
}

