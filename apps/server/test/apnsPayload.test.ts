// 0.8.0 grouped notifications: the iPhone payload built for each push (apnsPayload.ts).
// Run: npm test -w @glofly/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { apnsFor } from "../src/push/apnsPayload";

type Aps = Record<string, unknown> & { alert?: { title: string; body: string } };
const apsOf = (p: Record<string, unknown>) => (p.payload as { aps: Aps }).aps;
const headersOf = (p: Record<string, unknown>) => p.headers as Record<string, string>;

const base = {
  type: "message",
  messageId: "m1",
  senderId: "u-maya",
  senderAvatar: "",
  preview: "1",
  mention: "0",
  sentAt: new Date().toISOString(),
};

test("1-on-1 messages stack per chat, summarised by the sender", () => {
  const a = apnsFor({ ...base, conversationId: "c-dm", chatKind: "dm", chatTitle: "", senderName: "Maya", title: "Maya", text: "hi" }, 3600);
  const b = apnsFor({ ...base, messageId: "m2", conversationId: "c-dm", chatKind: "dm", chatTitle: "", senderName: "Maya", title: "Maya", text: "there" }, 3600);
  assert.equal(apsOf(a)["thread-id"], "c-dm");
  assert.equal(apsOf(b)["thread-id"], apsOf(a)["thread-id"]);
  assert.equal(apsOf(a)["summary-arg"], "Maya");
  assert.equal(apsOf(a)["summary-arg-count"], 1);
  assert.equal(apsOf(a).category, "GLOFLY_MESSAGE");
  assert.deepEqual(apsOf(a).alert, { title: "Maya", body: "hi" });
  assert.equal(headersOf(a)["apns-push-type"], "alert");
  // No collapse id: each message stays in the stack instead of replacing the last one.
  assert.equal(headersOf(a)["apns-collapse-id"], undefined);
});

test("group messages stack per group, summarised by the group's name", () => {
  const p = apnsFor({ ...base, conversationId: "c-grp", chatKind: "group", chatTitle: "Weekend crew", senderName: "Sam", title: "Sam · Weekend crew", text: "yo" }, 3600);
  assert.equal(apsOf(p)["thread-id"], "c-grp");
  assert.equal(apsOf(p)["summary-arg"], "Weekend crew");
});

test("nebula messages stack per nebula (not per constellation)", () => {
  const data = {
    ...base,
    conversationId: "c-neb-1",
    chatKind: "group",
    chatTitle: "#general · Night Owls",
    senderName: "Dana",
    title: "Dana · #general",
    text: "Night Owls: hello",
    nebula: "1",
    thread: "constellation:k1",
  };
  const p = apnsFor(data, 3600);
  assert.equal(apsOf(p)["thread-id"], "c-neb-1");
  assert.equal(apsOf(p)["summary-arg"], "#general · Night Owls");
  const other = apnsFor({ ...data, conversationId: "c-neb-2" }, 3600);
  assert.notEqual(apsOf(other)["thread-id"], apsOf(p)["thread-id"]);
});

test("message sounds follow the phone's pick", () => {
  const p = apnsFor({ ...base, conversationId: "c", chatKind: "dm", senderName: "Maya", title: "Maya", text: "x" }, 60);
  assert.match(String(apsOf(p).sound), /\.caf$/);
});

test("clears stay silent background pushes", () => {
  const p = apnsFor({ type: "clear", conversationId: "c-dm" }, 60);
  assert.equal(headersOf(p)["apns-push-type"], "background");
  assert.deepEqual(apsOf(p), { "content-available": 1 });
});

test("calls keep their own collapse id and no thread change", () => {
  const ring = apnsFor({ type: "call_ring", callId: "call1", conversationId: "c", callerName: "Maya", video: "0" }, 30);
  assert.equal(headersOf(ring)["apns-collapse-id"], "call1");
  assert.equal(apsOf(ring)["thread-id"], undefined);
  const missed = apnsFor({ type: "call_missed", callId: "call1", conversationId: "c", title: "Missed call", text: "Maya" }, 30);
  assert.equal(apsOf(missed)["thread-id"], "c");
});
