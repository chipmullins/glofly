// Shared by release.mjs and release-upload.mjs: paths, small helpers, and the S3 upload.

import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const DESKTOP = join(ROOT, 'apps', 'desktop')
export const DIST = join(DESKTOP, 'dist')
export const BUCKET = 'glofly-updates'
export const PROFILE = 'glofly-release'
// RELEASE_UPDATES_URL is only for testing this script without the real bucket.
export const UPDATES_URL = process.env.RELEASE_UPDATES_URL ?? `https://${BUCKET}.s3.us-east-2.amazonaws.com`

export const bold = (s) => `\x1b[1m${s}\x1b[0m`
export const green = (s) => `\x1b[32m${s}\x1b[0m`
export const red = (s) => `\x1b[31m${s}\x1b[0m`
export const yellow = (s) => `\x1b[33m${s}\x1b[0m`

export function step(text) {
  console.log(`\n${bold('▸ ' + text)}`)
}
export function fail(text) {
  console.error(`\n${red('✖ ' + text)}\n`)
  process.exit(1)
}
/** Runs a command, showing its output. */
export function run(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
}
/** Runs a command quietly and returns what it printed (trimmed). */
export function out(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
}
export function ok(cmd) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
export const desktopVersion = () =>
  JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).version

// One prompt reader for the whole run (closing it would close the terminal's input for later questions).
let prompts = null
export async function ask(question) {
  prompts ??= createInterface({ input: process.stdin, output: process.stdout })
  const answer = await prompts.question(question)
  return answer.trim().toLowerCase()
}
/** Lets the script end once it's done asking. */
export function doneAsking() {
  prompts?.close()
  prompts = null
}

/** Checks the AWS tool and the upload key are set up. */
export function checkAws() {
  if (!ok('aws --version')) {
    fail("The AWS command-line tool isn't installed (or this terminal was open before installing it).")
  }
  if (!ok(`aws sts get-caller-identity --profile ${PROFILE}`)) {
    fail(`The "${PROFILE}" AWS key isn't set up. Run:  aws configure --profile ${PROFILE}`)
  }
}

/** Builds the installer, retrying the known "spawn UNKNOWN" hiccup. Returns false if it never worked. */
export function build() {
  step('Building the Windows installer')
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) console.log(yellow(`  Trying again (attempt ${attempt} of 3)…`))
      run('npm run build:win -w apps/desktop')
      return true
    } catch {
      // Usually "spawn UNKNOWN": Windows briefly blocking an unsigned helper. Retrying fixes it.
    }
  }
  return false
}

/** Uploads the built installer (latest.yml last) and checks it's live. */
export async function upload(v) {
  const setup = `Glofly-${v}-setup.exe`
  for (const f of [setup, `${setup}.blockmap`, 'latest.yml']) {
    if (!existsSync(join(DIST, f))) fail(`Couldn't find apps\\desktop\\dist\\${f}`)
  }
  copyFileSync(join(DIST, setup), join(DIST, 'Glofly-Setup.exe'))

  step(`Uploading Glofly ${v} to ${BUCKET}`)
  const cp = (file, extra = '') =>
    run(`aws s3 cp "${join(DIST, file)}" s3://${BUCKET}/${file} --profile ${PROFILE} --only-show-errors ${extra}`)
  // The installer first, latest.yml last: nobody hears "new version" before the file exists.
  cp(setup, '--content-type application/octet-stream')
  cp(`${setup}.blockmap`, '--content-type application/octet-stream')
  cp('Glofly-Setup.exe', '--content-type application/octet-stream --cache-control no-cache')
  cp('latest.yml', '--content-type text/yaml --cache-control no-cache')

  step('Checking it’s live')
  const res = await fetch(`${UPDATES_URL}/latest.yml?t=${Date.now()}`)
  const text = res.ok ? await res.text() : ''
  if (!text.includes(`version: ${v}`)) fail('latest.yml online doesn\'t show the new version yet. Check the bucket.')
  console.log(green(`\n✔ Glofly ${v} is out.`))
  console.log(`  Installed copies get the "Restart to update" bar within ~4 hours (30s after opening Glofly).
  New downloads: https://glofly.app/download\n`)
}
