// Communities round (Nov 2026): threads + forum nebulas, against a real server with Postgres and
// Redis. Run like integrations.e2e.ts.
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
let forum: { id: string; conversationId: string; forum: any };

const send = (conversationId: string, body: string, token: string, extra: Record<string, unknown> = {}) =>
  call(`/conversations/${conversationId}/messages`, { method: "POST", token, body: { body, ...extra } });

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  owner = await account("thowner");
  riley = await account("thriley");
  sam = await account("thsam");
  outsider = await account("thout");
  const made = await call("/constellations", { method: "POST", token: owner.token, body: { name: `Threads ${tag}`, template: "gaming" } });
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

let threadId: string;
let parentId: string;

test("a thread off a message: replies stay out of the nebula, the chip counts them", { skip }, async () => {
  const parent = await send(general.conversationId, "Saturday raid: who's in?", riley.token);
  assert.equal(parent.status, 201, JSON.stringify(parent.json));
  parentId = parent.json.message.id;
  assert.equal((await call(`/constellations/${cid}/nebulas/${general.id}/threads`, { method: "POST", token: outsider.token, body: { parentMessageId: parentId } })).status, 404);
  const t = await call(`/constellations/${cid}/nebulas/${general.id}/threads`, { method: "POST", token: riley.token, body: { parentMessageId: parentId } });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  threadId = t.json.thread.id;
  assert.equal(t.json.thread.title, "Saturday raid: who's in?");
  assert.equal(t.json.thread.following, true);
  const again = await call(`/constellations/${cid}/nebulas/${general.id}/threads`, { method: "POST", token: sam.token, body: { parentMessageId: parentId } });
  assert.equal(again.json.thread.id, threadId, "one thread per message");

  const reply = await send(general.conversationId, "I can heal", sam.token, { threadId });
  assert.equal(reply.status, 201, JSON.stringify(reply.json));
  assert.equal(reply.json.message.threadId, threadId);
  const main = await call(`/conversations/${general.conversationId}/messages`, { token: riley.token });
  assert.ok(!main.json.messages.some((m: any) => m.body === "I can heal"), "not in the nebula's timeline");
  const chip = main.json.messages.find((m: any) => m.id === parentId).thread;
  assert.equal(chip.replyCount, 1);
  assert.deepEqual(chip.recentIds, [sam.id]);
  const inThread = await call(`/conversations/${general.conversationId}/messages?thread=${threadId}`, { token: riley.token });
  assert.deepEqual(inThread.json.messages.map((m: any) => m.body), ["I can heal"]);

  const also = await send(general.conversationId, "8 PM Central", riley.token, { threadId, alsoInNebula: true });
  assert.equal(also.json.message.alsoInNebula, true);
  const main2 = await call(`/conversations/${general.conversationId}/messages`, { token: sam.token });
  assert.ok(main2.json.messages.some((m: any) => m.body === "8 PM Central"), "also shown in the nebula");

  // Riley follows it (replying counts as reading); Sam's next reply is unread for her.
  await send(general.conversationId, "see you there", sam.token, { threadId });
  const view = await call(`/constellations/${cid}`, { token: riley.token });
  const g = view.json.constellation.nebulas.find((n: any) => n.id === general.id);
  assert.equal(g.threads[0].id, threadId);
  assert.equal(g.threads[0].unread, 1);
  await call(`/constellations/${cid}/threads/${threadId}/read`, { method: "POST", token: riley.token });
  const after = await call(`/constellations/${cid}/threads/${threadId}`, { token: riley.token });
  assert.equal(after.json.thread.unread, 0);
});

test("a reply must quote a message from the same thread; outsiders can't read it", { skip }, async () => {
  const wrong = await send(general.conversationId, "hm", sam.token, { threadId, replyToId: parentId });
  assert.equal(wrong.status, 400);
  assert.equal((await call(`/conversations/${general.conversationId}/messages?thread=${threadId}`, { token: outsider.token })).status, 404);
  const bogus = await send(general.conversationId, "x", sam.token, { threadId: "00000000-0000-4000-8000-000000000000" });
  assert.equal(bogus.status, 404);
});

test("threads can be limited to staff", { skip }, async () => {
  const off = await call(`/constellations/${cid}/nebulas/${general.id}`, { method: "PATCH", token: owner.token, body: { threadsStaffOnly: true } });
  assert.equal(off.status, 200, JSON.stringify(off.json));
  const m = await send(general.conversationId, "another topic", sam.token);
  assert.equal((await call(`/constellations/${cid}/nebulas/${general.id}/threads`, { method: "POST", token: sam.token, body: { parentMessageId: m.json.message.id } })).status, 403);
  assert.equal((await call(`/constellations/${cid}/nebulas/${general.id}/threads`, { method: "POST", token: owner.token, body: { parentMessageId: m.json.message.id } })).status, 201);
  await call(`/constellations/${cid}/nebulas/${general.id}`, { method: "PATCH", token: owner.token, body: { threadsStaffOnly: false } });
});

let postId: string;
let solvedTag: string;
let questionTag: string;

