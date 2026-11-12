// Campfire 0.11.2: map pieces the game master hides (one by one, or a whole map layer) never reach
// players: not in the table, not in a scene, not over the live connection. Showing them sends
// them. An app from before hidden pieces keeps the game master's marks when it saves the map.
// Run like campfire.e2e.ts:
//
//   npm run dev -w apps/server            (in one terminal; a dev database, never production)
//   GLOFLY_E2E_URL=http://localhost:4000 npx tsx --env-file=../../.env --test test/campfire-hidden.e2e.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { io, type Socket } from "socket.io-client";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const NEW = "threads, round2, campfire, campfire2";
const OLD = "threads,campfire";
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Who = { id: string; token: string; username: string };

async function call(path: string, opts: { method?: string; body?: unknown; token?: string; features?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-glofly-version": "0.11.2", "x-glofly-features": opts.features ?? NEW };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(URL_ + path, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}
async function account(name: string): Promise<Who> {
  const username = `${name}${tag}`;
  const r = await call("/auth/register", {
    method: "POST",
    body: { email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthday: "1995-05-14", acceptTerms: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.user.id, token: r.json.token, username };
}
async function befriend(a: Who, b: Who) {
  assert.ok((await call("/friends/requests", { method: "POST", token: a.token, body: { username: b.username } })).status < 300);
  const req = (await call("/friends", { token: b.token })).json.incoming.find((p: any) => p.username === a.username);
  assert.ok((await call(`/friends/requests/${req.id}/accept`, { method: "POST", token: b.token })).status < 300);
}

let pool: pg.Pool;
let gm: Who, p1: Who, p2: Who;
let groupId: string, campaignId: string, sceneId: string;
const sockets: Socket[] = [];

const sq = (x: number, y: number, w = 140) => [[x, y], [x + w, y], [x + w, y + w], [x, y + w]];
const MAP = {
  layers: [
    { id: "vault", name: "Secret vault", hidden: true },
    { id: "up", name: "Upstairs" },
  ],
  floors: [
    { id: "hall", points: sq(0, 0), material: "stone" },
    { id: "closet", points: sq(200, 0), material: "wood", hidden: true },
    { id: "vaultfloor", points: sq(400, 0), material: "stone", layer: "vault" },
    { id: "stairs", points: sq(600, 0), material: "stone", layer: "up" },
  ],
  walls: [{ id: "secretdoor", points: [[140, 0], [140, 140]], door: { state: "closed" }, hidden: true }],
  objects: [{ id: "gold", kind: "chest", x: 420, y: 20, w: 60, h: 40, rotation: 0, layer: "vault" }],
  notes: [],
  terrain: [{ id: "pit", kind: "difficult", points: sq(200, 200), hidden: true }],
};

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  gm = await account("hidgm");
  p1 = await account("hidpa");
  p2 = await account("hidpb");
  await befriend(gm, p1);
  await befriend(gm, p2);
  const group = await call("/conversations/group", { method: "POST", token: gm.token, body: { userIds: [p1.id, p2.id], name: "Hidden" } });
  groupId = group.json.conversation.id;
  const made = await call("/campfire/campaigns", { method: "POST", token: gm.token, body: { home: { kind: "chat", id: groupId }, name: "Vaults" } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  campaignId = made.json.id;
  const scene = await call(`/campfire/campaigns/${campaignId}/scenes`, { method: "POST", token: gm.token, body: { name: "Keep" } });
  sceneId = scene.json.id;
  assert.equal((await call(`/campfire/campaigns/${campaignId}/scenes/${sceneId}/activate`, { method: "POST", token: gm.token })).status, 200);
});

after(async () => {
  if (skip) return;
  for (const s of sockets) s.close();
  await pool.query("delete from campfire_campaigns where id = $1", [campaignId]);
  await pool.query("delete from conversations where id = $1", [groupId]);
  await pool.query("delete from users where id = any($1)", [[gm.id, p1.id, p2.id]]);
  await pool.end();
});

const playerScene = async (who: Who) => (await call(`/campfire/campaigns/${campaignId}`, { token: who.token })).json.scene;
const ids = (list: { id: string }[] | undefined) => (list ?? []).map((x) => x.id).sort();

test("hidden pieces and hidden layers never reach players", { skip }, async () => {
  const saved = await call(`/campfire/scenes/${sceneId}`, { method: "PATCH", token: gm.token, body: { built: MAP } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  // The game master gets everything, marks and layers included.
  assert.deepEqual(ids(saved.json.built.floors), ["closet", "hall", "stairs", "vaultfloor"]);
  assert.equal(saved.json.built.layers.length, 2);
  const s = await playerScene(p1);
  assert.deepEqual(ids(s.built.floors), ["hall", "stairs"]);
  assert.equal(s.built.walls.length, 0);
  assert.equal(s.built.objects.length, 0);
  assert.equal(s.built.terrain, undefined);
  assert.equal(s.built.layers, undefined, "no layer names");
  const raw = JSON.stringify(s);
  for (const secret of ["Secret vault", "closet", "vaultfloor", "secretdoor", "gold", "pit", '"hidden"', '"layer"']) assert.ok(!raw.includes(secret), `player saw ${secret}`);
  // Opening the scene directly gives a player the same filtered map.
  const direct = await call(`/campfire/scenes/${sceneId}`, { token: p1.token });
  assert.equal(direct.status, 200);
  assert.deepEqual(ids(direct.json.scene.built.floors), ["hall", "stairs"]);
  assert.ok(!JSON.stringify(direct.json).includes("Secret vault"));
});

test("showing a layer or a piece sends it to players live", { skip }, async () => {
  const events: any[] = [];
  const socket: Socket = io(URL_!, { auth: { token: p2.token, version: "0.11.2", features: ["constellations", "campfire"] }, transports: ["websocket"], forceNew: true });
  sockets.push(socket);
  socket.onAny((name: string, data: any) => {
    if (name === "campfire:fog") events.push(data);
  });
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", reject);
  });
  assert.ok((await call(`/campfire/campaigns/${campaignId}/presence`, { method: "POST", token: p2.token, body: { here: true } })).status < 300);
  const gmView = (await call(`/campfire/scenes/${sceneId}`, { token: gm.token })).json.scene.built;
  const shown = { ...gmView, layers: gmView.layers.map((l: any) => (l.id === "vault" ? { id: l.id, name: l.name } : l)) };
  assert.equal((await call(`/campfire/scenes/${sceneId}`, { method: "PATCH", token: gm.token, body: { built: shown } })).status, 200);
  await wait(600);
  const live = events.at(-1);
  assert.ok(live, "a live update came");
  assert.deepEqual(ids(live.built.floors), ["hall", "stairs", "vaultfloor"]);
  assert.deepEqual(ids(live.built.objects), ["gold"]);
  assert.ok(!JSON.stringify(live).includes("closet"), "the closet is still hidden");
  assert.deepEqual(ids((await playerScene(p1)).built.floors), ["hall", "stairs", "vaultfloor"]);
});

test("an app from before hidden pieces keeps the marks when it saves", { skip }, async () => {
  const gmView = (await call(`/campfire/scenes/${sceneId}`, { token: gm.token })).json.scene.built;
  // What an older app sends: no layers, no marks (it never knew them), and one wall moved.
  const strip = (x: any) => {
    const { hidden: _h, layer: _l, ...rest } = x;
    return rest;
  };
  const old = {
    floors: gmView.floors.map(strip),
    walls: gmView.walls.map((w: any) => ({ ...strip(w), points: [[150, 0], [150, 140]] })),
    objects: gmView.objects.map(strip),
    notes: [],
    terrain: gmView.terrain.map(strip),
  };
  const r = await call(`/campfire/scenes/${sceneId}`, { method: "PATCH", token: gm.token, features: OLD, body: { built: old } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.built.floors.find((f: any) => f.id === "closet").hidden, true);
  assert.equal(r.json.built.walls[0].hidden, true);
  assert.deepEqual(r.json.built.walls[0].points, [[150, 0], [150, 140]], "the move itself is kept");
  assert.equal(r.json.built.layers.length, 2);
  assert.deepEqual(ids((await playerScene(p1)).built.floors), ["hall", "stairs", "vaultfloor"]);
  // A new app can unhide.
  const fresh = { ...r.json.built, floors: r.json.built.floors.map(strip) };
  const r2 = await call(`/campfire/scenes/${sceneId}`, { method: "PATCH", token: gm.token, body: { built: fresh } });
  assert.equal(r2.json.built.floors.every((f: any) => !f.hidden), true);
  assert.ok(ids((await playerScene(p1)).built.floors).includes("closet"));
});
