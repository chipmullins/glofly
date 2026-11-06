// Communities round (Nov 2026): incoming + outgoing webhooks, against a real server with real
// Postgres and Redis. Not part of `npm test`. The dev server must allow local addresses so the
// outgoing hooks can reach this test's own little receiver:
//
//   LINK_PREVIEW_ALLOW_PRIVATE=1 npm run dev -w apps/server
//   GLOFLY_E2E_URL=http://localhost:4000 npx tsx --env-file=../../.env --test test/webhooks.e2e.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";

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
  const r = await call("/auth/register", {
    method: "POST",
    body: { email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthday: "1995-05-14", acceptTerms: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.user.id as string, token: r.json.token as string };
}

// A stand-in for a game server's events endpoint.
type Got = { headers: Record<string, string | string[] | undefined>; body: string };
const got: Got[] = [];
let receiver: Server;
let receiverUrl: string;
let answer = 200;
async function waitFor(pred: (g: Got) => boolean, ms = 5000): Promise<Got> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const g = got.find(pred);
    if (g) return g;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("No delivery arrived");
}

let owner: { id: string; token: string };
let player: { id: string; token: string };
let cid: string;
let general: { id: string; conversationId: string };
let modRole: string;

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      got.push({ headers: req.headers, body });
      res.statusCode = answer;
      res.end();
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", () => r()));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/glofly-events`;
  owner = await account("hookowner");
  player = await account("player");
  const made = await call("/constellations", { method: "POST", token: owner.token, body: { name: `Hooks ${tag}`, template: "gaming" } });
  cid = made.json.constellation.id;
  const view = await call(`/constellations/${cid}`, { token: owner.token });
  general = view.json.constellation.nebulas.find((n: any) => n.kind === "text");
  modRole = (await pool.query("select id from constellation_roles where constellation_id = $1 and kind = 'moderator'", [cid])).rows[0].id;
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.end();
  receiver.close();
});

let hookUrl: string;
let hookId: string;

test("incoming: a secret address posts into its nebula as its own bot", { skip }, async () => {
  const wrong = await call(`/constellations/${cid}/integrations/hooks`, { method: "POST", token: owner.token, body: { kind: "incoming", name: "Server", nebulaId: general.id, password: "nope" } });
  assert.equal(wrong.status, 403);
  const r = await call(`/constellations/${cid}/integrations/hooks`, { method: "POST", token: owner.token, body: { kind: "incoming", name: "Cozy RP Server", nebulaId: general.id, password: PASSWORD } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  hookUrl = r.json.url;
  hookId = r.json.hook.id;
  assert.match(hookUrl, /\/hooks\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{43}$/);
  const stored = await pool.query("select token_hash from constellation_webhooks where id = $1", [hookId]);
  assert.ok(!hookUrl.includes(stored.rows[0].token_hash));
  const path = new URL(hookUrl).pathname;
  const post = await fetch(URL_ + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "Server restarted" }) });
  assert.equal(post.status, 204);
  const msg = await pool.query("select m.body, u.bot, u.display_name from messages m join users u on u.id = m.sender_id where m.conversation_id = $1 and m.body = 'Server restarted'", [general.conversationId]);
  assert.equal(msg.rows[0]?.bot, true);
  assert.equal(msg.rows[0]?.display_name, "Cozy RP Server");
  const bad = await fetch(URL_ + path.replace(/.$/, (c) => (c === "A" ? "B" : "A")), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x" }) });
  assert.equal(bad.status, 404);
});

test("incoming: a new address kills the old one", { skip }, async () => {
  const reset = await call(`/constellations/${cid}/integrations/hooks/${hookId}/reset`, { method: "POST", token: owner.token, body: { password: PASSWORD } });
  assert.equal(reset.status, 200);
  const old = await fetch(URL_ + new URL(hookUrl).pathname, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x" }) });
  assert.equal(old.status, 404);
  const fresh = await fetch(URL_ + new URL(reset.json.url).pathname, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "still here" }) });
  assert.equal(fresh.status, 204);
});

let secret: string;
let outId: string;

