// Glofly Control → Usage & costs: an estimate of this month's bill from what Glofly measured.
// Prices as of Oct 27, 2026 (LiveKit Cloud and Expo checked on their pricing pages; AWS standard
// on-demand prices, us-east-2). Update them here when a plan changes. It's an estimate, never the
// bill itself: AWS, LiveKit and Expo dashboards have the real numbers.

export const PRICES = {
  livekit: {
    freeMinutes: 5_000, // Build plan: $0, 5,000 participant minutes
    shipMonthly: 50, // Ship plan: $50/month, 150,000 participant minutes included
    shipMinutes: 150_000,
    perExtraMinute: 0.0005,
  },
  expo: {
    freeUsers: 1_000, // Free plan: over-the-air updates for 1,000 monthly active users (then capped)
    starterMonthly: 19, // Starter: $19/month, 3,000 included
    starterUsers: 3_000,
    perExtraUser: 0.005,
  },
  aws: {
    freeDataOutGb: 100, // data to the internet: first 100 GB a month free
    perDataOutGb: 0.09,
    perStoredGb: 0.023, // S3 Standard
    // The server (t4g.small), the database (db.t4g.micro + 20 GB), the server's public address.
    fixed: [
      { label: "Server (EC2 t4g.small)", monthly: 12.26 },
      { label: "Database (RDS db.t4g.micro + 20 GB)", monthly: 14 },
      { label: "Server's public IP address", monthly: 3.65 },
    ],
  },
  other: [
    { label: "Apple Developer ($99 a year)", monthly: 8.25 },
    { label: "glofly.app domain", monthly: 1.5 },
  ],
} as const;

export type Measured = {
  /** Call and voice-nebula time: every person counts, minute by minute (what LiveKit bills) */
  participantMinutes: number;
  /** Bytes of photos, videos and files the server sent (what AWS bills as data out) */
  bytesOut: number;
  /** People who used Glofly on a phone this month (close to what Expo bills for updates) */
  phoneUsers: number;
  /** Everything stored in S3 now */
  storedBytes: number;
};

export type CostLine = { key: string; label: string; detail: string; monthly: number };

const GB = 1024 ** 3;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The estimated bill for a month with these numbers. */
export function estimateCosts(m: Measured): { lines: CostLine[]; total: number } {
  const lk = PRICES.livekit;
  const minutes = Math.max(0, m.participantMinutes);
  const livekit =
    minutes <= lk.freeMinutes ? 0 : lk.shipMonthly + Math.max(0, minutes - lk.shipMinutes) * lk.perExtraMinute;
  const ex = PRICES.expo;
  const users = Math.max(0, m.phoneUsers);
  const expo = users <= ex.freeUsers ? 0 : ex.starterMonthly + Math.max(0, users - ex.starterUsers) * ex.perExtraUser;
  const outGb = Math.max(0, m.bytesOut) / GB;
  const storedGb = Math.max(0, m.storedBytes) / GB;
  const aws = PRICES.aws;
  const dataOut = Math.max(0, outGb - aws.freeDataOutGb) * aws.perDataOutGb;
  const storage = storedGb * aws.perStoredGb;
  const fixedAws = aws.fixed.reduce((sum, f) => sum + f.monthly, 0);
  const other = PRICES.other.reduce((sum, f) => sum + f.monthly, 0);

  const lines: CostLine[] = [
    {
      key: "livekit",
      label: "Calls (LiveKit)",
      detail:
        minutes <= lk.freeMinutes
          ? `Free plan: ${Math.round(minutes).toLocaleString("en-US")} of ${lk.freeMinutes.toLocaleString("en-US")} minutes`
          : `Ship plan: ${Math.round(minutes).toLocaleString("en-US")} minutes (${lk.shipMinutes.toLocaleString("en-US")} included)`,
      monthly: livekit,
    },
    {
      key: "expo",
      label: "Phone updates (Expo)",
      detail:
        users <= ex.freeUsers
          ? `Free plan: ${users.toLocaleString("en-US")} of ${ex.freeUsers.toLocaleString("en-US")} phone users`
          : `Starter plan: ${users.toLocaleString("en-US")} phone users (${ex.starterUsers.toLocaleString("en-US")} included)`,
      monthly: expo,
    },
    {
      key: "dataOut",
      label: "Photos & videos sent (AWS)",
      detail: `${outGb.toFixed(1)} GB (first ${aws.freeDataOutGb} GB free)`,
      monthly: dataOut,
    },
    { key: "storage", label: "Stored files (AWS S3)", detail: `${storedGb.toFixed(1)} GB`, monthly: storage },
    { key: "aws", label: "Server, database, address (AWS)", detail: "Fixed each month", monthly: fixedAws },
    { key: "other", label: "Apple Developer, domain", detail: "Fixed, spread monthly", monthly: other },
  ].map((l) => ({ ...l, monthly: round2(l.monthly) }));
  return { lines, total: round2(lines.reduce((sum, l) => sum + l.monthly, 0)) };
}

/** A month-so-far number scaled to the whole month (by time elapsed; at least a day's worth). */
export function projectToMonth(soFar: number, now: Date): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const elapsed = Math.max(now.getTime() - start, 24 * 60 * 60 * 1000);
  return soFar * Math.min((end - start) / elapsed, 31);
}
