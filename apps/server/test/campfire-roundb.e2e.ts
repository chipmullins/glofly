// Campfire Round B (Nov 2026): movement on your turn (speed, Dash, terrain, undo), timed
// conditions, legendary actions, pause, spotlight, moving everyone's view, removing someone,
// whispers, locks and the sound board. Run like campfire.e2e.ts:
//
//   npm run dev -w apps/server            (in one terminal; a dev database, never production)
//   GLOFLY_E2E_URL=http://localhost:4000 npx tsx --env-file=../../.env --test test/campfire-roundb.e2e.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const H = { "content-type": "application/json", "x-glofly-version": "0.9.3", "x-glofly-features": "threads,campfire" };
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");

let pool: pg.Pool;
type Who = { id: string; token: string; username: string };
async function call(path: string, opts: { method?: string; body?: unknown; token?: string; raw?: Buffer } = {}) {
  const headers: Record<string, string> = { ...H };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.raw) headers["content-type"] = "application/octet-stream";
  const r = await fetch(URL_ + path, { method: opts.method ?? "GET", headers, body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
  const buf = Buffer.from(await r.arrayBuffer());
  let json: any = null;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    json = buf;
  }
  return { status: r.status, json };
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
  await call("/friends/requests", { method: "POST", token: a.token, body: { username: b.username } });
  const req = (await call("/friends", { token: b.token })).json.incoming.find((p: any) => p.username === a.username);
  await call(`/friends/requests/${req.id}/accept`, { method: "POST", token: b.token });
}


let gm: Who, p1: Who, p2: Who, other: Who;
let groupId: string;
let cid: string, sceneId: string, pc1: string, tok1: string, gob: string;
const CELL = 70;
const at = (cx: number, cy: number) => ({ x: cx * CELL, y: cy * CELL });

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  gm = await account("rbgm");
  p1 = await account("rbpone");
  p2 = await account("rbptwo");
  other = await account("rbother");
  for (const p of [p1, p2, other]) await befriend(gm, p);
  groupId = (await call("/conversations/group", { method: "POST", token: gm.token, body: { userIds: [p1.id, p2.id], name: "Round B" } })).json.conversation.id;
  cid = (await call("/campfire/campaigns", { method: "POST", token: gm.token, body: { home: { kind: "chat", id: groupId }, name: "Drowned Bell" } })).json.id;
  for (const p of [p1, p2]) await call(`/campfire/campaigns/${cid}`, { token: p.token });
  sceneId = (await call(`/campfire/campaigns/${cid}/scenes`, { method: "POST", token: gm.token, body: { name: "Crypt", widthPx: 1400, heightPx: 980 } })).json.id;
  await call(`/campfire/campaigns/${cid}/scenes/${sceneId}/activate`, { method: "POST", token: gm.token });
  pc1 = (await call(`/campfire/campaigns/${cid}/characters`, { method: "POST", token: p1.token, body: { kind: "pc", name: "Lyra" } })).json.id;
  const t1 = await call(`/campfire/scenes/${sceneId}/tokens`, { method: "POST", token: gm.token, body: { ...at(1, 1), characterId: pc1, controlledBy: [p1.id] } });
  assert.equal(t1.status, 201, JSON.stringify(t1.json));
  tok1 = t1.json.id;
  gob = (await call(`/campfire/scenes/${sceneId}/tokens`, { method: "POST", token: gm.token, body: { ...at(10, 1), srdMonster: "aboleth" } })).json.id;
  await call(`/campfire/campaigns/${cid}`, { method: "PATCH", token: gm.token, body: { settings: { moveOnTurn: true } } });
});

after(async () => {
  if (skip) return;
  await pool.query("delete from campfire_campaigns where conversation_id = any($1)", [[groupId]]);
  await pool.query("delete from conversations where id = any($1)", [[groupId]]);
  await pool.query("delete from users where id = any($1)", [[gm.id, p1.id, p2.id, other.id]]);
  await pool.end();
});

const move = (who: Who, id: string, p: { x: number; y: number }, path?: [number, number][]) =>
  call(`/campfire/tokens/${id}`, { method: "PATCH", token: who.token, body: { ...p, ...(path ? { path } : {}) } });
const combatOp = (who: Who, body: unknown) => call(`/campfire/campaigns/${cid}/combat`, { method: "POST", token: who.token, body });

