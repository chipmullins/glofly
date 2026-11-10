// Campfire (phase 1, Nov 2026): the tabletop, against a real server with Postgres and Redis.
// Run like integrations.e2e.ts:
//
//   npm run dev -w apps/server            (in one terminal; a dev database, never production)
//   GLOFLY_E2E_URL=http://localhost:4000 npx tsx --env-file=../../.env --test test/campfire.e2e.ts
//
// It makes its own throwaway accounts, constellation and group each run. The Lockdown and Pause
// tests switch those on for a few seconds (the server re-reads them every 5 s), then off again.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { io, type Socket } from "socket.io-client";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const H = { "content-type": "application/json", "x-glofly-version": "0.9.3", "x-glofly-features": "threads,campfire" };
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pool: pg.Pool;
type Who = { id: string; token: string; username: string };
async function call(path: string, opts: { method?: string; body?: unknown; token?: string; raw?: Buffer; type?: string; headers?: Record<string, string>; old?: boolean } = {}) {
  const headers: Record<string, string> = { ...H, ...(opts.headers ?? {}) };
  if (opts.old) headers["x-glofly-features"] = "threads";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.raw) headers["content-type"] = opts.type ?? "application/octet-stream";
  const r = await fetch(URL_ + path, { method: opts.method ?? "GET", headers, body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
  const buf = Buffer.from(await r.arrayBuffer());
  let json: any = null;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    json = buf;
  }
  return { status: r.status, json, headers: r.headers };
}
async function account(name: string): Promise<Who> {
  const username = `${name}${tag}`;
  const r = await call("/auth/register", {
    method: "POST",
    body: { email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthday: "1995-05-14", acceptTerms: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.user.id as string, token: r.json.token as string, username };
}
async function befriend(a: Who, b: Who) {
  assert.ok((await call("/friends/requests", { method: "POST", token: a.token, body: { username: b.username } })).status < 300);
  const req = (await call("/friends", { token: b.token })).json.incoming.find((p: any) => p.username === a.username);
  assert.ok((await call(`/friends/requests/${req.id}/accept`, { method: "POST", token: b.token })).status < 300);
}

const sockets: Socket[] = [];
/** A live connection that collects Campfire events. */
function listen(who: Who, features = ["constellations", "campfire"]) {
  const events: { name: string; data: any }[] = [];
  const socket: Socket = io(URL_!, { auth: { token: who.token, version: "0.9.3", features }, transports: ["websocket"], forceNew: true });
  sockets.push(socket);
  socket.onAny((name: string, data: any) => {
    if (name.startsWith("campfire:")) events.push({ name, data });
  });
  const ready = new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", reject);
  });
  return { socket, events, ready, of: (name: string) => events.filter((e) => e.name === name).map((e) => e.data) };
}

let gm: Who, p1: Who, p2: Who, outsider: Who, kid: Who;
let cid: string;
let voice: { id: string; conversationId: string };
let general: { id: string; conversationId: string };
let groupId: string;
let campaignId: string;
let chatCampaignId: string;
let sceneId: string;
let scene2Id: string;
const tok: Record<string, string> = {};
let goblinCharId: string;
let pcId: string;

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  gm = await account("cfgm");
  p1 = await account("cfpone");
  p2 = await account("cfptwo");
  outsider = await account("cfout");
  kid = await account("cfkid");
  const made = await call("/constellations", { method: "POST", token: gm.token, body: { name: `Campfire ${tag}`, template: "gaming" } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  cid = made.json.constellation.id;
  voice = made.json.constellation.nebulas.find((n: any) => n.kind === "voice");
  general = made.json.constellation.nebulas.find((n: any) => n.kind === "text");
  // AutoMod blocks a word (the /roll test puts it in a roll's label).
  await pool.query("insert into constellation_automod (constellation_id, words_on, words) values ($1, true, '{trollword}')", [cid]);
  const link = await call(`/constellations/${cid}/links`, { method: "POST", token: gm.token, body: { lifetime: "7d" } });
  for (const p of [p1, p2, kid]) assert.ok((await call(`/constellations/links/${link.json.link.code}/join`, { method: "POST", token: p.token })).status < 300);
  await befriend(gm, p1);
  await befriend(gm, p2);
  const group = await call("/conversations/group", { method: "POST", token: gm.token, body: { userIds: [p1.id, p2.id], name: "Table" } });
  assert.ok(group.status < 300, JSON.stringify(group.json));
  groupId = group.json.conversation.id;
});

after(async () => {
  if (skip) return;
  for (const s of sockets) s.close();
  await pool.query("delete from server_settings where key in ('lockdown', 'pause')");
  await pool.query("delete from campfire_campaigns where constellation_id = $1 or conversation_id = $2", [cid, groupId]);
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.query("delete from conversations where id = $1", [groupId]);
  await pool.query("delete from users where id = any($1)", [[gm.id, p1.id, p2.id, outsider.id, kid.id]]);
  await pool.end();
});

