import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

// Small key/value storage. Secrets (the session token) go into Android's Keystore through
// SecureStore; the web preview falls back to localStorage, which is only used for testing.

const web = Platform.OS === 'web'

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
      else await SecureStore.setItemAsync(key, value)
    } catch {
      /* Keystore unavailable: the user signs in again next time */
    }
  },
}

/** Non-secret preferences (theme, dismissed banners, recent reactions). */
export const prefs = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const raw = await secure.get(`pref.${key}`)
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