test("movement on your turn: speed, refused past it, Dash, Undo, difficult terrain", { skip }, async () => {
  assert.equal((await combatOp(gm, { op: "start", tokenIds: [tok1] })).status, 200);
  // 4 squares = 20 ft of Lyra's 30.
  assert.equal((await move(p1, tok1, at(5, 1))).status, 200);
  let c = (await call(`/campfire/campaigns/${cid}`, { token: p1.token })).json.combat;
  assert.equal(c.entries[0].moved, 20);
  // 3 more (15) would be 35: refused.
  const far = await move(p1, tok1, at(8, 1));
  assert.equal(far.status, 403);
  assert.equal(far.json.error, "too_far");
  // A path with a turn costs both legs: 1 down + 1 right = 10, fits.
  assert.equal((await move(p1, tok1, at(6, 2), [[5 * CELL + 35, 2 * CELL + 35]])).status, 200);
  c = (await call(`/campfire/campaigns/${cid}`, { token: gm.token })).json.combat;
  assert.equal(c.entries[0].moved, 30);
  assert.equal((await move(p1, tok1, at(7, 2))).status, 403, "no movement left");
  // Dash doubles it.
  assert.equal((await combatOp(p1, { op: "dash" })).status, 200);
  assert.equal((await combatOp(p1, { op: "dash" })).status, 409, "once a turn");
  assert.equal((await move(p1, tok1, at(9, 2))).status, 200);
  // Undo puts it back and gives the feet back.
  assert.equal((await combatOp(p1, { op: "undoMove" })).status, 200);
  const back = (await call(`/campfire/campaigns/${cid}`, { token: p1.token })).json;
  const tk = back.tokens.find((x: any) => x.id === tok1);
  assert.deepEqual([tk.x, tk.y], [6 * CELL, 2 * CELL]);
  assert.equal(back.combat.entries[0].moved, 30);
  assert.equal((await combatOp(p1, { op: "undoMove" })).status, 409, "one step of undo");
  assert.equal((await combatOp(p2, { op: "dash" })).status, 403, "not their token");
  // Difficult terrain over the next squares: 2 squares through it = 20.
  const built = { floors: [], walls: [], objects: [], notes: [], terrain: [{ kind: "difficult", points: [[7 * CELL, 0], [12 * CELL, 0], [12 * CELL, 5 * CELL], [7 * CELL, 5 * CELL]] }] };
  assert.equal((await call(`/campfire/scenes/${sceneId}`, { method: "PATCH", token: gm.token, body: { built } })).status, 200);
  const p1View = (await call(`/campfire/campaigns/${cid}`, { token: p1.token })).json;
  assert.equal(p1View.scene.built.terrain.length, 1, "players see terrain");
  // 30 left after Dash: 3 squares in mud = 30 fits, 4 = 40 doesn't.
  assert.equal((await move(p1, tok1, at(10, 2))).status, 403);
  assert.equal((await move(p1, tok1, at(9, 2))).status, 200);
  // The next turn starts fresh.
  await combatOp(gm, { op: "next" });
  c = (await call(`/campfire/campaigns/${cid}`, { token: gm.token })).json.combat;
  assert.equal(c.entries[0].moved ?? 0, 0);
  assert.equal(c.entries[0].dashed ?? false, false);
  // Grappled: speed 0.
  await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: gm.token, body: { conditions: ["grappled"] } });
  assert.equal((await move(p1, tok1, at(9, 3))).status, 403);
  await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: gm.token, body: { conditions: [] } });
  await combatOp(gm, { op: "end" });
});

test("timed conditions tick down at the start of the creature's turn and drop off", { skip }, async () => {
  const set = await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: gm.token, body: { conditions: ["poisoned", "prone"], conditionTimers: { poisoned: 2, prone: 3, blinded: 4 } } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.json.conditionTimers, { poisoned: 2, prone: 3 }, "only conditions it has");
  assert.equal((await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: p1.token, body: { conditionTimers: { prone: 9 } } })).status, 403, "players don't set timers");
  await combatOp(gm, { op: "start", tokenIds: [tok1] }); // its turn starts: 1 round off
  let tk = (await call(`/campfire/campaigns/${cid}`, { token: p1.token })).json.tokens.find((x: any) => x.id === tok1);
  assert.deepEqual(tk.conditionTimers, { poisoned: 1, prone: 2 });
  await combatOp(gm, { op: "next" }); // round 2, its turn again
  tk = (await call(`/campfire/campaigns/${cid}`, { token: p1.token })).json.tokens.find((x: any) => x.id === tok1);
  assert.deepEqual(tk.conditions, ["prone"]);
  assert.deepEqual(tk.conditionTimers, { prone: 1 });
  const p2View = (await call(`/campfire/campaigns/${cid}`, { token: p2.token })).json.tokens.find((x: any) => x.id === tok1);
  assert.equal(p2View.conditionTimers, undefined, "others see the condition, not the timer");
  await combatOp(gm, { op: "end" });
});

