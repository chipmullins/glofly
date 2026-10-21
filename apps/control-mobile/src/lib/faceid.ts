import * as LocalAuthentication from 'expo-local-authentication'

/** Right before a dangerous action is sent: Face ID (or the passcode if Face ID fails). */
export async function confirmWithFaceId(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Confirm with Face ID',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    })
    return result.success
  } catch {
    return false
  }
}
