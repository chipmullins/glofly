import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { MESSAGE_MAX, isWebhookEvent, type WebhookInfo } from "@glofly/shared";
import { db } from "../db";
import { constellationWebhooks, constellations, nebulas } from "../db/schema";
import { postScheduledText } from "../messages/routes";
import { takeSlot, noteRedisError } from "../rateLimit";
import { logIntegration } from "./keys";
import { clientIp } from "./ip";
export { deliver, fireConstellationEvent, signature } from "./events";

// Communities round (Nov 2026): Integrations → Webhooks.
//
// Incoming: POST https://api.glofly.app/hooks/<id>/<token>  { text }  (Discord-style { content }
// works too, so existing tools can point here). Posts into its one nebula as its own bot, through
// the same path as a person's message. 30 a minute per hook. Only the token's SHA-256 is stored.
//
// Outgoing: Glofly POSTs a WebhookPayload (shared integrations.ts) to the owner's https address
// for the events they picked (never message contents), signed:
//   Glofly-Signature: t=<unix seconds>,v1=<HMAC-SHA256(secret, `${t}.${body}`) in hex>
// Sent through the SSRF-safe fetcher (public addresses only, no redirects), tried 3 times
// (now, 10 s, 60 s). After WEBHOOK_FAILURES_MAX failed deliveries in a row it switches itself off.

export const hookTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const newHookToken = () => randomBytes(32).toString("base64url");
export const newSigningSecret = () => "gfs_" + randomBytes(32).toString("base64url");

/** The incoming webhook's address (the token is shown once). */
export const hookUrl = (base: string, id: string, token: string) => `${base.replace(/\/$/, "")}/hooks/${id}/${token}`;

export function webhookInfo(row: typeof constellationWebhooks.$inferSelect, roleId: string | null): WebhookInfo {
  return {
    id: row.id,
    kind: row.kind === "outgoing" ? "outgoing" : "incoming",
    name: row.name,
    nebulaId: row.nebulaId,
    botUserId: row.botUserId,
    roleId,
    url: row.url,
    events: row.events.filter(isWebhookEvent),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    lastStatus: row.lastStatus,
    failures: row.failures,
    disabled: !!row.disabledAt,
  };
}

// ───────────── Incoming ─────────────

export const incomingHooksRouter = Router();

const incomingBody = z
  .object({ text: z.string().optional(), content: z.string().optional() })
  .transform((b) => (b.text ?? b.content ?? "").trim())
  .pipe(z.string().min(1, "Send { text }.").max(MESSAGE_MAX, `Messages can be up to ${MESSAGE_MAX} characters.`));

incomingHooksRouter.post("/hooks/:hookId/:token", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const hookId = z.uuid().safeParse(req.params.hookId);
  const token = String(req.params.token ?? "");
  const nope = () => res.status(404).json({ error: "not_found", message: "That webhook address doesn't work. It may have been reset or deleted." });
  if (!hookId.success || !/^[A-Za-z0-9_-]{43}$/.test(token)) return void nope();
  const [h] = await db
    .select({ hook: constellationWebhooks, conversationId: nebulas.conversationId, nebulaName: nebulas.name, takenDownAt: constellations.takenDownAt })
    .from(constellationWebhooks)
    .innerJoin(nebulas, eq(nebulas.id, constellationWebhooks.nebulaId))
    .innerJoin(constellations, eq(constellations.id, constellationWebhooks.constellationId))
    .where(and(eq(constellationWebhooks.id, hookId.data), eq(constellationWebhooks.kind, "incoming"), eq(constellationWebhooks.tokenHash, hookTokenHash(token))));
  if (!h || h.takenDownAt || !h.hook.botUserId) return void nope();
  try {
    if (!(await takeSlot(60_000, [{ key: `hookin:${h.hook.id}`, limit: 30 }]))) {
      res.set("Retry-After", "60");
      return void res.status(429).json({ error: "too_many_requests", message: "Slow down: up to 30 posts a minute per webhook." });
    }
  } catch (err) {
    noteRedisError(err);
  }
  const text = incomingBody.safeParse(req.body ?? {});
  if (!text.success) return void res.status(400).json({ error: "invalid", message: text.error.issues[0]?.message ?? "Send { text }." });
  const sent = await postScheduledText(h.conversationId, h.hook.botUserId, text.data, null);
  if (!sent.ok) return void res.status(403).json({ error: "cant_post", message: sent.reason });
  await db.update(constellationWebhooks).set({ lastUsedAt: new Date() }).where(eq(constellationWebhooks.id, h.hook.id));
  await logIntegration({ constellationId: h.hook.constellationId, keyName: h.hook.name, action: "hook.post", details: { nebula: h.nebulaName }, ip: clientIp(req) });
  res.status(204).end();
});
