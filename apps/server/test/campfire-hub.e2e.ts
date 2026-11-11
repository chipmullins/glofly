// Campfire Round A (Nov 2026): rule sets, the campaign hub, homebrew, switching over, the
// "move only on your turn" rule. Run like campfire.e2e.ts:
//
//   npm run dev -w apps/server            (in one terminal; a dev database, never production)
//   GLOFLY_E2E_URL=http://localhost:4000 npx tsx --env-file=../../.env --test test/campfire-hub.e2e.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
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
let groupId: string, group2Id: string;
let cid: string, otherCampaign: string;
let pc1: string, pc2: string;

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  gm = await account("hubgm");
  p1 = await account("hubpone");
  p2 = await account("hubptwo");
  other = await account("hubother");
  for (const p of [p1, p2, other]) await befriend(gm, p);
  groupId = (await call("/conversations/group", { method: "POST", token: gm.token, body: { userIds: [p1.id, p2.id], name: "Hub" } })).json.conversation.id;
  group2Id = (await call("/conversations/group", { method: "POST", token: gm.token, body: { userIds: [other.id, p1.id], name: "Other" } })).json.conversation.id;
  const made = await call("/campfire/campaigns", { method: "POST", token: gm.token, body: { home: { kind: "chat", id: groupId }, name: "Sunken Crypt" } });
  cid = made.json.id;
  otherCampaign = (await call("/campfire/campaigns", { method: "POST", token: gm.token, body: { home: { kind: "chat", id: group2Id }, name: "Elsewhere" } })).json.id;
  for (const p of [p1, p2]) await call(`/campfire/campaigns/${cid}`, { token: p.token });
});

after(async () => {
  if (skip) return;
  await pool.query("delete from campfire_campaigns where conversation_id = any($1)", [[groupId, group2Id]]);
  await pool.query("delete from conversations where id = any($1)", [[groupId, group2Id]]);
  await pool.query("delete from users where id = any($1)", [[gm.id, p1.id, p2.id, other.id]]);
  await pool.end();
});

test("rule sets: 2014 by default, 2024 per campaign; builder data and items for both", { skip }, async () => {
  const t = await call(`/campfire/campaigns/${cid}`, { token: gm.token });
  assert.equal(t.json.campaign.settings.rules, undefined, "older and new campaigns read as 2014 until set");
  const set = await call(`/campfire/campaigns/${cid}`, { method: "PATCH", token: gm.token, body: { settings: { rules: "2024", moveOnTurn: true, leveling: "milestone", diagonal: "5-10" } } });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.equal(set.json.settings.rules, "2024");
  assert.equal(set.json.settings.moveOnTurn, true);
  assert.equal(set.json.settings.diagonal, "5-10");
  assert.equal((await call(`/campfire/campaigns/${cid}`, { method: "PATCH", token: gm.token, body: { settings: { rules: "1999" } } })).status, 400);
  assert.equal((await call(`/campfire/campaigns/${cid}`, { method: "PATCH", token: p1.token, body: { settings: { rules: "2014" } } })).status, 403);

  const b24 = await call("/campfire/srd/builder?rules=2024", { token: p1.token });
  assert.equal(b24.status, 200);
  assert.equal(b24.json.rules, "2024");
  assert.equal(b24.json.species.length, 9);
  assert.equal(b24.json.classes.length, 12);
  assert.match(b24.json.credit, /5\.2/);
  const ranger = b24.json.classes.find((c: any) => c.id === "ranger");
  assert.deepEqual(ranger.levels[3].slots.slice(0, 2), [3, 0]);
  assert.equal(ranger.levels[3].asi, true);
  const soldier = b24.json.backgrounds.find((b: any) => b.id === "soldier");
  assert.deepEqual(soldier.abilities, ["str", "dex", "con"]);
  const b14 = await call("/campfire/srd/builder", { token: p1.token });
  assert.equal(b14.json.rules, "2014");
  assert.ok(b14.json.species.find((s: any) => s.id === "half-elf").bonusChoice);
  assert.match(b14.json.credit, /5\.1/);
  const items = await call("/campfire/srd/items?rules=2024&q=studded", { token: p1.token });
  assert.equal(items.json.items[0].armor.base, 12);
  const fb = await call("/campfire/srd/spells/fire-bolt?rules=2024", { token: p1.token });
  assert.deepEqual(fb.json.damage.byCharacterLevel, { "1": "1d10", "5": "2d10", "11": "3d10", "17": "4d10" });
  // A 2024 campaign's monsters come from SRD 5.2.
  const scene = await call(`/campfire/campaigns/${cid}/scenes`, { method: "POST", token: gm.token, body: { name: "Crypt" } });
  const gob = await call(`/campfire/scenes/${scene.json.id}/tokens`, { method: "POST", token: gm.token, body: { x: 0, y: 0, srdMonster: "goblin-warrior" } });
  assert.equal(gob.status, 201, JSON.stringify(gob.json));
  assert.equal(gob.json.bars[0].value, 10, "the 2024 Goblin Warrior has 10 HP");
});

