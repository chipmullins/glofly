# Glofly app icon

The icon on the installer, Glofly.exe, shortcuts, taskbar, title bar, tray and Windows
notifications. (The logo *inside* the app, `firefly.png` and the wordmark, is separate.)

Designs come from the "Glofly app icon options" canvas (Oct 9). Chip picked **6 · Twilight**.

```
node tools/icons/make-icons.mjs      (from the repo root)
```

writes `apps/desktop/build/icon.ico` (16–256 px), `icon.icns` (16–1024 px), `icon.png`, and
`apps/desktop/resources/icon.png` (window, tray, notifications) for the design named in `ACTIVE`,
plus every design as `.svg` + 512 px `.png` in `apps/desktop/resources/icon-options/`.
Sizes up to 40 px leave out the stars and use thicker wings so the firefly still reads.

| Saved design | File |
|---|---|
| 6 · Twilight (in use) | twilight |
| 1 · Night Glow | night-glow |
| 2 · Red Solid | red-solid |
| 4 · Red Dusk | red-dusk |
| 7 · Daylight | daylight |
| The original Glofly Red icon (Oct 7–9) | glofly-red.png (picture only) |

To switch: set `ACTIVE` to another name, run the script, rebuild (`npm run build:win`, or
`npm run release`). `resources/icon-options/` is left out of the installer (electron-builder.yml).
