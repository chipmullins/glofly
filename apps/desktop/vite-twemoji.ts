import { createReadStream, existsSync, readdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Plugin } from 'vite'

// Shared by the desktop app (electron.vite.config.ts) and Glofly in a browser (apps/web).

/** Finds an installed package's folder (npm workspaces put it in the repo's root node_modules). */
function packageDir(name: string): string {
  let dir = process.cwd()
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`Couldn't find the ${name} package. Run npm install.`)
    dir = parent
  }
}

/**
 * Twemoji pictures for emoji, served from this computer (never a CDN), so they work offline
 * and the Content Security Policy stays 'self' only.
 *
 * `import { names, base } from 'virtual:twemoji'` gives the list of pictures that exist and
 * where they live. While developing they're served at /twemoji/<name>.svg; a build copies
 * them to out/renderer/twemoji/.
 */
export function twemoji(): Plugin {
  const dir = packageDir('@twemoji/svg')
  const files = readdirSync(dir).filter((f) => /^[0-9a-f-]+\.svg$/.test(f))
  const fileSet = new Set(files)
  let building = false
  return {
    name: 'glofly-twemoji',
    configResolved(config) {
      building = config.command === 'build'
    },
    resolveId(id) {
      return id === 'virtual:twemoji' ? '\0virtual:twemoji' : null
    },
    load(id) {
      if (id !== '\0virtual:twemoji') return null
      const names = files.map((f) => f.slice(0, -4))
      return `export const names = ${JSON.stringify(names)}\nexport const base = ${JSON.stringify(
        building ? './twemoji/' : '/twemoji/'
      )}\n`
    },
    configureServer(server) {
      server.middlewares.use('/twemoji/', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!fileSet.has(name)) return next()
        res.setHeader('Content-Type', 'image/svg+xml')
        res.setHeader('Cache-Control', 'max-age=31536000, immutable')
        createReadStream(join(dir, name)).pipe(res)
      })
    },
    generateBundle() {
      if (!building) return
      for (const f of files) {
        this.emitFile({
          type: 'asset',
          fileName: `twemoji/${f}`,
          source: readFileSync(join(dir, f))
        })
      }
    }
  }
}
