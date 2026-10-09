import { z } from "zod";
import { db } from "../db";
import { adminAuditLog } from "../db/schema";

// The audit log: one row for every action taken in Control (and sign-ins). Append only:
// the database itself refuses to change or delete rows (migration 0016).

export const noteSchema = z
  .string({ error: "Add a short note for the audit log." })
  .trim()
  .min(3, "Add a short note for the audit log (a few words is enough).")
  .max(500, "Keep the note under 500 characters.");

export type AuditEntry = {
  adminId: string | null;
  action: string;
  targetUserId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, unknown> | null;
  note?: string;
  ip?: string | null;
};

export async function logAction(entry: AuditEntry): Promise<void> {
  await db.insert(adminAuditLog).values({
    adminId: entry.adminId,
    action: entry.action,
    targetUserId: entry.targetUserId ?? null,
    targetLabel: entry.targetLabel ?? null,
    details: entry.details ?? null,
    note: entry.note ?? "",
    ip: entry.ip ?? null,
  });
}

/** Writes the entry without making anyone wait; a failure is logged. */
export function logInBackground(entry: AuditEntry): void {
  logAction(entry).catch((err) => console.error("Couldn't write to the audit log", err));
}