test("homes, permissions to create, restricted accounts", { skip }, async () => {
  const asPlayer = await call(`/campfire/homes/nebula/${voice.conversationId}/campaigns`, { token: p1.token });
  assert.equal(asPlayer.status, 200);
  assert.equal(asPlayer.json.canCreate, false, "Members can't run games");
  assert.equal((await call(`/campfire/homes/nebula/${voice.conversationId}/campaigns`, { token: outsider.token })).status, 404);
  assert.equal((await call(`/campfire/homes/nebula/${general.conversationId}/campaigns`, { token: gm.token })).status, 404, "text nebulas aren't homes");
  const no = await call("/campfire/campaigns", { method: "POST", token: p1.token, body: { home: { kind: "nebula", id: voice.conversationId }, name: "Mine" } });
  assert.equal(no.status, 403);
  assert.equal((await call(`/campfire/homes/nebula/${voice.conversationId}/campaigns`, { token: gm.token })).json.canCreate, true);
  const made = await call("/campfire/campaigns", { method: "POST", token: gm.token, body: { home: { kind: "nebula", id: voice.conversationId }, name: "  Lost Mine  " } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.name, "Lost Mine");
  assert.equal(made.json.myRole, "gm");
  assert.deepEqual(made.json.settings, { gmApprovesDamage: true, showMonsterHp: "bloodied", diceVisibility: "all" });
  campaignId = made.json.id;
  const list = await call(`/campfire/homes/nebula/${voice.conversationId}/campaigns`, { token: p1.token });
  assert.deepEqual(list.json.campaigns.map((c: any) => [c.id, c.myRole]), [[campaignId, "player"]]);
  // Group chats: any member can start one.
  const chat = await call("/campfire/campaigns", { method: "POST", token: p1.token, body: { home: { kind: "chat", id: groupId }, name: "Side quest" } });
  assert.equal(chat.status, 201, JSON.stringify(chat.json));
  chatCampaignId = chat.json.id;
  assert.equal((await call(`/campfire/campaigns/${chatCampaignId}`, { token: gm.token })).json.myRole, "player");
  assert.equal((await call(`/campfire/campaigns/${chatCampaignId}`, { token: outsider.token })).status, 404);
  assert.equal((await call("/campfire/campaigns", { method: "POST", token: gm.token, body: { home: { kind: "chat", id: groupId }, name: "" } })).status, 400);
  // A restricted (family) account can't be at a constellation's table.
  assert.equal((await call(`/campfire/campaigns/${campaignId}`, { token: kid.token })).status, 200);
  await pool.query("update users set restricted = true where id = $1", [kid.id]);
  assert.equal((await call(`/campfire/campaigns/${campaignId}`, { token: kid.token })).status, 404);
  assert.equal((await call(`/campfire/homes/nebula/${voice.conversationId}/campaigns`, { token: kid.token })).status, 404);
  // Players can't change the campaign; a bad id is just not found.
  assert.equal((await call(`/campfire/campaigns/${campaignId}`, { method: "PATCH", token: p1.token, body: { name: "Mine now" } })).status, 403);
  assert.equal((await call(`/campfire/campaigns/not-a-uuid`, { token: gm.token })).status, 404);
});

test("older apps keep Run Campfire games on the Admin role; Owner and Admin have it", { skip }, async () => {
  const detail = await call(`/constellations/${cid}`, { token: gm.token });
  const admin = detail.json.constellation.roles.find((r: any) => r.kind === "admin");
  assert.ok(admin.permissions.includes("runGames"));
  const without = admin.permissions.filter((p: string) => p !== "runGames");
  const saved = await call(`/constellations/${cid}/roles/${admin.id}`, { method: "PATCH", token: gm.token, body: { permissions: without }, old: true });
  assert.ok(saved.status < 300, JSON.stringify(saved.json));
  const { rows } = await pool.query("select permissions from constellation_roles where id = $1", [admin.id]);
  assert.ok(rows[0].permissions.includes("runGames"), "an app that doesn't know Campfire doesn't drop it");
  const member = detail.json.constellation.roles.find((r: any) => r.kind === "member");
  assert.ok(!member.permissions.includes("runGames"));
});

test("scenes, tokens and fog: players never get hidden things", { skip }, async () => {
  const built = {
    floors: [
      { id: "lit", points: [[0, 0], [700, 0], [700, 700], [0, 700]], material: "wood" },
      { id: "dark", points: [[1400, 1400], [2000, 1400], [2000, 2000]], material: "stone" },
    ],
    walls: [{ id: "w1", points: [[0, 0], [700, 0]], door: { state: "locked" } }],
    objects: [{ id: "chest", kind: "chest", x: 1500, y: 1500, w: 70, h: 70, rotation: 0 }],
    notes: [{ id: "n1", x: 100, y: 100, text: "The mimic is the second chest" }],
  };
  const s = await call(`/campfire/campaigns/${campaignId}/scenes`, {
    method: "POST",
    token: gm.token,
    body: { name: "Cragmaw cave", widthPx: 2100, heightPx: 2100, grid: { type: "square", size: 70, feet: 5 }, theme: "cave", built, fog: { enabled: true, revealed: [{ id: "r1", kind: "rect", points: [[0, 0], [700, 700]] }] } },
  });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  sceneId = s.json.id;
  assert.equal(s.json.built.notes.length, 1, "the GM gets the notes");
  assert.equal((await call(`/campfire/campaigns/${campaignId}/scenes`, { method: "POST", token: p1.token, body: { name: "x" } })).status, 403);
  scene2Id = (await call(`/campfire/campaigns/${campaignId}/scenes`, { method: "POST", token: gm.token, body: { name: "Next room" } })).json.id;

  const pc = await call(`/campfire/campaigns/${campaignId}/characters`, {
    method: "POST",
    token: p1.token,
    body: { kind: "pc", name: "Thorin", sheet: { ac: 18, hp: { current: 20, max: 20, temp: 5 }, abilities: { dex: 14 }, concentration: "Bless", classes: [{ name: "Fighter", level: 3, hitDie: 10, caster: "none" }] } },
  });
  assert.equal(pc.status, 201, JSON.stringify(pc.json));
  pcId = pc.json.id;
  assert.equal((await call(`/campfire/campaigns/${campaignId}/characters`, { method: "POST", token: p1.token, body: { kind: "npc", name: "Fake" } })).status, 403);

  const mk = async (name: string, body: Record<string, unknown>) => {
    const r = await call(`/campfire/scenes/${sceneId}/tokens`, { method: "POST", token: gm.token, body: { name, ...body } });
    assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.json)}`);
    tok[name] = r.json.id;
    return r.json;
  };
  const goblin = await mk("goblin", { x: 140, y: 140, srdMonster: "goblin" });
  goblinCharId = goblin.characterId;
  assert.equal(goblin.bars[0].value, 7);
  await mk("goblin2", { x: 280, y: 280, srdMonster: "goblin" });
  await mk("lurker", { x: 1500, y: 1500, srdMonster: "goblin" });
  await mk("trap", { x: 70, y: 70, layer: "gm" });
  await mk("thorin", { x: 1400, y: 70, characterId: pcId, controlledBy: [p1.id] });
  await mk("cart", { x: 210, y: 0, layer: "map", showName: false });

  const asGm = await call(`/campfire/campaigns/${campaignId}`, { token: gm.token });
  assert.equal(asGm.json.tokens.length, 6);
  const t1 = await call(`/campfire/campaigns/${campaignId}`, { token: p1.token });
  assert.equal(t1.status, 200);
  const names = t1.json.tokens.map((t: any) => t.id).sort();
  assert.deepEqual(names, [tok.goblin, tok.goblin2, tok.thorin, tok.cart].sort(), "no fogged or GM-layer tokens; own token even in fog");
  const g = t1.json.tokens.find((t: any) => t.id === tok.goblin);
  assert.equal(g.characterId, null, "NPC sheets stay hidden");
  assert.equal(g.bars[0].value, null, "monster HP numbers stay hidden");
  assert.equal(g.bars[0].state, "healthy");
  assert.equal(t1.json.tokens.find((t: any) => t.id === tok.cart).name, "", "hidden names stay hidden");
  assert.deepEqual(t1.json.scene.built.notes, [], "no GM notes");
  assert.deepEqual(t1.json.scene.built.floors.map((f: any) => f.id), ["lit"]);
  assert.deepEqual(t1.json.scene.built.objects, []);
  assert.ok(!t1.json.characters.some((c: any) => c.kind === "npc"), "no NPCs in the character list");
  const mine = t1.json.characters.find((c: any) => c.id === pcId);
  assert.equal(mine.full, true);
  const t2 = await call(`/campfire/campaigns/${campaignId}`, { token: p2.token });
  const theirs = t2.json.characters.find((c: any) => c.id === pcId);
  assert.equal(theirs.sheet, undefined, "other players get a PC's public part only");
  assert.equal(theirs.summary.ac, 18);
  assert.equal(t2.json.tokens.find((t: any) => t.id === tok.thorin), undefined, "someone else's token in fog is hidden");
  assert.equal(JSON.stringify(t1.json).includes("mimic"), false);
  assert.deepEqual(t1.json.scenes.map((x: any) => x.id), [sceneId], "players only see the active scene");
  assert.equal((await call(`/campfire/characters/${goblinCharId}`, { token: p1.token })).status, 404);
  assert.equal((await call(`/campfire/scenes/${scene2Id}`, { token: p1.token })).status, 404);
  assert.equal((await call(`/campfire/scenes/${scene2Id}`, { token: gm.token })).status, 200);
  assert.equal((await call(`/campfire/tokens/${tok.trap}`, { method: "PATCH", token: p1.token, body: { x: 0, y: 0 } })).status, 404);

  // Settings: exact HP for everyone.
  await call(`/campfire/campaigns/${campaignId}`, { method: "PATCH", token: gm.token, body: { settings: { showMonsterHp: "exact" } } });
  assert.equal((await call(`/campfire/campaigns/${campaignId}`, { token: p1.token })).json.tokens.find((t: any) => t.id === tok.goblin).bars[0].value, 7);
  await call(`/campfire/campaigns/${campaignId}`, { method: "PATCH", token: gm.token, body: { settings: { showMonsterHp: "none" } } });
  assert.equal((await call(`/campfire/campaigns/${campaignId}`, { token: p1.token })).json.tokens.find((t: any) => t.id === tok.goblin).bars[0], null);
  await call(`/campfire/campaigns/${campaignId}`, { method: "PATCH", token: gm.token, body: { settings: { showMonsterHp: "bloodied" } } });
});

test("live events are filtered per person, only to apps that know Campfire", { skip }, async () => {
  const a = listen(p1);
  const old = listen(p2, ["constellations"]);
  const g = listen(gm);
  await Promise.all([a.ready, old.ready, g.ready]);
  for (const who of [p1, p2]) assert.equal((await call(`/campfire/campaigns/${campaignId}/presence`, { method: "POST", token: who.token })).status, 200);
  const start = (await call(`/campfire/campaigns/${campaignId}`, { token: p1.token })).json.seq;
  // The lurker walks out of the fog, then back in.
  await call(`/campfire/tokens/${tok.lurker}`, { method: "PATCH", token: gm.token, body: { x: 350, y: 350 } });
  await wait(300);
  let ev = a.of("campfire:token");
  assert.equal(ev.at(-1).op, "upsert");
  assert.equal(ev.at(-1).token.id, tok.lurker);
  assert.equal(ev.at(-1).campaignId, campaignId);
  assert.ok(ev.at(-1).seq > start);
  await call(`/campfire/tokens/${tok.lurker}`, { method: "PATCH", token: gm.token, body: { x: 1500, y: 1500 } });
  await wait(300);
  ev = a.of("campfire:token");
  assert.deepEqual([ev.at(-1).op, ev.at(-1).tokenId], ["delete", tok.lurker]);
  // Moving hidden things around tells players nothing.
  const before = a.events.length;
  await call(`/campfire/tokens/${tok.lurker}`, { method: "PATCH", token: gm.token, body: { x: 1600, y: 1500 } });
  await call(`/campfire/tokens/${tok.trap}`, { method: "PATCH", token: gm.token, body: { x: 0, y: 0 } });
  await wait(300);
  assert.equal(a.events.length, before);
  assert.ok(g.of("campfire:token").some((e) => e.token?.id === tok.trap), "the GM hears about everything");
  // Revealing fog sends the newly visible tokens and pieces.
  await call(`/campfire/scenes/${sceneId}/fog`, { method: "POST", token: gm.token, body: { op: "reveal", shape: { kind: "poly", points: [[1400, 1400], [2100, 1400], [2100, 2100], [1400, 2100]] } } });
  await wait(300);
  const fog = a.of("campfire:fog").at(-1);
  assert.ok(fog.tokens.some((t: any) => t.id === tok.lurker));
  assert.deepEqual(fog.built.floors.map((f: any) => f.id).sort(), ["dark", "lit"]);
  assert.deepEqual(fog.built.notes, []);
  await call(`/campfire/scenes/${sceneId}/fog`, { method: "POST", token: gm.token, body: { op: "hide", shape: { kind: "rect", points: [[1400, 1400], [2100, 2100]] } } });
  await wait(300);
  assert.ok(!a.of("campfire:fog").at(-1).tokens.some((t: any) => t.id === tok.lurker));
  assert.equal((await call(`/campfire/scenes/${sceneId}/fog`, { method: "POST", token: p1.token, body: { op: "revealAll" } })).status, 403);
  // GM-only rolls never reach players; rolls for everyone do.
  await call(`/campfire/campaigns/${campaignId}/rolls`, { method: "POST", token: gm.token, body: { expression: "1d20+4", label: "Secret", visibility: "gm" } });
  await call(`/campfire/campaigns/${campaignId}/rolls`, { method: "POST", token: gm.token, body: { expression: "1d6", visibility: "all" } });
  await wait(300);
  const rolls = a.of("campfire:roll");
  assert.equal(rolls.length, 1);
  assert.equal(rolls[0].roll.expression, "1d6");
  assert.equal(old.events.length, 0, "an app without the campfire feature gets nothing");
  // Sequences have no gaps for each person.
  const seqs = a.events.map((e) => e.data.seq);
  for (let i = 1; i < seqs.length; i++) assert.equal(seqs[i], seqs[i - 1] + 1);
  // Dragging over the live connection: only your own tokens.
  a.socket.emit("campfire:move", { tokenId: tok.thorin, x: 420, y: 70 });
  a.socket.emit("campfire:move", { tokenId: tok.goblin, x: 0, y: 0 });
  await wait(500);
  const { rows } = await pool.query("select id, x, y from campfire_tokens where id = any($1)", [[tok.thorin, tok.goblin]]);
  assert.equal(rows.find((r) => r.id === tok.thorin).x, 420);
  assert.equal(rows.find((r) => r.id === tok.goblin).x, 140);
  for (const s of [a, old, g]) s.socket.close();
});

test("move rules for players", { skip }, async () => {
  assert.equal((await call(`/campfire/tokens/${tok.thorin}`, { method: "PATCH", token: p1.token, body: { x: 490, y: 70 } })).status, 200);
  assert.equal((await call(`/campfire/tokens/${tok.goblin}`, { method: "PATCH", token: p1.token, body: { x: 0, y: 0 } })).status, 403);
  assert.equal((await call(`/campfire/tokens/${tok.thorin}`, { method: "PATCH", token: p1.token, body: { layer: "gm" } })).status, 403);
  assert.equal((await call(`/campfire/tokens/${tok.thorin}`, { method: "PATCH", token: p1.token, body: { controlledBy: [p2.id] } })).status, 403);
  assert.equal((await call(`/campfire/tokens/${tok.thorin}`, { method: "PATCH", token: p2.token, body: { x: 0, y: 0 } })).status, 403);
  const cond = await call(`/campfire/tokens/${tok.thorin}`, { method: "PATCH", token: p1.token, body: { conditions: ["prone"] } });
  assert.deepEqual(cond.json.conditions, ["prone"]);
  assert.equal((await call(`/campfire/tokens/${tok.thorin}`, { method: "PATCH", token: p1.token, body: { x: 1e9, y: 0 } })).status, 400);
  assert.equal((await call(`/campfire/tokens/${tok.thorin}`, { method: "DELETE", token: p1.token })).status, 403);
  // HP bar and sheet stay in step.
  const bar = await call(`/campfire/tokens/${tok.thorin}`, { method: "PATCH", token: p1.token, body: { bars: [{ value: 18, max: 20, color: "#e0193a", show: "gm" }] } });
  assert.equal(bar.status, 200, JSON.stringify(bar.json));
  assert.equal(bar.json.bars[0].show, "all", "players can't change who sees a bar");
  const sheet = await call(`/campfire/characters/${pcId}`, { token: p1.token });
  assert.equal(sheet.json.sheet.hp.current, 18);
  await call(`/campfire/characters/${pcId}`, { method: "PATCH", token: p1.token, body: { sheet: { ...sheet.json.sheet, hp: { current: 20, max: 20, temp: 5 } } } });
  // A locked sheet keeps its HP max and AC.
  const locked = { ...sheet.json.sheet, hp: { current: 20, max: 20, temp: 5 }, locked: true };
  assert.equal((await call(`/campfire/characters/${pcId}`, { method: "PATCH", token: gm.token, body: { sheet: locked } })).status, 200);
  const cheat = await call(`/campfire/characters/${pcId}`, { method: "PATCH", token: p1.token, body: { sheet: { ...locked, ac: 30, hp: { current: 99, max: 99, temp: 5 }, locked: false } } });
  assert.equal(cheat.json.sheet.ac, 18);
  assert.equal(cheat.json.sheet.hp.max, 20);
  assert.equal(cheat.json.sheet.locked, true);
  assert.equal((await call(`/campfire/characters/${pcId}`, { method: "PATCH", token: p2.token, body: { name: "Mine" } })).status, 403);
});

test("rolls: server dice, friendly errors, history filtered, whispers", { skip }, async () => {
  const bad = await call(`/campfire/campaigns/${campaignId}/rolls`, { method: "POST", token: p1.token, body: { expression: "1d20+" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.message, "That roll ends too soon. Add a number or dice after the + or −.");
  const big = await call(`/campfire/campaigns/${campaignId}/rolls`, { method: "POST", token: p1.token, body: { expression: "500d6" } });
  assert.equal(big.json.message, "You can roll 1 to 100 dice at once.");
  const r = await call(`/campfire/campaigns/${campaignId}/rolls`, { method: "POST", token: p1.token, body: { expression: "2d20kh1+5 [Stealth]", characterId: pcId } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.label, "Stealth");
  assert.ok(r.json.total >= 6 && r.json.total <= 25);
  assert.match(r.json.result.breakdown, /^2d20kh1\+5 → \(/);
  const w = await call(`/campfire/campaigns/${campaignId}/rolls`, { method: "POST", token: gm.token, body: { expression: "1d4", visibility: "whisper", whisperTo: [p1.id] } });
  assert.equal(w.status, 201);
  const h1 = await call(`/campfire/campaigns/${campaignId}/rolls`, { token: p1.token });
  const h2 = await call(`/campfire/campaigns/${campaignId}/rolls`, { token: p2.token });
  assert.ok(h1.json.rolls.some((x: any) => x.id === w.json.id));
  assert.ok(!h2.json.rolls.some((x: any) => x.id === w.json.id));
  assert.ok(!h2.json.rolls.some((x: any) => x.label === "Secret"), "no GM-only rolls in a player's history");
  assert.ok((await call(`/campfire/campaigns/${campaignId}/rolls`, { token: gm.token })).json.rolls.some((x: any) => x.label === "Secret"));
  assert.equal((await call(`/campfire/campaigns/${campaignId}/rolls`, { method: "POST", token: p2.token, body: { expression: "1d6", characterId: pcId } })).status, 403);
  // Dice visibility "GM only" for players.
  await call(`/campfire/campaigns/${campaignId}`, { method: "PATCH", token: gm.token, body: { settings: { diceVisibility: "gm" } } });
  const forced = await call(`/campfire/campaigns/${campaignId}/rolls`, { method: "POST", token: p2.token, body: { expression: "1d6", visibility: "all" } });
  assert.equal(forced.json.visibility, "gm");
  assert.ok(!(await call(`/campfire/campaigns/${campaignId}/rolls`, { token: p1.token })).json.rolls.some((x: any) => x.id === forced.json.id));
  await call(`/campfire/campaigns/${campaignId}`, { method: "PATCH", token: gm.token, body: { settings: { diceVisibility: "all" } } });
});

test("the hit flow: hit/miss without the AC, crits, pending damage, temp HP, concentration, death saves", { skip }, async () => {
  const atk = (body: Record<string, unknown>, token = p1.token) =>
    call(`/campfire/campaigns/${campaignId}/attack`, { method: "POST", token, body: { attackerTokenId: tok.thorin, targetTokenId: tok.goblin, ...body } });
  const sword = (toHit: string, damage: string) => ({ attack: { name: "Longsword", toHit, damage, damageType: "slashing", kind: "melee" } });
  // Never a natural 1 or 20; +100 always hits, −100 always misses (goblin AC 15).
  const miss = await atk(sword("1d20min2max19-100", "7"));
  assert.equal(miss.status, 200, JSON.stringify(miss.json));
  assert.equal(miss.json.hit, false);
  assert.equal(miss.json.damage, null);
  const hit = await atk(sword("1d20min2max19+100", "7"));
  assert.equal(hit.json.hit, true);
  assert.equal(hit.json.crit, false);
  assert.equal(hit.json.pending, null, "players don't see pending damage");
  assert.equal(JSON.stringify(hit.json).includes('"ac"'), false, "players never learn the AC");
  let state = await call(`/campfire/campaigns/${campaignId}`, { token: gm.token });
  assert.equal(state.json.pending.length, 1);
  assert.equal(state.json.pending[0].amount, 7);
  assert.deepEqual((await call(`/campfire/campaigns/${campaignId}`, { token: p1.token })).json.pending, []);
  assert.equal((await call(`/campfire/pending/${state.json.pending[0].id}/apply`, { method: "POST", token: p1.token })).status, 403);
  // A natural 20: the damage dice are rolled twice.
  const crit = await atk(sword("1d20min20", "2d2min2+1"));
  assert.equal(crit.json.crit, true);
  assert.equal(crit.json.damage.expression, "4d2min2+1");
  assert.equal(crit.json.damage.total, 9);
  // The attacker must be your own token.
  assert.equal((await atk(sword("1d20", "1"), p2.token)).status, 403);
  assert.equal((await atk({ ...sword("2d6", "1") })).json.message, "An attack roll needs a d20, like 1d20+5.");
  state = await call(`/campfire/campaigns/${campaignId}`, { token: gm.token });
  const [first, second] = state.json.pending;
  // Skip one, apply the other with a change: the goblin (7 HP) takes 5, is bloodied.
  assert.equal((await call(`/campfire/pending/${second.id}/skip`, { method: "POST", token: gm.token })).status, 200);
  const a = listen(p1);
  await a.ready;
  await call(`/campfire/campaigns/${campaignId}/presence`, { method: "POST", token: p1.token });
  const applied = await call(`/campfire/pending/${first.id}/apply`, { method: "POST", token: gm.token, body: { amount: 5 } });
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  assert.equal(applied.json.applied.amount, 5);
  assert.equal(applied.json.applied.bloodied, true);
  assert.equal((await call(`/campfire/pending/${first.id}/apply`, { method: "POST", token: gm.token })).status, 404, "applied once");
  await wait(300);
  const hitEv = a.of("campfire:hit").at(-1);
  assert.equal(hitEv.targetTokenId, tok.goblin);
  assert.equal(hitEv.attackerTokenId, tok.thorin);
  assert.equal(hitEv.kind, "melee");
  const goblinNow = a.of("campfire:token").filter((e) => e.token?.id === tok.goblin).at(-1);
  assert.deepEqual([goblinNow.token.bars[0].value, goblinNow.token.bars[0].state], [null, "bloodied"]);
  // Without approval, damage lands at once; 0 HP = defeated.
  await call(`/campfire/campaigns/${campaignId}`, { method: "PATCH", token: gm.token, body: { settings: { gmApprovesDamage: false } } });
  const kill = await atk(sword("1d20min2max19+100", "10"));
  assert.equal(kill.json.applied.defeated, true);
  const gob = (await call(`/campfire/characters/${goblinCharId}`, { token: gm.token })).json;
  assert.equal(gob.sheet.hp.current, 0);
  const { rows } = await pool.query("select conditions from campfire_tokens where id = $1", [tok.goblin]);
  assert.ok(rows[0].conditions.includes("defeated"));
  // Temporary HP first, then a concentration prompt (DC 10 or half the damage).
  const dmg = await call(`/campfire/tokens/${tok.thorin}/damage`, { method: "POST", token: gm.token, body: { amount: 8, type: "fire" } });
  assert.equal(dmg.json.applied.concentrationDc, 10);
  let pc = (await call(`/campfire/characters/${pcId}`, { token: p1.token })).json;
  assert.deepEqual(pc.sheet.hp, { current: 17, max: 20, temp: 0 });
  const big = await call(`/campfire/tokens/${tok.thorin}/damage`, { method: "POST", token: gm.token, body: { amount: 40 } });
  assert.equal(big.json.applied.concentrationDc, 20);
  assert.equal(big.json.applied.defeated, true);
  pc = (await call(`/campfire/characters/${pcId}`, { token: p1.token })).json;
  assert.equal(pc.sheet.hp.current, 0);
  assert.ok(pc.sheet.conditions.includes("unconscious"));
  // Hit while down: a death save failure. Then death saves are rolled on the server.
  await call(`/campfire/tokens/${tok.thorin}/damage`, { method: "POST", token: gm.token, body: { amount: 1 } });
  pc = (await call(`/campfire/characters/${pcId}`, { token: p1.token })).json;
  assert.equal(pc.sheet.deathSaves.failures, 1);
  const ds = await call(`/campfire/characters/${pcId}/death-save`, { method: "POST", token: p1.token });
  assert.equal(ds.status, 200, JSON.stringify(ds.json));
  assert.ok(["success", "failure", "stable", "dead", "revived"].includes(ds.json.outcome));
  assert.equal((await call(`/campfire/characters/${pcId}/death-save`, { method: "POST", token: p2.token })).status, 404);
  // Healing brings them back; a long rest restores everything.
  await call(`/campfire/tokens/${tok.thorin}/heal`, { method: "POST", token: p1.token, body: { amount: 5 } });
  pc = (await call(`/campfire/characters/${pcId}`, { token: p1.token })).json;
  if (!pc.sheet.deathSaves.dead) assert.ok(!pc.sheet.conditions.includes("unconscious"));
  const rest = await call(`/campfire/characters/${pcId}/rest`, { method: "POST", token: p1.token, body: { kind: "long" } });
  assert.equal(rest.json.sheet.hp.current, 20);
  // Save spells: a DC nobody makes, then one everybody makes (half damage).
  const fail = await call(`/campfire/campaigns/${campaignId}/save-spell`, {
    method: "POST",
    token: p1.token,
    body: { casterTokenId: tok.thorin, targetTokenIds: [tok.goblin2], dc: 40, ability: "dex", damage: "10", half: true, damageType: "fire", name: "Burning Hands" },
  });
  assert.equal(fail.status, 200, JSON.stringify(fail.json));
  assert.deepEqual([fail.json.targets[0].saved, fail.json.targets[0].amount], [false, 10]);
  assert.equal(fail.json.targets[0].save.result.breakdown, "", "a monster's save bonus stays hidden");
  const made = await call(`/campfire/campaigns/${campaignId}/save-spell`, {
    method: "POST",
    token: gm.token,
    body: { casterTokenId: tok.goblin, targetTokenIds: [tok.thorin], dc: 1, ability: "dex", damage: "9", half: true },
  });
  assert.deepEqual([made.json.targets[0].saved, made.json.targets[0].amount], [true, 4]);
  await call(`/campfire/campaigns/${campaignId}`, { method: "PATCH", token: gm.token, body: { settings: { gmApprovesDamage: true } } });
  a.socket.close();
});

test("the turn order", { skip }, async () => {
  const c = (body: Record<string, unknown>, token = gm.token) => call(`/campfire/campaigns/${campaignId}/combat`, { method: "POST", token, body });
  assert.equal((await c({ op: "next" })).status, 409);
  const start = await c({ op: "start", tokenIds: [tok.thorin, tok.goblin2, tok.trap] });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  assert.equal(start.json.combat.round, 1);
  assert.equal(start.json.combat.entries.find((e: any) => e.tokenId === tok.trap).hidden, true, "GM-layer tokens start hidden");
  const rolled = await c({ op: "rollAll" });
  const inits = rolled.json.combat.entries.map((e: any) => e.init);
  assert.ok(inits.every((n: any) => typeof n === "number"));
  assert.deepEqual([...inits].sort((x, y) => y - x), inits, "highest first");
  const asPlayer = (await call(`/campfire/campaigns/${campaignId}`, { token: p1.token })).json.combat;
  assert.ok(!asPlayer.entries.some((e: any) => e.tokenId === tok.trap));
  assert.equal((await c({ op: "roll", tokenId: tok.goblin2 }, p1.token)).status, 403);
  const mine = await c({ op: "roll", tokenId: tok.thorin }, p1.token);
  assert.equal(mine.status, 200);
  assert.ok(!mine.json.combat.entries.some((e: any) => e.tokenId === tok.trap), "a player's answer is filtered too");
  const ids = [tok.goblin2, tok.thorin, tok.trap];
  const order = await c({ op: "reorder", tokenIds: ids });
  assert.deepEqual(order.json.combat.entries.map((e: any) => e.tokenId), ids);
  assert.equal((await c({ op: "reorder", tokenIds: [tok.goblin2] })).status, 400);
  // Reordering keeps the turn with whoever had it; going past the last starts round 2.
  let st = order.json.combat;
  for (let i = st.turn; i < 3; i++) st = (await c({ op: "next" })).json.combat;
  assert.deepEqual([st.round, st.turn], [2, 0]);
  st = (await c({ op: "prev" })).json.combat;
  assert.deepEqual([st.round, st.turn], [1, 2]);
  // "End my turn": a player may only end a turn that is theirs (the trap's isn't).
  assert.equal((await c({ op: "next" }, p1.token)).status, 403);
  st = (await c({ op: "next" })).json.combat;
  st = (await c({ op: "next" })).json.combat;
  assert.equal(st.entries[st.turn].tokenId, tok.thorin);
  const ended = await c({ op: "next" }, p1.token);
  assert.equal(ended.status, 200, JSON.stringify(ended.json));
  // Now it's the hidden trap's turn: the player's (filtered) answer doesn't say whose.
  assert.deepEqual([ended.json.combat.round, ended.json.combat.current], [2, null]);
  st = (await c({ op: "remove", tokenId: tok.trap })).json.combat;
  assert.equal(st.entries.length, 2);
  st = (await c({ op: "set", tokenId: tok.goblin2, init: 30 })).json.combat;
  assert.equal(st.entries[0].tokenId, tok.goblin2);
  assert.equal((await c({ op: "end" })).json.combat, null);
});

test("files: uploads, limits, who may download", { skip }, async () => {
  const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#335533" } }).png().toBuffer();
  const up = (kind: string, raw: Buffer, token = gm.token, type = "image/png") => call(`/campfire/campaigns/${campaignId}/files?kind=${kind}`, { method: "POST", token, raw, type });
  const map = await up("map", png);
  assert.equal(map.status, 201, JSON.stringify(map.json));
  assert.equal(map.json.mime, "image/webp");
  assert.equal(map.json.width, 640);
  assert.equal((await up("map", png, p1.token)).status, 403);
  assert.equal((await up("map", Buffer.from("not a picture at all"))).status, 400);
  assert.equal((await up("sword", png)).status, 400);
  assert.equal((await up("map", png, outsider.token)).status, 404);
  const tooBig = await up("token", Buffer.alloc(9 * 1024 * 1024, 1), p1.token);
  assert.equal(tooBig.status, 413);
  const huge = await sharp({ create: { width: 9000, height: 100, channels: 3, background: "#000" } }).png().toBuffer();
  assert.equal((await up("map", huge)).json.message, "Maps can be up to 8192 pixels on each side.");
  const portrait = await up("portrait", png, p1.token);
  assert.equal(portrait.status, 201);
  // The map on the scene everyone's on: players can load it. On another scene: GMs only.
  await call(`/campfire/scenes/${scene2Id}`, { method: "PATCH", token: gm.token, body: { backgroundFileId: map.json.id } });
  assert.equal((await call(`/campfire/files/${map.json.id}`, { token: p2.token })).status, 404);
  assert.equal((await call(`/campfire/files/${map.json.id}`, { token: gm.token })).status, 200);
  await call(`/campfire/scenes/${sceneId}`, { method: "PATCH", token: gm.token, body: { backgroundFileId: map.json.id } });
  const got = await call(`/campfire/files/${map.json.id}`, { token: p2.token });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/webp");
  assert.equal((await call(`/campfire/files/${map.json.id}`, { token: outsider.token })).status, 404);
  assert.equal((await call(`/campfire/files/..%2F..%2Fetc%2Fpasswd`, { token: gm.token })).status, 404);
  // A handout picture: only for people the handout is shared with.
  const pic = await up("handout", png);
  const ho = await call(`/campfire/campaigns/${campaignId}/handouts`, { method: "POST", token: gm.token, body: { title: "Map to Wave Echo", body: "**X** marks it", imageFileId: pic.json.id, shared: "some", sharedWith: [p1.id] } });
  assert.equal(ho.status, 201, JSON.stringify(ho.json));
  assert.equal((await call(`/campfire/files/${pic.json.id}`, { token: p1.token })).status, 200);
  assert.equal((await call(`/campfire/files/${pic.json.id}`, { token: p2.token })).status, 404);
  assert.equal((await call(`/campfire/campaigns/${campaignId}/handouts/${ho.json.id}`, { token: p2.token })).status, 404);
  assert.deepEqual((await call(`/campfire/campaigns/${campaignId}/handouts`, { token: p2.token })).json.handouts, []);
  assert.deepEqual((await call(`/campfire/campaigns/${campaignId}/handouts/${ho.json.id}`, { token: p1.token })).json.sharedWith, [p1.id]);
  assert.equal((await call(`/campfire/campaigns/${campaignId}/handouts`, { method: "POST", token: p1.token, body: { title: "x" } })).status, 403);
  const shared = await call(`/campfire/campaigns/${campaignId}/handouts/${ho.json.id}`, { method: "PATCH", token: gm.token, body: { shared: "all" } });
  assert.equal(shared.status, 200);
  assert.equal((await call(`/campfire/campaigns/${campaignId}/handouts`, { token: p2.token })).json.handouts.length, 1);
  // Music: a short WAV, a track, playing it for the table; players stream it in ranges.
  const samples = 8000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  assert.equal((await up("audio", png)).json.message, "Music can be MP3, Ogg, M4A or WAV files.");
  const audio = await up("audio", wav, gm.token, "audio/wav");
  assert.equal(audio.status, 201, JSON.stringify(audio.json));
  assert.equal((await call(`/campfire/files/${audio.json.id}`, { token: p2.token })).status, 404, "not a track yet");
  const track = await call(`/campfire/campaigns/${campaignId}/tracks`, { method: "POST", token: gm.token, body: { fileId: audio.json.id, title: "Tavern" } });
  assert.equal(track.status, 201, JSON.stringify(track.json));
  assert.equal(track.json.durationSec, 1);
  const ranged = await call(`/campfire/files/${audio.json.id}`, { token: p2.token, headers: { range: "bytes=0-99" } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.json.length, 100);
  const play = await call(`/campfire/campaigns/${campaignId}/music`, { method: "POST", token: gm.token, body: { op: "play", trackId: track.json.id, loop: true } });
  assert.equal(play.json.music.playing, true);
  assert.equal((await call(`/campfire/campaigns/${campaignId}/music`, { method: "POST", token: p1.token, body: { op: "stop" } })).status, 403);
  const paused = await call(`/campfire/campaigns/${campaignId}/music`, { method: "POST", token: gm.token, body: { op: "pause" } });
  assert.equal(paused.json.music.playing, false);
  assert.equal((await call(`/campfire/campaigns/${campaignId}`, { token: p1.token })).json.music.trackId, track.json.id);
});

test("compendium: SRD monsters and spells with the credit line", { skip }, async () => {
  const list = await call("/campfire/srd/monsters?q=gob", { token: p1.token });
  assert.ok(list.json.monsters.some((m: any) => m.slug === "goblin"));
  const goblin = await call("/campfire/srd/monsters/goblin", { token: p1.token });
  assert.equal(goblin.json.sheet.ac, 15);
  assert.equal(goblin.json.sheet.hp.max, 7);
  assert.equal(goblin.json.sheet.attacks[0].fixedToHit, 4);
  assert.equal(goblin.json.credit, "Includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.");
  const spells = await call("/campfire/srd/spells?level=3&class=wizard&q=fire", { token: p1.token });
  assert.ok(spells.json.spells.some((s: any) => s.slug === "fireball"));
  const fireball = await call("/campfire/srd/spells/fireball", { token: p1.token });
  assert.deepEqual(fireball.json.save, { ability: "dex", half: true });
  assert.equal((await call("/campfire/srd/monsters/..%2Fetc", { token: p1.token })).status, 404);
});

test("/roll in chats: rolled on the server, plain text for older apps, AutoMod still applies", { skip }, async () => {
  const send = (conversationId: string, body: string, token: string) => call(`/conversations/${conversationId}/messages`, { method: "POST", token, body: { body } });
  const r = await send(groupId, "/roll 1d20+3 #Initiative", p1.token);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.message.roll.expression, "1d20+3");
  assert.equal(r.json.message.roll.label, "Initiative");
  assert.match(r.json.message.body, /^🎲 cfpone rolled 1d20\+3 \(Initiative\): \d+/);
  assert.equal(r.json.message.roll.dice.length, 1);
  const page = await call(`/conversations/${groupId}/messages`, { token: p2.token });
  assert.ok(page.json.messages.some((m: any) => m.roll && m.id === r.json.message.id));
  assert.equal((await send(groupId, "/roll banana", p1.token)).status, 400);
  assert.equal((await call(`/conversations/${groupId}/messages/${r.json.message.id}`, { method: "PATCH", token: p1.token, body: { body: "/roll 20" } })).status, 400);
  assert.equal((await send(groupId, "/rolling on the floor", p1.token)).json.message.roll, undefined);
  const neb = await send(general.conversationId, "/roll 2d6", p1.token);
  assert.equal(neb.status, 201, JSON.stringify(neb.json));
  assert.ok(neb.json.message.roll);
  const blocked = await send(general.conversationId, "/roll 1d6 #trollword", p1.token);
  assert.notEqual(blocked.status, 201, "AutoMod checks the label");
});

test("members: GMs can make GMs; deleting is the creator's", { skip }, async () => {
  assert.equal((await call(`/campfire/campaigns/${campaignId}/members/${p2.id}`, { method: "PUT", token: p1.token, body: { role: "gm" } })).status, 403);
  const made = await call(`/campfire/campaigns/${campaignId}/members/${p2.id}`, { method: "PUT", token: gm.token, body: { role: "gm" } });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const t2 = await call(`/campfire/campaigns/${campaignId}`, { token: p2.token });
  assert.equal(t2.json.myRole, "gm");
  assert.ok(t2.json.tokens.some((t: any) => t.id === tok.trap), "a new GM sees the GM layer");
  assert.equal((await call(`/campfire/campaigns/${campaignId}/members/${gm.id}`, { method: "PUT", token: p2.token, body: { role: "player" } })).status, 403);
  assert.equal((await call(`/campfire/campaigns/${campaignId}/members/${outsider.id}`, { method: "PUT", token: gm.token, body: { role: "gm" } })).status, 404);
  await call(`/campfire/campaigns/${campaignId}/members/${p2.id}`, { method: "PUT", token: gm.token, body: { role: "player" } });
  assert.equal((await call(`/campfire/campaigns/${campaignId}`, { token: p2.token })).json.myRole, "player");
  assert.equal((await call(`/campfire/campaigns/${chatCampaignId}`, { method: "DELETE", token: gm.token })).status, 403);
  assert.equal((await call(`/campfire/campaigns/${chatCampaignId}`, { method: "DELETE", token: p1.token })).status, 200);
  assert.equal((await call(`/campfire/campaigns/${chatCampaignId}`, { token: p1.token })).status, 404);
});

test("open in a call: everyone in it hears the campfire is lit", { skip }, async () => {
  // Calls need LiveKit, so this one is made by hand: an ongoing call in the voice nebula with p1 in it.
  const { rows } = await pool.query("insert into calls (conversation_id, caller_id, video, status, answered_at) values ($1, $2, false, 'ongoing', now()) returning id", [voice.conversationId, gm.id]);
  const callId = rows[0].id;
  await pool.query("insert into call_participants (call_id, user_id, joined_at) values ($1, $2, now()), ($1, $3, now())", [callId, gm.id, p1.id]);
  const a = listen(p1);
  await a.ready;
  assert.equal((await call(`/campfire/campaigns/${campaignId}/open`, { method: "POST", token: p1.token, body: { callId } })).status, 403);
  const open = await call(`/campfire/campaigns/${campaignId}/open`, { method: "POST", token: gm.token, body: { callId } });
  assert.equal(open.status, 200, JSON.stringify(open.json));
  await wait(300);
  assert.deepEqual(a.of("campfire:opened").map((e) => [e.callId, e.name]), [[callId, "Lost Mine"]]);
  assert.equal((await call(`/campfire/homes/nebula/${voice.conversationId}/campaigns`, { token: p1.token })).json.campaigns[0].openInCallId, callId);
  await call(`/campfire/campaigns/${campaignId}/close`, { method: "POST", token: gm.token });
  await wait(300);
  assert.equal(a.of("campfire:closed").length, 1);
  a.socket.close();
  await pool.query("update calls set status = 'ended', ended_at = now() where id = $1", [callId]);
});

test("Lockdown: no new campaigns or chat rolls for new accounts", { skip }, async () => {
  await pool.query("insert into server_settings (key, value) values ('lockdown', $1) on conflict (key) do update set value = $1", [JSON.stringify({ on: true, since: new Date().toISOString() })]);
  await wait(5500);
  try {
    const made = await call("/campfire/campaigns", { method: "POST", token: gm.token, body: { home: { kind: "chat", id: groupId }, name: "During lockdown" } });
    assert.equal(made.status, 403);
    assert.equal(made.json.error, "lockdown");
    const roll = await call(`/conversations/${groupId}/messages`, { method: "POST", token: gm.token, body: { body: "/roll 1d20" } });
    assert.equal(roll.status, 403);
    assert.equal(roll.json.error, "lockdown");
  } finally {
    await pool.query("delete from server_settings where key = 'lockdown'");
    await wait(5500);
  }
});

test("Pause: Campfire answers 503 like everything else", { skip }, async () => {
  await pool.query("insert into server_settings (key, value) values ('pause', $1) on conflict (key) do update set value = $1", [JSON.stringify({ paused: true, message: "Back soon", since: new Date().toISOString() })]);
  await wait(5500);
  try {
    const r = await call(`/campfire/campaigns/${campaignId}`, { token: p1.token });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, "paused");
  } finally {
    await pool.query("delete from server_settings where key = 'pause'");
    await wait(5500);
  }
  assert.equal((await call(`/campfire/campaigns/${campaignId}`, { token: p1.token })).status, 200);
});

test("rolls are rate limited (60 a minute per person)", { skip }, async () => {
  let limited = false;
  for (let i = 0; i < 61 && !limited; i++) {
    const r = await call(`/campfire/campaigns/${campaignId}/rolls`, { method: "POST", token: p2.token, body: { expression: "1d6" } });
    if (r.status === 429) limited = true;
  }
  assert.equal(limited, true);
});
