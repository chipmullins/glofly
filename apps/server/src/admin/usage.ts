import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { serverSettings } from "../db/schema";
import { gifMeter } from "../messages/gifMeter";
import { takeSent } from "../sentBytes";
import { estimateCosts, PRICES, projectToMonth } from "./usageCosts";

// Glofly Control → Usage & costs: this month's calls, data sent, phone users and stored files, and
// what that's likely to cost (usageCosts.ts). Months are UTC months, like AWS's bills.

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7); // "2026-10"
const settingsKey = (month: string) => `usage:out:${month}`;

/** Every minute: adds the bytes sent since the last save to this month's total (server_settings). */
export async function saveSentBytes(): Promise<void> {
  const n = takeSent();
  if (n <= 0) return;
  const key = settingsKey(monthKey());
  await db.execute(sql`
    insert into server_settings (key, value) values (${key}, jsonb_build_object('bytes', ${n}::bigint, 'since', now()))
    on conflict (key) do update
      set value = jsonb_set(server_settings.value, '{bytes}',
        to_jsonb(coalesce((server_settings.value->>'bytes')::bigint, 0) + ${n}::bigint)),
        updated_at = now()`);
}

/** Chip's monthly budget for Glofly (Control → Usage & costs), or null for none. */
export async function getBudget(): Promise<number | null> {
  const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, "usageBudget"));
  const v = (row?.value ?? {}) as { monthly?: unknown };
  return typeof v.monthly === "number" && v.monthly > 0 ? v.monthly : null;
}

export async function setBudget(monthly: number | null): Promise<void> {
  const value = { monthly };
  await db
    .insert(serverSettings)
    .values({ key: "usageBudget", value })
    .onConflictDoUpdate({ target: serverSettings.key, set: { value, updatedAt: new Date() } });
}

export async function usageReport(now = new Date()) {
  const month = monthKey(now);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Calls and voice nebulas: each person's time in a call this month, in minutes. Someone still in
  // a call counts up to now; a row nobody closed counts until the call ended.
  const [callRow] = (
    await db.execute<{ minutes: number }>(sql`
      select coalesce(sum(greatest(0, extract(epoch from (
        least(coalesce(p.left_at, c.ended_at, now()), now()) - greatest(p.joined_at, ${monthStart})
      )) / 60)), 0)::float as minutes
      from call_participants p join calls c on c.id = p.call_id
      where p.joined_at is not null and coalesce(p.left_at, c.ended_at, now()) > ${monthStart}`)
  ).rows;

  // Phones that used Glofly this month (Expo bills over-the-air updates by phone, per month).
  const [phoneRow] = (
    await db.execute<{ n: number }>(sql`
      select count(distinct user_id)::int as n from sessions
      where platform in ('ios', 'android') and last_used_at >= ${monthStart}`)
  ).rows;

  // What's stored now: chat files (photos come in two sizes; this counts the uploaded size).
  const [storedRow] = (
    await db.execute<{ bytes: string | null }>(sql`select coalesce(sum(size), 0)::bigint as bytes from attachments`)
  ).rows;

  const [outRow] = (
    await db.execute<{ value: { bytes?: number | string; since?: string } }>(
      sql`select value from server_settings where key = ${settingsKey(month)}`,
    )
  ).rows;

  const measured = {
    participantMinutes: Number(callRow?.minutes ?? 0),
    bytesOut: Number(outRow?.value?.bytes ?? 0),
    phoneUsers: Number(phoneRow?.n ?? 0),
    storedBytes: Number(storedRow?.bytes ?? 0),
  };
  const projected = {
    participantMinutes: projectToMonth(measured.participantMinutes, now),
    bytesOut: projectToMonth(measured.bytesOut, now),
    phoneUsers: measured.phoneUsers, // already "this month so far"; more may come, but not linearly
    storedBytes: measured.storedBytes,
  };
  return {
    month,
    measured,
    projected,
    // The data-out count started when this feature arrived (or the month began, if later).
    countingSince: outRow?.value?.since ?? null,
    soFar: estimateCosts(measured),
    endOfMonth: estimateCosts(projected),
    prices: PRICES,
    budget: await getBudget(),
    gifs: await gifMeter(now).catch(() => null),
  };
}
