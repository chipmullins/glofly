import { AppState, Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

// Small key/value storage. Secrets (the session token) go into Android's Keystore through
// SecureStore; the web preview falls back to localStorage, which is only used for testing.

const web = Platform.OS === 'web'

// iPhone: readable once the phone has been unlocked since it started (SecureStore's default is
// "only while unlocked"), so Glofly started in the background (a call or push on the lock screen)
// can still read the sign-in instead of waiting until the phone is unlocked and Glofly opened.
const WRITE_OPTIONS: SecureStore.SecureStoreOptions | undefined =
  Platform.OS === 'ios' ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } : undefined

/** Resolves the next time Glofly comes on screen (straight away if it's on screen now). */
function whenActive(): Promise<void> {
  if (AppState.currentState === 'active') return new Promise((r) => setTimeout(r, 500))
  return new Promise((resolve) => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      sub.remove()
      resolve()
    })
  })
}

function webGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}
function webSet(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key)
    else globalThis.localStorage?.setItem(key, value)
  } catch {
    /* storage unavailable: fine */
  }
}

export const secure = {
  async get(key: string): Promise<string | null> {
    if (web) return webGet(key)
    try {
      return await SecureStore.getItemAsync(key)
    } catch {
      return null
    }
  },
  /**
   * Like get, but says when the Keychain/Keystore couldn't be read at all (an iPhone can start
   * Glofly in the background before it's unlocked), so a saved sign-in isn't mistaken for none.
   */
  async read(key: string): Promise<{ value: string | null; failed: boolean }> {
    if (web) return { value: webGet(key), failed: false }
    try {
      return { value: await SecureStore.getItemAsync(key), failed: false }
    } catch {
      return { value: null, failed: true }
    }
  },
  async set(key: string, value: string | null): Promise<void> {
    if (web) return webSet(key, value)
    try {
      if (value === null) await SecureStore.deleteItemAsync(key)
      else await SecureStore.setItemAsync(key, value, WRITE_OPTIONS)
    } catch {
      /* Keystore unavailable: the user signs in again next time */
    }
  },
  /**
   * iPhone: saves an item again so it's readable after first unlock (items saved before Oct 17
   * kept "only while unlocked": updating one in place doesn't change that, so it's deleted and
   * added again). Only call it with a value just read successfully.
   */
  async upgrade(key: string, value: string): Promise<void> {
    if (Platform.OS !== 'ios') return
    try {
      await SecureStore.deleteItemAsync(key)
      await SecureStore.setItemAsync(key, value, WRITE_OPTIONS)
    } catch {
      // Put it back the old way rather than lose it.
      await SecureStore.setItemAsync(key, value).catch(() => {})
    }
  },
}

/** Non-secret preferences (theme, dismissed banners, recent reactions). */
export const prefs = {
  async get<T>(key: string, fallback: T): Promise<T> {
    let r = await secure.read(`pref.${key}`)
    // The Keychain was locked (iPhone started Glofly before it was unlocked): read it again once
    // Glofly is on screen instead of using the default, which a later change would then save
    // over the real setting.
    if (r.failed) {
      await whenActive()
      r = await secure.read(`pref.${key}`)
    }
    const raw = r.value
    if (raw === null) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    await secure.set(`pref.${key}`, value === undefined ? null : JSON.stringify(value))
  },
}
