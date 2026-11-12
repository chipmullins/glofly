// Communities round 2: custom emoji + stickers per constellation (upload, cleaning, limits,
// permissions, using them in messages and reactions everywhere, stickers), against a real server
// with Postgres and Redis. Run like integrations.e2e.ts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const H = { "x-glofly-version": "0.9.0", "x-glofly-features": "threads, round2" };
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");

let pool: pg.Pool;
async function call(path: string, opts: { method?: string; body?: unknown; raw?: Buffer; token?: string; old?: boolean } = {}) {
  const headers: Record<string, string> = { ...H, "content-type": opts.raw ? "image/png" : "application/json" };
  if (opts.old) headers["x-glofly-features"] = "threads";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(URL_ + path, { method: opts.method ?? "GET", headers, body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
  const buf = Buffer.from(await r.arrayBuffer());
  let json: any = null;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    json = null;
  }
  return { status: r.status, json, buf, type: r.headers.get("content-type") };
}
type Acct = { id: string; token: string };
const made: string[] = [];
async function account(name: string): Promise<Acct & { username: string }> {
  const username = `${name}${tag}`;
  const r = await call("/auth/register", { method: "POST", body: { email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthday: "1995-05-14", acceptTerms: true } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  made.push(r.json.user.id);
  return { id: r.json.user.id, token: r.json.token, username };
}
const square = (color: string, size = 300) => sharp({ create: { width: size, height: size, channels: 4, background: color } }).png().toBuffer();
async function animated(): Promise<Buffer> {
  const frames = await Promise.all(["#ff0000", "#00ff00", "#0000ff"].map((c) => square(c, 64)));
  return sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100] }).toBuffer();
}

let owner: Acct, admin: Acct, member: Acct & { username: string }, friend: Acct & { username: string };
let cid: string, other: string;
let general: { conversationId: string };
let dm: string;

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  owner = await account("emowner");
  admin = await account("emadmin");
  member = await account("emmember");
  friend = await account("emfriend");
  const c = await call("/constellations", { method: "POST", token: owner.token, body: { name: `Emoji ${tag}`, template: "gaming" } });
  cid = c.json.constellation.id;
  general = c.json.constellation.nebulas.find((n: any) => n.kind === "text");
  const link = await call(`/constellations/${cid}/links`, { method: "POST", token: owner.token, body: { lifetime: "7d" } });
  for (const u of [admin, member]) await call(`/constellations/links/${link.json.link.code}/join`, { method: "POST", token: u.token });
  const roles = (await call(`/constellations/${cid}`, { token: owner.token })).json.constellation.roles;
  await call(`/constellations/${cid}/members/${admin.id}/roles`, { method: "PUT", token: owner.token, body: { roleIds: [roles.find((r: any) => r.kind === "admin").id] } });
  const o = await call("/constellations", { method: "POST", token: friend.token, body: { name: `Other ${tag}`, template: "gaming" } });
  other = o.json.constellation.id;
  // member and friend are friends, for a DM
  await call("/friends/requests", { method: "POST", token: member.token, body: { username: friend.username } });
  const req = (await call("/friends", { token: friend.token })).json.incoming.find((p: any) => p.username === member.username);
  await call(`/friends/requests/${req.id}/accept`, { method: "POST", token: friend.token });
  dm = (await call("/conversations/dm", { method: "POST", token: member.token, body: { userId: friend.id } })).json.conversation.id;
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = any($1)", [[cid, other]]);
  await pool.query("delete from users where id = any($1)", [made]);
  await pool.end();
});

let gg: any, owl: any, sticker: any;

test("Admins add emoji (cleaned to 128 px WebP, animation kept); members can't", { skip }, async () => {
  const no = await call(`/constellations/${cid}/emoji?name=gg`, { method: "POST", token: member.token, raw: await square("#2e9e5b") });
  assert.equal(no.status, 403);
  const r = await call(`/constellations/${cid}/emoji?name=GG`, { method: "POST", token: admin.token, raw: await square("#2e9e5b") });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  gg = r.json.emoji[0];
  assert.equal(gg.name, "gg");
  assert.equal(gg.width, 128);
  assert.equal(gg.animated, false);
  const again = await call(`/constellations/${cid}/emoji?name=gg`, { method: "POST", token: admin.token, raw: await square("#000000") });
  assert.equal(again.status, 409);
  const a = await call(`/constellations/${cid}/emoji?name=night_owl&outside=0`, { method: "POST", token: admin.token, raw: await animated() });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  owl = a.json.emoji.find((e: any) => e.name === "night_owl");
  assert.equal(owl.animated, true);
  assert.equal(owl.outside, false);
  const img = await call(`/emoji/${owl.id}/image`, { token: friend.token });
  assert.equal(img.status, 200);
  assert.equal(img.type, "image/webp");
  const meta = await sharp(img.buf, { animated: true }).metadata();
  assert.equal(meta.pages, 3);
  assert.equal(meta.exif, undefined);
  const bad = await call(`/constellations/${cid}/emoji?name=nope`, { method: "POST", token: admin.token, raw: Buffer.from("not a picture at all") });
  assert.equal(bad.status, 422);
});