test("legendary actions: the creature's budget per round, GM only", { skip }, async () => {
  await combatOp(gm, { op: "start", tokenIds: [gob, tok1] });
  assert.equal((await combatOp(gm, { op: "legendary", tokenId: gob, cost: 2 })).status, 200);
  assert.equal((await combatOp(gm, { op: "legendary", tokenId: gob, cost: 2 })).status, 409, "3 a round");
  assert.equal((await combatOp(gm, { op: "legendary", tokenId: gob, cost: 1 })).status, 200);
  assert.equal((await combatOp(gm, { op: "legendary", tokenId: tok1, cost: 1 })).status, 400, "Lyra has none");
  assert.equal((await combatOp(p1, { op: "legendary", tokenId: gob, cost: 1 })).status, 403);
  const p1c = (await call(`/campfire/campaigns/${cid}`, { token: p1.token })).json.combat;
  assert.ok(p1c.entries.every((e: any) => e.legendaryUsed === undefined && e.anchor === undefined), "players don't get the GM's bookkeeping");
  await combatOp(gm, { op: "end" });
});

test("initiative: monsters roll at once, players roll their own, then the order starts", { skip }, async () => {
  await combatOp(gm, { op: "start", tokenIds: [gob, tok1] });
  let c = (await combatOp(gm, { op: "rollAll" })).json.combat;
  assert.equal(c.rolling, true, "waiting for the player");
  assert.ok(c.entries.find((e: any) => e.tokenId === gob).init !== null, "the goblin rolled");
  assert.equal(c.entries.find((e: any) => e.tokenId === tok1).init, null, "Lyra rolls her own");
  assert.equal((await combatOp(gm, { op: "next" })).status, 409, "no turns until everyone has rolled");
  assert.equal((await combatOp(p2, { op: "roll", tokenId: tok1 })).status, 403, "only her player");
  const p1c = (await call(`/campfire/campaigns/${cid}`, { token: p1.token })).json.combat;
  assert.equal(p1c.rolling, true);
  c = (await combatOp(p1, { op: "roll", tokenId: tok1 })).json.combat;
  assert.equal(c.rolling, undefined, "everyone rolled: the fight starts");
  assert.equal(c.turn, 0);
  assert.ok(c.entries.every((e: any) => e.init !== null));
  // A new round of initiative, and the GM rolls for an absent player.
  c = (await combatOp(gm, { op: "rollAll" })).json.combat;
  assert.equal(c.rolling, true);
  c = (await combatOp(gm, { op: "rollAll", rest: true })).json.combat;
  assert.equal(c.rolling, undefined);
  assert.ok(c.entries.every((e: any) => e.init !== null));
  await combatOp(gm, { op: "end" });
});

test("pause: players can't move or roll; GMs can; everyone gets the state", { skip }, async () => {
  assert.equal((await call(`/campfire/campaigns/${cid}/pause`, { method: "POST", token: p1.token, body: { on: true } })).status, 403);
  const on = await call(`/campfire/campaigns/${cid}/pause`, { method: "POST", token: gm.token, body: { on: true, message: "Pizza's here" } });
  assert.equal(on.status, 200);
  const view = (await call(`/campfire/campaigns/${cid}`, { token: p1.token })).json.campaign.live;
  assert.equal(view.paused.message, "Pizza's here");
  assert.equal((await move(p1, tok1, at(2, 2))).status, 423);
  assert.equal((await call(`/campfire/campaigns/${cid}/rolls`, { method: "POST", token: p1.token, body: { expression: "1d20" } })).status, 423);
  assert.equal((await call(`/campfire/campaigns/${cid}/rolls`, { method: "POST", token: gm.token, body: { expression: "1d20" } })).status, 201);
  await call(`/campfire/campaigns/${cid}/pause`, { method: "POST", token: gm.token, body: { on: false } });
  assert.equal((await move(p1, tok1, at(2, 2))).status, 200);
});

