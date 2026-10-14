import { resolve } from 'path'
import { defineConfig } from 'vite'

// The service worker (src/sw.ts): web push notifications with the tab closed. Built on its own
// to a fixed address (/sw.js), since a service worker's address can't change between versions.
export default defineConfig({
  root: __dirname,
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: ['chrome111', 'edge111', 'firefox115', 'safari16.4'],
    lib: {
      entry: resolve(__dirname, 'src/sw.ts'),
      formats: ['es'],
      fileName: () => 'sw.js'
    },
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
})
