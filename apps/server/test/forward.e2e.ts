// 0.9.3 forwarding, against a real server with Postgres and Redis. Run like threads.e2e.ts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const H = { "content-type": "application/json", "x-glofly-version": "0.9.3", "x-glofly-features": "threads" };
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");
// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let pool: pg.Pool;
async function call(path: string, opts: { method?: string; body?: unknown; token?: string; raw?: Buffer } = {}) {
  const headers: Record<string, string> = { ...H };
  if (opts.raw) headers["content-type"] = "application/octet-stream";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
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
async function account(name: string) {
  const username = `${name}${tag}`;
  const r = await call("/auth/register", {
    method: "POST",
    body: { email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthday: "1995-05-14", acceptTerms: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.user.id as string, token: r.json.token as string, username };
}
async function befriend(a: { token: string; username: string }, b: { token: string; id: string; username: string }) {
  assert.equal((await call("/friends/requests", { method: "POST", token: a.token, body: { username: b.username } })).status < 300, true);
  const fromA = await call("/friends", { token: b.token });
  const req = fromA.json.incoming.find((p: any) => p.username === a.username);
  assert.ok(req);
  assert.equal((await call(`/friends/requests/${req.id}/accept`, { method: "POST", token: b.token })).status < 300, true);
}
const dm = async (token: string, userId: string) => (await call("/conversations/dm", { method: "POST", token, body: { userId } })).json.conversation.id as string;

let maya: Awaited<ReturnType<typeof account>>;
let chip: Awaited<ReturnType<typeof account>>;
let jordan: Awaited<ReturnType<typeof account>>;
let outsider: Awaited<ReturnType<typeof account>>;
let cid: string;
let general: { id: string; conversationId: string };
let mayaChip: string;
let chipJordan: string;

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  maya = await account("fwmaya");
  chip = await account("fwchip");
  jordan = await account("fwjordan");
  outsider = await account("fwout");
  await befriend(maya, chip);
  await befriend(chip, jordan);
  mayaChip = await dm(maya.token, chip.id);
  chipJordan = await dm(chip.token, jordan.id);
  const made = await call("/constellations", { method: "POST", token: chip.token, body: { name: `Forward ${tag}`, template: "gaming" } });
  cid = made.json.constellation.id;
  general = made.json.constellation.nebulas.find((n: any) => n.kind === "text");
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.query("delete from users where id = any($1)", [[maya.id, chip.id, jordan.id, outsider.id]]);
  await pool.end();
});

let source: string;

test("forward a message with a photo to a DM and a nebula, with a note", { skip }, async () => {
  const up = await call(`/conversations/${mayaChip}/attachments?name=map.png`, { method: "POST", token: maya.token, raw: PNG });
  assert.equal(up.status, 201, JSON.stringify(up.json));
  const sent = await call(`/conversations/${mayaChip}/messages`, { method: "POST", token: maya.token, body: { body: "server ip is play.valleyrp.gg @" + chip.username, attachmentIds: [up.json.attachment.id] } });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  source = sent.json.message.id;

  const fwd = await call(`/conversations/messages/${source}/forward`, { method: "POST", token: chip.token, body: { to: [chipJordan, general.conversationId], note: "info for tonight" } });
  assert.equal(fwd.status, 201, JSON.stringify(fwd.json));
  assert.equal(fwd.json.sent.length, 2);
  assert.equal(fwd.json.failed.length, 0);
  const copy = fwd.json.sent[0].message;
  assert.deepEqual({ name: copy.forwarded.name, where: copy.forwarded.where }, { name: "fwmaya", where: null });
  assert.equal(copy.body, sent.json.message.body);
  assert.deepEqual(copy.mentions, []);
  assert.equal(copy.attachments.length, 1);
  assert.notEqual(copy.attachments[0].id, up.json.attachment.id);

  // Jordan sees the note, then the forward, and can load the copied photo.
  const page = await call(`/conversations/${chipJordan}/messages`, { token: jordan.token });
  const last = page.json.messages.slice(-2);
  assert.equal(last[0].body, "info for tonight");
  assert.ok(last[1].forwarded);
  const pic = await fetch(`${URL_}/conversations/${chipJordan}/attachments/${copy.attachments[0].id}/preview`, { headers: { authorization: `Bearer ${jordan.token}` } });
  assert.equal(pic.status, 200);

  // Deleting the original doesn't break the forward.
  assert.ok((await call(`/conversations/${mayaChip}/messages/${source}`, { method: "DELETE", token: maya.token })).status < 300);
  const again = await fetch(`${URL_}/conversations/${chipJordan}/attachments/${copy.attachments[0].id}/preview`, { headers: { authorization: `Bearer ${jordan.token}` } });
  assert.equal(again.status, 200);

  // A forward can't be edited.
  const edit = await call(`/conversations/${chipJordan}/messages/${copy.id}`, { method: "PATCH", token: chip.token, body: { body: "changed" } });
  assert.equal(edit.status, 400);

  // A forward of the forward keeps the first writer.
  const nebulaCopy = fwd.json.sent[1].message;
  const twice = await call(`/conversations/messages/${nebulaCopy.id}/forward`, { method: "POST", token: chip.token, body: { to: [mayaChip] } });
  assert.equal(twice.status, 201, JSON.stringify(twice.json));
  assert.equal(twice.json.sent[0].message.forwarded.name, "fwmaya");
});

test("only what you can see, only where you can post, never lanterns", { skip }, async () => {
  const m = await call(`/conversations/${mayaChip}/messages`, { method: "POST", token: maya.token, body: { body: "secret" } });
  // Someone outside the chat can't forward it (and doesn't learn it exists).
  assert.equal((await call(`/conversations/messages/${m.json.message.id}/forward`, { method: "POST", token: outsider.token, body: { to: [mayaChip] } })).status, 404);
  // Maya isn't in Chip and Jordan's DM: that target fails, nothing is sent.
  const r = await call(`/conversations/messages/${m.json.message.id}/forward`, { method: "POST", token: maya.token, body: { to: [chipJordan] } });
  assert.equal(r.status, 400);
  assert.equal(r.json.failed.length, 1);
  // Too many places, or the same twice.
  const six = Array.from({ length: 6 }, () => crypto.randomUUID());
  assert.equal((await call(`/conversations/messages/${m.json.message.id}/forward`, { method: "POST", token: maya.token, body: { to: six } })).status, 400);
  assert.equal((await call(`/conversations/messages/${m.json.message.id}/forward`, { method: "POST", token: maya.token, body: { to: [mayaChip, mayaChip] } })).status, 400);
  const lantern = await call(`/conversations/${mayaChip}/messages`, { method: "POST", token: maya.token, body: { body: "fades", lantern: true } });
  assert.equal((await call(`/conversations/messages/${lantern.json.message.id}/forward`, { method: "POST", token: chip.token, body: { to: [chipJordan] } })).status, 400);
});

test("constellation owners can turn forwarding off", { skip }, async () => {
  const m = await call(`/conversations/${general.conversationId}/messages`, { method: "POST", token: chip.token, body: { body: "members only" } });
  await pool.query("update constellations set forwarding_off = true where id = $1", [cid]);
  const r = await call(`/conversations/messages/${m.json.message.id}/forward`, { method: "POST", token: chip.token, body: { to: [chipJordan] } });
  assert.equal(r.status, 403);
  await pool.query("update constellations set forwarding_off = false where id = $1", [cid]);
});

test("forward targets: recent chats and nebulas you can post in", { skip }, async () => {
  const r = await call("/conversations/forward-targets", { token: chip.token });
  assert.equal(r.status, 200);
  const ids = r.json.targets.map((t: any) => t.conversationId);
  assert.ok(ids.includes(chipJordan));
  assert.ok(ids.includes(general.conversationId));
  const nebula = r.json.targets.find((t: any) => t.conversationId === general.conversationId);
  assert.equal(nebula.kind, "nebula");
  assert.ok(nebula.title.startsWith("#"));
});
