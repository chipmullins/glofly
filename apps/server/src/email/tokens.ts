import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "../db";
import { emailTokens, type EmailTokenKind } from "../db/schema";

// One-time links for emails. The token only ever exists in the email; the database keeps
// its SHA-256, so a database leak can't be used to reset anyone's password.

const HOUR = 60 * 60 * 1000;
export const LIFETIME: Record<EmailTokenKind, number> = {
  reset_password: 1 * HOUR,
  verify_email: 7 * 24 * HOUR,
  change_email: 24 * HOUR,
};

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Tokens in links are 43 characters of base64url; anything else is rejected without a lookup. */
export const looksLikeToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

/** Makes a new link. Any older unused link of the same kind for this person stops working. */
export async function issueToken(userId: string, kind: EmailTokenKind, email: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(emailTokens.userId, userId), eq(emailTokens.kind, kind), isNull(emailTokens.usedAt)));
    await tx.insert(emailTokens).values({
      userId,
      kind,
      tokenHash: hash(token),
      email,
      expiresAt: new Date(Date.now() + LIFETIME[kind]),
    });
  });
  return token;
}

export type EmailToken = typeof emailTokens.$inferSelect;

/** A link that still works (unused, not expired), or null. Doesn't use it up. */
export async function findToken(token: string, kinds: EmailTokenKind[]): Promise<EmailToken | null> {
  if (!looksLikeToken(token)) return null;
  const [row] = await db
    .select()
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.tokenHash, hash(token)),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row && kinds.includes(row.kind) ? row : null;
}

/**
 * Uses a link up. Returns false if it was already used (e.g. two clicks at once), so only
 * one request can ever act on a link.
 */
export async function consumeToken(id: string): Promise<boolean> {
  const used = await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(emailTokens.id, id), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, new Date())))
    .returning({ id: emailTokens.id });
  return used.length === 1;
}

/** Stops every unused link of these kinds for a person. */
export async function cancelTokens(userId: string, kinds: EmailTokenKind[]): Promise<void> {
  for (const kind of kinds) {
    await db
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(emailTokens.userId, userId), eq(emailTokens.kind, kind), isNull(emailTokens.usedAt)));
  }
}

/** How many links of this kind were sent to this person recently (used for limits). */
export async function sentRecently(userId: string, kind: EmailTokenKind, withinMs: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.userId, userId),
        eq(emailTokens.kind, kind),
        gt(emailTokens.createdAt, new Date(Date.now() - withinMs)),
      ),
    );
  return row?.n ?? 0;
}

/** The new address waiting to be confirmed, if any. */
export async function pendingEmailFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: emailTokens.email })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.userId, userId),
        eq(emailTokens.kind, "change_email"),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row?.email ?? null;
}

/** Old links are kept a day after expiring (so limits can count them), then removed. */
export async function sweepEmailTokens(): Promise<void> {
  await db.delete(emailTokens).where(lt(emailTokens.expiresAt, new Date(Date.now() - 24 * HOUR)));
}
