import { join } from "node:path";
import sharp from "sharp";
import type { InferenceSession } from "onnxruntime-node";

// Custom stickers (0.5.0): the background is removed from a photo on the server with U²-Net
// (the small "u2netp" model, Apache-2.0, models/u2netp.onnx, ~4.5 MB) run by ONNX Runtime on
// the CPU: a few hundred milliseconds per photo. Nothing leaves the server.
//
// The cut-out gets a white outline like a real sticker, is trimmed to its edges, and saved as a
// see-through WebP up to 512 px.

const MODEL = join(__dirname, "..", "..", "models", "u2netp.onnx");
const SIZE = 320; // the model's input
const OUT = 512;
const OUTLINE = 7;

let session: Promise<InferenceSession> | null = null;
function model(): Promise<InferenceSession> {
  // Loaded on first use (keeps start-up fast and memory low when nobody makes stickers).
  session ??= import("onnxruntime-node").then((ort) => ort.InferenceSession.create(MODEL, { intraOpNumThreads: 2 }));
  session.catch(() => (session = null));
  return session;
}

/** Only one cut-out at a time, so a burst can't take over the server's CPU. */
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export class CutoutError extends Error {}

export type Cutout = { data: Buffer; width: number; height: number };

/** A photo → a sticker (see-through WebP). Throws CutoutError with a message for the person. */
export function makeSticker(photo: Buffer): Promise<Cutout> {
  return oneAtATime(() => cut(photo));
}

async function cut(photo: Buffer): Promise<Cutout> {
  let base: { data: Buffer; info: sharp.OutputInfo };
  try {
    base = await sharp(photo, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(OUT, OUT, { fit: "inside", withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new CutoutError("That doesn't look like a photo. Try a JPEG, PNG or HEIC.");
  }
  const { width, height } = base.info;

  // The model's view: 320×320, normalized like ImageNet.
  const small = await sharp(base.data, { raw: { width, height, channels: 3 } }).resize(SIZE, SIZE, { fit: "fill" }).raw().toBuffer();
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const input = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + i] = (small[i * 3 + c] / 255 - mean[c]) / std[c];
  }
  const ort = await import("onnxruntime-node");
  const s = await model();
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
  const raw = out[s.outputNames[0]].data as Float32Array;

  let lo = Infinity;
  let hi = -Infinity;
  for (const v of raw) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const mask = Buffer.alloc(SIZE * SIZE);
  let kept = 0;
  for (let i = 0; i < raw.length; i++) {
    const v = hi > lo ? (raw[i] - lo) / (hi - lo) : 0;
    // A gentle curve: crisp edges without jaggies.
    const a = Math.max(0, Math.min(1, (v - 0.15) / 0.7));
    mask[i] = Math.round(a * 255);
    if (a > 0.5) kept++;
  }
  const share = kept / (SIZE * SIZE);
  if (share < 0.02) throw new CutoutError("Couldn't find anything to cut out. Try a photo with something clearly in front.");
  if (share > 0.97) throw new CutoutError("Couldn't tell what's in front. Try a photo with a plainer background.");

  // (Single-channel pictures are kept single-channel with b-w, so the raw bytes line up.)
  const alpha = await sharp(mask, { raw: { width: SIZE, height: SIZE, channels: 1 } }).resize(width, height, { fit: "fill" }).toColourspace("b-w").raw().toBuffer();

  // Pad so the outline has room, then: white silhouette (the alpha, grown) under the cut-out.
  const pad = OUTLINE * 2;
  const W = width + pad * 2;
  const H = height + pad * 2;
  const paddedAlpha = await sharp(alpha, { raw: { width, height, channels: 1 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#000000" })
    .toColourspace("b-w")
    .raw()
    .toBuffer();
  // (sharp runs each pipeline's steps in its own fixed order, so grow and soften are separate passes.)
  const spread = await sharp(paddedAlpha, { raw: { width: W, height: H, channels: 1 } }).blur(OUTLINE).toColourspace("b-w").raw().toBuffer();
  const solid = await sharp(spread, { raw: { width: W, height: H, channels: 1 } }).threshold(6).toColourspace("b-w").raw().toBuffer();
  const grown = await sharp(solid, { raw: { width: W, height: H, channels: 1 } }).blur(0.8).toColourspace("b-w").raw().toBuffer();
  if (alpha.length !== width * height || grown.length !== W * H) throw new Error("sticker mask size mismatch");
  const white = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    white[i * 4] = 255;
    white[i * 4 + 1] = 255;
    white[i * 4 + 2] = 255;
    white[i * 4 + 3] = grown[i];
  }
  const subject = await sharp(base.data, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const composed = await sharp(white, { raw: { width: W, height: H, channels: 4 } })
    .composite([{ input: subject }])
    .png()
    .toBuffer();
  const trimmed = await sharp(composed).trim({ threshold: 1 }).png().toBuffer();
  const final = await sharp(trimmed)
    .resize(OUT, OUT, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88, alphaQuality: 90 })
    .toBuffer({ resolveWithObject: true });
  return { data: final.data, width: final.info.width, height: final.info.height };
}
