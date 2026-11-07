// Communities round (FiveM/RedM quick wins): cfx.re/join cards. The lookup is off on dev
// (CFX_SERVER_LOOKUP), so the route answers without asking Cfx.re; the answer parsing is
// checked against a sample of Cfx.re's server-list shape.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { clearSignupLimit } from "./e2eLimits";
import { cardFrom } from "../src/games/cfx";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
let pool: pg.Pool;
let user: { id: string; token: string };

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const username = `cfx${randomBytes(3).toString("hex")}`;
  const r = await fetch(URL_ + "/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-glofly-version": "0.9.0" },
    body: JSON.stringify({ email: `${username}@example.com`, username, displayName: "Cfx", password: "glofly-e2e-" + username, birthday: "1995-05-14", acceptTerms: true }),
  });
  const j: any = await r.json();
  user = { id: j.user.id, token: j.token };
});
after(async () => {
  if (skip) return;
  await pool.query("delete from users where id = $1", [user.id]);
  await pool.end();
});

const get = (path: string, token?: string) =>
  fetch(URL_ + path, { headers: { "x-glofly-version": "0.9.0", ...(token ? { authorization: `Bearer ${token}` } : {}) } });

test("the card route: signed in only, checks the code, no lookup while it's off", { skip }, async () => {
  assert.equal((await get("/games/cfx/abc123")).status, 401);
  assert.equal((await get("/games/cfx/no%20way", user.token)).status, 400);
  const r = await get("/games/cfx/AbC123", user.token);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { code: "abc123", lookup: false });
});

test("Cfx.re's answer becomes a small, clean card", () => {
  const card = cardFrom("abc123", {
    EndPoint: "abc123",
    Data: { hostname: "^1Cozy ^7RP | whitelisted", clients: 41, sv_maxclients: "64", vars: { sv_projectName: "^3Cozy RP", gamename: "rdr3", sv_licenseKeyToken: "secret" }, players: [{ name: "x", identifiers: ["license:1"] }] },
  });
  assert.deepEqual(card, { code: "abc123", lookup: true, found: true, name: "Cozy RP", players: 41, maxPlayers: 64, game: "redm" });
  assert.deepEqual(cardFrom("abc123", { error: "not found" }), { code: "abc123", lookup: true, found: false });
  assert.equal(cardFrom("abc123", { Data: { hostname: "X", clients: -5, sv_maxclients: "lots" } }).players, undefined);
});
