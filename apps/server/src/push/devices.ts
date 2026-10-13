import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { pushDevices } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isPhoneMessageSound, isPhoneRingtone } from "@glofly/shared";

// Phones register for push notifications here, after signing in:
//   PUT /devices/push    { token, platform: "android" | "ios", preview?, voipToken?, messageSound?, ringtone? }   (again whenever the token or a setting changes)
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
  // iPhone lock-screen calls (CallKit): Apple's VoIP push token, "<hex>" or "sandbox:<hex>" for
  // development builds. Left out = unchanged (older apps); null = remove.
  voipToken: z
    .string()
    .trim()
    .regex(/^(sandbox:)?[0-9a-f]{32,200}$/i)
    .nullable()
    .optional(),
  // The sounds picked on this phone (Oct 13; iPhone notifications name them). Left out = unchanged
  // (older apps). A name this server doesn't know is stored as the default (null).
  messageSound: z.string().max(40).optional(),
  ringtone: z.string().max(40).optional(),
});

devicesRouter.put("/push", limiter, async (req, res) => {
  const parsed = registration.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "That isn't a push registration Glofly understands." });
    return;
  }
  const { token, platform, preview, voipToken, messageSound, ringtone } = parsed.data;
  const voip = platform === "ios" && voipToken !== undefined ? { voipToken } : {};
  const sounds = {
    ...(messageSound !== undefined ? { messageSound: isPhoneMessageSound(messageSound) ? messageSound : null } : {}),
    ...(ringtone !== undefined ? { ringtone: isPhoneRingtone(ringtone) ? ringtone : null } : {}),
  };
  const sessionId = sessionOf(res);
  const userId = userOf(res);
  await db.transaction(async (tx) => {
    // A phone has one token: if someone else signed in on it before, their pushes stop here.
    await tx.delete(pushDevices).where(and(eq(pushDevices.token, token), ne(pushDevices.sessionId, sessionId)));
    await tx
      .insert(pushDevices)
      .values({ sessionId, userId, platform, token, preview, ...voip, ...sounds })
      .onConflictDoUpdate({
        target: pushDevices.sessionId,
        set: { token, platform, preview, ...voip, ...sounds, updatedAt: new Date() },
      });
    // A VoIP token belongs to one phone too.
    if (voip.voipToken) {
      await tx
        .update(pushDevices)
        .set({ voipToken: null })
        .where(and(eq(pushDevices.voipToken, voip.voipToken), ne(pushDevices.sessionId, sessionId)));
    }
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
