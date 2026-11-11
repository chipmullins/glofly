// Communities round 2: stage nebulas (start, speakers and listeners, hands, invites, moving down,
// listener chat, ending) and announcement nebulas (follow, copies, edits/deletes following along,
// no pings in copies, older apps), against a real server with Postgres and Redis.
//
// Stages need LiveKit settings, but not a LiveKit server: start the dev server with stand-ins, e.g.
//   LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=devsecret0123456789devsecret0123456789
// (passes are checked by reading their grants; nothing connects to them).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const H = { "x-glofly-version": "0.9.0", "x-glofly-features": "threads, round2" };
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");

let pool: pg.Pool;
async function call(path: string, opts: { method?: string; body?: unknown; token?: string; old?: boolean } = {}) {
  const headers: Record<string, string> = { ...H, "content-type": "application/json" };
  if (opts.old) headers["x-glofly-features"] = "threads";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(URL_ + path, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: r.status, json };
}
type Acct = { id: string; token: string; username: string };
const made: string[] = [];
async function account(name: string): Promise<Acct> {
  const username = `${name}${tag}`;
  const r = await call("/auth/register", { method: "POST", body: { email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthday: "1995-05-14", acceptTerms: true } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  made.push(r.json.user.id);
  return { id: r.json.user.id, token: r.json.token, username };
}
const grants = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));

let owner: Acct, mod: Acct, member: Acct, listener: Acct, partner: Acct;
let cid: string, pid: string;
let stage: any, news: any, partnerNews: any;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  owner = await account("stowner");
  mod = await account("stmod");
  member = await account("stmember");
  listener = await account("stlisten");
  partner = await account("stpartner");
  const c = await call("/constellations", { method: "POST", token: owner.token, body: { name: `Stage ${tag}`, template: "gaming" } });
  cid = c.json.constellation.id;
  const link = await call(`/constellations/${cid}/links`, { method: "POST", token: owner.token, body: { lifetime: "7d" } });
  for (const u of [mod, member, listener]) await call(`/constellations/links/${link.json.link.code}/join`, { method: "POST", token: u.token });
  const roles = (await call(`/constellations/${cid}`, { token: owner.token })).json.constellation.roles;
  await call(`/constellations/${cid}/members/${mod.id}/roles`, { method: "PUT", token: owner.token, body: { roleIds: [roles.find((r: any) => r.kind === "moderator").id] } });
  const p = await call("/constellations", { method: "POST", token: partner.token, body: { name: `Partner ${tag}`, template: "gaming" } });
  pid = p.json.constellation.id;
  partnerNews = p.json.constellation.nebulas.find((n: any) => n.kind === "text");
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = any($1)", [[cid, pid]]);
  await pool.query("delete from users where id = any($1) or id in (select tool_bot_id from constellations where false)", [made]);
  await pool.end();
});

