import type { NextFunction, Request, Response } from "express";

// Communities round (Nov 2026): apps from before threads + forums don't know a "forum" nebula
// (older desktop builds treat any kind that isn't "text" as voice). Apps that know them send
// `X-Glofly-Features: threads`; for everyone else, every forum nebula in an answer becomes a
// read-only text nebula that says to update (its timeline is empty: all posts are threads).

const NOTE = "This is a star chart. Update Glofly to read and send signals here.";
const STAGE_NOTE = "This is a stage. Update Glofly to listen in.";

export const knowsThreads = (req: Request) => /(^|[\s,])threads($|[\s,])/.test(String(req.headers["x-glofly-features"] ?? ""));

type Downgrade = { forums: boolean; round2: boolean };
const ALL: Downgrade = { forums: true, round2: true };

export function downgrade(value: unknown, depth = 0, what: Downgrade = ALL): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => downgrade(v, depth + 1, what));
  // Only plain objects are rebuilt. Dates, Buffers and anything else with its own toJSON pass through
  // untouched: copying a Date's (zero) own keys turned every date into {} for older apps and Control.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = downgrade(v, depth + 1, what);
  if (what.forums && o.kind === "forum" && typeof o.conversationId === "string") {
    out.kind = "text";
    if ("readOnly" in o) out.readOnly = true;
    if ("topic" in o) out.topic = NOTE;
    delete out.forum;
  }
  // Communities round 2: a stage is a read-only text nebula saying to update; an announcement nebula is
  // what announcements used to be (read-only text). Live stages aren't sent at all.
  if (what.round2 && typeof o.conversationId === "string" && (o.kind === "stage" || o.kind === "announcement")) {
    if (o.kind === "stage" && "topic" in o) out.topic = STAGE_NOTE;
    out.kind = "text";
    if ("readOnly" in o) out.readOnly = true;
    delete out.followers;
    delete out.stageSpeakerLimit;
  }
  if (what.round2 && Array.isArray(o.stages) && Array.isArray(o.nebulas)) delete out.stages;
  return out;
}

export function legacyForums(req: Request, res: Response, next: NextFunction): void {
  // Control (/admin) never shows nebulas, so its answers are left alone.
  if (req.path.startsWith("/admin")) return next();
  const threads = knowsThreads(req);
  const round2 = knowsRound2(req);
  if (threads && round2) return next();
  const json = res.json.bind(res);
  res.json = ((body: unknown) => json(downgrade(body, 0, { forums: !threads, round2: !round2 }))) as Response["json"];
  next();
}

/** Communities round 2 (Nov 2026): apps that know custom emoji, stage and announcement nebulas and the newer permissions. */
export const knowsRound2 = (req: Request) => /(^|[\s,])round2($|[\s,])/.test(String(req.headers["x-glofly-features"] ?? ""));
