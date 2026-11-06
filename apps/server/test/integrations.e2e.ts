// Communities round (Nov 2026): constellation API keys + the bot API, against a real server with
// real Postgres and Redis. Not part of `npm test` (it needs a running server):
//
//   npm run dev -w apps/server            (in one terminal; a dev database, never production)
//   GLOFLY_E2E_URL=http://localhost:4000 npx tsx --env-file=../../.env --test test/integrations.e2e.ts
//
// It makes its own throwaway accounts and constellation each run.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const H = { "content-type": "application/json", "x-glofly-version": "0.9.0" };
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");

let pool: pg.Pool;

async function call(path: string, opts: { method?: string; body?: unknown; token?: string; bot?: string; auth?: string } = {}) {
  const headers: Record<string, string> = { ...H };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.bot) headers.authorization = `Bot ${opts.bot}`;
  if (opts.auth) headers.authorization = opts.auth;
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
  const r = await call("/auth/register", {
    method: "POST",
    body: { email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthday: "1995-05-14", acceptTerms: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.user.id as string, token: r.json.token as string, username };
}

let owner: { id: string; token: string; username: string };
let helper: { id: string; token: string; username: string };
let cid: string;
let general: { id: string; conversationId: string };
let other: { id: string };
let adminRole: string;
let modRole: string;

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  owner = await account("owner");
  helper = await account("helper");
  const made = await call("/constellations", { method: "POST", token: owner.token, body: { name: `E2E ${tag}`, template: "gaming" } });
  assert.equal(made.status, 201);
  cid = made.json.constellation.id;
  const view = await call(`/constellations/${cid}`, { token: owner.token });
  const texts = view.json.constellation.nebulas.filter((n: any) => n.kind === "text");
  general = texts[0];
  other = texts[1];
  const roles = await pool.query("select id, kind from constellation_roles where constellation_id = $1", [cid]);
  adminRole = roles.rows.find((r) => r.kind === "admin").id;
  modRole = roles.rows.find((r) => r.kind === "moderator").id;
  // The helper joins with the Moderator role (straight into the database: joining isn't what's tested).
  await pool.query("insert into constellation_members (constellation_id, user_id, joined_at, welcomed_at) values ($1, $2, now(), now())", [cid, helper.id]);
  await pool.query("insert into constellation_member_roles (constellation_id, user_id, role_id) values ($1, $2, $3)", [cid, helper.id, modRole]);
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.end();
});

const newKey = (body: Record<string, unknown>, token = owner.token) =>
  call(`/constellations/${cid}/integrations/keys`, { method: "POST", token, body: { roleId: null, scopes: [], lifetime: "never", password: PASSWORD, ...body } });

test("only managers see Integrations; making a key needs the password", { skip }, async () => {
  const asMod = await call(`/constellations/${cid}/integrations`, { token: helper.token });
  assert.equal(asMod.status, 403);
  const wrong = await newKey({ name: "Nope", password: "not-it" });
  assert.equal(wrong.status, 403);
  const noPassword = await newKey({ name: "Nope", password: undefined });
  assert.equal(noPassword.status, 403);
});

let secret: string;
let keyId: string;
let botId: string;

