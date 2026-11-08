// 0.9.1 profiles: pronouns, header, board, who sees what, mutuals, activity. Against a real
// server with Postgres and Redis (run like integrations.e2e.ts).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const H = { "content-type": "application/json", "x-glofly-version": "0.9.1" };
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");

let pool: pg.Pool;
async function call(path: string, opts: { method?: string; body?: unknown; token?: string; raw?: Buffer; type?: string } = {}) {
  const headers: Record<string, string> = { ...H };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.raw) headers["content-type"] = opts.type ?? "image/png";
  const r = await fetch(URL_ + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.raw ? new Uint8Array(opts.raw) : opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json };
}
type Who = { id: string; token: string };
async function account(name: string): Promise<Who> {
  const username = `${name}${tag}`;
  const r = await call("/auth/register", {
    method: "POST",
    body: { email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthday: "1995-05-14", acceptTerms: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.user.id as string, token: r.json.token as string };
}
async function befriend(a: Who, b: Who) {
  const [low, high] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  await pool.query("insert into friendships (user_low, user_high, requester_id, status, accepted_at) values ($1, $2, $1, 'accepted', now())", [low, high]);
}

let maya: Who, riley: Who, sam: Who, stranger: Who;
let publicC: string, inviteC: string;

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  maya = await account("prmaya");
  riley = await account("prriley");
  sam = await account("prsam");
  stranger = await account("prstr");
  await befriend(maya, riley);
  await befriend(maya, sam);
  await befriend(riley, sam);
  const a = await call("/constellations", { method: "POST", token: maya.token, body: { name: `Cozy ${tag}`, template: "gaming" } });
  publicC = a.json.constellation.id;
  await pool.query("update constellations set visibility = 'public' where id = $1", [publicC]);
  const b = await call("/constellations", { method: "POST", token: maya.token, body: { name: `Secret ${tag}`, template: "gaming" } });
  inviteC = b.json.constellation.id;
  // Riley joins the public one.
  assert.equal((await call(`/constellations/${publicC}/join`, { method: "POST", token: riley.token })).status < 300, true);
  await pool.query(
    "insert into user_games (user_id, game_key, name, seconds, first_played_at, last_played_at) values ($1, 'stardew valley', 'Stardew Valley', 36000, now() - interval '20 days', now() - interval '1 day')",
    [maya.id],
  );
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = any($1)", [[publicC, inviteC]]);
  await pool.query("delete from users where id = any($1)", [[maya.id, riley.id, sam.id, stranger.id]]);
  await pool.end();
});

