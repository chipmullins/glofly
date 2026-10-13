// After npm install: prepares the desktop app's native parts for Electron
// (electron-builder install-app-deps; Push to talk's keyboard hook).
//
// Skipped on Expo's build machines (EAS sets EAS_BUILD): they install the whole project to build
// the phone app, which never uses the desktop app, and their Linux machines can't compile the
// keyboard hook (missing X11 headers), so the phone build failed there.
import { spawnSync } from 'node:child_process'

if (process.env.EAS_BUILD) {
  console.log('Phone app build (EAS): skipping the desktop app’s native setup.')
  process.exit(0)
}

const result = spawnSync('electron-builder install-app-deps', { stdio: 'inherit', shell: true })
process.exit(result.status ?? 1)