test("stage nebulas: made by managers, shown to older apps as read-only text", { skip }, async () => {
  const r = await call(`/constellations/${cid}/nebulas`, { method: "POST", token: owner.token, body: { name: "Town Hall", kind: "stage", stageSpeakerLimit: 2 } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  stage = r.json.constellation.nebulas.find((n: any) => n.kind === "stage");
  assert.equal(stage.name, "town-hall");
  assert.equal(stage.stageSpeakerLimit, 2);
  const old = await call(`/constellations/${cid}`, { token: member.token, old: true });
  const asOld = old.json.constellation.nebulas.find((n: any) => n.id === stage.id);
  assert.equal(asOld.kind, "text");
  assert.equal(asOld.readOnly, true);
  assert.match(asOld.topic, /Update Glofly/);
  assert.equal(old.json.constellation.stages, undefined);
});

test("stages: start, listen (receive-only pass), hands, invite up, speaker limit, move down, end", { skip }, async () => {
  const base = `/constellations/${cid}/nebulas/${stage.id}/stage`;
  // Members can't start one; a topic is needed.
  assert.equal((await call(base, { method: "POST", token: member.token, body: { topic: "Hi" } })).status, 403);
  assert.equal((await call(base, { method: "POST", token: mod.token, body: { topic: "  " } })).status, 400);
  const start = await call(base, { method: "POST", token: mod.token, body: { topic: "Season 3 town hall", listenerChat: false } });
  assert.equal(start.status, 201, JSON.stringify(start.json));
  assert.equal(start.json.role, "speaker");
  const sg = grants(start.json.token);
  assert.equal(sg.sub, mod.id);
  assert.equal(sg.video.canPublish, true);
  assert.equal(sg.video.room, start.json.room);
  assert.equal((await call(base, { method: "POST", token: owner.token, body: { topic: "Again" } })).status, 409);

  // A member listens: a pass that can't send anything, hidden, not their user id.
  const listen = await call(`${base}/join`, { method: "POST", token: member.token, body: { as: "listener" } });
  assert.equal(listen.status, 200, JSON.stringify(listen.json));
  const lg = grants(listen.json.token);
  assert.equal(lg.video.canPublish, false);
  assert.deepEqual(lg.video.canPublishSources ?? [], []);
  assert.equal(lg.video.hidden, true);
  assert.notEqual(lg.sub, member.id);
  assert.match(lg.sub, new RegExp(`^listen:${member.id}:`));
  // …and can't come up without being asked.
  assert.equal((await call(`${base}/join`, { method: "POST", token: member.token, body: { as: "speaker" } })).status, 403);

  // Listener chat is off: only speakers and managers post in the stage nebula.
  const chat = `/conversations/${stage.conversationId}/messages`;
  assert.equal((await call(chat, { method: "POST", token: member.token, body: { body: "hello" } })).status, 403);
  assert.equal((await call(chat, { method: "POST", token: mod.token, body: { body: "welcome" } })).status, 201);
  await call(base, { method: "PATCH", token: mod.token, body: { listenerChat: true } });
  assert.equal((await call(chat, { method: "POST", token: member.token, body: { body: "hello" } })).status, 201);

  // Raise a hand: managers see it, others only a count.
  await call(`${base}/join`, { method: "POST", token: listener.token, body: { as: "listener" } });
  assert.equal((await call(`${base}/hand`, { method: "POST", token: member.token, body: { up: true } })).status, 200);
  await wait(50);
  const seen = await call(base, { token: mod.token });
  assert.equal(seen.json.stage.handCount, 1);
  assert.equal(seen.json.stage.hands[0].userId, member.id);
  assert.equal(seen.json.stage.listenerCount, 2);
  const plain = await call(base, { token: listener.token });
  assert.equal(plain.json.stage.hands, undefined);
  assert.equal(plain.json.stage.handCount, 1);
  assert.equal(plain.json.me.role, "listener");
  // In the constellation's detail too.
  const detail = await call(`/constellations/${cid}`, { token: member.token });
  assert.equal(detail.json.constellation.stages[0].topic, "Season 3 town hall");

  // Invited up: they can join as a speaker now (their hand goes down).
  assert.equal((await call(`${base}/invite`, { method: "POST", token: member.token, body: { userId: listener.id } })).status, 403);
  assert.equal((await call(`${base}/invite`, { method: "POST", token: mod.token, body: { userId: member.id } })).status, 200);
  assert.equal((await call(base, { token: member.token })).json.me.role, "invited");
  const up = await call(`${base}/join`, { method: "POST", token: member.token, body: { as: "speaker" } });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.equal(grants(up.json.token).sub, member.id);
  assert.equal(up.json.me.role, "speaker");
  assert.equal(up.json.stage.speakers.length, 2);
  assert.equal(up.json.stage.handCount, 0);

  // The limit is 2: a third can't come up.
  await call(`${base}/invite`, { method: "POST", token: mod.token, body: { userId: listener.id } });
  assert.equal((await call(`${base}/join`, { method: "POST", token: listener.token, body: { as: "speaker" } })).status, 409);

  // Moved to the audience: a member can't move people, a manager can; the owner can't be moved.
  assert.equal((await call(`${base}/audience`, { method: "POST", token: member.token, body: { userId: mod.id } })).status, 403);
  assert.equal((await call(`${base}/audience`, { method: "POST", token: mod.token, body: { userId: member.id } })).status, 200);
  const after = await call(base, { token: member.token });
  assert.equal(after.json.stage.speakers.length, 1);
  assert.notEqual(after.json.me.role, "speaker");
  assert.equal((await call(`${base}/join`, { method: "POST", token: member.token, body: { as: "speaker" } })).status, 403);

  // Pings keep people on it; leaving takes them off.
  assert.equal((await call(`${base}/ping`, { method: "POST", token: listener.token, body: { as: "listener" } })).json.live, true);
  await call(`${base}/leave`, { method: "POST", token: listener.token });
  assert.equal((await call(base, { token: listener.token })).json.me.role, "invited");

  // Ended for everyone (and logged).
  assert.equal((await call(base, { method: "DELETE", token: member.token })).status, 403);
  assert.equal((await call(base, { method: "DELETE", token: mod.token })).status, 204);
  assert.equal((await call(base, { token: member.token })).json.stage, null);
  assert.equal((await call(`${base}/join`, { method: "POST", token: member.token, body: { as: "listener" } })).status, 409);
  const log = await pool.query("select action from constellation_audit_log where constellation_id = $1 and action like 'stage_%'", [cid]);
  assert.deepEqual(log.rows.map((r) => r.action).sort(), ["stage_ended", "stage_started"]);
  // Chat is open again once it's over.
  await call(base, { method: "PATCH", token: mod.token, body: { listenerChat: false } });
  assert.equal((await call(chat, { method: "POST", token: listener.token, body: { body: "after" } })).status, 201);
});

test("announcement nebulas: staff-only, followed by another constellation, copies follow edits and deletes", { skip }, async () => {
  const r = await call(`/constellations/${cid}/nebulas`, { method: "POST", token: owner.token, body: { name: "news", kind: "announcement", readOnly: false } });
  assert.equal(r.status, 201);
  news = r.json.constellation.nebulas.find((n: any) => n.kind === "announcement");
  assert.equal(news.readOnly, true);
  assert.equal(news.followers, 0);
  // Older apps: plain read-only text.
  const old = await call(`/constellations/${cid}`, { token: member.token, old: true });
  assert.equal(old.json.constellation.nebulas.find((n: any) => n.id === news.id).kind, "text");
  // Members can't post there.
  assert.equal((await call(`/conversations/${news.conversationId}/messages`, { method: "POST", token: member.token, body: { body: "hi" } })).status, 403);

  // The partner isn't a member and the constellation is private: they can't follow.
  assert.equal((await call(`/constellations/announcements/targets?nebulaId=${news.id}`, { token: partner.token })).status, 404);
  // Public now: they can, into a nebula of their own.
  await call(`/constellations/${cid}`, { method: "PATCH", token: owner.token, body: { visibility: "public", type: "gaming" } });
  const targets = await call(`/constellations/announcements/targets?nebulaId=${news.id}`, { token: partner.token });
  assert.equal(targets.status, 200, JSON.stringify(targets.json));
  assert.equal(targets.json.targets[0].constellationId, pid);
  // Not into a constellation where they can't manage nebulas.
  assert.equal((await call(`/constellations/${cid}/nebulas/${news.id}/follow`, { method: "POST", token: member.token, body: { targetNebulaId: partnerNews.id } })).status, 404);
  const f = await call(`/constellations/${cid}/nebulas/${news.id}/follow`, { method: "POST", token: partner.token, body: { targetNebulaId: partnerNews.id } });
  assert.equal(f.status, 201, JSON.stringify(f.json));
  assert.equal((await call(`/constellations/${cid}`, { token: owner.token })).json.constellation.nebulas.find((n: any) => n.id === news.id).followers, 1);
  const followers = await call(`/constellations/${cid}/nebulas/${news.id}/followers`, { token: owner.token });
  assert.equal(followers.json.followers[0].name, `Partner ${tag}`);
  assert.equal((await call(`/constellations/${cid}/nebulas/${news.id}/followers`, { token: member.token })).status, 403);

  // A post (with an @mention of a partner member) is copied in, without pinging anyone.
  const post = await call(`/conversations/${news.conversationId}/messages`, { method: "POST", token: owner.token, body: { body: `Season 3 starts Friday @${partner.username}` } });
  assert.equal(post.status, 201, JSON.stringify(post.json));
  await wait(600);
  const copies = await call(`/conversations/${partnerNews.conversationId}/messages`, { token: partner.token });
  const copy = copies.json.messages.find((m: any) => m.crosspost);
  assert.ok(copy, "copied");
  assert.equal(copy.body, `Season 3 starts Friday @${partner.username}`);
  assert.equal(copy.crosspost.constellationName, `Stage ${tag}`);
  assert.equal(copy.crosspost.nebulaName, "news");
  assert.equal(copy.crosspost.authorName, "stowner");
  assert.equal(copy.forwarded.where, `Stage ${tag} › #news`);
  assert.deepEqual(copy.mentions ?? [], []);
  assert.notEqual(copy.senderId, owner.id);

  // Edits and deletes follow along.
  await call(`/conversations/${news.conversationId}/messages/${post.json.message.id}`, { method: "PATCH", token: owner.token, body: { body: "Season 3 starts Saturday" } });
  await wait(600);
  let again = (await call(`/conversations/${partnerNews.conversationId}/messages`, { token: partner.token })).json.messages.find((m: any) => m.id === copy.id);
  assert.equal(again.body, "Season 3 starts Saturday");
  await call(`/conversations/${news.conversationId}/messages/${post.json.message.id}`, { method: "DELETE", token: owner.token });
  await wait(600);
  again = (await call(`/conversations/${partnerNews.conversationId}/messages`, { token: partner.token })).json.messages.find((m: any) => m.id === copy.id);
  assert.equal(again.deleted, true);

  // The follower unfollows; new posts aren't copied any more.
  const mine = await call(`/constellations/${pid}/follows`, { token: partner.token });
  assert.equal(mine.json.follows[0].sourceNebulaName, "news");
  assert.equal((await call(`/constellations/${pid}/follows/${mine.json.follows[0].followId}`, { method: "DELETE", token: partner.token })).status, 204);
  await call(`/conversations/${news.conversationId}/messages`, { method: "POST", token: owner.token, body: { body: "Nobody follows" } });
  await wait(600);
  const last = (await call(`/conversations/${partnerNews.conversationId}/messages`, { token: partner.token })).json.messages;
  assert.ok(!last.some((m: any) => m.body === "Nobody follows"));
});
