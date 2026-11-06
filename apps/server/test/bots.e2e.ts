// Communities round (Nov 2026): bots in chats (slash commands, buttons, giving roles), against a
// real server with real Postgres and Redis. Not part of `npm test`. The dev server must allow local
// addresses so interactions can reach this test's own little receiver:
//
//   LINK_PREVIEW_ALLOW_PRIVATE=1 npm run dev -w apps/server
//   GLOFLY_E2E_URL=http://localhost:4000 npx tsx --env-file=../../.env --test test/bots.e2e.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
let adminRole: string;
let secret: string;
let keyId: string;
let botId: string;
let interactionSecret: string;

const asBot = async (path: string, method = "GET", body?: unknown, key = secret) => {
  const r = await fetch(URL_ + path, { method, headers: { ...H, authorization: `Bot ${key}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
};
const verify = (g: Got, s: string) => {
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(g.headers["glofly-signature"]))!;
  assert.equal(v1, createHmac("sha256", s).update(`${t}.${g.body}`).digest("hex"));
};

before(async () => {
  if (skip) return;
  await clearSignupLimit();
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
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/interactions`;
  owner = await account("botowner");
  player = await account("botplayer");
  const made = await call("/constellations", { method: "POST", token: owner.token, body: { name: `Bots ${tag}`, template: "gaming" } });
  cid = made.json.constellation.id;
  const view = await call(`/constellations/${cid}`, { token: owner.token });
  general = view.json.constellation.nebulas.find((n: any) => n.kind === "text");
  const roles = await pool.query("select id, kind from constellation_roles where constellation_id = $1", [cid]);
  modRole = roles.rows.find((r) => r.kind === "moderator").id;
  adminRole = roles.rows.find((r) => r.kind === "admin").id;
  const link = await call(`/constellations/${cid}/links`, { method: "POST", token: owner.token, body: { lifetime: "7d" } });
  await call(`/constellations/links/${link.json.link.code}/join`, { method: "POST", token: player.token });
  const k = await call(`/constellations/${cid}/integrations/keys`, {
    method: "POST",
    token: owner.token,
    body: { name: "Whitelist", roleId: adminRole, scopes: ["members:read", "messages:write", "roles:write", "commands"], postNebulaIds: [general.id], password: PASSWORD },
  });
  assert.equal(k.status, 201, JSON.stringify(k.json));
  secret = k.json.secret;
  keyId = k.json.key.id;
  botId = k.json.key.bot.id;
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.end();
  receiver.close();
});

test("a bot sets its interactions address and registers slash commands", { skip }, async () => {
  const set = await asBot("/api/v1/interactions", "PUT", { url: receiverUrl });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  interactionSecret = set.json.secret;
  assert.equal((await asBot("/api/v1/commands", "PUT", { commands: [{ name: "Bad Name", description: "x" }] })).status, 400);
  const put = await asBot("/api/v1/commands", "PUT", { commands: [{ name: "whitelist", description: "Ask to be whitelisted" }] });
  assert.equal(put.status, 200);
  const menu = await call(`/constellations/${cid}/commands`, { token: player.token });
  assert.equal(menu.status, 200);
  assert.deepEqual(menu.json.commands.map((c: any) => c.name), ["whitelist"]);
  assert.equal(menu.json.commands[0].bot.id, botId);
  const stranger = await account("botstranger");
  assert.equal((await call(`/constellations/${cid}/commands`, { token: stranger.token })).status, 404);
});

test("another bot can't take a command name", { skip }, async () => {
  const k = await call(`/constellations/${cid}/integrations/keys`, { method: "POST", token: owner.token, body: { name: "Other", roleId: null, scopes: ["commands"], password: PASSWORD } });
  const clash = await asBot("/api/v1/commands", "PUT", { commands: [{ name: "whitelist", description: "mine" }] }, k.json.secret);
  assert.equal(clash.status, 409);
  await call(`/constellations/${cid}/integrations/keys/${k.json.key.id}`, { method: "DELETE", token: owner.token });
});

let commandMessage: string;

test("running a command posts the member's message and tells the bot (signed)", { skip }, async () => {
  const run = await call(`/constellations/${cid}/commands/run`, { method: "POST", token: player.token, body: { nebulaId: general.id, input: "/whitelist apply" } });
  assert.equal(run.status, 200, JSON.stringify(run.json));
  assert.equal(run.json.delivered, true);
  commandMessage = run.json.messageId;
  const g = await waitFor((x) => x.body.includes('"command"'));
  verify(g, interactionSecret);
  const p = JSON.parse(g.body);
  assert.deepEqual(p.command, { name: "whitelist", text: "apply" });
  assert.equal(p.user.id, player.id);
  assert.equal(p.messageId, commandMessage);
  const row = await pool.query("select sender_id, body from messages where id = $1", [commandMessage]);
  assert.equal(row.rows[0].sender_id, player.id);
  assert.equal(row.rows[0].body, "/whitelist apply");
  assert.equal((await call(`/constellations/${cid}/commands/run`, { method: "POST", token: player.token, body: { nebulaId: general.id, input: "/nope" } })).status, 404);
});

let botMessage: string;

test("the bot answers with buttons; clicks reach it; unknown buttons don't", { skip }, async () => {
  const reply = await asBot(`/api/v1/nebulas/${general.id}/messages`, "POST", {
    text: "Application received",
    replyToId: commandMessage,
    buttons: [{ id: "approve:" + player.id, label: "Approve", style: "primary" }, { id: "decline", label: "Decline", style: "danger" }],
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.json));
  botMessage = reply.json.messageId;
  const row = await pool.query("select buttons, reply_to_id from messages where id = $1", [botMessage]);
  assert.equal(row.rows[0].buttons.length, 2);
  assert.equal(row.rows[0].reply_to_id, commandMessage);
  const tooMany = await asBot(`/api/v1/nebulas/${general.id}/messages`, "POST", { text: "x", buttons: Array.from({ length: 6 }, (_, i) => ({ id: "b" + i, label: "B" })) });
  assert.equal(tooMany.status, 400);

  const click = await call(`/constellations/${cid}/messages/${botMessage}/buttons/decline`, { method: "POST", token: owner.token });
  assert.equal(click.status, 200);
  const g = await waitFor((x) => x.body.includes('"button"'));
  verify(g, interactionSecret);
  assert.equal(JSON.parse(g.body).button.id, "decline");
  assert.equal((await call(`/constellations/${cid}/messages/${botMessage}/buttons/nope`, { method: "POST", token: owner.token })).status, 404);
  // A person's message has no buttons to click.
  assert.equal((await call(`/constellations/${cid}/messages/${commandMessage}/buttons/decline`, { method: "POST", token: owner.token })).status, 404);
});

test("giving roles: only below the bot's own, only to people below it", { skip }, async () => {
  assert.equal((await asBot(`/api/v1/members/${player.id}/roles/${modRole}`, "PUT")).status, 200);
  const held = await pool.query("select 1 from constellation_member_roles where user_id = $1 and role_id = $2", [player.id, modRole]);
  assert.equal(held.rowCount, 1);
  assert.equal((await asBot(`/api/v1/members/${player.id}/roles/${adminRole}`, "PUT")).status, 403, "Admin is the bot's own rank");
  assert.equal((await asBot(`/api/v1/members/${owner.id}/roles/${modRole}`, "PUT")).status, 403, "never the Owner");
  assert.equal((await asBot(`/api/v1/members/${player.id}/roles/${modRole}`, "DELETE")).status, 200);
  const gone = await pool.query("select 1 from constellation_member_roles where user_id = $1 and role_id = $2", [player.id, modRole]);
  assert.equal(gone.rowCount, 0);
});

test("deleting the key removes its commands", { skip }, async () => {
  await call(`/constellations/${cid}/integrations/keys/${keyId}`, { method: "DELETE", token: owner.token });
  const menu = await call(`/constellations/${cid}/commands`, { token: player.token });
  assert.deepEqual(menu.json.commands, []);
  assert.equal((await call(`/constellations/${cid}/messages/${botMessage}/buttons/decline`, { method: "POST", token: owner.token })).status, 404);
});
