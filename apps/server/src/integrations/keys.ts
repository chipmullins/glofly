import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import {
  API_KEY_PATTERN,
  API_KEY_PREFIX,
  isIntegrationScope,
  type ApiKeyInfo,
  type IntegrationActivity,
  type IntegrationScope,
} from "@glofly/shared";
import { db } from "../db";
import { constellationApiKeys, integrationActivity, users } from "../db/schema";

// Communities round (Nov 2026): constellation API keys (Integrations). A key is 32 random bytes,
// shown once. Only its SHA-256 is stored, the way sessions are (a random 256-bit secret needs no
// slow hash: there is nothing to guess). Each key acts as its own bot account.

/** A brand-new key: the secret (show once), what's stored, and the part shown in lists. */
export function newKey(): { secret: string; hash: string; prefix: string } {
  const secret = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { secret, hash: hashKey(secret), prefix: secret.slice(0, API_KEY_PREFIX.length + 8) };
}

export const hashKey = (secret: string): string => createHash("sha256").update(secret).digest("hex");

export const looksLikeKey = (s: unknown): s is string => typeof s === "string" && API_KEY_PATTERN.test(s);

/**
 * The bot account a key acts as. It can never sign in (no usable password, and login skips bots),
 * has an address nobody can receive mail at, and a username nobody else holds.
 */
export async function createBotUser(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], displayName: string): Promise<string> {
  const id = randomUUID();
  await tx.insert(users).values({
    id,
    username: `bot.${id.replace(/-/g, "").slice(0, 12)}`,
    displayName,
    email: `${id}@bots.glofly.invalid`,
    // Not an Argon2 hash: verifying any password against it fails.
    passwordHash: "!bot",
    birthday: "2000-01-01",
    termsAcceptedAt: new Date(),
    statusPreference: "invisible",
    bot: true,
  });
  return id;
}

type KeyRow = typeof constellationApiKeys.$inferSelect;

export function keyInfo(
  row: KeyRow,
  bot: { id: string; displayName: string; avatarVersion: string | null },
  roleId: string | null,
  createdBy: { id: string; displayName: string } | null,
): ApiKeyInfo {
  return {
    id: row.id,
    name: row.name,
    prefix: row.keyPrefix,
    bot,
    roleId,
    scopes: row.scopes.filter(isIntegrationScope) as IntegrationScope[],
    postNebulaIds: row.postNebulaIds,
    readNebulaIds: row.readNebulaIds,
    allowedIps: row.allowedIps,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    createdBy,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/** Writes a line to the constellation's Integrations → Activity (never throws). */
export async function logIntegration(entry: {
  constellationId: string;
  keyId?: string | null;
  keyName?: string | null;
  actorId?: string | null;
  action: string;
  targetUserId?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
}): Promise<void> {
  try {
    await db.insert(integrationActivity).values({
      constellationId: entry.constellationId,
      keyId: entry.keyId ?? null,
      keyName: entry.keyName ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetUserId: entry.targetUserId ?? null,
      details: entry.details ?? null,
      ip: entry.ip ?? null,
    });
  } catch (err) {
    console.error("Integration activity couldn't be saved", err);
  }
}

/** Activity is kept 30 days (index.ts sweeps hourly). */
export async function sweepIntegrationActivity(): Promise<void> {
  await db.delete(integrationActivity).where(lt(integrationActivity.createdAt, new Date(Date.now() - 30 * 24 * 3600_000)));
}

const ACTIVITY_PAGE = 50;

/** Integrations → Activity, newest first, in plain sentences. */
export async function activityFor(constellationId: string, before: Date | null): Promise<IntegrationActivity[]> {
  const rows = await db
    .select({
      id: integrationActivity.id,
      at: integrationActivity.createdAt,
      keyId: integrationActivity.keyId,
      keyName: integrationActivity.keyName,
      action: integrationActivity.action,
      details: integrationActivity.details,
      ip: integrationActivity.ip,
      actorName: users.displayName,
      targetId: integrationActivity.targetUserId,
    })
    .from(integrationActivity)
    .leftJoin(users, eq(users.id, integrationActivity.actorId))
    .where(
      before
        ? and(eq(integrationActivity.constellationId, constellationId), lt(integrationActivity.createdAt, before))
        : eq(integrationActivity.constellationId, constellationId),
    )
    .orderBy(desc(integrationActivity.createdAt))
    .limit(ACTIVITY_PAGE);
  const targetIds = [...new Set(rows.map((r) => r.targetId).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  for (const id of targetIds) {
    const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, id));
    if (u) names.set(id, u.username);
  }
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    keyId: r.keyId,
    keyName: r.keyName,
    action: r.action,
    text: activityText(r.action, r.keyName ?? "A key", r.actorName ?? "Someone", r.targetId ? names.get(r.targetId) ?? null : null, r.details ?? {}),
    from: r.ip ? `from ${r.ip}` : null,
  }));
}

