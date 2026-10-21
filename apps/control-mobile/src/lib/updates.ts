import { AppState } from 'react-native'
import * as Updates from 'expo-updates'

// Over-the-air updates, like the Glofly phone app (apps/mobile/src/lib/updates.ts): checked at
// launch by expo-updates itself, again when you come back (at most every 10 minutes); a downloaded
// update is switched to the next time you leave the app (which signs you out after 5 minutes anyway).

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
    if (found.isAvailable) ready = (await Updates.fetchUpdateAsync()).isNew
  } catch {
    // Offline, or the update server is unreachable: try again later.
  } finally {
    checking = false
  }
}

let started = false
export function startUpdates() {
  if (started || __DEV__ || !Updates.isEnabled) return
  started = true
  AppState.addEventListener('change', (s) => {
    if (s === 'active') void check()
    else if (s === 'background' && ready) void Updates.reloadAsync().catch(() => {})
  })
  setTimeout(() => void check(), 30_000)
}