test("spotlight, moving everyone's view, locks", { skip }, async () => {
  assert.equal((await call(`/campfire/campaigns/${cid}/spotlight`, { method: "POST", token: gm.token, body: { userId: other.id } })).status, 400, "not at this table");
  const s = await call(`/campfire/campaigns/${cid}/spotlight`, { method: "POST", token: gm.token, body: { userId: p2.id } });
  assert.equal(s.json.live.spotlight, p2.id);
  assert.equal((await call(`/campfire/campaigns/${cid}/view`, { method: "POST", token: gm.token, body: { sceneId, x: 300, y: 200 } })).status, 200);
  const hidden = (await call(`/campfire/campaigns/${cid}/scenes`, { method: "POST", token: gm.token, body: { name: "Secret", widthPx: 700, heightPx: 700 } })).json.id;
  assert.equal((await call(`/campfire/campaigns/${cid}/view`, { method: "POST", token: gm.token, body: { sceneId: hidden, x: 1, y: 1 } })).status, 409);
  assert.equal((await call(`/campfire/campaigns/${cid}/view`, { method: "POST", token: p1.token, body: { sceneId, x: 1, y: 1 } })).status, 403);
  // Locks
  await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: gm.token, body: { locked: true } });
  assert.equal((await move(p1, tok1, at(3, 3))).status, 403);
  await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: gm.token, body: { locked: false } });
  await call(`/campfire/campaigns/${cid}`, { method: "PATCH", token: gm.token, body: { settings: { tokensLocked: true } } });
  assert.equal((await move(p1, tok1, at(3, 3))).status, 403);
  await call(`/campfire/campaigns/${cid}`, { method: "PATCH", token: gm.token, body: { settings: { tokensLocked: false } } });
  assert.equal((await move(p1, tok1, at(3, 3))).status, 200);
  // Players may set their own token's height, not lock it.
  assert.equal((await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: p1.token, body: { elevation: 20 } })).json.elevation, 20);
  assert.equal((await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: p1.token, body: { locked: true } })).status, 403);
});

test("removing someone from the table, and letting them back", { skip }, async () => {
  assert.equal((await call(`/campfire/campaigns/${cid}/members/${gm.id}/remove`, { method: "POST", token: gm.token, body: { removed: true } })).status, 400);
  assert.equal((await call(`/campfire/campaigns/${cid}/members/${p1.id}/remove`, { method: "POST", token: p2.token, body: { removed: true } })).status, 403);
  assert.equal((await call(`/campfire/campaigns/${cid}/members/${p2.id}/remove`, { method: "POST", token: gm.token, body: { removed: true } })).status, 200);
  assert.equal((await call(`/campfire/campaigns/${cid}`, { token: p2.token })).status, 404);
  assert.equal((await call(`/campfire/campaigns/${cid}/hub`, { token: p2.token })).status, 404);
  await call(`/campfire/campaigns/${cid}/members/${p2.id}/remove`, { method: "POST", token: gm.token, body: { removed: false } });
  assert.equal((await call(`/campfire/campaigns/${cid}`, { token: p2.token })).status, 200);
});

test("whispers and the sound board", { skip }, async () => {
  assert.equal((await call(`/campfire/campaigns/${cid}/whisper`, { method: "POST", token: gm.token, body: { to: other.id, on: true } })).status, 400);
  assert.equal((await call(`/campfire/campaigns/${cid}/whisper`, { method: "POST", token: gm.token, body: { to: p1.id, on: true } })).status, 200);
  assert.equal((await call(`/campfire/campaigns/${cid}/whisper`, { method: "POST", token: p1.token, body: { to: p2.id, on: true } })).status, 403);
  const list = await call(`/campfire/campaigns/${cid}/sounds`, { token: p1.token });
  assert.ok(list.json.builtin.some((s: any) => s.id === "bell"));
  assert.deepEqual(list.json.sounds, []);
  assert.equal((await call(`/campfire/campaigns/${cid}/sound`, { method: "POST", token: gm.token, body: { builtin: "bell" } })).status, 200);
  assert.equal((await call(`/campfire/campaigns/${cid}/sound`, { method: "POST", token: gm.token, body: { builtin: "../etc" } })).status, 400);
  assert.equal((await call(`/campfire/campaigns/${cid}/sound`, { method: "POST", token: p1.token, body: { builtin: "bell" } })).status, 403);
  // An uploaded clip: 1 s of silence as a WAV.
  const rate = 8000;
  const data = Buffer.alloc(rate * 2);
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + data.length, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(data.length, 40);
  const up = await call(`/campfire/campaigns/${cid}/files?kind=audio`, { method: "POST", token: gm.token, raw: Buffer.concat([wav, data]) });
  assert.equal(up.status, 201, JSON.stringify(up.json));
  assert.equal((await call(`/campfire/files/${up.json.id}`, { token: p1.token })).status, 404, "not a sound yet");
  const snd = await call(`/campfire/campaigns/${cid}/sounds`, { method: "POST", token: gm.token, body: { fileId: up.json.id, name: "Silence" } });
  assert.equal(snd.status, 201, JSON.stringify(snd.json));
  assert.equal((await call(`/campfire/files/${up.json.id}`, { token: p1.token })).status, 200, "players load sounds they hear");
  assert.equal((await call(`/campfire/campaigns/${cid}/sound`, { method: "POST", token: gm.token, body: { soundId: snd.json.id } })).status, 200);
  assert.equal((await call(`/campfire/sounds/${snd.json.id}`, { method: "DELETE", token: p1.token })).status, 403);
  assert.equal((await call(`/campfire/sounds/${snd.json.id}`, { method: "DELETE", token: gm.token })).status, 200);
});

