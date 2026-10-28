import { resolve } from 'path'
import { twemoji } from './vite-twemoji'
import { defineConfig, loadEnv } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * @glofly/shared (types, rules and helpers shared with the server and the mobile app) is read
 * from its TypeScript source and bundled into each part of the app.
 */
const shared = [
  { find: /^@glofly\/shared$/, replacement: resolve('../../packages/shared/src/index.ts') },
  { find: /^@glofly\/shared\/(.*)$/, replacement: resolve('../../packages/shared/src') + '/$1' }
]

/**
 * The page's Content-Security-Policy may show exactly one framed page: the Glofly server's Watch
 * Together player (/watch/player). The server's address comes from MAIN_VITE_SERVER_URL (the
 * same setting the main process uses; localhost when unset).
 */
function serverOrigin(mode: string): string {
  const setting = loadEnv(mode, process.cwd(), 'MAIN_VITE_').MAIN_VITE_SERVER_URL
  try {
    const url = new URL((setting || 'http://localhost:4000').trim())
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin
  } catch {
    // falls through
  }
  return 'http://localhost:4000'
}
const cspServer = (mode: string): Plugin => ({
  name: 'glofly-csp-server',
  transformIndexHtml: (html) => html.replace('%GLOFLY_SERVER_ORIGIN%', serverOrigin(mode))
})

export default defineConfig(({ mode }) => ({
  main: {
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        // The screen-sound capture runs in a process of its own (src/main/screenSound).
        input: {
          index: resolve('src/main/index.ts'),
          screenSound: resolve('src/main/screenSound/worker.ts')
        }
      }
    }
  },
  preload: { resolve: { alias: shared } },
  renderer: {
    resolve: {
      alias: [...shared, { find: '@renderer', replacement: resolve('src/renderer/src') }]
    },
    plugins: [react(), twemoji(), cspServer(mode)],
    build: {
      rollupOptions: {
        // 0.8.6: the launch updater window (src/main/launchUpdate.ts) is a page of its own.
        input: {
          index: resolve('src/renderer/index.html'),
          updater: resolve('src/renderer/updater.html')
        }
      }
    }
  }
}))
