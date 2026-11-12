// Communities round 2 (item 4): big constellations. Over 1,000 members the detail lists only staff,
// me and people online (memberCount says how many there are), and the member list loads page by
// page from GET /constellations/:id/members (sorted by name, searchable). Generated members are
// inserted straight into the database. Run like the other e2e tests.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const H = { "x-glofly-version": "0.9.0", "x-glofly-features": "threads, round2", "content-type": "application/json" };
const tag = randomBytes(3).toString("hex");
let pool: pg.Pool;
const made: string[] = [];
let owner: { id: string; token: string };
let cid: string;

async function call(path: string, token: string, method = "GET", body?: unknown) {
  const r = await fetch(URL_ + path, { method, headers: { ...H, authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const r = await fetch(URL_ + "/auth/register", { method: "POST", headers: H, body: JSON.stringify({ email: `bigowner${tag}@example.com`, username: `bigowner${tag}`, displayName: "Big Owner", password: "glofly-e2e-" + tag, birthday: "1995-05-14", acceptTerms: true }) });
  const j = await r.json();
  owner = { id: j.user.id, token: j.token };
  made.push(owner.id);
  cid = (await call("/constellations", owner.token, "POST", { name: `Big ${tag}`, template: "gaming" })).json.constellation.id;
  await pool.query(
    `insert into users (username, display_name, email, password_hash, birthday, terms_accepted_at)
     select 'big_${tag}_' || g, 'Big ' || lpad(g::text, 4, '0'), 'big_${tag}_' || g || '@load.invalid', '!load', '2000-01-01', now() from generate_series(1, 1100) g`,
  );
  await pool.query(`insert into constellation_members (constellation_id, user_id) select $1, id from users where username like 'big\\_${tag}\\_%'`, [cid]);
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.query(`delete from users where username like 'big\\_${tag}\\_%' or id = any($1)`, [made]);
  await pool.end();
});

test("big constellations: a partial member list in the detail, the rest page by page", { skip }, async () => {
  const d = (await call(`/constellations/${cid}`, owner.token)).json.constellation;
  assert.equal(d.memberCount, 1101);
  assert.equal(d.membersPartial, true);
  assert.ok(d.members.length < 20, `only staff + online, got ${d.members.length}`);
  assert.ok(d.members.some((m: any) => m.user.id === owner.id));
  // Older apps get the same (they show fewer people; nothing breaks).
  // Page through everyone by name.
  const first = await call(`/constellations/${cid}/members?limit=100`, owner.token);
  assert.equal(first.status, 200);
  assert.equal(first.json.total, 1101);
  assert.equal(first.json.members.length, 100);
  assert.equal(first.json.members[0].user.displayName, "Big 0001");
  const second = await call(`/constellations/${cid}/members?limit=100&after=${first.json.next}`, owner.token);
  assert.equal(second.json.members[0].user.displayName, "Big 0101");
  assert.equal(second.json.total, undefined);
  // Search finds anyone.
  const found = await call(`/constellations/${cid}/members?q=${encodeURIComponent("Big 1099")}`, owner.token);
  assert.deepEqual(found.json.members.map((m: any) => m.user.displayName), ["Big 1099"]);
  // A bad cursor is just ignored; outsiders get nothing.
  assert.equal((await call(`/constellations/${cid}/members?after=nonsense`, owner.token)).status, 200);
  const stranger = await fetch(URL_ + "/auth/register", { method: "POST", headers: H, body: JSON.stringify({ email: `bigx${tag}@example.com`, username: `bigx${tag}`, displayName: "X", password: "glofly-e2e-" + tag, birthday: "1995-05-14", acceptTerms: true }) }).then((r) => r.json());
  made.push(stranger.user.id);
  assert.equal((await call(`/constellations/${cid}/members`, stranger.token)).status, 404);
});
