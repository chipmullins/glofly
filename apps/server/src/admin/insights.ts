import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Router } from "express";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import * as schema from "../db/schema";
import { appErrors, pushDevices, sessions, users } from "../db/schema";
import { getMinVersion } from "../app-version";
import { WEB_ORIGIN } from "../web/session";
import { TIME_ZONE } from "../social/glows";
import { logAction, noteSchema } from "./audit";
import { admin, invalid, ip, target } from "./routes";

// Oct 28, 2026: Glofly Control → Insights (calls, people, features, the new-user funnel),
// "What's live where", pending deletions, and an account's Support view and data export.
// Everything here only reads, except the export, which goes in the audit log.

export const insightsRouter = Router();

const DAY = 24 * 60 * 60_000;
const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> =>
  (await db.execute(q)).rows as T[];
const one = async <T>(q: ReturnType<typeof sql>): Promise<T> =>
  (await rows<T>(q))[0];

/** The last `days` days in Glofly's time zone, oldest first ("2026-10-28"). */
function dayList(days: number, now = new Date()): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--)
    out.push(fmt.format(new Date(now.getTime() - i * DAY)));
  return [...new Set(out)];
}

// ───────────── Calls ─────────────

const isCallProblem = sql`(${appErrors.where} = 'call' or ${appErrors.message} like 'Call:%')`;

export async function callInsights(days: number) {
  const since = new Date(Date.now() - days * DAY);
  const totals = await one<{
    started: number;
    answered: number;
    missed: number;
    declined: number;
    video: number;
    group: number;
    short: number;
    avg_sec: number;
    avg_people: number;
  }>(sql`
    select count(*)::int as started,
      count(*) filter (where c.answered_at is not null)::int as answered,
      count(*) filter (where c.status = 'missed')::int as missed,
      count(*) filter (where c.status = 'declined')::int as declined,
      count(*) filter (where c.video)::int as video,
      count(*) filter (where v.kind = 'group')::int as "group",
      count(*) filter (where c.answered_at is not null and c.ended_at is not null and c.ended_at - c.answered_at < interval '20 seconds')::int as short,
      coalesce(avg(extract(epoch from c.ended_at - c.answered_at)) filter (where c.answered_at is not null and c.ended_at is not null), 0)::float as avg_sec,
      coalesce(avg((select count(*) from call_participants p where p.call_id = c.id and p.joined_at is not null)) filter (where c.answered_at is not null), 0)::float as avg_people
    from calls c join conversations v on v.id = c.conversation_id
    where c.created_at >= ${since} and v.kind <> 'nebula'`);
  const voice = await one<{
    rooms: number;
    people: number;
    minutes: number;
  }>(sql`
    select count(distinct c.id)::int as rooms, count(distinct p.user_id)::int as people,
      coalesce(sum(extract(epoch from coalesce(p.left_at, c.ended_at, now()) - p.joined_at) / 60), 0)::float as minutes
    from calls c join conversations v on v.id = c.conversation_id
    join call_participants p on p.call_id = c.id and p.joined_at is not null
    where c.created_at >= ${since} and v.kind = 'nebula'`);
  const perDay = await rows<{
    day: string;
    started: number;
    answered: number;
    missed: number;
  }>(sql`
    select to_char((c.created_at at time zone ${TIME_ZONE})::date, 'YYYY-MM-DD') as day,
      count(*)::int as started,
      count(*) filter (where c.answered_at is not null)::int as answered,
      count(*) filter (where c.status in ('missed', 'declined'))::int as missed
    from calls c join conversations v on v.id = c.conversation_id
    where c.created_at >= ${since} and v.kind <> 'nebula'
    group by 1`);
  const byDay = new Map(perDay.map((r) => [r.day, r]));
  const problems = await db
    .select({
      id: appErrors.id,
      message: appErrors.message,
      app: appErrors.app,
      appVersion: appErrors.appVersion,
      os: appErrors.os,
      count: appErrors.count,
      people: sql<number>`coalesce(cardinality(${appErrors.userIds}), 0)::int`,
      firstAt: appErrors.firstAt,
      lastAt: appErrors.lastAt,
      resolvedAt: appErrors.resolvedAt,
    })
    .from(appErrors)
    .where(and(isCallProblem, sql`${appErrors.lastAt} >= ${since}`))
    .orderBy(desc(appErrors.count))
    .limit(15);
  const { avg_sec, avg_people, ...counts } = totals;
  return {
    days,
    ...counts,
    avgSeconds: Math.round(avg_sec),
    avgPeople: Math.round(avg_people * 10) / 10,
    voiceRooms: { ...voice, minutes: Math.round(voice.minutes) },
    daily: dayList(days).map(
      (day) => byDay.get(day) ?? { day, started: 0, answered: 0, missed: 0 },
    ),
    problems: problems.map((p) => ({
      ...p,
      firstAt: p.firstAt.toISOString(),
      lastAt: p.lastAt.toISOString(),
      resolvedAt: p.resolvedAt?.toISOString() ?? null,
    })),
  };
}

