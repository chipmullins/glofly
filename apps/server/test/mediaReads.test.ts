import { test } from "node:test";
import assert from "node:assert/strict";
import { isMediaRead } from "../src/mediaReads";

// Oct 27, 2026: with a minimum desktop version set in Control, every photo and file the desktop app
// and chat.glofly.app load by address was refused (they can't send X-Glofly-Version). These are
// exactly the addresses desktop main/media.ts, renderer lib/media.ts and the downloads use.
const c = "b57ddf0b-0156-4c76-8c08-c05b68070892";
const a = "7dd03eec-4093-49ff-9ebf-3276aca20c01";

test("photo and file loads skip the minimum version", () => {
  for (const url of [
    `/avatars/${c}/${a}`,
    `/conversations/${c}/photo/${a}`,
    ...["preview", "full", "file", "poster", "video", "m4a"].map((v) => `/conversations/${c}/attachments/${a}/${v}`),
    `/conversations/${c}/messages/${a}/preview-image`,
    `/stickers/${a}/image`,
    `/constellations/${c}/icon/${a}`,
    `/constellations/${c}/banner/${a}`,
    `/avatars/${c}/${a}?x=1`,
  ]) {
    assert.equal(isMediaRead("GET", url), true, url);
  }
  assert.equal(isMediaRead("HEAD", `/avatars/${c}/${a}`), true);
});

test("everything else still asks old apps to update", () => {
  for (const [method, url] of [
    ["GET", `/conversations/${c}/messages`],
    ["GET", "/conversations"],
    ["GET", "/auth/me"],
    ["POST", `/conversations/${c}/attachments`],
    ["POST", `/conversations/${c}/attachments/${a}/full`],
    ["PUT", "/users/me/avatar"],
    ["DELETE", `/avatars/${c}/${a}`],
    ["GET", `/avatars/${c}/${a}/extra`],
    ["GET", `/conversations/${c}/attachments/${a}/other`],
    ["GET", `/admin/avatars/${c}/${a}`],
  ] as const) {
    assert.equal(isMediaRead(method, url), false, `${method} ${url}`);
  }
});
