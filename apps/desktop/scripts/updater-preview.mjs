// npm run updater-preview (in apps/desktop): starts the development app with the 0.8.6 launch
// updater window showing every frame (Checking → Updating → All set → Couldn't check) with a
// pretend download, then Glofly opens as usual. Works the same on Windows and on a Mac.
import { spawn } from 'node:child_process'

const child = spawn('npx', ['electron-vite', 'dev'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, GLOFLY_UPDATER_PREVIEW: '1' }
})
child.on('exit', (code) => process.exit(code ?? 0))