test("forum nebulas: tags (required, staff-only), older apps see read-only text", { skip }, async () => {
  const made = await call(`/constellations/${cid}/nebulas`, {
    method: "POST",
    token: owner.token,
    body: {
      name: "Help Forum",
      kind: "forum",
      forum: {
        guidelines: "Say which server and what you tried.",
        requireTag: true,
        tags: [
          { name: "Question", color: "blue" },
          { name: "Solved", color: "green", staffOnly: true },
        ],
      },
    },
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  forum = made.json.constellation.nebulas.find((n: any) => n.id === made.json.nebulaId);
  assert.equal(forum.kind, "forum");
  assert.equal(forum.forum.tags.length, 2);
  questionTag = forum.forum.tags.find((t: any) => t.name === "Question").id;
  solvedTag = forum.forum.tags.find((t: any) => t.name === "Solved").id;
  const old = await call(`/constellations/${cid}`, { token: riley.token, old: true });
  const asOld = old.json.constellation.nebulas.find((n: any) => n.id === forum.id);
  assert.equal(asOld.kind, "text");
  assert.equal(asOld.readOnly, true);
  assert.equal(asOld.forum, undefined);

  const noTag = await call(`/constellations/${cid}/nebulas/${forum.id}/threads`, { method: "POST", token: riley.token, body: { title: "Can't join FiveM" } });
  assert.equal(noTag.status, 400);
  const staffTag = await call(`/constellations/${cid}/nebulas/${forum.id}/threads`, { method: "POST", token: riley.token, body: { title: "Can't join FiveM", tagIds: [solvedTag] } });
  assert.equal(staffTag.status, 400);
  const post = await call(`/constellations/${cid}/nebulas/${forum.id}/threads`, { method: "POST", token: riley.token, body: { title: "Can't join FiveM", tagIds: [questionTag] } });
  assert.equal(post.status, 201, JSON.stringify(post.json));
  postId = post.json.thread.id;
  // Not listed until its opening message is posted; only its author can post that.
  assert.equal((await call(`/constellations/${cid}/nebulas/${forum.id}/threads`, { token: sam.token })).json.threads.length, 0);
  assert.equal((await send(forum.conversationId, "first!", sam.token, { threadId: postId })).status, 404);
  assert.equal((await send(forum.conversationId, "It says link again after linking.", riley.token, { threadId: postId })).status, 201);
  const list = await call(`/constellations/${cid}/nebulas/${forum.id}/threads`, { token: sam.token });
  assert.equal(list.json.threads.length, 1);
  assert.equal(list.json.threads[0].preview, "It says link again after linking.");
  assert.equal(list.json.threads[0].replyCount, 0);
  const found = await call(`/constellations/${cid}/nebulas/${forum.id}/threads?q=${encodeURIComponent("link again")}`, { token: sam.token });
  assert.equal(found.json.threads.length, 1);
  const none = await call(`/constellations/${cid}/nebulas/${forum.id}/threads?tag=${solvedTag}`, { token: sam.token });
  assert.equal(none.json.threads.length, 0);
});

test("answers: the poster marks one, Solved goes on; others can't; staff can pin", { skip }, async () => {
  const answer = await send(forum.conversationId, "Two Rockstar accounts? Link from the right one.", sam.token, { threadId: postId });
  const aid = answer.json.message.id;
  assert.equal((await call(`/constellations/${cid}/threads/${postId}`, { method: "PATCH", token: sam.token, body: { answerMessageId: aid } })).status, 403);
  const marked = await call(`/constellations/${cid}/threads/${postId}`, { method: "PATCH", token: riley.token, body: { answerMessageId: aid } });
  assert.equal(marked.status, 200, JSON.stringify(marked.json));
  assert.equal(marked.json.thread.answerMessageId, aid);
  assert.ok(marked.json.thread.tagIds.includes(solvedTag));
  assert.equal((await call(`/constellations/${cid}/threads/${postId}`, { method: "PATCH", token: riley.token, body: { pinned: true } })).status, 403);
  assert.equal((await call(`/constellations/${cid}/threads/${postId}`, { method: "PATCH", token: owner.token, body: { pinned: true } })).json.thread.pinned, true);
  // Riley follows the post and has Sam's reply unread.
  const mine = await call(`/constellations/${cid}/nebulas/${forum.id}/threads`, { token: riley.token });
  assert.equal(mine.json.threads[0].unread, 1);
});

test("deleting: not once others replied (unless staff)", { skip }, async () => {
  assert.equal((await call(`/constellations/${cid}/threads/${postId}`, { method: "DELETE", token: riley.token })).status, 403);
  assert.equal((await call(`/constellations/${cid}/threads/${postId}`, { method: "DELETE", token: owner.token })).status, 200);
  assert.equal((await call(`/constellations/${cid}/threads/${postId}`, { token: riley.token })).status, 404);
  const log = await pool.query("select action from constellation_audit_log where constellation_id = $1 and action = 'thread_deleted'", [cid]);
  assert.equal(log.rows.length, 1);
});
