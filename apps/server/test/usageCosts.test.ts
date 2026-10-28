// Control → Usage & costs: the estimate (admin/usageCosts.ts). Run: npm test -w @glofly/server
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCosts, projectToMonth } from "../src/admin/usageCosts";

const GB = 1024 ** 3;
const line = (r: ReturnType<typeof estimateCosts>, key: string) => r.lines.find((l) => l.key === key)!.monthly;
const base = { participantMinutes: 0, bytesOut: 0, phoneUsers: 0, storedBytes: 0 };

test("free plans while small", () => {
  const r = estimateCosts({ ...base, participantMinutes: 4_999, phoneUsers: 1_000, bytesOut: 99 * GB });
  assert.equal(line(r, "livekit"), 0);
  assert.equal(line(r, "expo"), 0);
  assert.equal(line(r, "dataOut"), 0);
});

test("paid plans and overage at a few thousand people", () => {
  const r = estimateCosts({ participantMinutes: 200_000, phoneUsers: 5_000, bytesOut: 300 * GB, storedBytes: 100 * GB });
  assert.equal(line(r, "livekit"), 75); // $50 + 50,000 × $0.0005
  assert.equal(line(r, "expo"), 29); // $19 + 2,000 × $0.005
  assert.equal(line(r, "dataOut"), 18); // (300 − 100) GB × $0.09
  assert.equal(line(r, "storage"), 2.3);
  assert.equal(line(r, "aws"), 29.91);
  assert.equal(line(r, "other"), 9.75);
  assert.equal(r.total, 75 + 29 + 18 + 2.3 + 29.91 + 9.75);
});

test("just over the free call minutes moves to the $50 plan", () => {
  assert.equal(line(estimateCosts({ ...base, participantMinutes: 5_001 }), "livekit"), 50);
});

test("projection scales month-so-far to the whole month", () => {
  // Oct 2026 has 31 days; halfway through (Oct 16, 12:00 UTC) doubles the count.
  const mid = new Date(Date.UTC(2026, 9, 16, 12));
  assert.equal(Math.round(projectToMonth(100, mid)), 200);
  // The first hours of a month count as a full day (no wild 700× projections).
  const early = new Date(Date.UTC(2026, 9, 1, 1));
  assert.equal(Math.round(projectToMonth(10, early)), 310);
});
