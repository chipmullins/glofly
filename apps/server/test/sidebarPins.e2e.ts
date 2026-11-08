// 0.9.3 constellations pinned to the desktop sidebar. Run like threads.e2e.ts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const tag = randomBytes(3).toString("hex");
let pool: pg.Pool;
async function call(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-glofly-version": "0.9.3" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(URL_ + path, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
}
let me: { id: string; token: string };
const ids: string[] = [];

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const username = `pins${tag}`;
  const r = await call("/auth/register", { method: "POST", body: { email: `${username}@example.com`, username, displayName: "Pins", password: "glofly-e2e-" + tag + "x1", birthday: "1995-05-14", acceptTerms: true } });
  me = { id: r.json.user.id, token: r.json.token };
  for (let i = 0; i < 6; i++) {
    const made = await call("/constellations", { method: "POST", token: me.token, body: { name: `Pins ${i} ${tag}`, template: "blank" } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    ids.push(made.json.constellation.id);
  }
});
after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = any($1)", [ids]);
  await pool.query("delete from users where id = $1", [me.id]);
  await pool.end();
});

test("pin up to 5, in order, reorder, unpin", { skip }, async () => {
  for (const id of ids.slice(0, 5)) assert.equal((await call(`/constellations/${id}/sidebar-pin`, { method: "PUT", token: me.token })).status, 204);
  // Pinning one already pinned changes nothing.
  assert.equal((await call(`/constellations/${ids[0]}/sidebar-pin`, { method: "PUT", token: me.token })).status, 204);
  const full = await call(`/constellations/${ids[5]}/sidebar-pin`, { method: "PUT", token: me.token });
  assert.equal(full.status, 409);
  assert.match(full.json.message, /up to 5/);
  let cards = (await call("/constellations", { token: me.token })).json.constellations;
  const pinned = (l: any[]) => l.filter((c) => c.sidebarPin !== null).sort((a, b) => a.sidebarPin - b.sidebarPin).map((c) => c.id);
  assert.deepEqual(pinned(cards), ids.slice(0, 5));
  const detail = await call(`/constellations/${ids[0]}`, { token: me.token });
  assert.equal(detail.json.constellation.me.sidebarPinned, true);
  const order = [ids[4], ids[0], ids[1], ids[2], ids[3]];
  assert.equal((await call("/constellations/sidebar-pins/order", { method: "PUT", token: me.token, body: { ids: order } })).status, 204);
  cards = (await call("/constellations", { token: me.token })).json.constellations;
  assert.deepEqual(pinned(cards), order);
  assert.equal((await call(`/constellations/${ids[4]}/sidebar-pin`, { method: "DELETE", token: me.token })).status, 204);
  assert.equal((await call(`/constellations/${ids[5]}/sidebar-pin`, { method: "PUT", token: me.token })).status, 204);
  cards = (await call("/constellations", { token: me.token })).json.constellations;
  assert.equal(pinned(cards).length, 5);
  assert.equal(pinned(cards).at(-1), ids[5]);
  // Someone else's constellation (not a member): not found.
  assert.equal((await call(`/constellations/${crypto.randomUUID()}/sidebar-pin`, { method: "PUT", token: me.token })).status, 404);
});
