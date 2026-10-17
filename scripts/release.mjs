// One-command release:   npm run release            (0.1.4 → 0.1.5)
//                        npm run release -- minor   (0.1.4 → 0.2.0)
//                        npm run release -- 0.3.0   (exactly that)
//
// Run from the repo root on Chip's PC, on the dev branch with everything committed.
// It: checks everything is ready → bumps the version → commits, pushes dev, moves main to
// it and tags it → if server code changed, stops so the server is updated first → builds
// the Windows installer (retrying the known "spawn UNKNOWN" hiccup) → uploads the files
// to the glofly-updates bucket in a safe order (latest.yml last) → checks it's live.
//
// Uploads use the AWS profile "glofly-release" (an upload-only key; see glofly-going-live.md).

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DESKTOP,
  ask,
  build,
  checkAws,
  doneAsking,
  desktopVersion,
  setDesktopVersion,
  fail,
  green,
  ok,
  out,
  run,
  step,
  upload,
  yellow
} from './release-lib.mjs'

// ---------------------------------------------------------------- 1. Ready?
step('Checking everything is ready')

const bump = process.argv[2] ?? 'patch'
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump)) {
  fail(`"${bump}" isn't a version. Use patch, minor, major, or a number like 0.3.0.`)
}
if (out('git rev-parse --abbrev-ref HEAD') !== 'dev') {
  fail('Switch to the dev branch first:  git switch dev')
}
if (out('git status --porcelain')) {
  fail('You have changes that aren\'t committed. Commit (or undo) them first, then run this again.')
}
// Installer builds use production mode, where .env.production.local is the file that wins over
// .env.production (.env.local does not). Either one here means a test build, not a release.
for (const name of ['.env.production.local', '.env.local']) {
  if (existsSync(join(DESKTOP, name))) {
    fail(
      `apps\\desktop\\${name} exists, so the installer might not point at api.glofly.app.\n` +
        '  Delete it (it\'s only for testing against your PC), then run this again.'
    )
  }
}
checkAws()

run('git fetch origin dev main --quiet')
if (!ok('git merge-base --is-ancestor origin/dev HEAD')) {
  fail('GitHub has newer commits on dev. Get them first:  git pull')
}
if (!ok('git merge-base --is-ancestor origin/main HEAD')) {
  fail('main has commits that dev doesn\'t. Ask Claude to sort out the branches before releasing.')
}

// Anything the live server runs (server code, deploy files, the website) changed since the last release?
const serverChanged = !ok('git diff --quiet origin/main HEAD -- apps/server packages/shared deploy')
const siteChanged = !ok('git diff --quiet origin/main HEAD -- site')
// Glofly in a browser (chat.glofly.app) is built on the server from these.
const webChanged = !ok(
  'git diff --quiet origin/main HEAD -- apps/web apps/desktop/src/renderer apps/desktop/src/preload apps/desktop/vite-twemoji.ts'
)

const from = desktopVersion()
const version = setDesktopVersion(bump)
console.log(green(`  Version ${from} → ${version}`))
console.log(
  `  Server code changed since the last release: ${serverChanged ? yellow('yes') : 'no'}` +
    (siteChanged ? `\n  Website changed: ${yellow('yes')}` : '') +
    (webChanged ? `\n  Glofly in a browser changed: ${yellow('yes')}` : '')
)
const go = await ask(`\n  Release Glofly ${version}? (y/n) `)
if (go !== 'y' && go !== 'yes') {
  run('git checkout -- apps/desktop/package.json package-lock.json')
  doneAsking()
  fail('Stopped. Nothing was changed.')
}

// ---------------------------------------------------------------- 2. Commit, main, tag
step(`Committing version ${version} and moving main to it`)
run('git add apps/desktop/package.json package-lock.json')
run(`git commit --quiet -m "Version ${version}"`)
run('git push --quiet origin dev')
run('git push --quiet origin HEAD:main')
run(`git tag -a v${version} -m "Glofly ${version}"`)
run(`git push --quiet origin v${version}`)
console.log(green(`  main is now ${version} (tag v${version})`))

// ---------------------------------------------------------------- 3. Server first
if (serverChanged || siteChanged || webChanged) {
  // The server and the browser version are both rebuilt by `docker compose up -d --build`.
  const rebuild = serverChanged || webChanged
  step(serverChanged ? 'Update the server first' : webChanged ? 'Update the server (browser version)' : 'Update the website')
  console.log(`  In the AWS browser terminal (EC2 → glofly-server → Connect → Session Manager):

    sudo -iu ubuntu
    cd ~/glofly/deploy && git pull
${rebuild ? '    docker compose up -d --build\n    docker compose logs --tail 10 server\n' : ''}
  ${serverChanged ? 'Check https://api.glofly.app/health says "connected".' : webChanged ? 'Reload https://chat.glofly.app to see the change.' : 'Refresh https://glofly.app to see the change.'}`)
  await ask('\n  Press Enter once that\'s done (the app upload comes next) ')
}

// ---------------------------------------------------------------- 4. Build + upload
doneAsking()
if (!build()) {
  fail(
    'The build failed 3 times. If it says "spawn UNKNOWN": Windows Security → Protection history →\n' +
      '  Allow the blocked item, then run:  npm run release:upload\n' +
      '  (the version is already committed; this just builds and uploads it).'
  )
}
await upload(version)
