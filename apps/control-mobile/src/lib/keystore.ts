import * as SecureStore from 'expo-secure-store'

// What the phone keeps (iOS Keychain, this device only):
// - the private key: behind Face ID (requireAuthentication; reading it shows the Face ID prompt),
//   only when the phone has a passcode, never backed up or moved to another phone;
// - the device id, the phone's name and the last admin username: plain Keychain entries (not secret
//   on their own: the server needs the key's signature too).

const KEY = 'control.privateKey'
const DEVICE = 'control.deviceId'
const NAME = 'control.phoneName'
const USERNAME = 'control.username'

const PLAIN: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
const LOCKED: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  authenticationPrompt: 'Unlock your Glofly Control key',
}

export type Approved = { deviceId: string; phoneName: string }

export const keystore = {
  /** Face ID must be set up for the key to be saved behind it. */
  canUseFaceId: (): boolean => {
    try {
      return SecureStore.canUseBiometricAuthentication()
    } catch {
      return false
    }
  },
  async saveApproval(secretKeyHex: string, deviceId: string, phoneName: string): Promise<void> {
    await SecureStore.setItemAsync(KEY, secretKeyHex, LOCKED)
    await SecureStore.setItemAsync(DEVICE, deviceId, PLAIN)
    await SecureStore.setItemAsync(NAME, phoneName, PLAIN)
  },
  async approved(): Promise<Approved | null> {
    try {
      const deviceId = await SecureStore.getItemAsync(DEVICE, PLAIN)
      if (!deviceId) return null
      return { deviceId, phoneName: (await SecureStore.getItemAsync(NAME, PLAIN)) ?? "Chip's iPhone" }
    } catch {
      return null
    }
  },
  /** Shows Face ID. Null when it was cancelled or the key is gone (Face ID changed → key unusable). */
  async readKey(): Promise<{ ok: true; key: string } | { ok: false; gone: boolean; message: string }> {
    try {
      const key = await SecureStore.getItemAsync(KEY, LOCKED)
      if (!key) return { ok: false, gone: true, message: 'The key for this iPhone is missing. Approve it again from desktop Control.' }
      return { ok: true, key }
    } catch (err) {
      const text = String((err as Error)?.message ?? err)
      if (/cancel/i.test(text)) return { ok: false, gone: false, message: 'Face ID was cancelled.' }
      // Face ID enrollment changed (biometryCurrentSet invalidates the key) or the passcode was removed.
      if (/not be found|item.*not|decode/i.test(text)) {
        return { ok: false, gone: true, message: "This iPhone's key can't be used any more (Face ID or the passcode changed). Approve it again from desktop Control." }
      }
      return { ok: false, gone: false, message: "Face ID didn't unlock the key. Try again." }
    }
  },
  async wipe(): Promise<void> {
    for (const k of [KEY, DEVICE, NAME]) await SecureStore.deleteItemAsync(k).catch(() => {})
  },
  async username(): Promise<string> {
    try {
      return (await SecureStore.getItemAsync(USERNAME, PLAIN)) ?? ''
    } catch {
      return ''
    }
  },
  async setUsername(name: string): Promise<void> {
    await SecureStore.setItemAsync(USERNAME, name, PLAIN).catch(() => {})
  },
}
