// Builds the Mac menu-bar icon: the firefly as a black silhouette.
//
//   node tools/icons/make-menubar-icon.mjs      (from the repo root; uses sharp)
//
// Writes apps/desktop/resources/trayTemplate.png (18 px) and trayTemplate@2x.png (36 px).
// "Template" in the name tells macOS to recolor it to match the menu bar (black in light mode,
// white in dark mode, highlighted when clicked), so only the shape and transparency matter.
// Same firefly drawing as make-icons.mjs, with thicker wings so it reads at 18 px.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'apps', 'desktop', 'resources')

const WINGS = [
  'M490 490 C420 380 268 222 182 238 C124 250 136 330 200 382 C280 444 400 470 490 490 Z',
  'M490 490 C400 456 262 432 192 456 C142 474 150 536 222 546 C302 556 410 520 490 490 Z',
  'M490 490 C620 500 800 520 860 580 C905 626 870 690 780 680 C680 668 572 560 490 490 Z',
  'M490 490 C500 600 540 705 598 768 C632 804 694 796 676 736 C658 672 566 566 490 490 Z'
]

// The drawing spans roughly x 120–905, y 238–800; centered and fit into a 512 square.
const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <g transform="translate(256 256) scale(0.62) translate(-512 -519)" fill="#000" stroke="#000">
    <path d="M520 352 C524 332 520 316 506 304" fill="none" stroke-width="34" stroke-linecap="round"/>
    <circle cx="505" cy="301" r="22" stroke="none"/>
    <path d="M596 398 C616 380 640 374 662 382" fill="none" stroke-width="34" stroke-linecap="round"/>
    <circle cx="664" cy="382" r="22" stroke="none"/>
    <ellipse cx="455" cy="528" rx="84" ry="58" transform="rotate(-38 455 528)" stroke="none"/>
    <circle cx="540" cy="428" r="80" stroke="none"/>
    <g fill="none" stroke-width="56" stroke-linejoin="round">
      ${WINGS.map((d) => `<path d="${d}"/>`).join('')}
    </g>
    <rect x="282" y="588" width="216" height="154" rx="50" stroke="none"/>
    <path d="M322 722 L318 778 Q320 794 336 784 L392 738 Z" stroke="none"/>
  </g>
</svg>`

for (const [name, size] of [
  ['trayTemplate.png', 18],
  ['trayTemplate@2x.png', 36]
]) {
  const png = await sharp(Buffer.from(svg(size * 8)))
    .resize(size, size)
    .png()
    .toBuffer()
  writeFileSync(join(OUT, name), png)
  console.log(`wrote ${name} (${size} px)`)
}