test("stickers: cleaned to 320 px, sent as a photo older apps can show", { skip }, async () => {
  const r = await call(`/constellations/${cid}/emoji?kind=sticker&name=${encodeURIComponent("Owl hype")}`, { method: "POST", token: admin.token, raw: await square("#7c3aed", 800) });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  sticker = r.json.stickers[0];
  assert.equal(sticker.width, 320);
  const sent = await call(`/emoji/${sticker.id}/send`, { method: "POST", token: member.token, body: { conversationId: general.conversationId } });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.equal(sent.json.message.attachments[0].sticker, true);
  // Outside the constellation too (outside is on by default).
  if (dm) assert.equal((await call(`/emoji/${sticker.id}/send`, { method: "POST", token: member.token, body: { conversationId: dm } })).status, 201);
  // Not a member: no.
  assert.equal((await call(`/emoji/${sticker.id}/send`, { method: "POST", token: friend.token, body: { conversationId: dm ?? general.conversationId } })).status, 403);
});

test("messages carry the emoji they use; outside-only rules hold", { skip }, async () => {
  const m = await call(`/conversations/${general.conversationId}/messages`, { method: "POST", token: member.token, body: { body: "gg :gg: :night_owl: :unknown:", emojis: [gg.id, owl.id] } });
  assert.equal(m.status, 201);
  assert.deepEqual(m.json.message.emojis.map((e: any) => e.name).sort(), ["gg", "night_owl"]);
  if (dm) {
    // :night_owl: is inside-only.
    const d = await call(`/conversations/${dm}/messages`, { method: "POST", token: member.token, body: { body: ":gg: :night_owl:", emojis: [gg.id, owl.id] } });
    assert.equal(d.status, 201);
    assert.deepEqual(d.json.message.emojis.map((e: any) => e.name), ["gg"]);
    // Someone not in the constellation can't use it at all.
    const f = await call(`/conversations/${dm}/messages`, { method: "POST", token: friend.token, body: { body: ":gg:", emojis: [gg.id] } });
    assert.equal(f.json.message.emojis, undefined);
    // …but can see where it's from (public: no; this one is invite-only → no name).
    const info = await call(`/emoji/${gg.id}/info`, { token: friend.token });
    assert.equal(info.json.name, "gg");
    assert.equal(info.json.constellation, null);
    assert.equal(info.json.member, false);
  }
  // Reactions: a new app names the emoji; then anyone (even an older app) can press the chip.
  const target = m.json.message.id;
  const r1 = await call(`/conversations/${general.conversationId}/messages/${target}/reactions/${encodeURIComponent(":owl_hype:")}?id=${gg.id}`, { method: "PUT", token: member.token });
  assert.equal(r1.status, 400);
  const r2 = await call(`/conversations/${general.conversationId}/messages/${target}/reactions/${encodeURIComponent(":gg:")}?id=${gg.id}`, { method: "PUT", token: member.token });
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  const r3 = await call(`/conversations/${general.conversationId}/messages/${target}/reactions/${encodeURIComponent(":gg:")}`, { method: "PUT", token: owner.token, old: true });
  assert.equal(r3.status, 200);
  const chip = r3.json.message.reactions.find((x: any) => x.emoji === ":gg:");
  assert.equal(chip.count ?? chip.userIds?.length, 2);
});

test("the picker lists my constellations; renames, limits, removing", { skip }, async () => {
  const mine = await call("/emoji/mine", { token: member.token });
  const set = mine.json.sets.find((x: any) => x.constellation.id === cid);
  assert.equal(set.emoji.length, 2);
  assert.equal(set.stickers.length, 1);
  assert.equal((await call("/emoji/mine", { token: friend.token })).json.sets.some((x: any) => x.constellation.id === cid), false);
  const ren = await call(`/constellations/${cid}/emoji/${gg.id}`, { method: "PATCH", token: admin.token, body: { name: "good game" } });
  assert.equal(ren.status, 200);
  assert.ok(ren.json.emoji.some((e: any) => e.name === "good_game"));
  await pool.query("insert into constellation_emoji (constellation_id, kind, name, width, height) select $1, 'emoji', 'filler' || g, 128, 128 from generate_series(1, 148) g", [cid]);
  const full = await call(`/constellations/${cid}/emoji?name=one_more`, { method: "POST", token: admin.token, raw: await square("#123456") });
  assert.equal(full.status, 409);
  assert.equal((await call(`/constellations/${cid}/emoji/${owl.id}`, { method: "DELETE", token: admin.token })).status, 200);
  assert.equal((await call(`/emoji/${owl.id}/image`, { token: member.token })).status, 404);
  // An older app saving the Admin role keeps "Manage emoji & stickers".
  const roles = (await call(`/constellations/${cid}`, { token: owner.token })).json.constellation.roles;
  const adminRole = roles.find((r: any) => r.kind === "admin");
  assert.ok(adminRole.permissions.includes("manageEmoji"));
  const older = adminRole.permissions.filter((p: string) => p !== "manageEmoji" && p !== "manageStages");
  const saved = await call(`/constellations/${cid}/roles/${adminRole.id}`, { method: "PATCH", token: owner.token, old: true, body: { permissions: older } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const after = (await call(`/constellations/${cid}`, { token: owner.token })).json.constellation.roles.find((r: any) => r.id === adminRole.id);
  assert.ok(after.permissions.includes("manageEmoji"));
});