test("a key is shown once and only its hash is stored", { skip }, async () => {
  const r = await newKey({ name: "Whitelist", roleId: modRole, scopes: ["members:read", "messages:write"], postNebulaIds: [general.id] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  secret = r.json.secret;
  keyId = r.json.key.id;
  botId = r.json.key.bot.id;
  assert.match(secret, /^gfk_[A-Za-z0-9_-]{43}$/);
  assert.equal(r.json.key.prefix, secret.slice(0, 12));
  assert.equal(r.json.key.roleId, modRole);
  const list = await call(`/constellations/${cid}/integrations`, { token: owner.token });
  assert.equal(list.status, 200);
  assert.ok(!JSON.stringify(list.json).includes(secret), "the list never contains the secret");
  const row = await pool.query("select key_hash from constellation_api_keys where id = $1", [keyId]);
  assert.notEqual(row.rows[0].key_hash, secret);
  assert.equal(row.rows[0].key_hash.length, 64);
  const bot = await pool.query("select bot, password_hash from users where id = $1", [botId]);
  assert.equal(bot.rows[0].bot, true);
});

test("the bot API takes only keys, and keys work nowhere else", { skip }, async () => {
  const me = await call("/api/v1/me", { bot: secret });
  assert.equal(me.status, 200);
  assert.equal(me.json.constellation.id, cid);
  assert.deepEqual(me.json.scopes.sort(), ["members:read", "messages:write"]);
  assert.equal((await call("/api/v1/me", { token: owner.token })).status, 401, "a session token is not a key");
  assert.equal((await call("/api/v1/me", { auth: `Bearer ${secret}` })).status, 401, "a key must be sent as Bot");
  assert.equal((await call("/constellations", { token: secret })).status, 401, "a key is not a session token");
});

test("member lookups: roles for members, 404 for everyone else, every use logged", { skip }, async () => {
  const found = await call(`/api/v1/members/${helper.id}`, { bot: secret });
  assert.equal(found.status, 200);
  assert.equal(found.json.member.username, helper.username);
  assert.deepEqual(found.json.member.roles.map((r: any) => r.id), [modRole]);
  assert.equal(found.json.member.email, undefined);
  const stranger = await account("stranger");
  assert.equal((await call(`/api/v1/members/${stranger.id}`, { bot: secret })).status, 404);
  assert.equal((await call(`/api/v1/members/not-an-id`, { bot: secret })).status, 404);
  const roles = await call("/api/v1/roles", { bot: secret });
  assert.equal(roles.status, 200);
  assert.ok(roles.json.roles.some((r: any) => r.id === adminRole));
  const activity = await call(`/constellations/${cid}/integrations/activity`, { token: owner.token });
  const actions = activity.json.items.map((i: any) => i.action);
  assert.ok(actions.includes("member.lookup"));
  assert.ok(actions.includes("key.created"));
});

test("posting: only picked nebulas, as the bot, through the normal message path", { skip }, async () => {
  const ok = await call(`/api/v1/nebulas/${general.id}/messages`, { method: "POST", bot: secret, body: { text: "Server restarting in 5 minutes" } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const msg = await pool.query("select body from messages where conversation_id = $1 and sender_id = $2", [general.conversationId, botId]);
  assert.equal(msg.rows[0]?.body, "Server restarting in 5 minutes");
  const elsewhere = await call(`/api/v1/nebulas/${other.id}/messages`, { method: "POST", bot: secret, body: { text: "hi" } });
  assert.equal(elsewhere.status, 403);
  const empty = await call(`/api/v1/nebulas/${general.id}/messages`, { method: "POST", bot: secret, body: { text: "   " } });
  assert.equal(empty.status, 400);
});

test("a frozen constellation: the bot can read but not post", { skip }, async () => {
  await pool.query("update constellations set frozen_at = now() where id = $1", [cid]);
  try {
    assert.equal((await call(`/api/v1/members/${helper.id}`, { bot: secret })).status, 200);
    const post = await call(`/api/v1/nebulas/${general.id}/messages`, { method: "POST", bot: secret, body: { text: "hi" } });
    assert.equal(post.status, 403);
    assert.equal((await newKey({ name: "Frozen" })).status, 403);
  } finally {
    await pool.query("update constellations set frozen_at = null where id = $1", [cid]);
  }
});

test("missing scopes and other addresses are refused (and logged)", { skip }, async () => {
  const narrow = await newKey({ name: "Narrow", scopes: [] });
  assert.equal(narrow.status, 201);
  assert.equal((await call(`/api/v1/members/${helper.id}`, { bot: narrow.json.secret })).status, 403);
  const fenced = await newKey({ name: "Fenced", scopes: ["members:read"], allowedIps: ["203.0.113.24"] });
  assert.equal(fenced.status, 201);
  const refused = await call("/api/v1/me", { bot: fenced.json.secret });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, "address_not_allowed");
  assert.equal((await newKey({ name: "Bad", allowedIps: ["not an ip"] })).status, 400);
  const activity = await call(`/constellations/${cid}/integrations/activity`, { token: owner.token });
  const actions = activity.json.items.map((i: any) => i.action);
  assert.ok(actions.includes("refused.scope") && actions.includes("refused.address"));
  for (const k of [narrow, fenced]) await call(`/constellations/${cid}/integrations/keys/${k.json.key.id}`, { method: "DELETE", token: owner.token });
});

test("rank rules: a moderator with settings rights can't give a bot a role at or above theirs", { skip }, async () => {
  await pool.query("update constellation_roles set permissions = array_append(permissions, 'manageConstellation') where id = $1", [modRole]);
  try {
    const high = await newKey({ name: "Too high", roleId: adminRole }, helper.token);
    assert.equal(high.status, 400);
    const same = await newKey({ name: "Same", roleId: modRole }, helper.token);
    assert.equal(same.status, 400);
    const change = await call(`/constellations/${cid}/integrations/keys/${keyId}`, { method: "PATCH", token: helper.token, body: { name: "Mine now", password: PASSWORD } });
    assert.equal(change.status, 403, "the Whitelist bot holds Moderator, the helper's own rank");
  } finally {
    await pool.query("update constellation_roles set permissions = array_remove(permissions, 'manageConstellation') where id = $1", [modRole]);
  }
});

test("bots never sign in and never show up in search", { skip }, async () => {
  const bot = await pool.query("select username, email from users where id = $1", [botId]);
  for (const identifier of [bot.rows[0].username, bot.rows[0].email]) {
    const r = await call("/auth/login", { method: "POST", body: { identifier, password: "!bot", twoStepAware: true } });
    assert.equal(r.status, 401);
  }
  const search = await call(`/friends/search?q=${encodeURIComponent(bot.rows[0].username)}`, { token: owner.token });
  assert.ok(!JSON.stringify(search.json).includes(botId));
  const req = await call("/friends/requests", { method: "POST", token: owner.token, body: { username: bot.rows[0].username } });
  assert.equal(req.status, 404);
});

test("rate limit per key", { skip }, async () => {
  const k = await newKey({ name: "Busy", scopes: [] });
  let last = 0;
  for (let i = 0; i < 121; i++) last = (await call("/api/v1/me", { bot: k.json.secret })).status;
  assert.equal(last, 429);
  await call(`/constellations/${cid}/integrations/keys/${k.json.key.id}`, { method: "DELETE", token: owner.token });
});

test("reset: the old key stops working at once; delete: the bot leaves", { skip }, async () => {
  const reset = await call(`/constellations/${cid}/integrations/keys/${keyId}/reset`, { method: "POST", token: owner.token, body: { password: PASSWORD } });
  assert.equal(reset.status, 200);
  assert.equal((await call("/api/v1/me", { bot: secret })).status, 401);
  assert.equal((await call("/api/v1/me", { bot: reset.json.secret })).status, 200);
  const del = await call(`/constellations/${cid}/integrations/keys/${keyId}`, { method: "DELETE", token: owner.token });
  assert.equal(del.status, 200);
  assert.equal((await call("/api/v1/me", { bot: reset.json.secret })).status, 401);
  const still = await pool.query("select 1 from constellation_members where constellation_id = $1 and user_id = $2", [cid, botId]);
  assert.equal(still.rowCount, 0);
  const msgs = await pool.query("select 1 from messages where sender_id = $1", [botId]);
  assert.equal(msgs.rowCount, 1, "its messages stay");
});
