// Communities round (Nov 2026): messages:read for bridges (reading + pushes + the members' notice),
// against a real server with Postgres and Redis. Run like integrations.e2e.ts.
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
let other: { id: string; conversationId: string };
let secret: string;
let botId: string;
let pushSecret: string;

const asBot = async (path: string, method = "GET", body?: unknown, key = secret) => {
  const r = await fetch(URL_ + path, { method, headers: { ...H, authorization: `Bot ${key}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
};
const verify = (g: Got, s: string) => {
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(g.headers["glofly-signature"]))!;
  assert.equal(v1, createHmac("sha256", s).update(`${t}.${g.body}`).digest("hex"));
};
const send = (conversationId: string, body: string, token = player.token) => call(`/conversations/${conversationId}/messages`, { method: "POST", token, body: { body } });

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
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/bridge`;
  owner = await account("bridgeowner");
  player = await account("bridgeplayer");
  const made = await call("/constellations", { method: "POST", token: owner.token, body: { name: `Bridge ${tag}`, template: "gaming" } });
  cid = made.json.constellation.id;
  const view = await call(`/constellations/${cid}`, { token: owner.token });
  const texts = view.json.constellation.nebulas.filter((n: any) => n.kind === "text");
  general = texts[0];
  other = texts[1];
  const link = await call(`/constellations/${cid}/links`, { method: "POST", token: owner.token, body: { lifetime: "7d" } });
  await call(`/constellations/links/${link.json.link.code}/join`, { method: "POST", token: player.token });
  const k = await call(`/constellations/${cid}/integrations/keys`, {
    method: "POST",
    token: owner.token,
    body: { name: "Discord Bridge", roleId: null, scopes: ["messages:read", "messages:write"], postNebulaIds: [general.id], readNebulaIds: [general.id], password: PASSWORD },
  });
  assert.equal(k.status, 201, JSON.stringify(k.json));
  secret = k.json.secret;
  botId = k.json.key.bot.id;
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.end();
  receiver.close();
});

test("members see which nebulas are shared, and with whom", { skip }, async () => {
  const view = await call(`/constellations/${cid}`, { token: player.token });
  const g = view.json.constellation.nebulas.find((n: any) => n.id === general.id);
  const o = view.json.constellation.nebulas.find((n: any) => n.id === other.id);
  assert.deepEqual(g.sharedWith, ["Discord Bridge"]);
  assert.equal(o.sharedWith, undefined);
});

test("reading: only picked nebulas, oldest first, with an after cursor", { skip }, async () => {
  assert.equal((await send(general.conversationId, "first")).status, 201);
  assert.equal((await send(general.conversationId, "second")).status, 201);
  await send(other.conversationId, "not for the bridge");
  const latest = await asBot(`/api/v1/nebulas/${general.id}/messages?limit=2`);
  assert.equal(latest.status, 200, JSON.stringify(latest.json));
  assert.deepEqual(latest.json.messages.map((m: any) => m.text), ["first", "second"]);
  assert.equal(latest.json.messages[0].author.id, player.id);
  assert.deepEqual(Object.keys(latest.json.messages[0].author).sort(), ["bot", "displayName", "id", "username"]);
  const after = await asBot(`/api/v1/nebulas/${general.id}/messages?after=${latest.json.messages[0].id}`);
  assert.deepEqual(after.json.messages.map((m: any) => m.text), ["second"]);
  assert.equal((await asBot(`/api/v1/nebulas/${other.id}/messages`)).status, 403);
});

test("pushes: created, edited and deleted, signed; its own posts aren't echoed", { skip }, async () => {
  const set = await asBot("/api/v1/interactions", "PUT", { url: receiverUrl });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  pushSecret = set.json.secret;
  got.length = 0;
  const sent = await send(general.conversationId, "hello bridge");
  const id = sent.json.message.id;
  const created = await waitFor((g) => g.headers["glofly-event"] === "message.created");
  verify(created, pushSecret);
  const p = JSON.parse(created.body);
  assert.equal(p.message.text, "hello bridge");
  assert.equal(p.nebulaId, general.id);
  await call(`/conversations/${general.conversationId}/messages/${id}`, { method: "PATCH", token: player.token, body: { body: "hello bridge!" } });
  const edited = JSON.parse((await waitFor((g) => g.headers["glofly-event"] === "message.edited")).body);
  assert.equal(edited.message.text, "hello bridge!");
  await call(`/conversations/${general.conversationId}/messages/${id}`, { method: "DELETE", token: player.token });
  const deleted = JSON.parse((await waitFor((g) => g.headers["glofly-event"] === "message.deleted")).body);
  assert.equal(deleted.messageId, id);
  assert.equal(deleted.message, null);
  got.length = 0;
  await send(other.conversationId, "elsewhere");
  assert.equal((await asBot(`/api/v1/nebulas/${general.id}/messages`, "GET")).status, 200);
  const own = await asBot(`/api/v1/nebulas/${general.id}/messages`, "POST", { text: "from Discord" });
  assert.equal(own.status, 201, JSON.stringify(own.json));
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(got.length, 0, "no pushes for other nebulas or the bridge's own posts");
  const read = await asBot(`/api/v1/nebulas/${general.id}/messages?limit=1`);
  assert.equal(read.json.messages[0].author.id, botId);
  assert.equal(read.json.messages[0].author.bot, true);
});

test("taking the permission away stops reading and the notice goes", { skip }, async () => {
  const keys = await call(`/constellations/${cid}/integrations`, { token: owner.token });
  const key = keys.json.keys.find((k: any) => k.name === "Discord Bridge");
  const ch = await call(`/constellations/${cid}/integrations/keys/${key.id}`, { method: "PATCH", token: owner.token, body: { scopes: ["messages:write"], postNebulaIds: [general.id], password: PASSWORD } });
  assert.equal(ch.status, 200, JSON.stringify(ch.json));
  assert.equal((await asBot(`/api/v1/nebulas/${general.id}/messages`)).status, 403);
  const view = await call(`/constellations/${cid}`, { token: player.token });
  assert.equal(view.json.constellation.nebulas.find((n: any) => n.id === general.id).sharedWith, undefined);
});
