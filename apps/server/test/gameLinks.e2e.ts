// Communities round (Nov 2026): Linked game servers (link codes), against a real server with
// real Postgres and Redis. Not part of `npm test` (it needs a running server):
//
//   npm run dev -w apps/server            (in one terminal; a dev database, never production)
//   GLOFLY_E2E_URL=http://localhost:4000 npx tsx --env-file=../../.env --test test/gameLinks.e2e.ts
//
// It makes its own throwaway accounts and constellation each run.
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
let player: { id: string; token: string; username: string };
let outsider: { id: string; token: string; username: string };
let cid: string;
let modRole: string;
let key: string;
let noLinkKey: string;

const LICENSE = "license:" + randomBytes(20).toString("hex");
const MC = randomBytes(16).toString("hex");

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  owner = await account("owner");
  player = await account("riley");
  outsider = await account("other");
  const made = await call("/constellations", { method: "POST", token: owner.token, body: { name: `Cozy ${tag}`, template: "gaming" } });
  assert.equal(made.status, 201);
  cid = made.json.constellation.id;
  const roles = await pool.query("select id, kind from constellation_roles where constellation_id = $1", [cid]);
  modRole = roles.rows.find((r) => r.kind === "moderator").id;
  await pool.query("insert into constellation_members (constellation_id, user_id, joined_at, welcomed_at) values ($1, $2, now(), now())", [cid, player.id]);
  await pool.query("insert into constellation_member_roles (constellation_id, user_id, role_id) values ($1, $2, $3)", [cid, player.id, modRole]);
  const k = await call(`/constellations/${cid}/integrations/keys`, { method: "POST", token: owner.token, body: { name: "FiveM", roleId: null, scopes: ["link"], lifetime: "never", password: PASSWORD } });
  assert.equal(k.status, 201, JSON.stringify(k.json));
  key = k.json.secret;
  const k2 = await call(`/constellations/${cid}/integrations/keys`, { method: "POST", token: owner.token, body: { name: "Chat", roleId: null, scopes: [], lifetime: "never", password: PASSWORD } });
  noLinkKey = k2.json.secret;
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.query("delete from users where id = any($1)", [[owner.id, player.id, outsider.id]]);
  await pool.end();
});

const lookup = (body: Record<string, unknown>, bot = key) => call("/api/v1/links/lookup", { method: "POST", bot, body });

let code: string;

test("a server needs the link permission and a real identity", { skip }, async () => {
  assert.equal((await lookup({ game: "fivem", identity: LICENSE }, noLinkKey)).status, 403);
  assert.equal((await lookup({ game: "fivem", identity: "steam:110000112345678" })).status, 400);
  assert.equal((await lookup({ game: "minecraft", identity: "not-a-uuid" })).status, 400);
});

test("an unlinked player gets the same code until it runs out; only its hash is stored", { skip }, async () => {
  const a = await lookup({ game: "fivem", identity: LICENSE, playerName: "Riley_Carter\u202e", identities: ["discord:123456789012345678", "ip:1.2.3.4"] });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.linked, false);
  assert.match(a.json.code, /^\d{3}-\d{3}$/);
  const b = await lookup({ game: "fivem", identity: LICENSE.toUpperCase().replace("LICENSE", "license") });
  assert.equal(b.json.code, a.json.code);
  code = a.json.code;
  const rows = await pool.query("select code_hash, player_name, extra_ids from game_link_codes where constellation_id = $1", [cid]);
  assert.equal(rows.rows.length, 1);
  assert.notEqual(rows.rows[0].code_hash, code.replace("-", ""));
  assert.equal(rows.rows[0].player_name, "Riley_Carter");
  assert.deepEqual(rows.rows[0].extra_ids, ["discord:123456789012345678"]);
});

