import { createHmac, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { WEBHOOK_FAILURES_MAX, type WebhookEvent, type WebhookPayload } from "@glofly/shared";
import { db } from "../db";
import { constellationWebhooks, users } from "../db/schema";
import { safePost } from "../messages/links";
import { logIntegration } from "./keys";

// Communities round (Nov 2026): outgoing webhooks (see webhooks.ts for the whole story). Kept apart
// from webhooks.ts (which imports the message routes) so constellations/members.ts and the role
// routes can call fireConstellationEvent without an import cycle.

/** The signature header for a body (exported for tests and the docs' example). */
export function signature(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

const RETRY_MS = [10_000, 60_000];

/** Sends one payload to one hook (with retries in the background). Resolves with the first try's status. */
export async function deliver(hook: { id: string; url: string; signingSecret: string; constellationId: string; name: string }, payload: WebhookPayload): Promise<number> {
  const body = JSON.stringify(payload);
  const attempt = async (n: number): Promise<number> => {
    const status = await safePost(hook.url, body, { "Glofly-Signature": signature(hook.signingSecret, body), "Glofly-Event": payload.type, "Glofly-Delivery": payload.id });
    const ok = status >= 200 && status < 300;
    const [row] = await db
      .update(constellationWebhooks)
      .set(ok ? { lastStatus: status, failures: 0, lastUsedAt: new Date() } : { lastStatus: status, failures: sql`${constellationWebhooks.failures} + 1` })
      .where(eq(constellationWebhooks.id, hook.id))
      .returning({ failures: constellationWebhooks.failures, disabledAt: constellationWebhooks.disabledAt });
    if (!ok && row && !row.disabledAt && row.failures >= WEBHOOK_FAILURES_MAX) {
      await db.update(constellationWebhooks).set({ disabledAt: new Date() }).where(eq(constellationWebhooks.id, hook.id));
      await logIntegration({ constellationId: hook.constellationId, keyName: hook.name, action: "hook.disabled", details: { failures: row.failures } });
    }
    if (!ok && n < RETRY_MS.length && payload.type !== "ping") setTimeout(() => void attempt(n + 1).catch(() => undefined), RETRY_MS[n]).unref();
    return status;
  };
  return attempt(0);
}

/**
 * A constellation event happened: every outgoing webhook that wants it gets it (in the
 * background; never slows the action down or makes it fail).
 */
export function fireConstellationEvent(constellationId: string, type: WebhookEvent, userId: string, roleIds?: string[]): void {
  void (async () => {
    const hooks = await db
      .select()
      .from(constellationWebhooks)
      .where(
        and(
          eq(constellationWebhooks.constellationId, constellationId),
          eq(constellationWebhooks.kind, "outgoing"),
          isNull(constellationWebhooks.disabledAt),
          sql`${type} = any(${constellationWebhooks.events})`,
        ),
      );
    if (!hooks.length) return;
    const [u] = await db.select({ id: users.id, username: users.username, displayName: users.displayName, bot: users.bot }).from(users).where(eq(users.id, userId));
    if (!u || u.bot) return; // bots coming and going isn't news for a server
    const payload: WebhookPayload = {
      id: randomUUID(),
      type,
      constellationId,
      createdAt: new Date().toISOString(),
      data: { user: { id: u.id, username: u.username, displayName: u.displayName }, ...(roleIds ? { roleIds } : {}) },
    };
    for (const h of hooks) {
      if (!h.url || !h.signingSecret) continue;
      await deliver({ id: h.id, url: h.url, signingSecret: h.signingSecret, constellationId, name: h.name }, payload);
    }
  })().catch((err) => console.error("Outgoing webhook failed", err));
}

