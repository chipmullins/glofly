import sharp from "sharp";

// Square photos: profile photos and group photos (0.2.1).

export const PHOTO_UPLOAD_MAX = "8mb";
export const PHOTO_SIZE = 512; // stored as a 512×512 square

/**
 * Reads an upload as an image, whatever it claims to be (anything that isn't a real image
 * fails), then turns it the right way up, crops it to a square and re-saves it as WebP.
 * Re-saving drops hidden photo data (like the GPS location phones add). Huge dimensions are
 * refused so nobody can overload the server. Null if it isn't a photo Glofly can use.
 */
export async function squarePhoto(input: Buffer): Promise<Buffer | null> {
  try {
    const image = sharp(input, { limitInputPixels: 50_000_000 });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp", "gif", "heif", "avif"].includes(meta.format ?? "")) return null;
    return await image.rotate().resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
}

/** Where a group's photo is kept. The version changes with every new photo. */
export const groupPhotoKey = (conversationId: string, version: string) =>
  `group-photos/${conversationId}/${version}.webp`;
