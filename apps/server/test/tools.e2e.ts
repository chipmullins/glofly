// Communities round (Nov 2026): Glofly tools (welcome, logging, button roles, tickets, giveaways),
// against a real server with real Postgres and Redis. Not part of `npm test`. The giveaway test
// waits for the server's one-minute sweep, so this file takes about a minute.
//
//   npm run dev -w apps/server
//   GLOFLY_E2E_URL=http://localhost:4000 npx tsx --env-file=../../.env --test test/tools.e2e.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const H = { "content-type": "application/json", "x-glofly-version": "0.9.0" };
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");
let pool: pg.Pool;

async function call(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
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
  return { status: r.status, json };
}
async function account(name: string) {
  const username = `${name}${tag}`;
  const r = await call("/auth/register", { method: "POST", body: { email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthday: "1995-05-14", acceptTerms: true } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.user.id as string, token: r.json.token as string, username };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 5000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v as T;
    await sleep(150);
  }
  throw new Error("Timed out waiting");
}

let owner: { id: string; token: string; username: string };
let player: { id: string; token: string; username: string };
let other: { id: string; token: string; username: string };
let cid: string;
let general: { id: string; conversationId: string };
let staffLog: { id: string; conversationId: string };
let modRole: string;
let code: string;

const lastBody = async (conversationId: string) => (await pool.query("select body, buttons, id from messages where conversation_id = $1 order by created_at desc limit 1", [conversationId])).rows[0];

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  owner = await account("toolowner");
  player = await account("toolplayer");
  other = await account("toolother");
  const made = await call("/constellations", { method: "POST", token: owner.token, body: { name: `Tools ${tag}`, template: "gaming" } });
  cid = made.json.constellation.id;
  general = made.json.constellation.nebulas.find((n: any) => n.kind === "text") ?? (await call(`/constellations/${cid}`, { token: owner.token })).json.constellation.nebulas.find((n: any) => n.kind === "text");
  modRole = (await pool.query("select id from constellation_roles where constellation_id = $1 and kind = 'moderator'", [cid])).rows[0].id;
  const n = await call(`/constellations/${cid}/nebulas`, { method: "POST", token: owner.token, body: { name: "staff-logs", kind: "text", visibility: "roles", roleIds: [modRole] } });
  assert.equal(n.status, 201, JSON.stringify(n.json));
  staffLog = n.json.constellation.nebulas.find((x: any) => x.id === n.json.nebulaId);
  code = (await call(`/constellations/${cid}/links`, { method: "POST", token: owner.token, body: { lifetime: "7d" } })).json.link.code;
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.end();
});

test("only managers set up tools; settings must point inside the constellation", { skip }, async () => {
  assert.equal((await call(`/constellations/${cid}/tools`, { token: player.token })).status, 404, "not even a member yet");
  const r = await call(`/constellations/${cid}/tools/welcome`, { method: "PUT", token: owner.token, body: { enabled: true, settings: { nebulaId: "00000000-0000-4000-8000-000000000000", message: "hi" } } });
  assert.equal(r.status, 400);
  assert.equal((await call(`/constellations/${cid}/tools/logging`, { method: "PUT", token: owner.token, body: { enabled: true } })).status, 400, "set it up first");
});

test("welcome + logging: a newcomer is greeted, and staff see it in a role-only log nebula", { skip }, async () => {
  assert.equal((await call(`/constellations/${cid}/tools/welcome`, { method: "PUT", token: owner.token, body: { enabled: true, settings: { nebulaId: general.id, message: "Welcome, {name}! Read the rules." } } })).status, 200);
  assert.equal((await call(`/constellations/${cid}/tools/logging`, { method: "PUT", token: owner.token, body: { enabled: true, settings: { nebulaId: staffLog.id } } })).status, 200);
  assert.ok((await call(`/constellations/links/${code}/join`, { method: "POST", token: player.token })).status < 300);
  const welcome = await waitFor(async () => {
    const m = await lastBody(general.conversationId);
    return m?.body?.startsWith("Welcome, toolplayer") ? m : null;
  });
  const sender = await pool.query("select u.bot, u.username, u.display_name from messages m join users u on u.id = m.sender_id where m.id = $1", [welcome.id]);
  assert.equal(sender.rows[0].bot, true);
  assert.match(sender.rows[0].username, /^tool\./);
  assert.equal(sender.rows[0].display_name, "Glofly");
  await waitFor(async () => (await lastBody(staffLog.conversationId))?.body?.includes("joined"));
  // The player can't see the staff log.
  const sees = await pool.query("select 1 from conversation_members where conversation_id = $1 and user_id = $2", [staffLog.conversationId, player.id]);
  assert.equal(sees.rowCount, 0);
});

test("logging never copies message text", { skip }, async () => {
  const sent = await call(`/conversations/${general.conversationId}/messages`, { method: "POST", token: player.token, body: { body: "secret plans" } });
  assert.ok(sent.status < 300, JSON.stringify(sent.json));
  const id = sent.json.message?.id ?? sent.json.id;
  await call(`/conversations/${general.conversationId}/messages/${id}`, { method: "PATCH", token: player.token, body: { body: "new secret plans" } });
  const line = await waitFor(async () => {
    const m = await lastBody(staffLog.conversationId);
    return m?.body?.includes("edited a message") ? m : null;
  });
  assert.ok(!line.body.includes("secret"));
});

