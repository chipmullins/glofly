// Communities round 2 (item 5): the Discord ↔ Glofly bridge against a stand-in Discord
// (test/discordStandIn.ts: start it and the dev server as its header says). Connecting (the
// server is confirmed with Discord, never taken from the address), pairing channels, messages
// both ways (names, mentions, @everyone held back, no echo), edits and deletes, the members'
// "shared with Discord" notice, older apps' plain text, turning it off.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const STAND_IN = process.env.DISCORD_STAND_IN ?? "http://localhost:4790";
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server (with the Discord stand-in)" : false;
const H = { "x-glofly-version": "0.9.0", "x-glofly-features": "threads, round2", "content-type": "application/json" };
const tag = randomBytes(3).toString("hex");
const GENERAL = "222222222222222222";
const ELSEWHERE = "444444444444444444";
let pool: pg.Pool;
const made: string[] = [];
let owner: { id: string; token: string }, member: { id: string; token: string; username: string };
let cid: string, general: { id: string; conversationId: string };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(path: string, token: string | null, method = "GET", body?: unknown, old = false) {
  const headers: Record<string, string> = { ...H };
  if (old) headers["x-glofly-features"] = "threads";
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(URL_ + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: r.status, json, text };
}
async function account(name: string) {
  const r = await call("/auth/register", null, "POST", { email: `${name}${tag}@example.com`, username: `${name}${tag}`, displayName: name, password: "glofly-e2e-" + tag, birthday: "1995-05-14", acceptTerms: true });
  assert.equal(r.status, 201, r.text);
  made.push(r.json.user.id);
  return { id: r.json.user.id, token: r.json.token, username: `${name}${tag}` };
}
const dispatch = (t: string, d: unknown) => fetch(`${STAND_IN}/_test/dispatch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, d }) }).then((r) => r.json());
const discordLog = () => fetch(`${STAND_IN}/_test/log`).then((r) => r.json()) as Promise<{ method: string; path: string; body: any }[]>;

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  // The bridge must have said hello to the stand-in Gateway (it retries with a growing wait).
  for (let i = 0; i < 80; i++) {
    const s = await fetch(`${STAND_IN}/_test/state`).then((r) => r.json());
    if (s.connected > 0) break;
    await wait(1000);
  }
  owner = await account("dcowner");
  member = await account("dcmember");
  const c = await call("/constellations", owner.token, "POST", { name: `Bridge ${tag}`, template: "gaming" });
  cid = c.json.constellation.id;
  general = c.json.constellation.nebulas.find((n: any) => n.name === "general");
  const link = await call(`/constellations/${cid}/links`, owner.token, "POST", { lifetime: "7d" });
  await call(`/constellations/links/${link.json.link.code}/join`, member.token, "POST");
});

after(async () => {
  if (skip) return;
  await pool.query("delete from discord_bridges where constellation_id = $1", [cid]);
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.query("delete from users where id = any($1)", [made]);
  await pool.end();
});

test("connecting: only managers; the server comes from Discord's answer, never the address", { skip }, async () => {
  assert.equal((await call(`/constellations/${cid}/discord`, member.token)).status, 403);
  const info = await call(`/constellations/${cid}/discord`, owner.token);
  assert.equal(info.json.available, true);
  assert.equal(info.json.bridge, null);
  const start = await call(`/constellations/${cid}/discord/connect`, owner.token, "POST");
  const u = new URL(start.json.url);
  assert.equal(u.searchParams.get("scope"), "bot");
  const state = u.searchParams.get("state")!;
  // A forged answer (wrong code) connects nothing; the state is used up either way.
  const forged = await call(`/bridge/discord/callback?code=bad&state=${state}&guild_id=999`, null);
  assert.equal(forged.status, 400);
  assert.equal((await call(`/constellations/${cid}/discord`, owner.token)).json.bridge, null);
  const again = new URL((await call(`/constellations/${cid}/discord/connect`, owner.token, "POST")).json.url).searchParams.get("state")!;
  const ok = await call(`/bridge/discord/callback?code=good-code&state=${again}&guild_id=${"999999999999999999"}`, null);
  assert.equal(ok.status, 200, ok.text);
  assert.match(ok.text, /Cozy RP/);
  const after = (await call(`/constellations/${cid}/discord`, owner.token)).json;
  assert.equal(after.bridge.guildId, "111111111111111111");
  assert.deepEqual(after.channels.map((c: any) => c.name), ["general", "lfg", "🎮│memes"]);
  assert.deepEqual(after.channels.map((c: any) => c.parent), [null, null, "Hangout"]);
  assert.deepEqual(after.voiceChannels.map((c: any) => c.name), ["Lounge"]);
  // A used state can't be replayed.
  assert.equal((await call(`/bridge/discord/callback?code=good-code&state=${again}`, null)).status, 400);
});

test("pairing: a channel of the connected server with a nebula everyone can see; members see the notice", { skip }, async () => {
  assert.equal((await call(`/constellations/${cid}/discord/pairs`, owner.token, "POST", { discordChannelId: ELSEWHERE, nebulaId: general.id })).status, 400);
  const r = await call(`/constellations/${cid}/discord/pairs`, owner.token, "POST", { discordChannelId: GENERAL, nebulaId: general.id });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.bridge.pairs.length, 1);
  assert.equal((await call(`/constellations/${cid}/discord/pairs`, owner.token, "POST", { discordChannelId: GENERAL, nebulaId: general.id })).status, 409);
  const d = (await call(`/constellations/${cid}`, member.token)).json.constellation;
  assert.deepEqual(d.nebulas.find((n: any) => n.id === general.id).sharedWith, ["Discord · Cozy RP"]);
});

test("messages both ways: names, mentions, @everyone held back, no echo, edits and deletes", { skip }, async () => {
  await fetch(`${STAND_IN}/_test/clear`, { method: "POST" });
  // Discord → Glofly
  await dispatch("MESSAGE_CREATE", {
    id: "600000000000000001",
    channel_id: GENERAL,
    guild_id: "111111111111111111",
    type: 0,
    author: { id: "800000000000000001", username: "tbone", global_name: "T-Bone", avatar: "0123456789abcdef0123456789abcdef" },
    member: { nick: "tbone" },
    content: "who's on tonight? @everyone <@800000000000000002>",
    mentions: [{ id: "800000000000000002", username: "luna", global_name: "lunamoth" }],
  });
  await wait(1500);
  let list = (await call(`/conversations/${general.conversationId}/messages`, member.token)).json.messages;
  const fromDiscord = list.find((m: any) => m.bridged);
  assert.ok(fromDiscord, "copied into Glofly");
  assert.equal(fromDiscord.bridged.name, "tbone");
  assert.equal(fromDiscord.bridged.avatar, "800000000000000001/0123456789abcdef0123456789abcdef");
  assert.equal(fromDiscord.body.slice(fromDiscord.bridged.skip), "who's on tonight? @​everyone @lunamoth");
  assert.equal(fromDiscord.body.slice(0, fromDiscord.bridged.skip), "tbone: ");
  assert.deepEqual(fromDiscord.groupMentions ?? [], []);
  // The picture is served without signing in (Discord pictures are public).
  assert.equal((await fetch(`${URL_}/bridge/avatars/${fromDiscord.bridged.avatar}`)).status, 200);
  // Older apps: "tbone: who's on tonight?…" in the body.
  const old = (await call(`/conversations/${general.conversationId}/messages`, member.token, "GET", undefined, true)).json.messages.find((m: any) => m.id === fromDiscord.id);
  assert.match(old.body, /^tbone: who's on tonight\?/);
  // Nothing went back to Discord for it (no echo).
  assert.equal((await discordLog()).filter((x) => x.method === "POST" && x.path.startsWith("/webhooks/")).length, 0);

  // Glofly → Discord: under the Glofly name, nobody pinged there.
  const sent = await call(`/conversations/${general.conversationId}/messages`, member.token, "POST", { body: "me! jumping on at 10 @everyone" });
  assert.equal(sent.status, 201);
  await wait(1200);
  let posts = (await discordLog()).filter((x) => x.method === "POST" && x.path.startsWith("/webhooks/"));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.content, "me! jumping on at 10 @everyone");
  assert.equal(posts[0].body.username, "dcmember · Glofly");
  assert.deepEqual(posts[0].body.allowed_mentions, { parse: [] });
  // Edits and deletes follow along.
  await call(`/conversations/${general.conversationId}/messages/${sent.json.message.id}`, member.token, "PATCH", { body: "me! jumping on at 11" });
  await call(`/conversations/${general.conversationId}/messages/${sent.json.message.id}`, member.token, "DELETE");
  await wait(1200);
  const log = await discordLog();
  assert.ok(log.some((x) => x.method === "PATCH" && x.body?.content === "me! jumping on at 11"));
  assert.ok(log.some((x) => x.method === "DELETE" && x.path.includes("/messages/")));
  // Discord edits and deletes too.
  await dispatch("MESSAGE_UPDATE", { id: "600000000000000001", channel_id: GENERAL, content: "who's on tomorrow?" });
  await wait(1000);
  list = (await call(`/conversations/${general.conversationId}/messages`, member.token)).json.messages;
  assert.equal(list.find((m: any) => m.id === fromDiscord.id).body, "tbone: who's on tomorrow?");
  await dispatch("MESSAGE_DELETE", { id: "600000000000000001", channel_id: GENERAL });
  await wait(1000);
  list = (await call(`/conversations/${general.conversationId}/messages`, member.token)).json.messages;
  assert.equal(list.find((m: any) => m.id === fromDiscord.id).deleted, true);
  // Pictures from Discord are copied into Glofly (only from Discord's file servers).
  await dispatch("MESSAGE_CREATE", {
    id: "600000000000000002",
    channel_id: GENERAL,
    type: 0,
    author: { id: "800000000000000003", username: "luna", avatar: null },
    content: "same",
    attachments: [
      { id: "1", filename: "pic.png", size: 600, url: `${STAND_IN}/cdn/files/pic.png` },
      { id: "2", filename: "evil.png", size: 600, url: "http://169.254.169.254/latest/meta-data" },
    ],
  });
  await wait(2000);
  list = (await call(`/conversations/${general.conversationId}/messages`, member.token)).json.messages;
  const pic = list.find((m: any) => m.bridged?.name === "luna");
  assert.ok(pic);
  assert.equal(pic.attachments.length, 1);
  assert.equal(pic.attachments[0].kind, "image");
  // A paused pair sends nothing.
  const info = (await call(`/constellations/${cid}/discord`, owner.token)).json;
  await call(`/constellations/${cid}/discord/pairs/${info.bridge.pairs[0].id}`, owner.token, "PATCH", { paused: true });
  await fetch(`${STAND_IN}/_test/clear`, { method: "POST" });
  await call(`/conversations/${general.conversationId}/messages`, member.token, "POST", { body: "paused" });
  await wait(1000);
  posts = (await discordLog()).filter((x) => x.method === "POST" && x.path.startsWith("/webhooks/"));
  assert.equal(posts.length, 0);
});

test("Nov 28: pictures go to Discord as files, and Glofly photos load without signing in", { skip }, async () => {
  const info = (await call(`/constellations/${cid}/discord`, owner.token)).json;
  await call(`/constellations/${cid}/discord/pairs/${info.bridge.pairs[0].id}`, owner.token, "PATCH", { paused: false });
  // A profile photo for the member.
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#f47a1f" } }).png().toBuffer();
  const up = await fetch(`${URL_}/users/me/avatar`, { method: "PUT", headers: { ...H, authorization: `Bearer ${member.token}`, "content-type": "image/png" }, body: png });
  assert.equal(up.status, 200, await up.text());
  const pic = await fetch(`${URL_}/conversations/${general.conversationId}/attachments?name=sunset.png`, {
    method: "POST",
    headers: { ...H, authorization: `Bearer ${member.token}`, "content-type": "application/octet-stream" },
    body: png,
  }).then((r) => r.json());
  await fetch(`${STAND_IN}/_test/clear`, { method: "POST" });
  const sent = await call(`/conversations/${general.conversationId}/messages`, member.token, "POST", { body: "look", attachmentIds: [pic.attachment.id] });
  assert.equal(sent.status, 201, sent.text);
  await wait(1500);
  const post = (await discordLog()).find((x) => x.method === "POST" && x.path.startsWith("/webhooks/"));
  assert.ok(post, "posted to Discord");
  assert.deepEqual(post!.body._files, ["sunset.webp"]);
  assert.equal(post!.body.content, "look");
  // The avatar address is public and signed; a changed signature or an old photo gets nothing.
  const avatarUrl: string = post!.body.avatar_url;
  assert.match(avatarUrl, /\/bridge\/glofly-avatars\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{32}\.png$/);
  const path = new URL(avatarUrl).pathname;
  const ok = await fetch(URL_ + path);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.equal((await fetch(URL_ + path.replace(/[A-Za-z0-9_-]{4}\.png$/, "AAAA.png"))).status, 404);
  assert.equal((await fetch(`${URL_}/avatars/${member.id}/${path.split("/")[4]}`)).status, 401, "the normal address still needs signing in");
});

test("Nov 28: pairing with a new nebula (named after the channel, in the matching category)", { skip }, async () => {
  const cat = await call(`/constellations/${cid}/categories`, owner.token, "POST", { name: "Hangout" });
  assert.ok(cat.status < 300, cat.text);
  const r = await call(`/constellations/${cid}/discord/pairs`, owner.token, "POST", { discordChannelId: "661000000000000000", newNebula: true });
  assert.equal(r.status, 201, r.text);
  const d = (await call(`/constellations/${cid}`, owner.token)).json.constellation;
  const made = d.nebulas.find((n: any) => n.name === "memes");
  assert.ok(made, "a nebula called memes");
  assert.equal(made.kind, "text");
  const inCat = d.categories.find((c: any) => c.id === made.categoryId);
  assert.equal(inCat?.name.toLowerCase(), "hangout");
  assert.ok(r.json.bridge.pairs.some((p: any) => p.nebulaId === made.id));
  // Not for someone who can't make nebulas (a plain member can't even see the page).
  assert.equal((await call(`/constellations/${cid}/discord/pairs`, member.token, "POST", { discordChannelId: "333333333333333333", newNebula: true })).status, 403);
});

test("Nov 28: who's in voice, both sides (no sound)", { skip }, async () => {
  const LOUNGE = "770000000000000000";
  const d = (await call(`/constellations/${cid}`, owner.token)).json.constellation;
  const voiceNebula = d.nebulas.find((n: any) => n.kind === "voice");
  assert.ok(voiceNebula, "the gaming template has a voice nebula");
  // A voice channel only pairs with a voice nebula.
  assert.equal((await call(`/constellations/${cid}/discord/pairs`, owner.token, "POST", { discordChannelId: LOUNGE, nebulaId: general.id })).status, 400);
  await fetch(`${STAND_IN}/_test/clear`, { method: "POST" });
  const r = await call(`/constellations/${cid}/discord/pairs`, owner.token, "POST", { discordChannelId: LOUNGE, nebulaId: voiceNebula.id });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.bridge.voicePairs.length, 1);
  // The bot posts one status message in the voice channel's chat.
  await wait(500);
  let log = await discordLog();
  const status = log.find((x) => x.method === "POST" && x.path === `/channels/${LOUNGE}/messages`);
  assert.ok(status, "status message posted");
  assert.match(status!.body.content, /Nobody's in \*\*#/);
  assert.deepEqual(status!.body.allowed_mentions, { parse: [] });
  assert.equal(status!.body.components[0].components[0].style, 5);
  // Someone joins the Discord voice channel: Glofly's voice nebula shows them.
  await dispatch("VOICE_STATE_UPDATE", {
    guild_id: "111111111111111111",
    channel_id: LOUNGE,
    user_id: "800000000000000009",
    member: { nick: "Sam", user: { id: "800000000000000009", username: "sam", avatar: "0123456789abcdef0123456789abcdef" } },
  });
  // A bot in voice is never shown.
  await dispatch("VOICE_STATE_UPDATE", { guild_id: "111111111111111111", channel_id: LOUNGE, user_id: "800000000000000010", member: { user: { id: "800000000000000010", username: "musicbot", bot: true } } });
  await wait(2000);
  let voice = (await call(`/constellations/${cid}`, member.token)).json.constellation.voice.find((v: any) => v.nebulaId === voiceNebula.id);
  assert.equal(voice.discord.channelName, "Lounge");
  assert.equal(voice.discord.url, `https://discord.com/channels/111111111111111111/${LOUNGE}`);
  assert.deepEqual(voice.discord.people.map((p: any) => p.name), ["Sam"]);
  assert.equal(voice.discord.people[0].avatar, "800000000000000009/0123456789abcdef0123456789abcdef");
  // Names off: "Someone on Discord", no picture.
  await call(`/constellations/${cid}/discord/settings`, owner.token, "PUT", { names: false });
  await wait(1800);
  voice = (await call(`/constellations/${cid}`, member.token)).json.constellation.voice.find((v: any) => v.nebulaId === voiceNebula.id);
  assert.deepEqual(voice.discord.people, [{ name: "Someone on Discord", avatar: null }]);
  await call(`/constellations/${cid}/discord/settings`, owner.token, "PUT", { names: true });
  // They leave.
  await dispatch("VOICE_STATE_UPDATE", { guild_id: "111111111111111111", channel_id: null, user_id: "800000000000000009" });
  await wait(1800);
  voice = (await call(`/constellations/${cid}`, member.token)).json.constellation.voice.find((v: any) => v.nebulaId === voiceNebula.id);
  assert.deepEqual(voice.discord.people, []);
  // Glofly → Discord: joining the voice nebula edits the status message (one edit, the name in it).
  await fetch(`${STAND_IN}/_test/clear`, { method: "POST" });
  const join = await call(`/constellations/${cid}/nebulas/${voiceNebula.id}/voice`, member.token, "POST", {});
  assert.ok(join.status < 300, join.text);
  {
    await wait(3500);
    log = await discordLog();
    const edit = log.find((x) => x.method === "PATCH" && x.path.startsWith(`/channels/${LOUNGE}/messages/`));
    assert.ok(edit, "status edited");
    assert.match(edit!.body.content, /On Glofly in #.*dcmember/);
  }
  // Unpairing removes the status message and the Discord group.
  const info = (await call(`/constellations/${cid}/discord`, owner.token)).json;
  await fetch(`${STAND_IN}/_test/clear`, { method: "POST" });
  const un = await call(`/constellations/${cid}/discord/voice/${info.bridge.voicePairs[0].id}`, owner.token, "DELETE");
  assert.equal(un.status, 200);
  assert.equal(un.json.bridge.voicePairs.length, 0);
  log = await discordLog();
  assert.ok(log.some((x) => x.method === "DELETE" && x.path.startsWith(`/channels/${LOUNGE}/messages/`)));
  voice = (await call(`/constellations/${cid}`, member.token)).json.constellation.voice.find((v: any) => v.nebulaId === voiceNebula.id);
  assert.equal(voice.discord, undefined);
});

test("turning it off: the notice goes, copies stay, the bot leaves the server", { skip }, async () => {
  const r = await call(`/constellations/${cid}/discord`, owner.token, "DELETE");
  assert.equal(r.status, 200);
  assert.equal(r.json.bridge, null);
  const d = (await call(`/constellations/${cid}`, member.token)).json.constellation;
  assert.equal(d.nebulas.find((n: any) => n.id === general.id).sharedWith, undefined);
  const list = (await call(`/conversations/${general.conversationId}/messages`, member.token)).json.messages;
  assert.ok(list.some((m: any) => m.bridged));
  assert.ok((await discordLog()).some((x) => x.method === "DELETE" && x.path === "/users/@me/guilds/111111111111111111"));
});