test("outgoing: only https names on the live server; signed pings and events", { skip }, async () => {
  const r = await call(`/constellations/${cid}/integrations/hooks`, {
    method: "POST",
    token: owner.token,
    body: { kind: "outgoing", name: "Events", url: receiverUrl, events: ["member.joined", "member.left", "member.roles"], password: PASSWORD },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  secret = r.json.secret;
  outId = r.json.hook.id;
  assert.match(secret, /^gfs_/);
  const list = await call(`/constellations/${cid}/integrations`, { token: owner.token });
  assert.ok(!JSON.stringify(list.json).includes(secret));

  const ping = await call(`/constellations/${cid}/integrations/hooks/${outId}/test`, { method: "POST", token: owner.token });
  assert.equal(ping.json.status, 200);
  const p = await waitFor((g) => g.body.includes('"ping"'));
  const sig = String(p.headers["glofly-signature"]);
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig)!;
  assert.equal(v1, createHmac("sha256", secret).update(`${t}.${p.body}`).digest("hex"));
  assert.ok(Math.abs(Date.now() / 1000 - Number(t)) < 60);

  // Someone joins with an invite link, gets a role, then leaves.
  const link = await call(`/constellations/${cid}/links`, { method: "POST", token: owner.token, body: { lifetime: "7d" } });
  assert.equal((await call(`/constellations/links/${link.json.link.code}/join`, { method: "POST", token: player.token })).status < 300, true);
  const joined = JSON.parse((await waitFor((g) => g.body.includes('"member.joined"'))).body);
  assert.equal(joined.data.user.id, player.id);
  assert.equal(joined.constellationId, cid);
  assert.equal(joined.data.user.email, undefined, "never more than name and id");
  await call(`/constellations/${cid}/members/${player.id}/roles`, { method: "PUT", token: owner.token, body: { roleIds: [modRole] } });
  const roles = JSON.parse((await waitFor((g) => g.body.includes('"member.roles"'))).body);
  assert.deepEqual(roles.data.roleIds, [modRole]);
  await call(`/constellations/${cid}/leave`, { method: "POST", token: player.token });
  await waitFor((g) => g.body.includes('"member.left"'));
  // Bots joining (the incoming webhook's) never produced an event.
  assert.equal(got.filter((g) => g.body.includes('"member.joined"')).length, 1);
});

test("outgoing: failures are counted, success resets them", { skip }, async () => {
  answer = 500;
  const r = await call(`/constellations/${cid}/integrations/hooks/${outId}/test`, { method: "POST", token: owner.token });
  assert.equal(r.json.ok, false);
  let row = await pool.query("select failures, last_status from constellation_webhooks where id = $1", [outId]);
  assert.equal(row.rows[0].failures, 1);
  assert.equal(row.rows[0].last_status, 500);
  answer = 200;
  await call(`/constellations/${cid}/integrations/hooks/${outId}/test`, { method: "POST", token: owner.token });
  row = await pool.query("select failures from constellation_webhooks where id = $1", [outId]);
  assert.equal(row.rows[0].failures, 0);
});

test("outgoing: private addresses are refused", { skip }, async () => {
  // The address check itself (the dev server allows local addresses for this test, so only the
  // rules that always hold are checked here).
  const ftp = await call(`/constellations/${cid}/integrations/hooks`, { method: "POST", token: owner.token, body: { kind: "outgoing", name: "x", url: "ftp://example.com/", events: ["member.joined"], password: PASSWORD } });
  assert.equal(ftp.status, 400);
  const creds = await call(`/constellations/${cid}/integrations/hooks`, { method: "POST", token: owner.token, body: { kind: "outgoing", name: "x", url: "https://a:b@example.com/", events: ["member.joined"], password: PASSWORD } });
  assert.equal(creds.status, 400);
});

test("delete: the webhook's address stops working and its bot leaves", { skip }, async () => {
  const del = await call(`/constellations/${cid}/integrations/hooks/${hookId}`, { method: "DELETE", token: owner.token });
  assert.equal(del.status, 200);
  const bots = await pool.query("select 1 from constellation_members m join users u on u.id = m.user_id where m.constellation_id = $1 and u.bot", [cid]);
  assert.equal(bots.rowCount, 0);
});
