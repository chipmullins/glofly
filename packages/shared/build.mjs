// Builds dist/ for the server (CommonJS + type declarations). The apps read src/ directly
// (Vite and Metro compile it), so only the server needs this.
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
rmSync(join(here, 'dist'), { recursive: true, force: true })

const esbuild = require('esbuild')
esbuild.buildSync({
  entryPoints: [join(here, 'src/index.ts')],
  outfile: join(here, 'dist/index.js'),
  bundle: true,
  platform: 'neutral',
  format: 'cjs',
  target: 'es2022',
  logLevel: 'warning'
})

const tsc = require.resolve('typescript/bin/tsc')
execFileSync(process.execPath, [tsc, '-p', join(here, 'tsconfig.json')], { stdio: 'inherit' })
