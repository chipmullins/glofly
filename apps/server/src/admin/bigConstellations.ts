import { sql } from "drizzle-orm";
import { BIG_CONSTELLATION_MEMBERS } from "@glofly/shared";
import { db } from "../db";
import { redis } from "../redis";
import { fanOutPerMinute, onlineNow } from "../realtime";
import { busyCountKey } from "../constellations/busy";

// Communities round 2 (board 4b): Glofly Control → Insights → Big constellations. Counts only:
// which constellations are big, how hard they push the server (messages, live events, busy-limit
// refusals), the biggest voice nebulas and stages, and what voice + stage minutes cost on LiveKit.

/** LiveKit Cloud's price per participant-minute past the plan's included minutes (Ship: $0.0005). */
const PRICE_PER_MINUTE = Number(process.env.LIVEKIT_PRICE_PER_MINUTE ?? 0.0005) || 0;
/** Live events per minute Glofly is comfortable sending from one server (a reference line). */
export const FANOUT_COMFORT_PER_MINUTE = 120_000;

const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(q)).rows as T[];
const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));

export type BigConstellationRow = {
  id: string;
  name: string;
  members: number;
  /** members at the end of each of the last 12 weeks, oldest first */
  weekly: number[];
  messagesToday: number;
  messagesWeekAvg: number;
  activeToday: number;
  activeWeekAvg: number;
  onlineNow: number;
  biggestVoiceToday: number;
  biggestVoiceWeek: number;
  biggestStageToday: number;
  biggestStageWeek: number;
  busyToday: number;
  busyWeekAvg: number;
};

export async function bigConstellations() {
  const sizes = await rows<{ id: string; name: string; members: number; week_ago: number }>(sql`
    select c.id, c.name, count(*)::int as members,
      count(*) filter (where cm.joined_at <= now() - interval '7 days')::int as week_ago
    from constellations c join constellation_members cm on cm.constellation_id = c.id
    join users u on u.id = cm.user_id and not u.bot
    where c.taken_down_at is null
    group by c.id order by members desc limit 50`);
  const big = sizes.filter((s) => s.members > BIG_CONSTELLATION_MEMBERS);
  // Nothing big yet: show the five biggest anyway, so the page isn't empty.
  const shown = (big.length ? big : sizes).slice(0, 10);
  const out: BigConstellationRow[] = [];
  for (const c of shown) {
    const [m] = await rows<{ today: number; week: number; active_today: number; active_week: number }>(sql`
      select count(*) filter (where m.created_at > now() - interval '1 day')::int as today,
        count(*)::int as week,
        count(distinct m.sender_id) filter (where m.created_at > now() - interval '1 day')::int as active_today,
        (select coalesce(avg(n), 0)::float from (select count(distinct m2.sender_id) n from messages m2 join nebulas n2 on n2.conversation_id = m2.conversation_id
           where n2.constellation_id = ${c.id} and m2.created_at > now() - interval '7 days' and m2.event is null group by date_trunc('day', m2.created_at)) d) as active_week
      from messages m join nebulas n on n.conversation_id = m.conversation_id
      where n.constellation_id = ${c.id} and m.created_at > now() - interval '7 days' and m.event is null`);
    const [v] = await rows<{ today: number; week: number }>(sql`
      select coalesce(max(people) filter (where started > now() - interval '1 day'), 0)::int as today, coalesce(max(people), 0)::int as week from (
        select k.id, min(p.joined_at) as started, count(*) filter (where p.joined_at is not null) as people
        from calls k join nebulas n on n.conversation_id = k.conversation_id join call_participants p on p.call_id = k.id
        where n.constellation_id = ${c.id} and k.created_at > now() - interval '7 days' group by k.id) x`);
    const [st] = await rows<{ today: number; week: number }>(sql`
      select coalesce(max(s.peak_listeners) filter (where s.started_at > now() - interval '1 day' or s.ended_at is null), 0)::int as today,
        coalesce(max(s.peak_listeners), 0)::int as week
      from stages s join nebulas n on n.id = s.nebula_id where n.constellation_id = ${c.id} and (s.started_at > now() - interval '7 days' or s.ended_at is null)`);
    const weekly = await rows<{ n: number }>(sql`
      select (select count(*) from constellation_members cm where cm.constellation_id = ${c.id} and cm.joined_at <= w)::int as n
      from generate_series(now() - interval '11 weeks', now(), interval '1 week') w order by w`);
    const busy = await Promise.all(days(7).map((d) => redis.get(busyCountKey(c.id, d)).then((x) => Number(x ?? 0))));
    const memberIds = (await rows<{ user_id: string }>(sql`select user_id from constellation_members where constellation_id = ${c.id}`)).map((r) => r.user_id);
    out.push({
      id: c.id,
      name: c.name,
      members: c.members,
      weekly: weekly.map((w) => w.n),
      messagesToday: m?.today ?? 0,
      messagesWeekAvg: Math.round((m?.week ?? 0) / 7),
      activeToday: m?.active_today ?? 0,
      activeWeekAvg: Math.round(m?.active_week ?? 0),
      onlineNow: onlineNow(memberIds).length,
      biggestVoiceToday: v?.today ?? 0,
      biggestVoiceWeek: v?.week ?? 0,
      biggestStageToday: st?.today ?? 0,
      biggestStageWeek: st?.week ?? 0,
      busyToday: busy[0],
      busyWeekAvg: Math.round(busy.reduce((a, b) => a + b, 0) / 7),
    });
  }
  const [minutes] = await rows<{ voice: number; stage: number }>(sql`
    select coalesce((select sum(extract(epoch from coalesce(p.left_at, now()) - p.joined_at) / 60)
        from call_participants p join calls k on k.id = p.call_id join conversations cv on cv.id = k.conversation_id
        where cv.kind = 'nebula' and p.joined_at > now() - interval '30 days'), 0)::float as voice,
      coalesce((select sum(participant_minutes) from stages where started_at > now() - interval '30 days'), 0)::float as stage`);
  const voice = Math.round(minutes?.voice ?? 0);
  const stage = Math.round(minutes?.stage ?? 0);
  const fan = fanOutPerMinute();
  return {
    threshold: BIG_CONSTELLATION_MEMBERS,
    bigCount: big.length,
    newThisWeek: big.filter((b) => b.week_ago <= BIG_CONSTELLATION_MEMBERS).length,
    biggest: sizes[0] ? { name: sizes[0].name, members: sizes[0].members } : null,
    fanOut: { lastMinute: fan.last, thisMinute: fan.now, comfort: FANOUT_COMFORT_PER_MINUTE },
    minutes: { voice, stage, pricePerMinute: PRICE_PER_MINUTE, estimate: Math.round((voice + stage) * PRICE_PER_MINUTE * 100) / 100 },
    constellations: out,
  };
}
