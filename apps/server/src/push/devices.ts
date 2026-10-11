import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { pushDevices } from "../db/schema";
import { requireAuth } from "../auth/sessions";

// Phones register for push notifications here, after signing in:
//   PUT /devices/push    { token, platform: "android" | "ios", preview? }   (again whenever the token or setting changes)
//   DELETE /devices/push                                                    (notifications turned off on this phone)
// The registration belongs to this session, so signing out removes it.

export const devicesRouter = Router();
devicesRouter.use(requireAuth);

const sessionOf = (res: Response) => res.locals.sessionId as string;
const userOf = (res: Response) => (res.locals.user as { id: string }).id;

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (_req, res) => userOf(res),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Slow down a little and try again." },
});

const registration = z.object({
  token: z.string().trim().min(10).max(4096),
  platform: z.enum(["android", "ios"]),
  preview: z.boolean().default(true),
});

devicesRouter.put("/push", limiter, async (req, res) => {
  const parsed = registration.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "That isn't a push registration Glofly understands." });
    return;
  }
  const { token, platform, preview } = parsed.data;
  const sessionId = sessionOf(res);
  const userId = userOf(res);
  await db.transaction(async (tx) => {
    // A phone has one token: if someone else signed in on it before, their pushes stop here.
    await tx.delete(pushDevices).where(and(eq(pushDevices.token, token), ne(pushDevices.sessionId, sessionId)));
    await tx
      .insert(pushDevices)
      .values({ sessionId, userId, platform, token, preview })
      .onConflictDoUpdate({
        target: pushDevices.sessionId,
        set: { token, platform, preview, updatedAt: new Date() },
      });
  });
  res.status(204).end();
});

devicesRouter.delete("/push", async (_req, res) => {
  await db.delete(pushDevices).where(eq(pushDevices.sessionId, sessionOf(res)));
  res.status(204).end();
});

/** Push tokens Firebase says no longer work (the app was uninstalled, say). */
export async function forgetTokens(tokens: string[]): Promise<void> {
  if (tokens.length) await db.delete(pushDevices).where(inArray(pushDevices.token, tokens));
}
