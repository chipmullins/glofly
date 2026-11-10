import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { and, eq, sql } from "drizzle-orm";
import { CAMPFIRE_LIMITS, type CampfireFile, type CampfireFileKind } from "@glofly/shared";
import { db } from "../db";
import { campfireCampaigns, campfireFiles } from "../db/schema";
import { storage } from "../storage";

// Campfire uploads: maps, token pictures, portraits, handout pictures and music. Pictures are
// re-saved as WebP (which drops hidden photo data like GPS), audio is copied without its tags and
// cover art by ffmpeg (reading a private temporary copy, never the network). Files are kept at
// campfire/<campaignId>/<fileId>.<ext> and only handed out by GET /campfire/files/:id.

export type FileRow = typeof campfireFiles.$inferSelect;
export const FILE_KINDS: readonly CampfireFileKind[] = ["map", "token", "portrait", "handout", "audio"];
export const isFileKind = (x: unknown): x is CampfireFileKind => typeof x === "string" && (FILE_KINDS as readonly string[]).includes(x);

export const fileOut = (f: FileRow): CampfireFile => ({
  id: f.id,
  kind: f.kind as CampfireFileKind,
  mime: f.mime,
  bytes: f.bytes,
  width: f.width,
  height: f.height,
  createdAt: f.createdAt.toISOString(),
});

export class UploadProblem extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    message: string,
  ) {
    super(message);
  }
}

const IMAGE_FORMATS = ["jpeg", "png", "webp", "gif", "heif", "avif"];
/** Largest side each kind of picture is kept at. */
const KEEP_SIDE: Record<Exclude<CampfireFileKind, "audio">, number> = { map: CAMPFIRE_LIMITS.mapSide, token: 1024, portrait: 1024, handout: 2048 };

export const maxBytesFor = (kind: CampfireFileKind) =>
  kind === "map" ? CAMPFIRE_LIMITS.mapBytes : kind === "audio" ? CAMPFIRE_LIMITS.audioBytes : CAMPFIRE_LIMITS.imageBytes;
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

async function processImage(kind: Exclude<CampfireFileKind, "audio">, data: Buffer) {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(data, { limitInputPixels: CAMPFIRE_LIMITS.mapSide * CAMPFIRE_LIMITS.mapSide }).metadata();
  } catch {
    throw new UploadProblem(400, "invalid", "That file isn't a picture Glofly can use.");
  }
  if (!IMAGE_FORMATS.includes(meta.format ?? "")) throw new UploadProblem(400, "invalid", "That file isn't a picture Glofly can use.");
  if (kind === "map" && ((meta.width ?? 0) > CAMPFIRE_LIMITS.mapSide || (meta.height ?? 0) > CAMPFIRE_LIMITS.mapSide)) {
    throw new UploadProblem(400, "too_large", `Maps can be up to ${CAMPFIRE_LIMITS.mapSide} pixels on each side.`);
  }
  try {
    const side = KEEP_SIDE[kind];
    // Token, portrait and handout pictures end up small: refuse giant ones before decoding (memory).
    const pixels = kind === "map" ? CAMPFIRE_LIMITS.mapSide * CAMPFIRE_LIMITS.mapSide : 40_000_000;
    if ((meta.width ?? 0) * (meta.height ?? 0) > pixels) throw new Error("too big");
    const out = await sharp(data, { limitInputPixels: pixels })
      .rotate()
      .resize(side, side, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: kind === "map" ? 82 : 85 })
      .toBuffer({ resolveWithObject: true });
    return { data: out.data, mime: "image/webp", ext: "webp", width: out.info.width, height: out.info.height, durationSec: null };
  } catch {
    throw new UploadProblem(400, "invalid", "That picture couldn't be read.");
  }
}

// ───────────── Audio ─────────────

const FFMPEG = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH?.trim() || "ffprobe";
const TIME_LIMIT_MS = 60_000;
let running = 0;

type AudioKind = { demuxer: string; muxer: string; mime: string; ext: string };
/** MP3 / Ogg / M4A / WAV by the bytes the file starts with (null: none of these). */
export function audioKind(data: Buffer): AudioKind | null {
  if (data.length < 12) return null;
  const head = data.toString("latin1", 0, 12);
  if (head.startsWith("ID3") || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) return { demuxer: "mp3", muxer: "mp3", mime: "audio/mpeg", ext: "mp3" };
  if (head.startsWith("OggS")) return { demuxer: "ogg", muxer: "ogg", mime: "audio/ogg", ext: "ogg" };
  if (head.slice(4, 8) === "ftyp") return { demuxer: "mov", muxer: "ipod", mime: "audio/mp4", ext: "m4a" };
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WAVE") return { demuxer: "wav", muxer: "wav", mime: "audio/wav", ext: "wav" };
  return null;
}

