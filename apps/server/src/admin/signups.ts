import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { accountInvites, inviteCodes, inviteCodeUses, serverSettings, signupMode } from "../db/schema";

// Who can create an account (Control → Sign-ups): open, invite only (needs a code), or closed.
// Accounts created for someone in Control always work, whichever is chosen.

export type SignupMode = (typeof signupMode.enumValues)[number];
const MODES = new Set<string>(signupMode.enumValues);

// Asked on every register screen open and every sign-up, so it's kept for a few seconds.
let cached: { mode: SignupMode; at: number } | null = null;

export async function getSignupMode(): Promise<SignupMode> {
  if (cached && Date.now() - cached.at < 5000) return cached.mode;
  const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, "signups"));
  const value = (row?.value as { mode?: string } | undefined)?.mode;
  const mode = value && MODES.has(value) ? (value as SignupMode) : "open";
  cached = { mode, at: Date.now() };
  return mode;
}

export async function setSignupMode(mode: SignupMode): Promise<void> {
  await db
    .insert(serverSettings)
    .values({ key: "signups", value: { mode } })
    .onConflictDoUpdate({ target: serverSettings.key, set: { value: { mode }, updatedAt: new Date() } });
  cached = { mode, at: Date.now() };
}

// ───────────── Invite codes ─────────────

// No look-alikes (0/O, 1/I/L), so a code read out over the phone can't be mistyped.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newInviteCode(): string {
  const bytes = randomBytes(4);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `GLOW-${code}`;
}

/** What people type: any case, with or without the dash or spaces. */
export function normalizeInviteCode(typed: string): string {
  const clean = typed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.startsWith("GLOW") && clean.length === 8 ? `GLOW-${clean.slice(4)}` : clean;
}

export const looksLikeInviteCode = (code: string): boolean => /^GLOW-[A-Z0-9]{4}$/.test(code);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Takes one use of a code inside the sign-up's transaction. Returns the code's id, or null if
 * it doesn't exist, is used up, expired or turned off. Two people using the last slot at the
 * same instant: only one gets it.
 */
export async function claimInviteCode(tx: Tx, code: string): Promise<string | null> {
  const [row] = await tx
    .update(inviteCodes)
    .set({ uses: sql`${inviteCodes.uses} + 1` })
    .where(
      and(
        eq(inviteCodes.code, code),
        isNull(inviteCodes.disabledAt),
        lt(inviteCodes.uses, inviteCodes.maxUses),
        or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, new Date())),
      ),
    )
    .returning({ id: inviteCodes.id });
  return row?.id ?? null;
}

export async function recordInviteUse(tx: Tx, codeId: string, userId: string): Promise<void> {
  await tx.insert(inviteCodeUses).values({ codeId, userId });
}

// ───────────── Usernames and emails held by pending invites ─────────────

const pending = () =>
  and(isNull(accountInvites.acceptedAt), isNull(accountInvites.cancelledAt), gt(accountInvites.expiresAt, new Date()));

/** Is this username waiting for someone who was invited? (Then nobody else can take it.) */
export async function usernameHeldByInvite(username: string, exceptInviteId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: accountInvites.id })
    .from(accountInvites)
    .where(and(pending(), eq(sql`lower(${accountInvites.username})`, username.toLowerCase())));
  return rows.some((r) => r.id !== exceptInviteId);
}

export async function emailHeldByInvite(email: string, exceptInviteId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: accountInvites.id })
    .from(accountInvites)
    .where(and(pending(), eq(sql`lower(${accountInvites.email})`, email.toLowerCase())));
  return rows.some((r) => r.id !== exceptInviteId);
}