// ───────────── People: active days and coming back ─────────────

export async function peopleInsights() {
  const days = dayList(30);
  const today = days[days.length - 1];
  const weekStart = days[days.length - 7];
  const monthStart = days[0];
  const active = await one<{
    today: number;
    week: number;
    month: number;
    total: number;
  }>(sql`
    select count(distinct user_id) filter (where day = ${today}::date)::int as today,
      count(distinct user_id) filter (where day >= ${weekStart}::date)::int as week,
      count(distinct user_id) filter (where day >= ${monthStart}::date)::int as month,
      (select count(*)::int from users where delete_after is null and suspended_at is null) as total
    from active_days where day >= ${monthStart}::date`);
  const perDay = await rows<{
    day: string;
    people: number;
    desktop: number;
    web: number;
    ios: number;
    android: number;
  }>(sql`
    select to_char(day, 'YYYY-MM-DD') as day, count(*)::int as people,
      count(*) filter (where platform = 'desktop')::int as desktop,
      count(*) filter (where platform = 'web')::int as web,
      count(*) filter (where platform = 'ios')::int as ios,
      count(*) filter (where platform = 'android')::int as android
    from active_days where day >= ${monthStart}::date group by day`);
  const byDay = new Map(perDay.map((r) => [r.day, r]));
  // Which app people use (each person's most recent day this month).
  const apps = await one<{
    desktop: number;
    web: number;
    ios: number;
    android: number;
  }>(sql`
    select count(*) filter (where platform = 'desktop')::int as desktop,
      count(*) filter (where platform = 'web')::int as web,
      count(*) filter (where platform = 'ios')::int as ios,
      count(*) filter (where platform = 'android')::int as android
    from (select distinct on (user_id) platform from active_days
          where day >= ${monthStart}::date and platform <> 'unknown' order by user_id, day desc) latest`);
  // Weekly sign-up groups (last 8 weeks): did they come back the next day, in their first week,
  // and a month later? A group only counts for a question once enough time has passed to answer it.
  const cohorts = await rows<{
    week: string;
    joined: number;
    d1_of: number;
    d1: number;
    w1_of: number;
    w1: number;
    m1_of: number;
    m1: number;
  }>(sql`
    with joined as (
      select id, (created_at at time zone ${TIME_ZONE})::date as d0 from users
      where created_at >= now() - interval '56 days'
    ), today as (select (now() at time zone ${TIME_ZONE})::date as t)
    select to_char(date_trunc('week', j.d0)::date, 'YYYY-MM-DD') as week,
      count(*)::int as joined,
      count(*) filter (where j.d0 + 1 < t)::int as d1_of,
      count(*) filter (where j.d0 + 1 < t and exists (select 1 from active_days a where a.user_id = j.id and a.day = j.d0 + 1))::int as d1,
      count(*) filter (where j.d0 + 7 < t)::int as w1_of,
      count(*) filter (where j.d0 + 7 < t and exists (select 1 from active_days a where a.user_id = j.id and a.day between j.d0 + 1 and j.d0 + 7))::int as w1,
      count(*) filter (where j.d0 + 35 < t)::int as m1_of,
      count(*) filter (where j.d0 + 35 < t and exists (select 1 from active_days a where a.user_id = j.id and a.day between j.d0 + 28 and j.d0 + 35))::int as m1
    from joined j, today group by 1 order by 1 desc`);
  const since = await one<{ day: string | null }>(
    sql`select to_char(min(day), 'YYYY-MM-DD') as day from active_days where platform <> 'unknown'`,
  );
  return {
    today: active.today,
    week: active.week,
    month: active.month,
    accounts: active.total,
    apps,
    daily: days.map(
      (day) =>
        byDay.get(day) ?? {
          day,
          people: 0,
          desktop: 0,
          web: 0,
          ios: 0,
          android: 0,
        },
    ),
    cohorts,
    // Before this day only message senders were known (the migration's head start).
    countingSince: since.day,
  };
}

