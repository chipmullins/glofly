// Communities round 2, item 4: a big constellation for load testing (generated data, never real
// people). Makes an owner and a member you can sign in as, a constellation with MEMBERS generated
// members (default 12,000) and MESSAGES messages (default 200,000) spread over its text nebulas
// and the last 7 days, then times the routes a member's app calls and prints the query plans of
// the hot queries.
//
//   cd apps/server
//   npx tsx --env-file=../../.env test/load/bigConstellation.ts http://localhost:4000           make + measure
//   MEMBERS=25000 MESSAGES=500000 npx tsx --env-file=../../.env test/load/bigConstellation.ts …   bigger
//   npx tsx --env-file=../../.env test/load/bigConstellation.ts --clean                            remove every load test
//
// Generated accounts are named load_<tag>_<n> and can't sign in (no password). Run against a dev
// database only.
import { randomBytes } from "node:crypto";
import pg from "pg";

const URL_ = process.argv[2] ?? "http://localhost:4000";
const MEMBERS = Number(process.env.MEMBERS ?? 12_000);
const MESSAGES = Number(process.env.MESSAGES ?? 200_000);
const H = { "x-glofly-version": "0.9.0", "x-glofly-features": "threads, round2", "content-type": "application/json" };
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV === "production") throw new Error("Not on production.");

async function clean() {
  const c = await pool.query("delete from constellations where name like 'Load test %' returning id");
  const u = await pool.query("delete from users where username like 'load\\_%' or username like 'loadowner%' or username like 'loadmember%' returning id");
  console.log(`Removed ${c.rowCount} load-test constellations and ${u.rowCount} generated accounts.`);
}

