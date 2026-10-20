import { Router, type Response } from "express";
import { rateLimit } from "../rateLimit";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { pushDevices } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isPhoneMessageSound, isPhoneRingtone } from "@glofly/shared";
import { webEnabled } from "../web/session";
import { parseSubscription, vapidKeys } from "./web";

// Phones register for push notifications here, after signing in:
//   PUT /devices/push    { token, platform: "android" | "ios", preview?, voipToken?, messageSound?, ringtone?, features? }   (again whenever the token or a setting changes)
//   DELETE /devices/push                                                    (notifications turned off on this phone)
// Glofly in a browser does the same with platform "web" and its push subscription as the token
// (JSON from PushSubscription.toJSON()), after GET /devices/web-push-key for the server's key.
// The registration belongs to this session, so signing out removes it.

export const devicesRouter = Router();
devicesRouter.use(requireAuth);

const sessionOf = (res: Response) => res.locals.sessionId as string;
const userOf = (res: Response) => (res.locals.user as { id: string }).id;

const limiter = rateLimit("push:devices", {
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (_req, res) => userOf(res),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Slow down a little and try again." },
});

const registration = z.object({
  token: z.string().trim().min(10).max(4096),
  platform: z.enum(["android", "ios", "web"]),
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
  // 0.7.0: what the app can show beyond plain chats ("constellations": nebula notifications).
  // Left out = unchanged (older apps keep none). Unknown names are dropped.
  features: z.array(z.string().max(40)).max(20).optional(),
});

/** The push features this server knows (an app sends the ones it can show). */
const PUSH_FEATURES = new Set(["constellations"]);

devicesRouter.put("/push", limiter, async (req, res) => {
  const parsed = registration.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "That isn't a push registration Glofly understands." });
    return;
  }
  const { token, platform, preview, voipToken, messageSound, ringtone } = parsed.data;
  // Phones only: browsers keep their own notifications (they never get nebula pushes).
  const features =
    parsed.data.features !== undefined && platform !== "web"
      ? { features: [...new Set(parsed.data.features.filter((f) => PUSH_FEATURES.has(f)))] }
      : {};
  // A browser's subscription only from the web app (its cookie session), and only a real one:
  // an address at a browser's push service with its keys (push/web.ts). Phones never send "web".
  const web = platform === "web";
  if (web !== (res.locals.viaCookie === true) || (web && (!webEnabled || !parseSubscription(token)))) {
    res.status(400).json({ error: "invalid", message: "That isn't a push registration Glofly understands." });
    return;
  }
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
      .values({ sessionId, userId, platform, token, preview, ...voip, ...sounds, ...features })
      .onConflictDoUpdate({
        target: pushDevices.sessionId,
        set: { token, platform, preview, ...voip, ...sounds, ...features, updatedAt: new Date() },
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

// GET /devices/web-push-key — the server's public key for web push (null: web push is off).
devicesRouter.get("/web-push-key", async (_req, res) => {
  const keys = webEnabled ? await vapidKeys() : null;
  res.json({ publicKey: keys?.publicKey ?? null });
});

devicesRouter.delete("/push", async (_req, res) => {
  await db.delete(pushDevices).where(eq(pushDevices.sessionId, sessionOf(res)));
  res.status(204).end();
});

/** Push tokens Firebase says no longer work (the app was uninstalled, say). */
export async function forgetTokens(tokens: string[]): Promise<void> {
  if (tokens.length) await db.delete(pushDevices).where(inArray(pushDevices.token, tokens));
}