// ───────────── Feature usage ─────────────

export async function featureInsights(days: number) {
  const since = new Date(Date.now() - days * DAY);
  type Row = { key: string; uses: number; people: number };
  const list = await rows<Row>(sql`
    with m as (
      select m.*, v.kind as conv_kind from messages m join conversations v on v.id = m.conversation_id
      where m.created_at >= ${since} and m.event is null
    ), a as (
      select a.*, m.sender_id from attachments a join messages m on m.id = a.message_id
      where m.created_at >= ${since}
    ), c as (
      select c.*, v.kind as conv_kind from calls c join conversations v on v.id = c.conversation_id
      where c.created_at >= ${since}
    )
    select 'messages' as key, count(*)::int as uses, count(distinct sender_id)::int as people from m where conv_kind <> 'nebula'
    union all select 'nebula_messages', count(*)::int, count(distinct sender_id)::int from m where conv_kind = 'nebula'
    union all select 'replies', count(*)::int, count(distinct sender_id)::int from m where reply_to_id is not null
    union all select 'photos', count(*)::int, count(distinct sender_id)::int from a where kind = 'image' and not coalesce(sticker, false)
    union all select 'videos', count(*)::int, count(distinct sender_id)::int from a where video is not null
    union all select 'voice', count(*)::int, count(distinct sender_id)::int from a where voice is not null
    union all select 'files', count(*)::int, count(distinct sender_id)::int from a where kind = 'file' and video is null and voice is null
    union all select 'stickers', count(*)::int, count(distinct sender_id)::int from a where coalesce(sticker, false)
    union all select 'gifs', count(*)::int, count(distinct sender_id)::int from m where gif is not null
    union all select 'links', count(*)::int, count(distinct sender_id)::int from m where link_preview is not null
    union all select 'polls', count(*)::int, count(distinct sender_id)::int from m where poll is not null
    union all select 'games', count(*)::int, count(distinct sender_id)::int from m where game is not null
    union all select 'lanterns', count(*)::int, count(distinct sender_id)::int from m where coalesce(lantern, false)
    union all select 'reactions', count(*)::int, count(distinct user_id)::int from message_reactions where created_at >= ${since}
    union all select 'pins', count(*)::int, count(distinct pinned_by)::int from pinned_messages where pinned_at >= ${since}
    union all select 'voice_calls', count(*)::int, count(distinct caller_id)::int from c where conv_kind <> 'nebula' and not video
    union all select 'video_calls', count(*)::int, count(distinct caller_id)::int from c where conv_kind <> 'nebula' and video
    union all select 'group_calls', count(*)::int, count(distinct caller_id)::int from c where conv_kind = 'group'
    union all select 'watch', count(*)::int, count(distinct m.sender_id)::int from messages m
      where m.created_at >= ${since} and m.event->>'type' = 'watch'
    union all select 'voice_rooms', count(distinct p.call_id)::int, count(distinct p.user_id)::int
      from call_participants p join c on c.id = p.call_id where c.conv_kind = 'nebula' and p.joined_at is not null
    union all select 'constellation_joins', count(*)::int, count(distinct user_id)::int from constellation_members where joined_at >= ${since}
    union all select 'constellations_made', count(*)::int, count(distinct owner_id)::int from constellations where created_at >= ${since}
    union all select 'friends', count(*)::int, count(distinct requester_id)::int from friendships where status = 'accepted' and accepted_at >= ${since}`);
  const active = await one<{ n: number }>(
    sql`select count(distinct user_id)::int as n from active_days where day >= (${since}::timestamptz at time zone ${TIME_ZONE})::date`,
  );
  return { days, activePeople: active.n, features: list };
}

