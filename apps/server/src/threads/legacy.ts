import type { NextFunction, Request, Response } from "express";

// Communities round (Nov 2026): apps from before threads + forums don't know a "forum" nebula
// (older desktop builds treat any kind that isn't "text" as voice). Apps that know them send
// `X-Glofly-Features: threads`; for everyone else, every forum nebula in an answer becomes a
// read-only text nebula that says to update (its timeline is empty: all posts are threads).

const NOTE = "This is a forum. Update Glofly to read and write posts here.";

export const knowsThreads = (req: Request) => /(^|[\s,])threads($|[\s,])/.test(String(req.headers["x-glofly-features"] ?? ""));

function downgrade(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => downgrade(v, depth + 1));
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = downgrade(v, depth + 1);
  if (o.kind === "forum" && typeof o.conversationId === "string") {
    out.kind = "text";
    if ("readOnly" in o) out.readOnly = true;
    if ("topic" in o) out.topic = NOTE;
    delete out.forum;
  }
  return out;
}

export function legacyForums(req: Request, res: Response, next: NextFunction): void {
  if (knowsThreads(req)) return next();
  const json = res.json.bind(res);
  res.json = ((body: unknown) => json(downgrade(body))) as Response["json"];
  next();
}
