// Unit test (no server): the old-app answer rewriter keeps dates and only touches forum nebulas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { downgrade } from "../src/threads/legacy";

test("dates and other non-plain values survive; forum nebulas become read-only text", () => {
  const when = new Date("2026-11-07T00:49:20.634Z");
  const body = {
    accounts: [{ id: "a", lastSeenAt: when, createdAt: when, bytes: Buffer.from("hi") }],
    nebulas: [{ id: "n", kind: "forum", conversationId: "c", readOnly: false, topic: "x", forum: { tags: [] } }],
  };
  const out = JSON.parse(JSON.stringify(downgrade(body)));
  assert.equal(out.accounts[0].lastSeenAt, "2026-11-07T00:49:20.634Z");
  assert.equal(out.accounts[0].createdAt, "2026-11-07T00:49:20.634Z");
  assert.equal(out.accounts[0].bytes.type, "Buffer");
  assert.equal(out.nebulas[0].kind, "text");
  assert.equal(out.nebulas[0].readOnly, true);
  assert.equal(out.nebulas[0].forum, undefined);
});