// ───────────── New-user funnel ─────────────

export async function funnelInsights(days: number) {
  const since = new Date(Date.now() - days * DAY);
  const f = await one<{
    signed_up: number;
    verified: number;
    friend: number;
    messaged: number;
    called: number;
    came_back: number;
    joined_constellation: number;
    median_first_message_min: number | null;
  }>(sql`
    with u as (select id, created_at, email_verified_at from users where created_at >= ${since}),
    first_msg as (
      select u.id, min(m.created_at) as at from u join messages m on m.sender_id = u.id and m.event is null group by u.id
    )
    select count(*)::int as signed_up,
      count(*) filter (where u.email_verified_at is not null)::int as verified,
      count(*) filter (where exists (select 1 from friendships f where f.status = 'accepted' and (f.user_low = u.id or f.user_high = u.id)))::int as friend,
      count(*) filter (where exists (select 1 from first_msg fm where fm.id = u.id))::int as messaged,
      count(*) filter (where exists (select 1 from call_participants p where p.user_id = u.id and p.joined_at is not null))::int as called,
      count(*) filter (where (select count(*) from active_days a where a.user_id = u.id) >= 2)::int as came_back,
      count(*) filter (where exists (select 1 from constellation_members cm where cm.user_id = u.id))::int as joined_constellation,
      (select percentile_cont(0.5) within group (order by extract(epoch from fm.at - u2.created_at) / 60)
        from first_msg fm join u u2 on u2.id = fm.id)::float as median_first_message_min
    from u`);
  const steps = [
    { key: "signed_up", label: "Made an account", people: f.signed_up },
    { key: "verified", label: "Confirmed their email", people: f.verified },
    { key: "friend", label: "Has a friend", people: f.friend },
    { key: "messaged", label: "Sent a message", people: f.messaged },
    { key: "called", label: "Was in a call", people: f.called },
    { key: "came_back", label: "Came back another day", people: f.came_back },
  ];
  return {
    days,
    steps,
    joinedConstellation: f.joined_constellation,
    medianMinutesToFirstMessage: f.median_first_message_min,
  };
}

// GET /admin/insights?days=7|30|90
insightsRouter.get("/insights", async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days))
    ? Number(req.query.days)
    : 30;
  const [calls, people, features, funnel] = await Promise.all([
    callInsights(days),
    peopleInsights(),
    featureInsights(days),
    funnelInsights(days),
  ]);
  res.json({ days, calls, people, features, funnel, timeZone: TIME_ZONE });
});

// ───────────── What's live where ─────────────

const UPDATES_URL = (
  process.env.UPDATES_URL?.trim() ||
  "https://glofly-updates.s3.us-east-2.amazonaws.com"
).replace(/\/+$/, "");

