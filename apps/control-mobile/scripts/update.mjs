// Sends an over-the-air update (JavaScript only) to installed copies of Glofly Control for iPhone:
//   npm run update:preview -- --message "Fix the search button"      (preview builds)
//   npm run update:production -- --message "..."                     (TestFlight builds)
//
// Why a script instead of plain `eas update`: the update must be made exactly like the builds were.
// - APP_VARIANT decides the app's config (a "development" config would be wrong on testers' phones).
// - EXPO_PUBLIC_SERVER_URL is baked into the JavaScript. apps/control-mobile/.env.local on the PC points at
//   the local test server, so without this the phone would start talking to the PC. Forced to the
//   live server here, and .env files are ignored.
// Works the same in PowerShell, cmd and Git Bash.
import { spawnSync } from 'node:child_process'

const channel = process.argv[2]
if (channel !== 'preview' && channel !== 'production') {
  console.error('Usage: node scripts/update.mjs preview|production [--message "..."]')
  process.exit(1)
}
const rest = process.argv.slice(3)
const env = {
  ...process.env,
  APP_VARIANT: channel,
  EXPO_PUBLIC_SERVER_URL: 'https://api.glofly.app',
  EXPO_NO_DOTENV: '1',
}
const args = ['eas', 'update', '--channel', channel, '--environment', channel, ...rest]
if (!rest.includes('--message') && !rest.includes('-m')) args.push('--message', `Update ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`)
// Windows runs npx through cmd (shell: true), which splits on spaces: anything with a space
// (the message) has to be quoted, or eas sees "Update", "2026-10-14" and "05:28" as three things.
const win = process.platform === 'win32'
const quoted = win ? args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)) : args
console.log(`> npx ${quoted.join(' ')}`)
const r = spawnSync('npx', quoted, { stdio: 'inherit', env, shell: win })
process.exit(r.status ?? 1)