test("security review fixes: paths, GM moves, conditions, pause on actions, undo locks", { skip }, async () => {
  await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: gm.token, body: { ...at(1, 1), conditions: [], locked: false } });
  await combatOp(gm, { op: "start", tokenIds: [tok1] });
  // A path far off the map is refused at once (no cell-by-cell walk).
  const zig: [number, number][] = Array.from({ length: 50 }, (_, i) => (i % 2 ? [100_000, 100_000] : [-100_000, -100_000]));
  const t0 = Date.now();
  const off = await move(p1, tok1, at(2, 1), zig);
  assert.equal(off.status, 403);
  assert.ok(Date.now() - t0 < 1500, "answered quickly");
  // A long zig-zag inside the map stops counting past the step limit (too far, not slow).
  const inside: [number, number][] = Array.from({ length: 50 }, (_, i) => (i % 2 ? [1300, 900] : [50, 50]));
  const t1 = Date.now();
  assert.equal((await move(p1, tok1, at(2, 1), inside)).status, 403);
  assert.ok(Date.now() - t1 < 1500, "answered quickly");
  // The GM shoving Lyra isn't charged to her turn, and she can't undo it.
  assert.equal((await move(gm, tok1, at(4, 1))).status, 200);
  let c = (await call(`/campfire/campaigns/${cid}`, { token: gm.token })).json.combat;
  assert.equal(c.entries[0].moved ?? 0, 0);
  assert.equal((await combatOp(p1, { op: "undoMove" })).status, 409, "nothing of hers to undo");
  // Her move counts from where the GM put her: 1 square = 5 ft.
  assert.equal((await move(p1, tok1, at(5, 1))).status, 200);
  c = (await call(`/campfire/campaigns/${cid}`, { token: gm.token })).json.combat;
  assert.equal(c.entries[0].moved, 5);
  // Locked: no undo for the player.
  await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: gm.token, body: { locked: true } });
  assert.equal((await combatOp(p1, { op: "undoMove" })).status, 403);
  await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: gm.token, body: { locked: false } });
  // Players can't take off a condition that stops movement.
  await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: gm.token, body: { conditions: ["restrained", "prone"] } });
  assert.equal((await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: p1.token, body: { conditions: ["prone"] } })).status, 403);
  assert.equal((await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: p1.token, body: { conditions: ["restrained"] } })).status, 200, "prone is theirs to drop");
  await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: gm.token, body: { conditions: [] } });
  // Paused: damage, healing, rests and token changes wait too.
  await call(`/campfire/campaigns/${cid}/pause`, { method: "POST", token: gm.token, body: { on: true, message: "  " } });
  assert.equal((await call(`/campfire/tokens/${tok1}/damage`, { method: "POST", token: p1.token, body: { amount: 1 } })).status, 423);
  assert.equal((await call(`/campfire/tokens/${tok1}/heal`, { method: "POST", token: p1.token, body: { amount: 1 } })).status, 423);
  assert.equal((await call(`/campfire/characters/${pc1}/rest`, { method: "POST", token: p1.token, body: { kind: "short" } })).status, 423);
  assert.equal((await call(`/campfire/tokens/${tok1}`, { method: "PATCH", token: p1.token, body: { conditions: ["prone"] } })).status, 423);
  await call(`/campfire/campaigns/${cid}/pause`, { method: "POST", token: gm.token, body: { on: false } });
  // A locked sheet keeps its speed.
  const sheet = (await call(`/campfire/characters/${pc1}`, { token: gm.token })).json.sheet;
  await call(`/campfire/characters/${pc1}`, { method: "PATCH", token: gm.token, body: { sheet: { ...sheet, locked: true } } });
  await call(`/campfire/characters/${pc1}`, { method: "PATCH", token: p1.token, body: { sheet: { ...sheet, locked: true, speed: 500 } } });
  assert.equal((await call(`/campfire/characters/${pc1}`, { token: p1.token })).json.sheet.speed, sheet.speed);
  await call(`/campfire/characters/${pc1}`, { method: "PATCH", token: gm.token, body: { sheet: { ...sheet, locked: false } } });
  await combatOp(gm, { op: "end" });
});