test("entering a code: wrong codes, outsiders and the preview", { skip }, async () => {
  const wrong = await call("/account/game-links/preview", { method: "POST", token: player.token, body: { code: "000-000" === code ? "000-001" : "000-000" } });
  assert.equal(wrong.status, 404);
  const p = await call("/account/game-links/preview", { method: "POST", token: player.token, body: { code: code.replace("-", " ") } });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.equal(p.json.preview.playerName, "Riley_Carter");
  assert.equal(p.json.preview.member, true);
  assert.equal(p.json.preview.game, "fivem");
  assert.match(p.json.preview.serverName, /'s FiveM server$/);
  const notMember = await call("/account/game-links", { method: "POST", token: outsider.token, body: { code } });
  assert.equal(notMember.status, 403);
});

test("linking: one use, then the server sees name and roles only", { skip }, async () => {
  const ok = await call("/account/game-links", { method: "POST", token: player.token, body: { code } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const again = await call("/account/game-links", { method: "POST", token: player.token, body: { code } });
  assert.equal(again.status, 404);
  const l = await lookup({ game: "fivem", identity: LICENSE });
  assert.equal(l.json.linked, true);
  assert.equal(l.json.allowed, true);
  assert.equal(l.json.user.username, player.username);
  assert.deepEqual(Object.keys(l.json.user).sort(), ["displayName", "id", "username"]);
  assert.equal(l.json.owner, false);
  assert.ok(l.json.roles.some((r: any) => r.id === modRole));
  const mine = await call("/account/game-links", { token: player.token });
  assert.equal(mine.json.servers.length, 1);
  assert.equal(mine.json.servers[0].playerName, "Riley_Carter");
  assert.ok(mine.json.servers[0].roles.length >= 1);
  const activity = await call(`/constellations/${cid}/integrations/activity`, { token: owner.token });
  assert.ok(activity.json.items.some((a: any) => /linked their FiveM player Riley_Carter/.test(a.text)), JSON.stringify(activity.json));
});

test("one player per account per game: a new link replaces the old one", { skip }, async () => {
  const other = "license:" + randomBytes(20).toString("hex");
  const a = await lookup({ game: "fivem", identity: other, playerName: "Alt" });
  const p = await call("/account/game-links/preview", { method: "POST", token: player.token, body: { code: a.json.code } });
  assert.equal(p.json.preview.replaces, "Riley_Carter");
  assert.equal((await call("/account/game-links", { method: "POST", token: player.token, body: { code: a.json.code } })).status, 200);
  assert.equal((await lookup({ game: "fivem", identity: LICENSE })).json.linked, false);
  assert.equal((await lookup({ game: "fivem", identity: other })).json.allowed, true);
});

test("banned or gone: the server is told no, without the name", { skip }, async () => {
  const other = (await call("/account/game-links", { token: player.token })).json.servers[0];
  const id = (await pool.query("select identity from game_links where id = $1", [other.id])).rows[0].identity;
  await pool.query("delete from constellation_members where constellation_id = $1 and user_id = $2", [cid, player.id]);
  const gone = await lookup({ game: "fivem", identity: id });
  assert.deepEqual(gone.json, { linked: true, allowed: false, reason: "not_member" });
  await pool.query("insert into constellation_bans (constellation_id, user_id) values ($1, $2)", [cid, player.id]);
  assert.equal((await lookup({ game: "fivem", identity: id })).json.reason, "banned");
  await pool.query("delete from constellation_bans where constellation_id = $1 and user_id = $2", [cid, player.id]);
  await pool.query("insert into constellation_members (constellation_id, user_id, joined_at, welcomed_at) values ($1, $2, now(), now())", [cid, player.id]);
  // An account waiting to be deleted (or suspended) is kept out too, without its name.
  await pool.query("update users set delete_after = now() + interval '30 days' where id = $1", [player.id]);
  assert.deepEqual((await lookup({ game: "fivem", identity: id })).json, { linked: true, allowed: false, reason: "account_locked" });
  await pool.query("update users set delete_after = null where id = $1", [player.id]);
  assert.equal((await lookup({ game: "fivem", identity: id })).json.allowed, true);
});

test("unlink: the server can't look you up any more", { skip }, async () => {
  const s = (await call("/account/game-links", { token: player.token })).json.servers[0];
  assert.equal((await call(`/account/game-links/${s.id}`, { method: "DELETE", token: outsider.token })).status, 404);
  assert.equal((await call(`/account/game-links/${s.id}`, { method: "DELETE", token: player.token })).status, 200);
  assert.equal((await call("/account/game-links", { token: player.token })).json.servers.length, 0);
});

test("Minecraft UUIDs with or without dashes are the same player", { skip }, async () => {
  const a = await lookup({ game: "minecraft", identity: MC, playerName: "Steve" });
  const dashed = `${MC.slice(0, 8)}-${MC.slice(8, 12)}-${MC.slice(12, 16)}-${MC.slice(16, 20)}-${MC.slice(20)}`;
  const b = await lookup({ game: "minecraft", identity: dashed.toUpperCase() });
  assert.equal(a.json.code, b.json.code);
});

test("guessing codes is cut off", { skip }, async () => {
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await call("/account/game-links/preview", { method: "POST", token: outsider.token, body: { code: String(100000 + i) } })).status;
  assert.equal(last, 429);
});