const gameName = (g: unknown) => (g === "minecraft" ? "Minecraft" : g === "redm" ? "RedM" : "FiveM");

function activityText(action: string, key: string, actor: string, target: string | null, d: Record<string, unknown>): string {
  const who = target ? `@${target}` : "someone";
  switch (action) {
    case "key.created":
      return `${actor} made the key ${key}`;
    case "key.reset":
      return `${actor} reset the key for ${key} (the old key stopped working)`;
    case "key.changed":
      return `${actor} changed ${key}`;
    case "key.deleted":
      return `${actor} deleted the key ${key}`;
    case "member.lookup":
      return d.member ? `${key} looked up ${who}` : `${key} looked up someone who isn't a member`;
    case "roles.read":
      return `${key} read the roles list`;
    case "message.post":
      return `${key} posted in #${String(d.nebula ?? "a nebula")}`;
    case "hook.created":
      return `${actor} made the webhook ${key}`;
    case "hook.reset":
      return `${actor} gave the webhook ${key} a new ${d.kind === "outgoing" ? "signing secret" : "address"}`;
    case "hook.changed":
      return `${actor} changed the webhook ${key}`;
    case "hook.deleted":
      return `${actor} deleted the webhook ${key}`;
    case "hook.post":
      return `${key} posted in #${String(d.nebula ?? "a nebula")}`;
    case "hook.test":
      return `${actor} sent a test to ${key} (${Number(d.status) ? `answered ${d.status}` : "no answer"})`;
    case "hook.disabled":
      return `${key} was switched off after ${String(d.failures)} failed deliveries in a row`;
    case "interactions.set":
      return `${key} set where its commands and buttons go`;
    case "commands.set":
      return `${key} updated its slash commands (${String(d.count ?? 0)})`;
    case "interaction.command":
    case "interaction.button":
      return `${who} used ${action === "interaction.command" ? "a command" : "a button"} of ${key}${Number(d.status) >= 200 && Number(d.status) < 300 ? "" : " (the bot didn't answer)"}`;
    case "role.given":
      return `${key} gave ${who} the role ${String(d.role)}`;
    case "role.taken":
      return `${key} took the role ${String(d.role)} from ${who}`;
    case "link.lookup":
      return d.allowed ? `${key} checked ${who} joining ${gameName(d.game)}` : `${key} turned away a linked player who can't join right now`;
    case "link.code":
      return `${key} gave a new player a link code`;
    case "link.made":
      return `${actor} linked their ${gameName(d.game)} player ${String(d.player ?? "")}`.trim();
    case "link.removed":
      return `${actor} unlinked their ${gameName(d.game)} player ${String(d.player ?? "")}`.trim();
    case "refused.address":
      return `${key} was refused: it came from an address that isn't allowed`;
    case "refused.scope":
      return `${key} was refused: it doesn't have permission for that`;
    default:
      return `${key}: ${action}`;
  }
}