test("pronouns and a board save; bad tiles are refused", { skip }, async () => {
  const bad = await call("/users/me/profile", { method: "PATCH", token: maya.token, body: { board: [{ kind: "constellation", constellationId: inviteC }] } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.message, /Invite-only/);
  const notMine = await call("/users/me/profile", { method: "PATCH", token: sam.token, body: { board: [{ kind: "constellation", constellationId: publicC }] } });
  assert.equal(notMine.status, 400);
  const tooMany = await call("/users/me/profile", { method: "PATCH", token: maya.token, body: { board: Array(7).fill({ kind: "note", text: "hi" }) } });
  assert.equal(tooMany.status, 400);
  const hidden = await call("/users/me/profile", { method: "PATCH", token: maya.token, body: { pronouns: "she‮/her" } });
  assert.equal(hidden.status, 400);

  const ok = await call("/users/me/profile", {
    method: "PATCH",
    token: maya.token,
    body: {
      pronouns: "  she/her ",
      board: [
        { kind: "games", games: [{ name: "Stardew Valley", key: "spoofed" }, { name: "Hades" }] },
        { kind: "constellation", constellationId: publicC },
        { kind: "note", text: "Cozy games and late-night calls." },
        { kind: "into", tags: [" Lo-fi ", "Cats", "Cats"] },
        { kind: "playing" },
      ],
    },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.pronouns, "she/her");
  assert.equal(ok.json.boardSource.length, 5);
  assert.equal(ok.json.boardSource[0].games[0].key, "stardew valley", "keys are worked out by the server");
  assert.deepEqual(ok.json.boardSource[3].tags, ["Lo-fi", "Cats"]);
  assert.deepEqual(ok.json.privacy, { board: "everyone", activity: "friends", mutuals: "everyone" });
  // Leaving other fields alone: a pronouns-only change keeps the board.
  const p = await call("/users/me/profile", { method: "PATCH", token: maya.token, body: { pronouns: "she/they" } });
  assert.equal(p.json.boardSource.length, 5);
});

test("a friend sees the board with playtime; a stranger sees it without; only_me hides it", { skip }, async () => {
  const f = await call(`/users/${maya.id}/profile`, { token: riley.token });
  assert.equal(f.status, 200);
  assert.equal(f.json.pronouns, "she/they");
  const games = f.json.board.find((t: any) => t.kind === "games");
  assert.equal(games.games[0].seconds, 36000, "My games is shared with friends by default");
  assert.equal(games.games[1].seconds, undefined);
  const c = f.json.board.find((t: any) => t.kind === "constellation");
  assert.equal(c.constellation.joined, true);
  assert.equal(c.constellation.memberCount, 2);
  assert.equal(f.json.activityShown, true);
  assert.equal(f.json.counts.mutualFriends, 1, "Sam");
  assert.equal(f.json.privacy, undefined, "only your own profile carries your settings");

  const s = await call(`/users/${maya.id}/profile`, { token: stranger.token });
  assert.equal(s.status, 200);
  assert.equal(s.json.bio, null);
  assert.ok(s.json.board, "board defaults to everyone");
  assert.equal(s.json.board.find((t: any) => t.kind === "games").games[0].seconds, undefined, "My games isn't shared with strangers");
  assert.equal(s.json.board.find((t: any) => t.kind === "playing").game, null);
  assert.equal(s.json.activityShown, false);

  await call("/users/me/profile", { method: "PATCH", token: maya.token, body: { privacy: { board: "only_me" } } });
  assert.equal((await call(`/users/${maya.id}/profile`, { token: riley.token })).json.board, null);
  const own = await call("/users/me/profile", { token: maya.token });
  assert.equal(own.json.privacy.board, "only_me");
  assert.equal(own.json.privacy.activity, "friends", "a partial change keeps the rest");
  assert.ok(own.json.board, "you always see your own");
  await call("/users/me/profile", { method: "PATCH", token: maya.token, body: { privacy: { board: "everyone" } } });
});

test("a constellation going invite-only drops off the board", { skip }, async () => {
  await pool.query("update constellations set visibility = 'invite' where id = $1", [publicC]);
  const f = await call(`/users/${maya.id}/profile`, { token: riley.token });
  assert.equal(f.json.board.some((t: any) => t.kind === "constellation"), false);
  await pool.query("update constellations set visibility = 'public' where id = $1", [publicC]);
});

test("mutuals: friends and constellations you share, per their setting", { skip }, async () => {
  const m = await call(`/users/${maya.id}/mutuals`, { token: riley.token });
  assert.equal(m.status, 200);
  assert.deepEqual(m.json.friends.map((u: any) => u.id), [sam.id]);
  assert.deepEqual(m.json.constellations.map((c: any) => c.id), [publicC], "the invite-only one Riley isn't in stays out");
  assert.ok(Array.isArray(m.json.constellations[0].roles));
  const s = await call(`/users/${maya.id}/mutuals`, { token: stranger.token });
  assert.deepEqual(s.json.friends, []);
  await call("/users/me/profile", { method: "PATCH", token: maya.token, body: { privacy: { mutuals: "only_me" } } });
  const hidden = await call(`/users/${maya.id}/mutuals`, { token: riley.token });
  assert.equal(hidden.json.shown, false);
  assert.deepEqual(hidden.json.friends, []);
  await call("/users/me/profile", { method: "PATCH", token: maya.token, body: { privacy: { mutuals: "everyone" } } });
});

test("activity: friends by default; games follow My games", { skip }, async () => {
  const a = await call(`/users/${maya.id}/activity`, { token: riley.token });
  assert.equal(a.status, 200);
  assert.equal(a.json.shown, true);
  assert.ok(a.json.items.some((i: any) => i.kind === "started" && i.game === "Stardew Valley"));
  assert.ok(a.json.items.some((i: any) => i.kind === "joined" && i.constellation.id === publicC));
  assert.ok(!a.json.items.some((i: any) => i.kind === "joined" && i.constellation.id === inviteC), "invite-only joins stay out");
  assert.equal((await call(`/users/${maya.id}/activity`, { token: stranger.token })).json.shown, false);
  await call("/games/me/settings", { method: "PUT", token: maya.token, body: { visibility: "only_me" } });
  const b = await call(`/users/${maya.id}/activity`, { token: riley.token });
  assert.ok(!b.json.items.some((i: any) => i.kind === "started" || i.kind === "played"));
  await call("/games/me/settings", { method: "PUT", token: maya.token, body: { visibility: "friends" } });
});

test("header: upload, focus, serve, block hides it, remove", { skip }, async () => {
  const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 80, g: 40, b: 120 } } }).png().toBuffer();
  const bad = await call("/users/me/header", { method: "PUT", token: maya.token, raw: Buffer.from("not an image") });
  assert.equal(bad.status, 400);
  const up = await call("/users/me/header", { method: "PUT", token: maya.token, raw: png });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  const version = up.json.header.version;
  const focus = await call("/users/me/profile", { method: "PATCH", token: maya.token, body: { headerFocus: 30 } });
  assert.deepEqual(focus.json.header, { version, focus: 30 });
  assert.equal((await call("/users/me/profile", { method: "PATCH", token: maya.token, body: { headerFocus: 130 } })).status, 400);
  const seen = await call(`/users/${maya.id}/profile`, { token: stranger.token });
  assert.equal(seen.json.header.version, version);
  const img = await fetch(`${URL_}/headers/${maya.id}/${version}`, { headers: { ...H, authorization: `Bearer ${stranger.token}` } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/webp");
  const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
  assert.equal(meta.width, 900, "kept whole (not cropped) so it can be moved");

  assert.ok((await call(`/blocks/${stranger.id}`, { method: "POST", token: maya.token })).status < 300);
  const blocked = await fetch(`${URL_}/headers/${maya.id}/${version}`, { headers: { ...H, authorization: `Bearer ${stranger.token}` } });
  assert.equal(blocked.status, 404);
  assert.equal((await call(`/users/${maya.id}/mutuals`, { token: stranger.token })).status, 404);

  const del = await call("/users/me/header", { method: "DELETE", token: maya.token });
  assert.equal(del.json.header, null);
  const gone = await fetch(`${URL_}/headers/${maya.id}/${version}`, { headers: { ...H, authorization: `Bearer ${riley.token}` } });
  assert.equal(gone.status, 404);
});

test("restricted (family) accounts only show these to friends", { skip }, async () => {
  await pool.query("update users set restricted = true where id = $1", [sam.id]);
  await call("/users/me/profile", { method: "PATCH", token: sam.token, body: { pronouns: "he/him", board: [{ kind: "note", text: "hey" }] } });
  const s = await call(`/users/${sam.id}/profile`, { token: stranger.token });
  assert.equal(s.status, 200);
  assert.equal(s.json.pronouns, null);
  assert.equal(s.json.board, null);
  const f = await call(`/users/${sam.id}/profile`, { token: riley.token });
  assert.equal(f.json.pronouns, "he/him");
});
