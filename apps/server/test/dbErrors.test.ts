// Oct 28, 2026: Drizzle's "Failed query" hid why Postgres refused a push registration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pgCode, withDatabaseReason } from "../src/dbErrors";

const wrapped = (cause: object) => Object.assign(new Error('Failed query: insert into "push_devices" …'), { cause });

test("finds Postgres's code through Drizzle's wrapper", () => {
  assert.equal(pgCode(wrapped({ code: "23505" })), "23505");
  assert.equal(pgCode({ code: "23503" }), "23503");
  assert.equal(pgCode(new Error("plain")), undefined);
  assert.equal(pgCode(null), undefined);
});

test("server error reports say which rule was broken, never the values", () => {
  const msg = withDatabaseReason(
    wrapped({ code: "23505", constraint: "push_devices_token_unique", detail: "Key (token)=(secret) already exists." }),
    "Failed query: …",
  );
  assert.equal(msg, "Postgres 23505 push_devices_token_unique: Failed query: …");
  assert.ok(!msg.includes("secret"));
  assert.equal(withDatabaseReason(wrapped({ code: "23503", table: "push_devices" }), "x"), "Postgres 23503 push_devices: x");
  assert.equal(withDatabaseReason(new Error("no cause"), "no cause"), "no cause");
});
