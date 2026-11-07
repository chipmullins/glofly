// Communities round 4.2: notification window + @everyone/@here/@role mentions, against a real
// server with Postgres and Redis. Run like integrations.e2e.ts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const H = { "content-type": "application/json", "x-glofly-version": "0.9.0", "x-glofly-features": "threads" };
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");

let pool: pg.Pool;
async function call(path: string, opts: { method?: string; body?: unknown; token?: string; old?: boolean } = {}) {
  const headers: Record<string, string> = { ...H };
  if (opts.old) delete headers["x-glofly-features"];
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

let owner: { id: string; token: string };
let riley: { id: string; token: string };
let sam: { id: string; token: string };
let outsider: { id: string; token: string };
let cid: string;
let general: { id: string; conversationId: string };

const send = (conversationId: string, body: string, token: string, extra: Record<string, unknown> = {}) =>
  call(`/conversations/${conversationId}/messages`, { method: "POST", token, body: { body, ...extra } });

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  owner = await account("nfowner");
  riley = await account("nfriley");
  sam = await account("nfsam");
  outsider = await account("nfout");
  const made = await call("/constellations", { method: "POST", token: owner.token, body: { name: `Notify ${tag}`, template: "gaming" } });
  cid = made.json.constellation.id;
  general = made.json.constellation.nebulas.find((n: any) => n.kind === "text");
  const link = await call(`/constellations/${cid}/links`, { method: "POST", token: owner.token, body: { lifetime: "7d" } });
  for (const p of [riley, sam]) await call(`/constellations/links/${link.json.link.code}/join`, { method: "POST", token: p.token });
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.query("delete from users where id = any($1)", [[owner.id, riley.id, sam.id, outsider.id]]);
  await pool.end();
});


const detail = async (token: string) => (await call(`/constellations/${cid}`, { token })).json.constellation;
const mentionsIn = async (token: string) => (await detail(token)).nebulas.find((n: any) => n.id === general.id).mentionCount as number;
const readAll = async (token: string) => {
  const d = await detail(token);
  const n = d.nebulas.find((x: any) => x.id === general.id);
  await call(`/conversations/${n.conversationId}/read`, { method: "POST", token });
};

test("@everyone only counts from people allowed to use it", { skip }, async () => {
  const plain = await send(general.conversationId, "@everyone look at this", riley.token);
  assert.equal(plain.status, 201, JSON.stringify(plain.json));
  assert.ok(!plain.json.message.mentionEveryone);
  assert.equal(await mentionsIn(sam.token), 0);
  const real = await send(general.conversationId, "@everyone raid starts in 10 minutes", owner.token);
  assert.equal(real.json.message.mentionEveryone, "everyone");
  assert.equal(await mentionsIn(sam.token), 1);
  // The people it reached stay on the server.
  assert.equal(real.json.message.groupMentions, undefined);
  // The Moderator role starts with the permission; Member doesn't.
  const roles = (await detail(owner.token)).roles;
  assert.ok(roles.find((r: any) => r.kind === "moderator").permissions.includes("mentionEveryone"));
  assert.ok(!roles.find((r: any) => r.kind === "member").permissions.includes("mentionEveryone"));
});

test("Ignore @everyone and @here; @here only reaches people online", { skip }, async () => {
  await readAll(riley.token);
  const r = await call(`/constellations/${cid}/notify`, { method: "PUT", token: riley.token, body: { ignoreEveryone: true } });
  assert.equal(r.status, 204);
  assert.equal((await detail(riley.token)).me.notifications.ignoreEveryone, true);
  await send(general.conversationId, "@everyone again", owner.token);
  assert.equal(await mentionsIn(riley.token), 0);
  await readAll(sam.token);
  const here = await send(general.conversationId, "@here anyone around?", owner.token);
  assert.equal(here.json.message.mentionEveryone, "here");
  assert.equal(await mentionsIn(sam.token), 0, "sam has no live connection");
});

test("role mentions: only marked roles for members, Ignore role mentions", { skip }, async () => {
  const made = await call(`/constellations/${cid}/roles`, { method: "POST", token: owner.token, body: { name: "Healers", color: "green", permissions: [] } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const healers = made.json.constellation.roles.find((x: any) => x.name === "Healers");
  assert.equal(healers.mentionable, false);
  assert.equal((await call(`/constellations/${cid}/members/${sam.id}/roles`, { method: "PUT", token: owner.token, body: { roleIds: [healers.id] } })).status, 200);
  await readAll(sam.token);
  const before = await send(general.conversationId, "@Healers stack left", riley.token);
  assert.deepEqual(before.json.message.mentionRoles ?? [], []);
  assert.equal(await mentionsIn(sam.token), 0);
  const on = await call(`/constellations/${cid}/roles/${healers.id}`, { method: "PATCH", token: owner.token, body: { mentionable: true } });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  const after = await send(general.conversationId, "@healers stack left for phase 2", riley.token);
  assert.deepEqual(after.json.message.mentionRoles, [healers.id]);
  assert.equal(after.json.message.mentionEveryone, null);
  assert.equal(await mentionsIn(sam.token), 1);
  await readAll(sam.token);
  await call(`/constellations/${cid}/notify`, { method: "PUT", token: sam.token, body: { ignoreRoles: true } });
  await send(general.conversationId, "@Healers once more", riley.token);
  assert.equal(await mentionsIn(sam.token), 0);
});

test("muting the constellation hides its badge; an older app keeps the new permission", { skip }, async () => {
  await readAll(sam.token);
  await send(general.conversationId, "just chatting", riley.token);
  const card = async () => (await call("/constellations", { token: sam.token })).json.constellations.find((c: any) => c.id === cid);
  assert.ok((await card()).unreadCount > 0);
  assert.equal((await call(`/constellations/${cid}/notify`, { method: "PUT", token: sam.token, body: { mute: "forever" } })).status, 204);
  assert.ok((await detail(sam.token)).me.notifications.mutedUntil);
  assert.equal((await card()).unreadCount, 0);
  await call(`/constellations/${cid}/notify`, { method: "PUT", token: sam.token, body: { mute: null } });
  assert.equal((await detail(sam.token)).me.notifications.mutedUntil, null);
  assert.equal((await call(`/constellations/${cid}/notify`, { method: "PUT", token: sam.token, body: {} })).status, 400);
  // An older app saves the Moderator role without knowing the permission: it stays.
  const mod = (await detail(owner.token)).roles.find((r: any) => r.kind === "moderator");
  const old = await call(`/constellations/${cid}/roles/${mod.id}`, {
    method: "PATCH",
    token: owner.token,
    old: true,
    body: { permissions: mod.permissions.filter((p: string) => p !== "mentionEveryone") },
  });
  assert.equal(old.status, 200, JSON.stringify(old.json));
  assert.ok((await detail(owner.token)).roles.find((r: any) => r.kind === "moderator").permissions.includes("mentionEveryone"));
});