test("button roles: only pick-it-yourself roles; a click gives, a second click takes away", { skip }, async () => {
  const strong = await call(`/constellations/${cid}/tools/buttonRoles`, { method: "PUT", token: owner.token, body: { enabled: true, settings: { nebulaId: general.id, text: "Pick", roleIds: [modRole] } } });
  assert.equal(strong.status, 400, "Moderator can't be a button role");
  const made = await call(`/constellations/${cid}/roles`, { method: "POST", token: owner.token, body: { name: "Minecraft", color: "green", permissions: [], selfAssign: true } });
  assert.ok(made.status < 300, JSON.stringify(made.json));
  const mc = (await pool.query("select id from constellation_roles where constellation_id = $1 and name = 'Minecraft'", [cid])).rows[0].id;
  assert.equal((await call(`/constellations/${cid}/tools/buttonRoles`, { method: "PUT", token: owner.token, body: { enabled: true, settings: { nebulaId: general.id, text: "Pick what you play:", roleIds: [mc] } } })).status, 200);
  const post = await call(`/constellations/${cid}/tools/buttonRoles/post`, { method: "POST", token: owner.token });
  assert.equal(post.status, 201, JSON.stringify(post.json));
  const click = () => call(`/constellations/${cid}/messages/${post.json.messageId}/buttons/tool-role-${mc}`, { method: "POST", token: player.token });
  const on = await click();
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.match(on.json.message, /now have Minecraft/);
  assert.equal((await pool.query("select 1 from constellation_member_roles where user_id = $1 and role_id = $2", [player.id, mc])).rowCount, 1);
  const off = await click();
  assert.match(off.json.message, /don't have Minecraft/);
  assert.equal((await pool.query("select 1 from constellation_member_roles where user_id = $1 and role_id = $2", [player.id, mc])).rowCount, 0);
});

test("tickets: a private nebula for the opener and staff; closing takes the opener out", { skip }, async () => {
  await call(`/constellations/links/${code}/join`, { method: "POST", token: other.token });
  assert.equal((await call(`/constellations/${cid}/tools/tickets`, { method: "PUT", token: owner.token, body: { enabled: true, settings: { nebulaId: general.id, staffRoleId: modRole } } })).status, 200);
  const post = await call(`/constellations/${cid}/tools/tickets/post`, { method: "POST", token: owner.token });
  assert.equal(post.status, 201);
  const open = await call(`/constellations/${cid}/messages/${post.json.messageId}/buttons/tool-ticket-open`, { method: "POST", token: player.token });
  assert.equal(open.status, 200, JSON.stringify(open.json));
  const t = (await pool.query("select t.id, n.conversation_id, n.name from constellation_tickets t join nebulas n on n.id = t.nebula_id where t.constellation_id = $1 and t.opener_id = $2", [cid, player.id])).rows[0];
  assert.ok(t, "a ticket nebula exists");
  const members = async () => (await pool.query("select user_id from conversation_members where conversation_id = $1", [t.conversation_id])).rows.map((r) => r.user_id);
  assert.ok((await members()).includes(player.id));
  assert.ok(!(await members()).includes(other.id), "other members don't see it");
  // Only the opener or staff can close it.
  const closeId = `tool-ticket-close-${t.id}`;
  const firstMsg = (await pool.query("select id from messages where conversation_id = $1 and buttons is not null limit 1", [t.conversation_id])).rows[0].id;
  assert.equal((await call(`/constellations/${cid}/messages/${firstMsg}/buttons/${closeId}`, { method: "POST", token: other.token })).status, 404, "can't even see it");
  const closed = await call(`/constellations/${cid}/messages/${firstMsg}/buttons/${closeId}`, { method: "POST", token: player.token });
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  assert.ok(!(await members()).includes(player.id));
  const n = await pool.query("select read_only, name from nebulas where conversation_id = $1", [t.conversation_id]);
  assert.equal(n.rows[0].read_only, true);
  assert.match(n.rows[0].name, /^closed-/);
});

test("giveaways: enter once, the sweep picks a winner and announces it", { skip, timeout: 90_000 }, async () => {
  assert.equal((await call(`/constellations/${cid}/giveaways`, { method: "POST", token: owner.token, body: { nebulaId: general.id, prize: "Fennec", winners: 1, hours: 1, roleId: null } })).status, 400, "switched off");
  await call(`/constellations/${cid}/tools/giveaways`, { method: "PUT", token: owner.token, body: { enabled: true } });
  const g = await call(`/constellations/${cid}/giveaways`, { method: "POST", token: owner.token, body: { nebulaId: general.id, prize: "Fennec", winners: 1, hours: 1, roleId: null } });
  assert.equal(g.status, 201, JSON.stringify(g.json));
  const msg = (await pool.query("select message_id from constellation_giveaways where id = $1", [g.json.id])).rows[0].message_id;
  const enter = () => call(`/constellations/${cid}/messages/${msg}/buttons/tool-give-${g.json.id}`, { method: "POST", token: player.token });
  assert.match((await enter()).json.message, /You're in/);
  assert.match((await enter()).json.message, /already in/);
  await pool.query("update constellation_giveaways set ends_at = now() - interval '1 second' where id = $1", [g.json.id]);
  const done = await waitFor(async () => (await pool.query("select winner_ids from constellation_giveaways where id = $1 and ended_at is not null", [g.json.id])).rows[0], 75_000);
  assert.deepEqual(done.winner_ids, [player.id]);
  // The sweep marks it ended first, then posts the announcement: wait for that too.
  const announce = await waitFor(async () => {
    const m = await lastBody(general.conversationId);
    return /Giveaway ended: Fennec/.test(m?.body ?? "") ? m : null;
  }, 10_000);
  assert.match(announce.body, /Giveaway ended: Fennec/);
  assert.match((await enter()).json.message, /ended/);
});