/** The release this server was built from (the desktop app's version is the release number). */
export function serverRelease(): string | null {
  for (const p of [
    resolve(process.cwd(), "../desktop/package.json"),
    resolve(__dirname, "../../../desktop/package.json"),
  ]) {
    try {
      const v = JSON.parse(readFileSync(p, "utf8")).version;
      if (typeof v === "string") return v;
    } catch {
      // try the next place
    }
  }
  return null;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      redirect: "error",
      headers: { "Cache-Control": "no-cache" },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** electron-builder's latest.yml: `version: 0.8.4` and `releaseDate: '…'`. */
export function readFeed(text: string | null): {
  version: string | null;
  releasedAt: string | null;
} {
  if (!text) return { version: null, releasedAt: null };
  const version = /^version:\s*['"]?([^'"\s]+)/m.exec(text)?.[1] ?? null;
  const releasedAt =
    /^releaseDate:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(text)?.[1] ?? null;
  return { version, releasedAt };
}

let liveCache: { at: number; value: unknown } | null = null;

insightsRouter.get("/live", async (_req, res) => {
  if (liveCache && Date.now() - liveCache.at < 60_000)
    return void res.json(liveCache.value);
  const release = serverRelease();
  const [webText, winText, macText] = await Promise.all([
    WEB_ORIGIN
      ? fetchText(`${WEB_ORIGIN}/version.json`)
      : Promise.resolve(null),
    fetchText(`${UPDATES_URL}/latest.yml`),
    fetchText(`${UPDATES_URL}/latest-mac.yml`),
  ]);
  let web: { version: string | null; build: string | null } = {
    version: null,
    build: null,
  };
  try {
    const j = webText ? JSON.parse(webText) : null;
    web = {
      version: typeof j?.version === "string" ? j.version : null,
      build: j?.build != null ? String(j.build) : null,
    };
  } catch {
    // shown as unknown
  }
  // Versions people actually used in the last 7 days, newest first, per app.
  const used = await rows<{
    platform: string;
    version: string;
    people: number;
  }>(sql`
    select coalesce(platform, 'desktop') as platform, app_version as version, count(distinct user_id)::int as people
    from sessions where last_used_at >= now() - interval '7 days' and app_version is not null
    group by 1, 2`);
  const newer = (a: string, b: string) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++)
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
  };
  const inUse = (platform: string) =>
    used
      .filter((u) => u.platform === platform)
      .sort((a, b) => newer(b.version, a.version))
      .map(({ version, people }) => ({ version, people }));
  const win = readFeed(winText);
  const mac = readFeed(macText);
  const min = async (p: "desktop" | "web" | "ios" | "android") =>
    (await getMinVersion(p)).min;
  const value = {
    release,
    server: {
      version: release,
      upSince: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    },
    web: {
      ...web,
      reachable: webText !== null,
      minimum: await min("web"),
      inUse: inUse("web"),
    },
    windows: {
      ...win,
      reachable: winText !== null,
      minimum: await min("desktop"),
      inUse: inUse("desktop"),
    },
    mac: { ...mac, reachable: macText !== null },
    ios: { minimum: await min("ios"), inUse: inUse("ios") },
    android: { minimum: await min("android"), inUse: inUse("android") },
    checkedAt: new Date().toISOString(),
  };
  liveCache = { at: Date.now(), value };
  res.json(value);
});

// ───────────── Pending deletions ─────────────

insightsRouter.get("/deletions", async (_req, res) => {
  const list = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      deleteAfter: users.deleteAfter,
    })
    .from(users)
    .where(isNotNull(users.deleteAfter))
    .orderBy(asc(users.deleteAfter))
    .limit(10);
  const [total] = await db
    .select({ n: count() })
    .from(users)
    .where(isNotNull(users.deleteAfter));
  res.json({
    count: total.n,
    next: list.map((u) => ({
      ...u,
      deleteAfter: u.deleteAfter!.toISOString(),
    })),
  });
});

// ───────────── An account's Support view ─────────────

