// 0.12.0 Clear chat (just for you), against a real server with Postgres and Redis. Run like threads.e2e.ts.
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
let chat: string;
const send = async (who: { token: string }, body: string) => (await call(`/conversations/${chat}/messages`, { method: "POST", token: who.token, body: { body } })).json.message;

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  maya = await account("maya");
  chip = await account("chip");
  await befriend(maya, chip);
  chat = await dm(chip.token, maya.id);
});
after(async () => {
  if (skip) return;
  await pool.query("delete from users where id = any($1)", [[maya.id, chip.id]]);
  await pool.end();
});

const history = async (who: { token: string }) => (await call(`/conversations/${chat}/messages`, { token: who.token })).json.messages.map((m: any) => m.body);
const summary = async (who: { token: string }) => (await call("/conversations", { token: who.token })).json.conversations.find((c: any) => c.id === chat);

test("clearing hides everything before it for me only; new messages show; undo brings it back", { skip }, async () => {
  const first = await send(maya, "pineapple pizza tonight?");
  await send(chip, "obviously");
  await send(maya, "pineapple it is");
  assert.equal((await call(`/conversations/${chat}/messages/${first.id}/pin`, { method: "POST", token: chip.token })).status, 200);

  const cleared = await call(`/conversations/${chat}/clear`, { method: "POST", token: chip.token });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.previous, null);

  // Chip: empty history, no last message, nothing unread, no pins, search finds nothing.
  assert.deepEqual(await history(chip), []);
  const mine = await summary(chip);
  assert.equal(mine.lastMessage, null);
  assert.equal(mine.unreadCount, 0);
  assert.equal(mine.clearedAt, cleared.json.clearedAt);
  assert.deepEqual((await call(`/conversations/${chat}/pins`, { token: chip.token })).json.pins, []);
  assert.equal((await call(`/conversations/messages/search?q=pineapple`, { token: chip.token })).json.results.length, 0);
  // An older app gets the same empty history (the server filters for every version).
  const old = await fetch(`${URL_}/conversations/${chat}/messages`, { headers: { authorization: `Bearer ${chip.token}`, "x-glofly-version": "0.3.0" } });
  assert.deepEqual((await old.json()).messages, []);

  // Maya still sees every message, the pin and her search.
  assert.deepEqual(await history(maya), ["pineapple pizza tonight?", "obviously", "pineapple it is"]);
  assert.equal((await call(`/conversations/${chat}/pins`, { token: maya.token })).json.pins.length, 1);
  assert.equal((await call(`/conversations/messages/search?q=pineapple`, { token: maya.token })).json.results.length, 2);
  // Nothing was deleted.
  const { rows } = await pool.query("select count(*)::int as n from messages where conversation_id = $1", [chat]);
  assert.equal(rows[0].n, 3);

  // A new message shows for Chip as usual and counts as unread.
  await new Promise((r) => setTimeout(r, 5));
  await send(maya, "still on for saturday?");
  assert.deepEqual(await history(chip), ["still on for saturday?"]);
  const after = await summary(chip);
  assert.equal(after.lastMessage.body, "still on for saturday?");
  assert.equal(after.unreadCount, 1);

  // Undo: only for that clear, only back to an earlier point.
  const wrong = await call(`/conversations/${chat}/clear/undo`, { method: "POST", token: chip.token, body: { clearedAt: new Date(Date.parse(cleared.json.clearedAt) - 5000).toISOString(), previous: null } });
  assert.equal(wrong.status, 409);
  const undo = await call(`/conversations/${chat}/clear/undo`, { method: "POST", token: chip.token, body: { clearedAt: cleared.json.clearedAt, previous: null } });
  assert.equal(undo.status, 200);
  assert.equal((await history(chip)).length, 4);
  assert.equal((await summary(chip)).clearedAt, null);
});

test("clearing someone else's chat is refused", { skip }, async () => {
  const stranger = await account("stranger");
  try {
    assert.equal((await call(`/conversations/${chat}/clear`, { method: "POST", token: stranger.token })).status, 404);
  } finally {
    await pool.query("delete from users where id = $1", [stranger.id]);
  }
});
