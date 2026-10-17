import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { VIDEO_MAX_MS } from "@glofly/shared";
import type { VideoInfo } from "../db/schema";

// Videos in chats (0.5.0). A video is stored exactly as sent (like any file, so older apps offer
// it as a download), plus a poster picture for the chat. The server looks at it with ffprobe and
// takes the poster with ffmpeg, both reading a private temporary copy (never the network:
// -protocol_whitelist file), one or two at a time, with a time limit.

const FFMPEG = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH?.trim() || "ffprobe";
const TIME_LIMIT_MS = 30_000;
const MAX_RUNNING = 2;
const POSTER_SIZE = 720;
let running = 0;

/** MP4 / MOV / WebM, by the bytes the file starts with (null if it isn't one). */
export function videoContainer(data: Buffer): VideoInfo["mime"] | null {
  if (data.length >= 12 && data.toString("latin1", 4, 8) === "ftyp") {
    const brand = data.toString("latin1", 8, 12);
    if (brand === "qt  ") return "video/quicktime";
    if (/^M4[AB] /.test(brand)) return null; // audio
    return "video/mp4";
  }
  if (data.length >= 64 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return data.subarray(0, 64).toString("latin1").includes("webm") ? "video/webm" : null;
  }
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

type Probe = { streams?: { codec_type?: string; width?: number; height?: number; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[]; format?: { duration?: string } };

/**
 * Looks at a video: its length and size (as it shows, so a phone video filmed upright is tall),
 * and a poster picture (WebP). Null if it isn't a video ffmpeg can read, or is too long.
 */
export async function examineVideo(data: Buffer): Promise<{ info: Omit<VideoInfo, "mime">; poster: Buffer } | null> {
  // At most MAX_RUNNING at once; the rest wait their turn (up to 20 seconds).
  const waitUntil = Date.now() + 20_000;
  while (running >= MAX_RUNNING) {
    if (Date.now() > waitUntil) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
  running++; // (no await between the check and this, so two can't both get in)
  const dir = await mkdtemp(join(tmpdir(), "glofly-video-"));
  const file = join(dir, "video");
  try {
    await writeFile(file, data, { mode: 0o600 });
    const probeOut = await run(
      FFPROBE,
      ["-v", "error", "-protocol_whitelist", "file", "-print_format", "json", "-show_streams", "-show_format", file],
      256 * 1024,
    );
    if (!probeOut) return null;
    const probe = JSON.parse(probeOut.toString("utf8")) as Probe;
    const stream = probe.streams?.find((s) => s.codec_type === "video");
    const durationMs = Math.round(Number(probe.format?.duration ?? 0) * 1000);
    if (!stream?.width || !stream.height || !(durationMs > 0) || durationMs > VIDEO_MAX_MS + 2000) return null;
    const rotation = Math.abs(Number(stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0)) % 180;
    const [width, height] = rotation === 90 ? [stream.height, stream.width] : [stream.width, stream.height];

    // The poster: a frame half a second in (or the first frame of a very short video).
    const at = durationMs > 1500 ? "0.5" : "0";
    const frame = await run(
      FFMPEG,
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "file", "-ss", at, "-i", file, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
      40 * 1024 * 1024,
    );
    if (!frame) return null;
    const poster = await sharp(frame, { limitInputPixels: 50_000_000 })
      .resize(POSTER_SIZE, POSTER_SIZE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return { info: { durationMs: Math.min(durationMs, VIDEO_MAX_MS), width, height }, poster };
  } catch {
    return null;
  } finally {
    running--;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
