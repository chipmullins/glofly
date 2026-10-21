import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

// 0.8.0: the picture a pasted invite link shows (Open Graph, 1200×630): the inviter's photo, or
// their initials, glowing on Glofly's night sky (InvitePage.dc.html, "PASTED INTO A TEXT").
// Only the photo or initials: no name text, so nothing here depends on fonts but the initials,
// which use Outfit Bold from fonts/ (bundled; the server's Docker image has no fonts of its own).

const W = 1200;
const H = 630;
const AVATAR = 300;

/** fonts/Outfit_700Bold.ttf next to src/ or dist/ (null: sharp's default font). */
const FONT_FILE = [join(__dirname, "../../fonts/Outfit_700Bold.ttf"), join(process.cwd(), "fonts/Outfit_700Bold.ttf")].find((f) =>
  existsSync(f),
);

const STARS: [number, number, number, string][] = [
  [12, 18, 2.4, "#f5ede6"],
  [22, 64, 3.4, "#ffb347"],
  [34, 10, 1.8, "#e9d5c4"],
  [8, 82, 2.4, "#f9b26b"],
  [80, 14, 2.4, "#f5ede6"],
  [88, 48, 3.4, "#ffb347"],
  [70, 78, 2.4, "#e9d5c4"],
  [94, 86, 1.8, "#f9b26b"],
  [58, 6, 2.4, "#f5ede6"],
  [46, 92, 3, "#ffb347"],
  [4, 40, 2.4, "#e9d5c4"],
  [66, 30, 1.8, "#f5ede6"],
  [28, 36, 1.6, "#f5ede6"],
  [76, 60, 1.6, "#e9d5c4"],
];

function skySvg(): string {
  const cx = W / 2;
  const cy = H / 2;
  const stars = STARS.map(([x, y, r, c]) => {
    const glow = c === "#ffb347" ? `<circle cx="${(x / 100) * W}" cy="${(y / 100) * H}" r="${r * 4}" fill="#ffa54a" opacity=".22"/>` : "";
    return `${glow}<circle cx="${(x / 100) * W}" cy="${(y / 100) * H}" r="${r}" fill="${c}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs>
<radialGradient id="sky" cx="50%" cy="120%" r="110%"><stop offset="0" stop-color="#4a2a3a"/><stop offset=".45" stop-color="#23152a"/><stop offset="1" stop-color="#120c0a"/></radialGradient>
<radialGradient id="glow"><stop offset="0" stop-color="#ffb347" stop-opacity=".55"/><stop offset=".55" stop-color="#ffa54a" stop-opacity=".18"/><stop offset="1" stop-color="#ffa54a" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
${stars}
<circle cx="${cx}" cy="${cy}" r="${AVATAR * 0.95}" fill="url(#glow)"/>
<circle cx="${cx}" cy="${cy}" r="${AVATAR / 2 + 12}" fill="#ffb347" opacity=".28"/>
<circle cx="${cx}" cy="${cy}" r="${AVATAR / 2}" fill="#e2650f"/>
</svg>`;
}

const circleMask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR}" height="${AVATAR}"><circle cx="${AVATAR / 2}" cy="${AVATAR / 2}" r="${AVATAR / 2}" fill="#fff"/></svg>`,
);

async function roundPhoto(photo: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(photo, { limitInputPixels: 50_000_000 })
      .resize(AVATAR, AVATAR, { fit: "cover" })
      .composite([{ input: circleMask, blend: "dest-in" }])
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

async function initialsImage(initials: string): Promise<Buffer | null> {
  try {
    const safe = initials.replace(/[&<>"']/g, "").slice(0, 4) || "?";
    return await sharp({
      text: {
        text: `<span foreground="#ffffff">${safe}</span>`,
        rgba: true,
        dpi: 300,
        ...(FONT_FILE ? { fontfile: FONT_FILE, font: "Outfit Bold 30" } : { font: "sans bold 30" }),
      },
    })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/** The preview picture as a PNG. */
export async function renderFriendLinkPreview(who: { name: string; initials: string; photo: Buffer | null }): Promise<Buffer> {
  const layers: sharp.OverlayOptions[] = [];
  const face = who.photo ? await roundPhoto(who.photo) : null;
  if (face) layers.push({ input: face, left: (W - AVATAR) / 2, top: (H - AVATAR) / 2 });
  else {
    const text = await initialsImage(who.initials);
    if (text) {
      const meta = await sharp(text).metadata();
      const tw = meta.width ?? 0;
      const th = meta.height ?? 0;
      layers.push({ input: text, left: Math.round((W - tw) / 2), top: Math.round((H - th) / 2) });
    }
  }
  return sharp(Buffer.from(skySvg())).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}
