import { AppState, Platform } from 'react-native'
import * as Updates from 'expo-updates'
import { useCall } from '@/calls/controller'

// Over-the-air updates (Oct 13). The app checks at launch by itself (app.config.ts → updates); this
// also checks when you come back to Glofly (at most every 10 minutes) and, once an update has
// downloaded, switches to it the next time you leave the app — never during a call. So a fix sent
// with `npm run update:preview` lands within minutes, without anyone noticing a restart.

const EVERY_MS = 10 * 60 * 1000
let lastCheck = 0
let ready = false
let checking = false

async function check() {
  if (checking || ready || Date.now() - lastCheck < EVERY_MS) return
  checking = true
  lastCheck = Date.now()
  try {
    const found = await Updates.checkForUpdateAsync()
    if (found.isAvailable) {
      const got = await Updates.fetchUpdateAsync()
      ready = got.isNew
    }
  } catch {
    // Offline, or the update server is unreachable: try again later.
  } finally {
    checking = false
  }
}

async function applyIfReady() {
  if (!ready) return
  const call = useCall.getState()
  if (call.call || call.connecting || call.incoming) return
  try {
    await Updates.reloadAsync()
  } catch {
    // Applied at the next launch instead.
  }
}

let started = false
export function startUpdates() {
  if (started || Platform.OS === 'web' || __DEV__ || !Updates.isEnabled) return
  started = true
  AppState.addEventListener('change', (s) => {
    if (s === 'active') void check()
    else if (s === 'background') void applyIfReady()
  })
  setTimeout(() => void check(), 30_000)
}