function run(cmd: string, args: string[], maxOut: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => p.kill("SIGKILL"), TIME_LIMIT_MS);
    p.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxOut) p.kill("SIGKILL");
      else chunks.push(c);
    });
    p.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && size <= maxOut ? Buffer.concat(chunks) : null);
    });
  });
}

async function processAudio(data: Buffer) {
  const kind = audioKind(data);
  const refuse = () => new UploadProblem(400, "invalid", "Music can be MP3, Ogg, M4A or WAV files.");
  if (!kind) throw refuse();
  const waitUntil = Date.now() + 20_000;
  while (running >= 2) {
    if (Date.now() > waitUntil) throw new UploadProblem(503, "busy", "Glofly is busy with other music right now. Try again in a moment.");
    await new Promise((r) => setTimeout(r, 250));
  }
  running++;
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "glofly-campfire-"));
    const file = join(dir, "in");
    await writeFile(file, data, { mode: 0o600 });
    const probeOut = await run(FFPROBE, ["-v", "error", "-protocol_whitelist", "file", "-f", kind.demuxer, "-print_format", "json", "-show_streams", "-show_format", file], 256 * 1024);
    if (!probeOut) throw refuse();
    const probe = JSON.parse(probeOut.toString("utf8")) as { streams?: { codec_type?: string }[]; format?: { duration?: string } };
    if (!probe.streams?.some((s) => s.codec_type === "audio")) throw refuse();
    const duration = Number(probe.format?.duration ?? 0);
    // Only the sound, without tags or cover art (the sound itself copied untouched).
    const out = join(dir, `clean.${kind.ext}`);
    const cleaned = await run(
      FFMPEG,
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "file", "-f", kind.demuxer, "-i", file, "-map", "0:a:0", "-map_metadata", "-1", "-c", "copy", "-f", kind.muxer, out],
      1024,
    );
    if (!cleaned) throw refuse();
    const clean = await readFile(out);
    if (!clean.length) throw refuse();
    return { data: clean, mime: kind.mime, ext: kind.ext, width: null, height: null, durationSec: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null };
  } finally {
    running--;
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ───────────── Saving ─────────────

/** Saves an upload for a campaign (limits checked). */
export async function saveUpload(campaignId: string, uploaderId: string, kind: CampfireFileKind, data: Buffer): Promise<FileRow> {
  if (!data.length) throw new UploadProblem(400, "invalid", "That file is empty.");
  if (data.length > maxBytesFor(kind)) throw new UploadProblem(413, "too_large", `That file is too big (up to ${mb(maxBytesFor(kind))}).`);
  if (kind === "audio") {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(campfireFiles)
      .where(and(eq(campfireFiles.campaignId, campaignId), eq(campfireFiles.kind, "audio")));
    if (n >= CAMPFIRE_LIMITS.tracks) throw new UploadProblem(409, "limit", `A campaign can have up to ${CAMPFIRE_LIMITS.tracks} music files.`);
  }
  const processed = kind === "audio" ? await processAudio(data) : await processImage(kind, data);
  const id = randomUUID();
  const storageKey = `campfire/${campaignId}/${id}.${processed.ext}`;
  // Counted and recorded in one step, so two uploads at once can't both squeeze past 1 GB.
  const file = await db.transaction(async (tx) => {
    await tx.select({ id: campfireCampaigns.id }).from(campfireCampaigns).where(eq(campfireCampaigns.id, campaignId)).for("update");
    const [{ total }] = await tx
      .select({ total: sql<number>`coalesce(sum(${campfireFiles.bytes}), 0)::bigint` })
      .from(campfireFiles)
      .where(eq(campfireFiles.campaignId, campaignId));
    if (Number(total) + processed.data.length > CAMPFIRE_LIMITS.campaignBytes) {
      throw new UploadProblem(409, "limit", "This campaign's files are full (1 GB). Delete some first.");
    }
    const [row] = await tx
      .insert(campfireFiles)
      .values({ id, campaignId, kind, storageKey, mime: processed.mime, bytes: processed.data.length, width: processed.width, height: processed.height, durationSec: processed.durationSec, uploadedBy: uploaderId })
      .returning();
    return row;
  });
  try {
    await storage.put(storageKey, processed.data, processed.mime);
  } catch (err) {
    await db.delete(campfireFiles).where(eq(campfireFiles.id, id));
    throw err;
  }
  return file;
}

export async function removeStored(keys: string[]): Promise<void> {
  for (const key of keys) await storage.remove(key).catch((err) => console.error("Couldn't remove a Campfire file", err));
}

/**
 * Account removal (account/deletion.ts): the person's uploads go with them (rows by cascade, the
 * stored files here). Campaigns whose group goes too are removed by the cleanup sweep.
 */
export async function campfireFilesOfLeaver(userId: string): Promise<string[]> {
  const mine = await db.select({ key: campfireFiles.storageKey }).from(campfireFiles).where(eq(campfireFiles.uploadedBy, userId));
  return mine.map((r) => r.key);
}
