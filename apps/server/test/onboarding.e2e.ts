// Communities round 4.3: onboarding (questions, optional nebulas, Browse nebulas), against a real
// server with Postgres and Redis. Run like integrations.e2e.ts.
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
let joinCode: string;

const send = (conversationId: string, body: string, token: string, extra: Record<string, unknown> = {}) =>
  call(`/conversations/${conversationId}/messages`, { method: "POST", token, body: { body, ...extra } });

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  owner = await account("obowner");
  riley = await account("obriley");
  sam = await account("obsam");
  outsider = await account("obout");
  const made = await call("/constellations", { method: "POST", token: owner.token, body: { name: `Onboard ${tag}`, template: "gaming" } });
  cid = made.json.constellation.id;
  general = made.json.constellation.nebulas.find((n: any) => n.kind === "text");
  const link = await call(`/constellations/${cid}/links`, { method: "POST", token: owner.token, body: { lifetime: "7d" } });
  await call(`/constellations/links/${link.json.link.code}/join`, { method: "POST", token: riley.token });
  joinCode = link.json.link.code;
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.query("delete from users where id = any($1)", [[owner.id, riley.id, sam.id, outsider.id]]);
  await pool.end();
});



const detail = async (token: string) => (await call(`/constellations/${cid}`, { token })).json.constellation;
const names = (d: any) => d.nebulas.map((n: any) => n.name);
let clips: any, offTopic: any, rl: any, admin: any, settings: any;

test("setting up onboarding: checks roles and nebulas, keeps what people already see", { skip }, async () => {
  for (const name of ["memes", "off-topic"]) {
    const r = await call(`/constellations/${cid}/nebulas`, { method: "POST", token: owner.token, body: { name, kind: "text" } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  const d = await detail(owner.token);
  clips = d.nebulas.find((n: any) => n.name === "memes");
  offTopic = d.nebulas.find((n: any) => n.name === "off-topic");
  rl = d.roles.find((r: any) => r.selfAssign && r.name === "Rocket League");
  admin = d.roles.find((r: any) => r.kind === "admin");
  assert.ok(rl, "the gaming template has a Rocket League role");
  const q = (roleIds: string[], nebulaIds: string[]) => ({
    title: "What do you play with us?",
    multi: true,
    required: true,
    answers: [
      { emoji: "🚀", label: "Rocket League", description: "Ranked squads most nights", roleIds, nebulaIds: [] },
      { emoji: "👋", label: "Just here to hang", description: "Chat and voice only", roleIds: [], nebulaIds },
    ],
  });
  settings = { enabled: true, questions: [q([rl.id], [offTopic.id])], optionalNebulaIds: [clips.id, offTopic.id] };
  // Answers can't hand out permissions or show nebulas that aren't optional.
  assert.equal((await call(`/constellations/${cid}/onboarding`, { method: "PUT", token: owner.token, body: { ...settings, questions: [q([admin.id], [])] } })).status, 400);
  assert.equal((await call(`/constellations/${cid}/onboarding`, { method: "PUT", token: owner.token, body: { ...settings, questions: [q([], [general.id])] } })).status, 400);
  assert.equal((await call(`/constellations/${cid}/onboarding`, { method: "PUT", token: riley.token, body: settings })).status, 403);
  const ok = await call(`/constellations/${cid}/onboarding`, { method: "PUT", token: owner.token, body: settings });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  settings = ok.json.constellation.onboarding;
  assert.equal(settings.questions[0].answers.length, 2);
  assert.ok(settings.questions[0].id && settings.questions[0].answers[0].id);
  // Riley was here first: still sees both, and isn't asked.
  const r = await detail(riley.token);
  assert.ok(names(r).includes("memes") && names(r).includes("off-topic"));
  assert.ok(r.me.onboarding.onboardedAt);
});

test("a new member sees less, answers, and changes answers later", { skip }, async () => {
  await call(`/constellations/links/${joinCode}/join`, { method: "POST", token: sam.token });
  let d = await detail(sam.token);
  assert.equal(d.me.onboarding.onboardedAt, null);
  assert.ok(!names(d).includes("memes") && !names(d).includes("off-topic"));
  assert.deepEqual(d.browse.map((b: any) => b.name).sort(), ["memes", "off-topic"]);
  // Hidden for real: no messages from it.
  assert.equal((await call(`/conversations/${clips.conversationId}/messages`, { token: sam.token })).status, 404);
  const q = settings.questions[0];
  const [rocket, hang] = q.answers;
  assert.equal((await call(`/constellations/${cid}/onboarding/answers`, { method: "POST", token: sam.token, body: { answers: {}, done: true } })).status, 400);
  const done = await call(`/constellations/${cid}/onboarding/answers`, { method: "POST", token: sam.token, body: { answers: { [q.id]: [rocket.id, hang.id] }, done: true } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  d = done.json.constellation;
  assert.ok(d.me.onboarding.onboardedAt);
  assert.ok(names(d).includes("off-topic") && !names(d).includes("memes"));
  assert.ok(names(d).includes("rocket-league"), "the role's nebula comes with it");
  assert.ok(d.members.find((m: any) => m.user.id === sam.id).roleIds.includes(rl.id));
  // "Your answers": only hanging out now. The role and its nebula go.
  const changed = await call(`/constellations/${cid}/onboarding/answers`, { method: "POST", token: sam.token, body: { answers: { [q.id]: [hang.id] } } });
  d = changed.json.constellation;
  assert.ok(!names(d).includes("rocket-league"));
  assert.ok(!d.members.find((m: any) => m.user.id === sam.id).roleIds.includes(rl.id));
  assert.deepEqual(d.me.onboarding.answers[q.id], [hang.id]);
});

test("Browse nebulas shows and hides an optional nebula for me", { skip }, async () => {
  const on = await call(`/constellations/${cid}/me/nebulas/${clips.id}`, { method: "PUT", token: sam.token, body: { shown: true } });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.ok(names(on.json.constellation).includes("memes"));
  assert.equal((await call(`/conversations/${clips.conversationId}/messages`, { token: sam.token })).status, 200);
  const off = await call(`/constellations/${cid}/me/nebulas/${clips.id}`, { method: "PUT", token: sam.token, body: { shown: false } });
  assert.ok(!names(off.json.constellation).includes("memes"));
  // Only optional nebulas can be hidden.
  assert.equal((await call(`/constellations/${cid}/me/nebulas/${general.id}`, { method: "PUT", token: sam.token, body: { shown: false } })).status, 400);
  // Turning onboarding off shows everything again.
  await call(`/constellations/${cid}/onboarding`, { method: "PUT", token: owner.token, body: { enabled: false, questions: settings.questions, optionalNebulaIds: [clips.id, offTopic.id] } });
  assert.ok(names(await detail(sam.token)).includes("memes"));
});