insightsRouter.get("/accounts/:id/support", async (req, res) => {
  const user = await target(res, req.params.id);
  if (!user) return;
  const devices = await db
    .select({
      id: sessions.id,
      deviceName: sessions.deviceName,
      platform: sessions.platform,
      appVersion: sessions.appVersion,
      persistent: sessions.persistent,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(eq(sessions.userId, user.id), sql`${sessions.expiresAt} > now()`),
    )
    .orderBy(desc(sessions.lastUsedAt));
  // Push registrations: never the tokens themselves.
  const pushes = await db
    .select({
      sessionId: pushDevices.sessionId,
      platform: pushDevices.platform,
      preview: pushDevices.preview,
      calls: sql<boolean>`${pushDevices.voipToken} is not null`,
      features: pushDevices.features,
      updatedAt: pushDevices.updatedAt,
    })
    .from(pushDevices)
    .where(eq(pushDevices.userId, user.id));
  const errors = await db
    .select({
      id: appErrors.id,
      app: appErrors.app,
      appVersion: appErrors.appVersion,
      os: appErrors.os,
      message: appErrors.message,
      where: appErrors.where,
      count: appErrors.count,
      lastAt: appErrors.lastAt,
      resolvedAt: appErrors.resolvedAt,
    })
    .from(appErrors)
    .where(sql`${user.id}::uuid = any(${appErrors.userIds})`)
    .orderBy(desc(appErrors.lastAt))
    .limit(25);
  const calls = await rows<{
    id: string;
    at: string;
    kind: string;
    video: boolean;
    status: string;
    caller: boolean;
    joined_at: string | null;
    left_at: string | null;
    seconds: number | null;
    people: number;
  }>(sql`
    select c.id, c.created_at as at, v.kind, c.video, c.status, c.caller_id = ${user.id} as caller,
      p.joined_at, p.left_at,
      greatest(0, extract(epoch from coalesce(p.left_at, c.ended_at) - p.joined_at))::int as seconds,
      (select count(*) from call_participants q where q.call_id = c.id and q.joined_at is not null)::int as people
    from call_participants p join calls c on c.id = p.call_id join conversations v on v.id = c.conversation_id
    where p.user_id = ${user.id}
    order by c.created_at desc limit 20`);
  const activity = await one<{
    days30: number;
    last: string | null;
    platforms: string[] | null;
  }>(sql`
    select count(*) filter (where day >= (now() at time zone ${TIME_ZONE})::date - 29)::int as days30,
      to_char(max(day), 'YYYY-MM-DD') as last,
      array_agg(distinct platform) filter (where platform <> 'unknown' and day >= (now() at time zone ${TIME_ZONE})::date - 29) as platforms
    from active_days where user_id = ${user.id}`);
  const [settings] = await db
    .select({
      twoStep: users.twoStep,
      quietHours: users.quietHours,
      restricted: users.restricted,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .where(eq(users.id, user.id));
  res.json({
    devices: devices.map((d) => ({
      ...d,
      platform: d.platform ?? "desktop",
      createdAt: d.createdAt.toISOString(),
      lastUsedAt: d.lastUsedAt.toISOString(),
      expiresAt: d.expiresAt.toISOString(),
      push: pushes.find((p) => p.sessionId === d.id) ?? null,
    })),
    errors: errors.map((e) => ({
      ...e,
      lastAt: e.lastAt.toISOString(),
      resolvedAt: e.resolvedAt?.toISOString() ?? null,
    })),
    calls: calls.map((c) => ({
      id: c.id,
      at: new Date(c.at).toISOString(),
      kind: c.kind,
      video: c.video,
      status: c.status,
      caller: c.caller,
      joined: c.joined_at !== null,
      seconds: c.seconds,
      people: c.people,
    })),
    activity: {
      daysLast30: activity?.days30 ?? 0,
      lastDay: activity?.last ?? null,
      apps: activity?.platforms ?? [],
    },
    settings: {
      twoStep: settings?.twoStep ?? null,
      quietHours: settings?.quietHours ?? null,
      restricted: settings?.restricted ?? false,
      lastSeenAt: settings?.lastSeenAt?.toISOString() ?? null,
    },
  });
});

// ───────────── One-click export of a person's data ─────────────

/** Never in an export: password and token hashes, push tokens, secrets. */
const SECRET_KEY = /hash|token|secret|password|nonce|key$/i;

function scrub(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      if (!SECRET_KEY.test(k)) out[k] = scrub(v);
    return out;
  }
  return value;
}

/** Everything Glofly keeps that's about this person or written by them (not other people's messages). */
export async function exportAccount(userId: string) {
  const s = schema;
  const [profile] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, userId));
  const sent = await db
    .select()
    .from(s.messages)
    .where(eq(s.messages.senderId, userId))
    .orderBy(asc(s.messages.createdAt));
  const sentIds = sent.map((m) => m.id);
  const conversationIds = (
    await db
      .select({ id: s.conversationMembers.conversationId })
      .from(s.conversationMembers)
      .where(eq(s.conversationMembers.userId, userId))
  ).map((r) => r.id);
  const data = {
    exportedAt: new Date().toISOString(),
    note: "Everything Glofly keeps about this account and everything it wrote. Other people's messages are left out. Photos and files are listed (name, size, when) but not included.",
    profile,
    devices: await db
      .select()
      .from(s.sessions)
      .where(eq(s.sessions.userId, userId)),
    pushRegistrations: await db
      .select()
      .from(s.pushDevices)
      .where(eq(s.pushDevices.userId, userId)),
    knownDevices: await db
      .select()
      .from(s.knownDevices)
      .where(eq(s.knownDevices.userId, userId)),
    friendships: await db
      .select()
      .from(s.friendships)
      .where(
        sql`${s.friendships.userLow} = ${userId} or ${s.friendships.userHigh} = ${userId}`,
      ),
    blocks: await db
      .select()
      .from(s.blocks)
      .where(eq(s.blocks.blockerId, userId)),
    nicknames: await db
      .select()
      .from(s.nicknames)
      .where(eq(s.nicknames.ownerId, userId)),
    conversations: conversationIds.length
      ? await db
          .select()
          .from(s.conversations)
          .where(inArray(s.conversations.id, conversationIds))
      : [],
    conversationMemberships: await db
      .select()
      .from(s.conversationMembers)
      .where(eq(s.conversationMembers.userId, userId)),
    messagesSent: sent,
    filesSent: await db
      .select()
      .from(s.attachments)
      .where(eq(s.attachments.uploaderId, userId)),
    reactions: await db
      .select()
      .from(s.messageReactions)
      .where(eq(s.messageReactions.userId, userId)),
    pollVotes: await db
      .select()
      .from(s.pollVotes)
      .where(eq(s.pollVotes.userId, userId)),
    pinnedByThem: await db
      .select()
      .from(s.pinnedMessages)
      .where(eq(s.pinnedMessages.pinnedBy, userId)),
    scheduledMessages: await db
      .select()
      .from(s.scheduledMessages)
      .where(eq(s.scheduledMessages.senderId, userId)),
    stickers: await db
      .select()
      .from(s.stickers)
      .where(eq(s.stickers.ownerId, userId)),
    calls: await db
      .select()
      .from(s.callParticipants)
      .where(eq(s.callParticipants.userId, userId)),
    constellationsOwned: await db
      .select()
      .from(s.constellations)
      .where(eq(s.constellations.ownerId, userId)),
    constellationMemberships: await db
      .select()
      .from(s.constellationMembers)
      .where(eq(s.constellationMembers.userId, userId)),
    games: await db
      .select()
      .from(s.userGames)
      .where(eq(s.userGames.userId, userId)),
    reportsFiled: await db
      .select({
        id: s.reports.id,
        reason: s.reports.reason,
        details: s.reports.details,
        status: s.reports.status,
        createdAt: s.reports.createdAt,
      })
      .from(s.reports)
      .where(eq(s.reports.reporterId, userId)),
    noticesFromGlofly: await db
      .select()
      .from(s.userNotices)
      .where(eq(s.userNotices.userId, userId)),
    activeDays: await db
      .select()
      .from(s.activeDays)
      .where(eq(s.activeDays.userId, userId)),
    messageCount: sentIds.length,
  };
  return scrub(data) as Record<string, unknown>;
}

// POST /admin/accounts/:id/export { note } → the JSON file's contents (Control saves it).
insightsRouter.post("/accounts/:id/export", async (req, res) => {
  const user = await target(res, req.params.id);
  if (!user) return;
  const parsed = z.object({ note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const data = await exportAccount(user.id);
  await logAction({
    adminId: admin(res).id,
    action: "Exported account data",
    targetUserId: user.id,
    targetLabel: `@${user.username}`,
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({
    fileName: `glofly-${user.username}-${new Date().toISOString().slice(0, 10)}.json`,
    data,
  });
});
