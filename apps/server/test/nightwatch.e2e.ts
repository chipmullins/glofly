// Communities round 2: Night watch (mod dashboard, mod log, reports, bans + appeals, Safety:
// verification, raid protection, mention cap), against a real server with Postgres and Redis.
// Run like integrations.e2e.ts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { createClient } from "redis";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const H = { "content-type": "application/json", "x-glofly-version": "0.9.0", "x-glofly-features": "threads" };
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");

let pool: pg.Pool;
async function call(path: string, opts: { method?: string; body?: unknown; token?: string; raw?: boolean } = {}) {
  const headers: Record<string, string> = { ...H };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(URL_ + path, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json, text };
}
type Acct = { id: string; token: string };
const made: string[] = [];
async function account(name: string): Promise<Acct> {
  const username = `${name}${tag}`;
  const r = await call("/auth/register", {
    method: "POST",
    body: { email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthday: "1995-05-14", acceptTerms: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  made.push(r.json.user.id);
  return { id: r.json.user.id as string, token: r.json.token as string };
}
const age = (u: Acct, days: number) => pool.query("update users set created_at = now() - make_interval(days => $2), email_verified_at = now() where id = $1", [u.id, days]);

let owner: Acct, mod: Acct, riley: Acct, sam: Acct, troll: Acct;
let cid: string;
let general: { id: string; conversationId: string };
let code: string;
const send = (conversationId: string, body: string, token: string) => call(`/conversations/${conversationId}/messages`, { method: "POST", token, body: { body } });
const join = (u: Acct) => call(`/constellations/links/${code}/join`, { method: "POST", token: u.token });

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  owner = await account("nwowner");
  mod = await account("nwmod");
  riley = await account("nwriley");
  sam = await account("nwsam");
  troll = await account("nwtroll");
  for (const u of [owner, mod, riley, sam, troll]) await age(u, 60);
  const c = await call("/constellations", { method: "POST", token: owner.token, body: { name: `Watch ${tag}`, template: "gaming" } });
  cid = c.json.constellation.id;
  general = c.json.constellation.nebulas.find((n: any) => n.kind === "text");
  const link = await call(`/constellations/${cid}/links`, { method: "POST", token: owner.token, body: { lifetime: "7d" } });
  code = link.json.link.code;
  for (const u of [mod, riley, sam, troll]) assert.equal((await join(u)).status, 200);
  const roles = (await call(`/constellations/${cid}`, { token: owner.token })).json.constellation.roles;
  const modRole = roles.find((r: any) => r.kind === "moderator");
  const r = await call(`/constellations/${cid}/members/${mod.id}/roles`, { method: "PUT", token: owner.token, body: { roleIds: [modRole.id] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.query("delete from users where id = any($1)", [made]);
  await pool.end();
});

test("Night watch is for moderators; members get 403", { skip }, async () => {
  assert.equal((await call(`/constellations/${cid}/watch`, { token: riley.token })).status, 403);
  const w = await call(`/constellations/${cid}/watch`, { token: mod.token });
  assert.equal(w.status, 200);
  assert.equal(w.json.safety.raidOn, true);
  assert.equal(w.json.can.safety, false);
  const d = (await call(`/constellations/${cid}`, { token: mod.token })).json.constellation;
  assert.deepEqual(d.watch, { open: 0, pausedUntil: null });
  assert.equal((await call(`/constellations/${cid}`, { token: riley.token })).json.constellation.watch, null);
});

test("a report lands in the queue; delete + time out resolves it and logs it", { skip }, async () => {
  const m = await send(general.conversationId, "nobody wants you here", troll.token);
  assert.equal(m.status, 201);
  // Older apps' Report (to the Glofly team) also reaches the moderators; a second reporter adds to it.
  const r1 = await call("/reports", { method: "POST", token: riley.token, body: { messageId: m.json.message.id, conversationId: general.conversationId, reason: "harassment" } });
  assert.equal(r1.status, 201, JSON.stringify(r1.json));
  const r2 = await call(`/constellations/${cid}/reports`, { method: "POST", token: sam.token, body: { messageId: m.json.message.id, reason: "harassment" } });
  assert.equal(r2.status, 200);
  assert.equal((await call(`/constellations/${cid}/reports`, { method: "POST", token: troll.token, body: { messageId: m.json.message.id, reason: "spam" } })).status, 400);
  const w = (await call(`/constellations/${cid}/watch`, { token: mod.token })).json;
  const item = w.queue.find((q: any) => q.kind === "report");
  assert.equal(item.reportCount, 2);
  assert.equal(item.excerpt, "nobody wants you here");
  assert.equal(item.messageLive, true);
  const done = await call(`/constellations/${cid}/reports/${item.id}/resolve`, { method: "POST", token: mod.token, body: { action: "delete_timeout", length: "1h" } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.queue.filter((q: any) => q.kind === "report").length, 0);
  assert.equal((await call(`/constellations/${cid}/reports/${item.id}/resolve`, { method: "POST", token: mod.token, body: { action: "dismiss" } })).status, 400);
  const log = (await call(`/constellations/${cid}/modlog?filter=timeouts`, { token: mod.token })).json.entries;
  assert.equal(log[0].action, "timed_out");
  assert.equal(log[0].canUndo, true);
  const undo = await call(`/constellations/${cid}/modlog/${log[0].id}/undo`, { method: "POST", token: mod.token });
  assert.equal(undo.status, 200);
  assert.equal(undo.json.entry.canUndo, false);
  assert.equal((await send(general.conversationId, "sorry", troll.token)).status, 201);
});

test("mention cap: too many pings are held and the sender is timed out", { skip }, async () => {
  const pings = ["nwowner", "nwmod", "nwriley", "nwsam"].map((n) => `@${n}${tag}`).join(" ");
  // 4 people: under the default cap of 5.
  assert.equal((await send(general.conversationId, `hey ${pings}`, troll.token)).status, 201);
  const set = await call(`/constellations/${cid}/safety`, { method: "PUT", token: owner.token, body: { mentionCap: 3 } });
  assert.equal(set.status, 200);
  const r = await send(general.conversationId, `hey ${pings}`, troll.token);
  assert.equal(r.status, 403);
  assert.match(r.json.message, /mentions 4 people/);
  const w = (await call(`/constellations/${cid}/watch`, { token: mod.token })).json;
  const held = w.queue.find((q: any) => q.kind === "held" && q.reason === "mentions");
  assert.ok(held);
  const me = (await call(`/constellations/${cid}`, { token: troll.token })).json.constellation.me;
  assert.ok(me.timedOutUntil);
  // Moderators are never capped.
  assert.equal((await send(general.conversationId, `team ${pings}`, mod.token)).status, 201);
  assert.equal((await call(`/constellations/${cid}/held/${held.id}/keep`, { method: "POST", token: mod.token })).status, 200);
  await pool.query("update constellation_members set timed_out_until = null where constellation_id = $1 and user_id = $2", [cid, troll.id]);
});

test("verification: Low needs a confirmed email; skip roles and moderators pass", { skip }, async () => {
  await pool.query("update users set email_verified_at = null where id = $1", [sam.id]);
  assert.equal((await call(`/constellations/${cid}/safety`, { method: "PUT", token: mod.token, body: { verification: "low" } })).status, 403);
  assert.equal((await call(`/constellations/${cid}/safety`, { method: "PUT", token: owner.token, body: { verification: "low" } })).status, 200);
  const r = await send(general.conversationId, "hello", sam.token);
  assert.equal(r.status, 403);
  assert.match(r.json.message, /Confirm your email/);
  const d = (await call(`/constellations/${cid}`, { token: sam.token })).json.constellation;
  assert.match(d.me.verification, /Confirm your email/);
  // Medium: account age
  await pool.query("update users set email_verified_at = now(), created_at = now() - interval '2 days' where id = $1", [sam.id]);
  await call(`/constellations/${cid}/safety`, { method: "PUT", token: owner.token, body: { verification: "medium" } });
  assert.match((await send(general.conversationId, "hello", sam.token)).json.message, /after 7 days/);
  await call(`/constellations/${cid}/safety`, { method: "PUT", token: owner.token, body: { verification: "off" } });
  assert.equal((await send(general.conversationId, "hello", sam.token)).status, 201);
  await age(sam, 60);
});

test("raid protection pauses joins and holds the raiders' messages", { skip }, async () => {
  await call(`/constellations/${cid}/safety`, { method: "PUT", token: owner.token, body: { raidJoins: 5, raidSeconds: 60, raidAccountDays: 7 } });
  const raiders: Acct[] = [];
  await clearSignupLimit();
  for (let i = 0; i < 6; i++) raiders.push(await account(`nwraid${i}`));
  for (let i = 0; i < 5; i++) assert.equal((await join(raiders[i])).status, 200);
  const sixth = await join(raiders[5]);
  assert.equal(sixth.status, 403);
  assert.equal(sixth.json.error, "joins_paused");
  const w = (await call(`/constellations/${cid}/watch`, { token: mod.token })).json;
  assert.ok(w.raid.pausedUntil);
  assert.equal(w.raid.heldJoiners, 5);
  const held = await send(general.conversationId, "raid raid raid", raiders[0].token);
  assert.equal(held.status, 403);
  assert.match(held.json.message, /waiting for a moderator/);
  const log = (await call(`/constellations/${cid}/modlog?actor=safety`, { token: mod.token })).json.entries;
  assert.equal(log[0].action, "joins_locked");
  assert.equal(log[0].by, "safety");
  const joiners = (await call(`/constellations/${cid}/raid/joiners`, { token: mod.token })).json.joiners;
  assert.equal(joiners.length, 5);
  assert.equal((await call(`/constellations/${cid}/raid/kick`, { method: "POST", token: mod.token, body: { userIds: [raiders[1].id, raiders[2].id] } })).json.kicked, 2);
  assert.equal((await call(`/constellations/${cid}/raid/clear`, { method: "POST", token: mod.token, body: {} })).json.cleared, 3);
  assert.equal((await send(general.conversationId, "ok sorry", raiders[0].token)).status, 201);
  // Reopen through the log's Undo, then the sixth can join.
  assert.equal(log[0].canUndo, false); // a moderator without settings or Ban can't
  const ownerLog = (await call(`/constellations/${cid}/modlog?actor=safety`, { token: owner.token })).json.entries;
  assert.equal(ownerLog[0].canUndo, true);
  assert.equal((await call(`/constellations/${cid}/modlog/${ownerLog[0].id}/undo`, { method: "POST", token: owner.token })).status, 200);
  assert.equal((await join(raiders[5])).status, 200);
  await call(`/constellations/${cid}/safety`, { method: "PUT", token: owner.token, body: { raidJoins: 15 } });
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  await redis.del(`raid:joins:${cid}`);
  await redis.quit();
});

test("bans: reason, deleting recent messages, appeals after 7 days, accept invites them back", { skip }, async () => {
  const m = await send(general.conversationId, "spoiler: everyone dies", troll.token);
  const ban = await call(`/constellations/${cid}/members/${troll.id}/ban`, {
    method: "POST",
    token: owner.token,
    body: { reason: "Spoilers", appeals: "later", deleteWindow: "1h" },
  });
  assert.equal(ban.status, 200, JSON.stringify(ban.json));
  const gone = await pool.query("select deleted_at from messages where id = $1", [m.json.message.id]);
  assert.ok(gone.rows[0].deleted_at);
  const mine = (await call("/constellations/bans/mine", { token: troll.token })).json.bans;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].reason, "Spoilers");
  assert.equal(mine[0].appeals, "later");
  const early = await call(`/constellations/${cid}/appeal`, { method: "POST", token: troll.token, body: { body: "please" } });
  assert.equal(early.status, 403);
  await pool.query("update constellation_bans set created_at = created_at - interval '8 days' where constellation_id = $1 and user_id = $2", [cid, troll.id]);
  const ok = await call(`/constellations/${cid}/appeal`, { method: "POST", token: troll.token, body: { body: "I get it now." } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal((await call(`/constellations/${cid}/appeal`, { method: "POST", token: troll.token, body: { body: "again" } })).status, 409);
  // Moderators without Ban don't see appeals; with it they do.
  assert.equal((await call(`/constellations/${cid}/appeals`, { token: riley.token })).status, 403);
  const appeals = (await call(`/constellations/${cid}/appeals`, { token: owner.token })).json.appeals;
  assert.equal(appeals[0].body, "I get it now.");
  assert.equal(appeals[0].number, 1);
  assert.equal(appeals[0].ban.reason, "Spoilers");
  const decided = await call(`/constellations/${cid}/appeals/${appeals[0].id}`, { method: "POST", token: owner.token, body: { decision: "accept", reply: "Welcome back" } });
  assert.equal(decided.status, 200, JSON.stringify(decided.json));
  assert.equal((await call("/constellations/bans/mine", { token: troll.token })).json.bans.length, 0);
  const dash = (await call("/constellations", { token: troll.token })).json;
  assert.ok(JSON.stringify(dash).includes(cid), "invited back");
});

test("mod log: filters, search and a CSV that can't run formulas", { skip }, async () => {
  await call(`/constellations/${cid}/members/${riley.id}/timeout`, { method: "POST", token: mod.token, body: { length: "5m", reason: "=HYPERLINK(\"x\")" } });
  const bans = (await call(`/constellations/${cid}/modlog?filter=bans`, { token: mod.token })).json.entries;
  assert.ok(bans.every((e: any) => ["banned", "unbanned", "appeal_accepted", "appeal_denied"].includes(e.action)));
  const found = (await call(`/constellations/${cid}/modlog?q=nwriley`, { token: mod.token })).json.entries;
  assert.ok(found.length >= 1 && found.every((e: any) => e.target?.id === riley.id || e.actor?.id === riley.id));
  const csv = await call(`/constellations/${cid}/modlog/export`, { token: mod.token });
  assert.equal(csv.status, 200);
  assert.ok(csv.json.csv.startsWith("time,by,action,member,reason,details"));
  assert.ok(csv.json.csv.includes(`"'=HYPERLINK(""x"")"`), csv.json.csv.slice(0, 600));
  assert.equal((await call(`/constellations/${cid}/modlog/export`, { token: riley.token })).status, 403);
});
