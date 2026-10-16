import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { twemoji } from '../desktop/vite-twemoji'

// Glofly in a browser (chat.glofly.app). It's the desktop app's screens (apps/desktop/src/renderer)
// built a second time as a plain website, with src/bridge standing in for the Electron side.
//
// GLOFLY_API_URL: the Glofly server (https://api.glofly.app when deployed; deploy/web.Dockerfile
// sets it). The page only ever talks to that server and LiveKit Cloud (calls).

const API_URL = originOf(process.env.GLOFLY_API_URL || 'http://localhost:4000')
const VERSION = (
  JSON.parse(readFileSync(resolve(__dirname, '../desktop/package.json'), 'utf8')) as {
    version: string
  }
).version
// Each build is told apart from the last, so an open tab notices a newer one ("Reload").
const BUILD = `${VERSION}-${Date.now().toString(36)}`

function originOf(url: string): string {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('GLOFLY_API_URL')
  return parsed.origin
}

const wsOrigin = API_URL.replace(/^http/, 'ws')

// The page's Content-Security-Policy (Caddy sends the same one as a header on the live site):
// scripts only from this site, network only to the Glofly server and LiveKit, no frames but the
// server's Watch Together player, no plugins, no <base>, no forms posting anywhere.
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // i.ytimg.com: the YouTube video's picture in the Watch together dialog (0.5.0)
  `img-src 'self' data: blob: ${API_URL} https://i.ytimg.com`,
  "font-src 'self'",
  `media-src 'self' blob: mediastream: ${API_URL}`,
  `connect-src 'self' ${API_URL} ${wsOrigin} wss://*.livekit.cloud https://*.livekit.cloud`,
  "worker-src 'self'",
  "manifest-src 'self'",
  // Only the Glofly server's Watch Together player page (0.5.0)
  `frame-src ${API_URL}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

/** The CSP as a <meta> too (it also covers `vite preview` and testing), and version.json. */
function gloflyPage(): Plugin {
  return {
    name: 'glofly-web-page',
    transformIndexHtml(html, ctx) {
      // `npm run dev` needs inline scripts for hot reload, so the CSP only goes on real builds.
      if (ctx.server) return html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
      // frame-ancestors only works as a header; the meta copy leaves it out (browsers warn otherwise).
      const meta = CSP.split('; ')
        .filter((d) => !d.startsWith('frame-ancestors'))
        .join('; ')
      return html.replace('%GLOFLY_CSP%', meta)
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: VERSION, build: BUILD })
      })
    }
  }
}

const shared = [
  {
    find: /^@glofly\/shared$/,
    replacement: resolve(__dirname, '../../packages/shared/src/index.ts')
  },
  {
    find: /^@glofly\/shared\/(.*)$/,
    replacement: resolve(__dirname, '../../packages/shared/src') + '/$1'
  }
]

export default defineConfig({
  root: __dirname,
  define: {
    __GLOFLY_API_URL__: JSON.stringify(API_URL),
    __GLOFLY_VERSION__: JSON.stringify(VERSION),
    __GLOFLY_BUILD__: JSON.stringify(BUILD)
  },
  resolve: {
    alias: [
      ...shared,
      { find: '@renderer', replacement: resolve(__dirname, '../desktop/src/renderer/src') }
    ]
  },
  plugins: [react(), twemoji(), gloflyPage()],
  server: { port: 5180, fs: { allow: [resolve(__dirname, '../..')] } },
  preview: { port: 5180 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: ['chrome111', 'edge111', 'firefox115', 'safari16.4'],
    chunkSizeWarningLimit: 2000
  }
})
