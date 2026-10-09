// Builds Glofly's app icon files from the designs on the "Glofly app icon options" canvas.
//
//   node tools/icons/make-icons.mjs      (from the repo root; uses sharp, already installed)
//
// Writes:
//   apps/desktop/build/icon.ico    installer, Glofly.exe, shortcuts, taskbar (16–256 px inside)
//   apps/desktop/build/icon.png    512 px (electron-builder's fallback / Linux)
//   apps/desktop/build/icon.icns   Mac (16–1024 px inside)
//   apps/desktop/resources/icon.png  window + tray icon, and the picture on Windows notifications
//   apps/desktop/resources/icon-options/<name>.svg + .png   every design, kept for later
//
// The app icon is ACTIVE (below). To switch to another design, change ACTIVE and run it again.
// The logo inside the app (firefly.png, the wordmark) is separate and not touched.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ACTIVE = 'twilight'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DESKTOP = join(ROOT, 'apps', 'desktop')
const OPTIONS = join(DESKTOP, 'resources', 'icon-options')

// ─── The firefly (same drawing as the takeoff animation), as SVG ───

const WINGS = [
  'M490 490 C420 380 268 222 182 238 C124 250 136 330 200 382 C280 444 400 470 490 490 Z',
  'M490 490 C400 456 262 432 192 456 C142 474 150 536 222 546 C302 556 410 520 490 490 Z',
  'M490 490 C620 500 800 520 860 580 C905 626 870 690 780 680 C680 668 572 560 490 490 Z',
  'M490 490 C500 600 540 705 598 768 C632 804 694 796 676 736 C658 672 566 566 490 490 Z'
]

/** The colourful firefly: gold body, orange wings, glowing chat-bubble tail. */
function firefly({ x = 256, y = 256, scale = 0.5, wing = '#FF8A1F', wingWidth = 30, antenna = '#FFB000' }) {
  return `<g transform="translate(${x} ${y}) scale(${scale}) translate(-525 -545)">
    <path d="M520 352 C524 332 520 316 506 304" fill="none" stroke="${antenna}" stroke-width="22" stroke-linecap="round"/>
    <circle cx="505" cy="301" r="14" fill="${antenna}"/>
    <path d="M596 398 C616 380 640 374 662 382" fill="none" stroke="${antenna}" stroke-width="22" stroke-linecap="round"/>
    <circle cx="664" cy="382" r="14" fill="${antenna}"/>
    <ellipse cx="455" cy="528" rx="78" ry="52" transform="rotate(-38 455 528)" fill="url(#b)"/>
    <circle cx="540" cy="428" r="74" fill="url(#b)"/>
    <g fill="none" stroke="${wing}" stroke-width="${wingWidth}" stroke-linejoin="round">
      ${WINGS.map((d) => `<path d="${d}"/>`).join('')}
    </g>
    <rect x="282" y="588" width="216" height="154" rx="50" fill="url(#u)"/>
    <path d="M322 722 L318 778 Q320 794 336 784 L392 738 Z" fill="#FF7000"/>
  </g>`
}

const BODY = (top = '#FFD24A', bottom = '#FFB000') =>
  `<linearGradient id="b" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`
const BUBBLE = (a = '#FFD21F', b = '#FF9A10', c = '#FF6A00') =>
  `<linearGradient id="u" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`
const BG = (from, to, mid) =>
  `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/>${
    mid ? `<stop offset="0.5" stop-color="${mid}"/>` : ''
  }<stop offset="1" stop-color="${to}"/></linearGradient>`
const GLOW = (color, opacity, edge = '#ff8a1f') =>
  `<radialGradient id="gl" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="0.6" stop-color="${edge}" stop-opacity="0.15"/><stop offset="1" stop-color="${edge}" stop-opacity="0"/></radialGradient>`
const TILE = (fill = 'url(#bg)', extra = '') => `<rect x="16" y="16" width="480" height="480" rx="112" fill="${fill}" ${extra}/>`