async function call(path: string, token: string, method = "GET", body?: unknown) {
  const t0 = performance.now();
  const r = await fetch(URL_ + path, { method, headers: { ...H, authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, ms: performance.now() - t0, bytes: text.length, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

async function account(name: string) {
  const r = await fetch(URL_ + "/auth/register", { method: "POST", headers: H, body: JSON.stringify({ email: `${name}@example.com`, username: name, displayName: name, password: "Load-test-password-1", birthday: "1995-05-14", acceptTerms: true }) });
  const j = await r.json();
  if (r.status !== 201) throw new Error(`register ${name}: ${r.status} ${JSON.stringify(j)}`);
  return { id: j.user.id as string, token: j.token as string };
}

async function timeIt(label: string, n: number, fn: () => Promise<{ status: number; ms: number; bytes: number }>) {
  const times: number[] = [];
  let last = { status: 0, bytes: 0 };
  for (let i = 0; i < n; i++) {
    const r = await fn();
    times.push(r.ms);
    last = r;
  }
  times.sort((a, b) => a - b);
  const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))].toFixed(0);
  console.log(`${label.padEnd(44)} ${String(last.status).padEnd(4)} p50 ${p(0.5).padStart(5)} ms  p95 ${p(0.95).padStart(5)} ms  ${(last.bytes / 1024).toFixed(0)} KB`);
}

async function explain(label: string, sql: string, params: unknown[]) {
  const r = await pool.query(`explain (analyze, buffers, format text) ${sql}`, params);
  const lines = r.rows.map((x) => x["QUERY PLAN"] as string);
  const total = lines.find((l) => l.startsWith("Execution Time"));
  const seq = lines.filter((l) => /Seq Scan on (messages|conversation_members|constellation_members)/.test(l));
  console.log(`\n${label}: ${total}${seq.length ? `\n  ⚠ ${seq.join("\n  ⚠ ")}` : ""}`);
  if (process.env.PLANS) console.log(lines.join("\n"));
}

async function main() {
  if (process.argv.includes("--clean")) return clean();
  const tag = randomBytes(3).toString("hex");
  console.log(`Load test ${tag}: ${MEMBERS.toLocaleString()} members, ${MESSAGES.toLocaleString()} messages`);
  // Signups are rate limited per address: clear the counters first (dev only).
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const { createClient } = await import("redis");
    const r = createClient({ url: redisUrl });
    await r.connect();
    for await (const keys of r.scanIterator({ MATCH: "rl:*", COUNT: 500 })) if (keys.length) await r.del(keys);
    await r.quit();
  }
  const owner = await account(`loadowner${tag}`);
  const member = await account(`loadmember${tag}`);
  const made = await call("/constellations", owner.token, "POST", { name: `Load test ${tag}`, template: "gaming" });
  const cid = made.json.constellation.id as string;
  await pool.query("update constellations set visibility = 'public', type = 'gaming' where id = $1", [cid]);
  const link = await call(`/constellations/${cid}/links`, owner.token, "POST", { lifetime: "7d" });
  await call(`/constellations/links/${link.json.link.code}/join`, member.token, "POST");
  const nebulaRows = (await pool.query("select id, kind, conversation_id, visibility from nebulas where constellation_id = $1", [cid])).rows;
  const open = nebulaRows.filter((n) => n.visibility === "everyone");
  const texts = open.filter((n) => n.kind === "text");

  let t0 = Date.now();
  await pool.query(
    `insert into users (username, display_name, email, password_hash, birthday, terms_accepted_at, created_at)
     select 'load_${tag}_' || g, 'Load ' || g, 'load_${tag}_' || g || '@load.invalid', '!load', '2000-01-01', now(), now() - (random() * interval '400 days')
     from generate_series(1, $1) g`,
    [MEMBERS],
  );
  await pool.query(
    `insert into constellation_members (constellation_id, user_id, joined_at)
     select $1, id, now() - (random() * interval '200 days') from users where username like 'load\\_${tag}\\_%'`,
    [cid],
  );
  for (const n of open)
    await pool.query(
      `insert into conversation_members (conversation_id, user_id, last_read_at)
       select $1, id, now() - (random() * interval '10 days') from users where username like 'load\\_${tag}\\_%'`,
      [n.conversation_id],
    );
  console.log(`members inserted in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  t0 = Date.now();
  const chats = texts.map((n) => n.conversation_id);
  for (let done = 0; done < MESSAGES; done += 50_000) {
    await pool.query(
      `with senders as (select array_agg(id) a from users where username like 'load\\_${tag}\\_%')
       insert into messages (conversation_id, sender_id, body, created_at)
       select ($2::uuid[])[1 + (g % array_length($2::uuid[], 1))], (select a[1 + floor(random() * array_length(a, 1))::int] from senders),
              'generated message ' || g, now() - (random() * interval '7 days')
       from generate_series(1, $1) g`,
      [Math.min(50_000, MESSAGES - done), chats],
    );
  }
  await pool.query("update conversations set last_message_at = now() where id = any($1)", [chats]);
  await pool.query("analyze messages; analyze conversation_members; analyze constellation_members; analyze users");
  console.log(`messages inserted in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  console.log("\nRoute timings as a member (10 tries each):");
  await timeIt("GET /constellations/:id (detail)", 10, () => call(`/constellations/${cid}`, member.token));
  await timeIt("GET /constellations (my cards)", 10, () => call(`/constellations`, member.token));
  await timeIt("GET /constellations/:id/members (first page)", 10, () => call(`/constellations/${cid}/members?limit=100`, member.token));
  await timeIt("GET /constellations/:id/members?q=load 1", 10, () => call(`/constellations/${cid}/members?q=${encodeURIComponent("Load 1")}`, member.token));
  await timeIt("GET messages (newest page)", 10, () => call(`/conversations/${texts[0].conversation_id}/messages`, member.token));
  let i = 0;
  await timeIt("POST message (fan-out to every member)", 10, () => call(`/conversations/${texts[0].conversation_id}/messages`, member.token, "POST", { body: `load ${i++}` }));

  const someone = (await pool.query(`select id from users where username = 'load_${tag}_1'`)).rows[0].id;
  await explain(
    "unread counts for one person (detail, capped at 1,000 per nebula)",
    `select cm.conversation_id,
       (select count(*) from (select 1 from messages m where m.conversation_id = cm.conversation_id and m.created_at > cm.last_read_at and m.sender_id <> $1
          and m.event is null and m.deleted_at is null and (m.thread_id is null or m.also_in_nebula) order by m.created_at limit 1000) u),
       (select count(*) from (select 1 from messages m where m.conversation_id = cm.conversation_id and m.created_at > cm.last_read_at and m.sender_id <> $1
          and m.event is null and m.deleted_at is null and (m.mentions @> array[$1::uuid] or m.group_mentions @> array[$1::uuid]) limit 1000) x)
     from conversation_members cm where cm.user_id = $1 and cm.conversation_id = any($2)`,
    [someone, chats],
  );
  await explain(
    "member list page (by name)",
    `select u.id from constellation_members cm join users u on u.id = cm.user_id where cm.constellation_id = $1 and not u.bot order by lower(u.display_name), u.id limit 101`,
    [cid],
  );
  await explain("newest messages page", `select id from messages where conversation_id = $1 order by created_at desc limit 50`, [chats[0]]);
  console.log(`\nDone. Sign in as loadmember${tag} / Load-test-password-1 to look around. Remove with --clean.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
