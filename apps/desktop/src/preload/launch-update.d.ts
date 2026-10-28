/**
 * 0.8.6: what the launch updater window shows (main process src/main/launchUpdate.ts →
 * page src/renderer/src/updater/updater.ts). Kept here because both TypeScript projects read
 * this folder's .d.ts files.
 */
export type LaunchUpdateView =
  | { phase: 'checking' }
  | { phase: 'downloading'; version: string; percent: number; transferred: number; total: number }
  | { phase: 'installing'; version: string }
  | { phase: 'done'; version: string }
  | { phase: 'offline' }
