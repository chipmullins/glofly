import { eq } from "drizzle-orm";
import { db } from "../db";
import { nebulas } from "../db/schema";
import { toolLog, welcomeNewMember, who } from "./tools";
import { registerToolHooks } from "../toolHooks";

// Communities round (Nov 2026): where the rest of the server tells Glofly tools what happened.
// Registered from index.ts into the leaf module toolHooks.ts (callers use toolHook(...)), so no
// import cycle can form between the tools and the code they watch.

export async function onJoin(constellationId: string, userId: string): Promise<void> {
  await welcomeNewMember(constellationId, userId);
  await toolLog(constellationId, "joins", `➕ ${await who(userId)} joined.`);
}

export async function onLeave(constellationId: string, userId: string): Promise<void> {
  await toolLog(constellationId, "joins", `➖ ${await who(userId)} left (or was removed).`);
}

const ACTIONS: Record<string, string> = {
  kicked: "kicked",
  banned: "banned",
  unbanned: "unbanned",
  timed_out: "timed out",
  timeout_removed: "ended the time-out of",
  message_deleted: "deleted a message by",
  voice_muted: "muted in voice",
  voice_disconnected: "disconnected from voice",
  request_approved: "let in",
  request_denied: "turned down",
};

/** A moderation entry (activity.ts logModeration): role changes and moderator actions. */
export async function onModeration(constellationId: string, actorId: string | null, action: string, targetUserId: string | null, details: Record<string, unknown> | null): Promise<void> {
  if (action === "roles_changed") {
    const roles = Array.isArray(details?.roles) ? (details!.roles as string[]).join(", ") : "";
    await toolLog(constellationId, "roles", `🏷️ ${await who(actorId)} changed the roles of ${await who(targetUserId)}${roles ? ` (${details?.give === false ? "took" : "now"}: ${roles})` : ""}.`);
    return;
  }
  const verb = ACTIONS[action];
  if (!verb) return;
  const reason = typeof details?.reason === "string" && details.reason ? ` Reason: ${details.reason}` : "";
  await toolLog(constellationId, "moderation", `🛡️ ${await who(actorId)} ${verb} ${await who(targetUserId)}.${reason}`);
}

/** Someone edited or deleted their own message in a nebula. Never the text itself (it stays private). */
export async function onMessageChanged(conversationId: string, userId: string, change: "edited" | "deleted"): Promise<void> {
  const [n] = await db.select({ constellationId: nebulas.constellationId, name: nebulas.name }).from(nebulas).where(eq(nebulas.conversationId, conversationId));
  if (!n) return;
  await toolLog(n.constellationId, "messages", `✏️ ${await who(userId)} ${change} a message in #${n.name}.`);
}

/** index.ts calls this once at start-up. */
export function startToolHooks(): void {
  registerToolHooks({ onJoin, onLeave, onModeration, onMessageChanged });
}
