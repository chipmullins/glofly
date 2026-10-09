// After a Windows build: copies dist/Glofly-<version>-setup.exe to dist/Glofly-Setup.exe,
// the always-the-newest name the website's Download button points at.
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const dist = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const source = join(dist, `Glofly-${version}-setup.exe`)
if (!existsSync(source)) {
  console.error(`Couldn't find ${source}. Run the Windows build first.`)
  process.exit(1)
}
copyFileSync(source, join(dist, 'Glofly-Setup.exe'))
console.log(`Ready to upload from apps\\desktop\\dist:
  Glofly-${version}-setup.exe
  Glofly-${version}-setup.exe.blockmap
  latest.yml
  Glofly-Setup.exe   (for the website's Download button)`)