const svg = (size, defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><defs>${defs}</defs>${body}</svg>`

/**
 * Each design draws itself at a pixel size. Small sizes (taskbar, title bar, tray) leave out
 * the stars and use thicker wings, so the firefly still reads at 16–32 px.
 */
const DESIGNS = {
  // 6 · Twilight (the app icon from Oct 9): deep violet night, gold firefly, glow trail.
  twilight(size) {
    const small = size <= 40
    const medium = size <= 64
    const stars = medium
      ? ''
      : `<circle cx="108" cy="112" r="4.5" fill="#fff" opacity="0.6"/>
         <circle cx="398" cy="98" r="3.5" fill="#fff" opacity="0.5"/>
         <circle cx="430" cy="300" r="3" fill="#fff" opacity="0.45"/>`
    const trail = small
      ? ''
      : `<circle cx="92" cy="408" r="6" fill="#ffc24a" opacity="0.7"/>
         <circle cx="122" cy="376" r="4.5" fill="#ffc24a" opacity="0.55"/>
         ${medium ? '' : '<circle cx="148" cy="352" r="3" fill="#ffc24a" opacity="0.45"/>'}`
    return svg(
      size,
      BG('#3d2775', '#140c2c') + GLOW('#ffc24a', small ? 0.66 : 0.58) + BODY() + BUBBLE(),
      TILE() +
        `<circle cx="262" cy="250" r="196" fill="url(#gl)"/>` +
        stars +
        trail +
        firefly(small
          ? { x: 258, y: 254, scale: 0.53, wing: '#FFA030', wingWidth: 40 }
          : { x: 262, y: 252, scale: 0.48, wing: '#FFA030', wingWidth: 30 })
    )
  },

  // 1 · Night Glow: the login screen's night sky.
  'night-glow'(size) {
    const small = size <= 40
    const stars = size <= 64
      ? ''
      : `<circle cx="112" cy="118" r="5" fill="#ffd27a" opacity="0.7"/>
         <circle cx="404" cy="104" r="4" fill="#ffd27a" opacity="0.55"/>
         <circle cx="420" cy="412" r="4.5" fill="#ffd27a" opacity="0.5"/>`
    return svg(
      size,
      BG('#2e1c14', '#110a08') + GLOW('#ffb21a', 0.62) + BODY() + BUBBLE(),
      TILE() + `<circle cx="262" cy="250" r="200" fill="url(#gl)"/>` + stars +
        firefly({ scale: small ? 0.53 : 0.5, wingWidth: small ? 40 : 30 })
    )
  },

  // 2 · Red Solid: flat Glofly Red, one-colour cream firefly.
  'red-solid'(size) {
    const small = size <= 40
    const c = '#fff4e6'
    const red = '#e0193a'
    return svg(
      size,
      '',
      TILE(red) +
        `<g transform="translate(256 256) scale(${small ? 0.55 : 0.52}) translate(-525 -545)">
          <g fill="none" stroke="${c}" stroke-width="${small ? 40 : 32}" stroke-linejoin="round">${WINGS.map((d) => `<path d="${d}"/>`).join('')}</g>
          <path d="M520 352 C524 332 520 316 506 304" fill="none" stroke="${c}" stroke-width="22" stroke-linecap="round"/>
          <circle cx="505" cy="301" r="15" fill="${c}"/>
          <path d="M596 398 C616 380 640 374 662 382" fill="none" stroke="${c}" stroke-width="22" stroke-linecap="round"/>
          <circle cx="664" cy="382" r="15" fill="${c}"/>
          <ellipse cx="455" cy="528" rx="80" ry="54" transform="rotate(-38 455 528)" fill="${c}" stroke="${red}" stroke-width="16"/>
          <circle cx="540" cy="428" r="76" fill="${c}" stroke="${red}" stroke-width="16"/>
          <rect x="278" y="584" width="224" height="162" rx="54" fill="${c}" stroke="${red}" stroke-width="16"/>
          <path d="M322 722 L318 784 Q320 800 336 790 L398 738 Z" fill="${c}"/>
        </g>`
    )
  },

  // 4 · Red Dusk: Glofly Red deepening into plum, gold glow.
  'red-dusk'(size) {
    const small = size <= 40
    return svg(
      size,
      BG('#f0294a', '#4a0b2a', '#a30f33') + GLOW('#ffc24a', 0.6) + BODY() + BUBBLE(),
      TILE() + `<circle cx="262" cy="250" r="190" fill="url(#gl)"/>` +
        firefly({ scale: small ? 0.53 : 0.5, wing: '#FFA030', wingWidth: small ? 40 : 30 })
    )
  },

  // 7 · Daylight: light cream tile, deeper oranges.
  daylight(size) {
    const small = size <= 40
    return svg(
      size,
      BG('#fffaf2', '#f4e2cc') +
        `<radialGradient id="gl" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffc24a" stop-opacity="0.5"/><stop offset="0.65" stop-color="#ffb21a" stop-opacity="0.1"/><stop offset="1" stop-color="#ffb21a" stop-opacity="0"/></radialGradient>` +
        BODY('#FFBE1A', '#F29A00') + BUBBLE('#FFC21F', '#FF8A10', '#F25A00'),
      `<rect x="18" y="18" width="476" height="476" rx="110" fill="url(#bg)" stroke="#e6d3bf" stroke-width="4"/>` +
        `<circle cx="262" cy="250" r="190" fill="url(#gl)"/>` +
        firefly({ scale: small ? 0.53 : 0.5, wing: '#F2601A', wingWidth: small ? 40 : 30, antenna: '#F29A00' })
    )
  }
}

// ─── Rendering and file formats ───

const png = (name, size) => sharp(Buffer.from(DESIGNS[name](size))).png({ compressionLevel: 9 }).toBuffer()

/** Windows .ico holding one PNG per size (Windows picks the closest for each place). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // icon
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, at) // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt8(0, at + 2) // no palette
    header.writeUInt8(0, at + 3)
    header.writeUInt16LE(1, at + 4) // colour planes
    header.writeUInt16LE(32, at + 6) // bits per pixel
    header.writeUInt32LE(data.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...images.map((i) => i.data)])
}

/** Mac .icns holding PNGs. */
function icns(images) {
  const TYPES = { 16: 'icp4', 32: 'icp5', 64: 'icp6', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' }
  const chunks = images.map(({ size, data }) => {
    const head = Buffer.alloc(8)
    head.write(TYPES[size], 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
  console.log(`  ${path.slice(ROOT.length + 1)}  (${Math.round(data.length / 1024)} KB)`)
}

console.log(`App icon: ${ACTIVE}`)
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]
write(join(DESKTOP, 'build', 'icon.ico'), ico(await Promise.all(ICO_SIZES.map(async (size) => ({ size, data: await png(ACTIVE, size) })))))
write(join(DESKTOP, 'build', 'icon.icns'), icns(await Promise.all(ICNS_SIZES.map(async (size) => ({ size, data: await png(ACTIVE, size) })))))
write(join(DESKTOP, 'build', 'icon.png'), await png(ACTIVE, 512))
write(join(DESKTOP, 'resources', 'icon.png'), await png(ACTIVE, 512))

console.log('Saved designs:')
for (const name of Object.keys(DESIGNS)) {
  write(join(OPTIONS, `${name}.svg`), Buffer.from(DESIGNS[name](512)))
  write(join(OPTIONS, `${name}.png`), await png(name, 512))
}