test("switching over mid-campaign: progress, the story so far, open quests", { skip }, async () => {
  assert.equal((await call(`/campfire/campaigns/${cid}/continue`, { method: "POST", token: p1.token, body: { sessionsBefore: 3, level: 5 } })).status, 403);
  const r = await call(`/campfire/campaigns/${cid}/continue`, {
    method: "POST",
    token: gm.token,
    body: { sessionsBefore: 12, level: 6, story: "The party cleared the docks.", quests: ["Silence the bell", "Find the wolf's owner"] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.progress, { sessionsBefore: 12, level: 6 });
  const before = r.json.sessions.find((s: any) => s.before);
  assert.equal(before.number, 0);
  assert.equal(before.recap, "The party cleared the docks.");
  assert.deepEqual(r.json.quests.map((q: any) => q.title), ["Silence the bell", "Find the wolf's owner"]);
  const asPlayer = await call(`/campfire/campaigns/${cid}/hub`, { token: p1.token });
  assert.equal(asPlayer.json.sessions.find((s: any) => s.before).recap, "The party cleared the docks.", "players see the story so far");
});

test("sessions: numbering after the old ones, RSVPs, recap drafts that only GMs see until posted", { skip }, async () => {
  const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const s = await call(`/campfire/campaigns/${cid}/sessions`, { method: "POST", token: gm.token, body: { title: "Into the nave", startsAt: soon } });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  assert.equal(s.json.number, 13, "continues after the 12 played elsewhere");
  assert.equal((await call(`/campfire/campaigns/${cid}/sessions`, { method: "POST", token: p1.token, body: {} })).status, 403);
  assert.equal((await call(`/campfire/sessions/${s.json.id}/rsvp`, { method: "PUT", token: p1.token, body: { answer: "yes" } })).status, 200);
  assert.equal((await call(`/campfire/sessions/${s.json.id}/rsvp`, { method: "PUT", token: p2.token, body: { answer: "maybe" } })).status, 200);
  assert.equal((await call(`/campfire/sessions/${s.json.id}/rsvp`, { method: "PUT", token: other.token, body: { answer: "yes" } })).status, 404, "not at this table");
  assert.equal((await call(`/campfire/sessions/${s.json.id}/rsvp`, { method: "PUT", token: p1.token, body: { answer: "sure" } })).status, 400);

  // The session window is open (it starts in 10 minutes): rolls count for the recap.
  for (let i = 0; i < 3; i++) await call(`/campfire/campaigns/${cid}/rolls`, { method: "POST", token: p1.token, body: { expression: "1d20", visibility: "all" } });
  await new Promise((r) => setTimeout(r, 300));
  const asGm = (await call(`/campfire/campaigns/${cid}/hub`, { token: gm.token })).json.sessions.find((x: any) => x.id === s.json.id);
  assert.equal(asGm.stats.rolls, 3);
  assert.deepEqual(asGm.rsvps.map((x: any) => x.answer).sort(), ["maybe", "yes"]);
  const draft = await call(`/campfire/sessions/${s.json.id}/draft`, { method: "POST", token: gm.token });
  assert.equal(draft.status, 200);
  assert.equal(typeof draft.json.draft, "string");
  await call(`/campfire/sessions/${s.json.id}`, { method: "PATCH", token: gm.token, body: { recap: "A secret draft about the mimic" } });
  const p = (await call(`/campfire/campaigns/${cid}/hub`, { token: p1.token })).json.sessions.find((x: any) => x.id === s.json.id);
  assert.equal(p.recap, "", "players don't see an unposted recap");
  assert.equal(p.stats.rolls, 0, "nor its counts");
  await call(`/campfire/sessions/${s.json.id}`, { method: "PATCH", token: gm.token, body: { recap: "They found the stair.", post: true } });
  const p2s = (await call(`/campfire/campaigns/${cid}/hub`, { token: p1.token })).json.sessions.find((x: any) => x.id === s.json.id);
  assert.equal(p2s.recap, "They found the stair.");
  assert.ok(p2s.recapPostedAt);
  assert.equal((await call(`/campfire/sessions/${s.json.id}`, { method: "PATCH", token: p1.token, body: { recap: "hacked" } })).status, 403);
  assert.equal((await call(`/campfire/sessions/${s.json.id}/draft`, { method: "POST", token: p1.token })).status, 403);
});

test("quests and the journal: hidden ones and GM notes never reach players", { skip }, async () => {
  const q = await call(`/campfire/campaigns/${cid}/quests`, { method: "POST", token: gm.token, body: { title: "The abbot's secret", hidden: true } });
  assert.equal(q.status, 201);
  assert.equal((await call(`/campfire/campaigns/${cid}/quests`, { method: "POST", token: p1.token, body: { title: "Mine" } })).status, 403);
  const j1 = await call(`/campfire/campaigns/${cid}/journal`, { method: "POST", token: gm.token, body: { kind: "npc", name: "Abbess Mara", text: "Kind, tired.", gmNotes: "She is the bell's keeper" } });
  const j2 = await call(`/campfire/campaigns/${cid}/journal`, { method: "POST", token: gm.token, body: { kind: "place", name: "The drowned nave", hidden: true } });
  assert.equal(j1.status, 201);
  assert.equal(j2.status, 201);
  const hub = await call(`/campfire/campaigns/${cid}/hub`, { token: p1.token });
  assert.ok(!hub.json.quests.some((x: any) => x.title === "The abbot's secret"));
  assert.deepEqual(hub.json.journal.map((x: any) => x.name), ["Abbess Mara"]);
  assert.equal(hub.json.journal[0].gmNotes, undefined);
  assert.equal(JSON.stringify(hub.json).includes("bell's keeper"), false);
  assert.equal(JSON.stringify(hub.json).includes("drowned nave"), false);
  const asGm = await call(`/campfire/campaigns/${cid}/hub`, { token: gm.token });
  assert.equal(asGm.json.journal.find((x: any) => x.name === "Abbess Mara").gmNotes, "She is the bell's keeper");
  assert.equal((await call(`/campfire/journal/${j1.json.id}`, { method: "PATCH", token: p1.token, body: { text: "x" } })).status, 403);
  assert.equal((await call(`/campfire/quests/${q.json.id}`, { method: "PATCH", token: gm.token, body: { status: "done", hidden: false } })).json.status, "done");
});

test("party loot: even split onto each PC's sheet, leftovers stay; giving an item", { skip }, async () => {
  pc1 = (await call(`/campfire/campaigns/${cid}/characters`, { method: "POST", token: p1.token, body: { kind: "pc", name: "Lyra" } })).json.id;
  pc2 = (await call(`/campfire/campaigns/${cid}/characters`, { method: "POST", token: p2.token, body: { kind: "pc", name: "Bram", sheet: { coins: { gp: 5 } } } })).json.id;
  assert.equal((await call(`/campfire/campaigns/${cid}/loot`, { method: "PUT", token: p1.token, body: { loot: { coins: { gp: 999 } } } })).status, 403);
  const put = await call(`/campfire/campaigns/${cid}/loot`, {
    method: "PUT",
    token: gm.token,
    body: { loot: { coins: { gp: 143, sp: 36 }, items: [{ id: "potion", name: "Potion of healing", qty: 1, notes: "" }] } },
  });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const split = await call(`/campfire/campaigns/${cid}/loot/split`, { method: "POST", token: gm.token, body: {} });
  assert.equal(split.status, 200, JSON.stringify(split.json));
  assert.deepEqual([split.json.each.gp, split.json.each.sp], [71, 18]);
  assert.deepEqual([split.json.loot.coins.gp, split.json.loot.coins.sp], [1, 0]);
  const bram = await call(`/campfire/characters/${pc2}`, { token: p2.token });
  assert.equal(bram.json.sheet.coins.gp, 76, "5 he had + 71");
  const give = await call(`/campfire/campaigns/${cid}/loot/give`, { method: "POST", token: gm.token, body: { itemId: "potion", characterId: pc1 } });
  assert.equal(give.status, 200);
  assert.equal(give.json.loot.items.length, 0);
  assert.ok((await call(`/campfire/characters/${pc1}`, { token: p1.token })).json.sheet.inventory.some((i: any) => i.name === "Potion of healing"));
});

test("homebrew: players get shared ones only; cleaned per kind; copying only to campaigns you run", { skip }, async () => {
  const mk = (body: unknown, token = gm.token) => call(`/campfire/campaigns/${cid}/homebrew`, { method: "POST", token, body });
  const cloak = await mk({ kind: "item", name: "Cloak of the Bell-Diver", shared: true, data: { itemKind: "magic", rarity: "Uncommon", attunement: true, speed: "swim 30 ft", evil: "<script>" } });
  assert.equal(cloak.status, 201, JSON.stringify(cloak.json));
  assert.equal(cloak.json.data.evil, undefined);
  assert.equal(cloak.json.data.attunement, true);
  const secret = await mk({ kind: "monster", name: "Drowned Abbot", data: { cr: 5, type: "undead", text: "Secret" } });
  assert.equal(secret.status, 201);
  assert.equal((await mk({ kind: "subclass", name: "No class", data: {} })).status, 400, "a subclass needs its class");
  assert.equal((await mk({ kind: "item", name: "x" }, p1.token)).status, 403);
  const asPlayer = await call(`/campfire/campaigns/${cid}/homebrew`, { token: p1.token });
  assert.deepEqual(asPlayer.json.homebrew.map((h: any) => h.name), ["Cloak of the Bell-Diver"]);
  assert.equal((await call(`/campfire/campaigns/${cid}/homebrew`, { token: gm.token })).json.homebrew.length, 2);
  const hub = await call(`/campfire/campaigns/${cid}/hub`, { token: p1.token });
  assert.deepEqual(hub.json.homebrewCounts, { item: 1 });
  // Copy to a campaign the GM runs: fine (copies start not shared). The player can't copy at all.
  const copy = await call(`/campfire/homebrew/${cloak.json.id}/copy`, { method: "POST", token: gm.token, body: { campaignId: otherCampaign } });
  assert.equal(copy.status, 201, JSON.stringify(copy.json));
  assert.equal(copy.json.shared, false);
  assert.equal((await call(`/campfire/homebrew/${cloak.json.id}/copy`, { method: "POST", token: p1.token, body: { campaignId: otherCampaign } })).status, 403);
  // The other campaign's GM role doesn't let anyone into this campaign's homebrew.
  assert.equal((await call(`/campfire/homebrew/${secret.json.id}`, { method: "PATCH", token: other.token, body: { name: "mine" } })).status, 404);
});

test("the hub's banner picture is the players' to load; GM pictures that aren't used stay the GM's", { skip }, async () => {
  const png = await sharp({ create: { width: 64, height: 32, channels: 3, background: "#335544" } }).png().toBuffer();
  const up = await call(`/campfire/campaigns/${cid}/files?kind=handout`, { method: "POST", token: gm.token, raw: png });
  assert.equal(up.status, 201, JSON.stringify(up.json));
  assert.equal((await call(`/campfire/files/${up.json.id}`, { token: p1.token })).status, 404, "not used yet");
  assert.equal((await call(`/campfire/campaigns/${cid}/hub`, { method: "PATCH", token: gm.token, body: { bannerFileId: up.json.id, pitch: "A drowned temple wakes." } })).status, 200);
  assert.equal((await call(`/campfire/files/${up.json.id}`, { token: p1.token })).status, 200);
  const hub = await call(`/campfire/campaigns/${cid}/hub`, { token: p2.token });
  assert.equal(hub.json.pitch, "A drowned temple wakes.");
  assert.equal(hub.json.party.length, 2);
});

test("table rule: during a fight, players move their tokens only on their turn", { skip }, async () => {
  const sceneId = (await call(`/campfire/campaigns/${cid}`, { token: gm.token })).json.scene.id;
  const mine = (await call(`/campfire/scenes/${sceneId}/tokens`, { method: "POST", token: gm.token, body: { x: 70, y: 70, characterId: pc1, controlledBy: [p1.id] } })).json;
  const theirs = (await call(`/campfire/scenes/${sceneId}/tokens`, { method: "POST", token: gm.token, body: { x: 140, y: 70, characterId: pc2, controlledBy: [p2.id] } })).json;
  assert.equal((await call(`/campfire/tokens/${mine.id}`, { method: "PATCH", token: p1.token, body: { x: 210, y: 70 } })).status, 200, "no fight: free to move");
  await call(`/campfire/campaigns/${cid}/combat`, { method: "POST", token: gm.token, body: { op: "start", tokenIds: [theirs.id, mine.id] } });
  const combat = (await call(`/campfire/campaigns/${cid}`, { token: gm.token })).json.combat;
  const firstId = combat.entries[combat.turn].tokenId;
  const [first, second, firstWho, secondWho] = firstId === mine.id ? [mine, theirs, p1, p2] : [theirs, mine, p2, p1];
  assert.equal((await call(`/campfire/tokens/${second.id}`, { method: "PATCH", token: secondWho.token, body: { x: 280, y: 70 } })).status, 403, "not their turn");
  assert.equal((await call(`/campfire/tokens/${first.id}`, { method: "PATCH", token: firstWho.token, body: { x: 280, y: 140 } })).status, 200);
  assert.equal((await call(`/campfire/tokens/${second.id}`, { method: "PATCH", token: gm.token, body: { x: 280, y: 210 } })).status, 200, "GMs move anything");
  // Turned off: everyone moves again.
  await call(`/campfire/campaigns/${cid}`, { method: "PATCH", token: gm.token, body: { settings: { moveOnTurn: false } } });
  assert.equal((await call(`/campfire/tokens/${second.id}`, { method: "PATCH", token: secondWho.token, body: { x: 350, y: 70 } })).status, 200);
  await call(`/campfire/campaigns/${cid}/combat`, { method: "POST", token: gm.token, body: { op: "end" } });
});

test("a fight and its hits count for the session (recap draft)", { skip }, async () => {
  const t = await call(`/campfire/campaigns/${cid}`, { token: gm.token });
  const gob = t.json.tokens.find((x: any) => x.name.startsWith("Goblin"));
  const hero = t.json.tokens.find((x: any) => x.characterId === pc1);
  await call(`/campfire/campaigns/${cid}`, { method: "PATCH", token: gm.token, body: { settings: { gmApprovesDamage: false } } });
  await call(`/campfire/campaigns/${cid}/combat`, { method: "POST", token: gm.token, body: { op: "start", tokenIds: [hero.id, gob.id] } });
  const dmg = await call(`/campfire/tokens/${gob.id}/damage`, { method: "POST", token: gm.token, body: { amount: 30 } });
  assert.equal(dmg.status, 200, JSON.stringify(dmg.json));
  await new Promise((r) => setTimeout(r, 400));
  const s = (await call(`/campfire/campaigns/${cid}/hub`, { token: gm.token })).json.sessions.find((x: any) => x.number === 13);
  assert.ok(s.stats.fights >= 1);
  assert.equal(Object.values(s.stats.defeated).reduce((a: number, b: any) => a + b, 0), 1);
  const draft = await call(`/campfire/sessions/${s.id}/draft`, { method: "POST", token: gm.token });
  assert.match(draft.json.draft, /Defeated: Goblin Warrior/);
});
