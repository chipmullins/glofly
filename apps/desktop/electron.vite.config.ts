import { resolve } from 'path'
import { twemoji } from './vite-twemoji'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * @glofly/shared (types, rules and helpers shared with the server and the mobile app) is read
 * from its TypeScript source and bundled into each part of the app.
 */
const shared = [
  { find: /^@glofly\/shared$/, replacement: resolve('../../packages/shared/src/index.ts') },
  { find: /^@glofly\/shared\/(.*)$/, replacement: resolve('../../packages/shared/src') + '/$1' }
]

export default defineConfig({
  main: { resolve: { alias: shared } },
  preload: { resolve: { alias: shared } },
  renderer: {
    resolve: {
      alias: [...shared, { find: '@renderer', replacement: resolve('src/renderer/src') }]
    },
    plugins: [react(), twemoji()]
  }
})
