import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'

// "Keep me signed in" saves the session token here, encrypted by Windows
// (the same protection Chrome and Edge use for saved passwords). Only your
// Windows account on this PC can decrypt it.
const filePath = (): string => join(app.getPath('userData'), 'session.dat')

export async function saveToken(token: string): Promise<void> {
  // If the system can't encrypt, don't save at all rather than save it in plain text.
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    await writeFile(filePath(), safeStorage.encryptString(token), { mode: 0o600 })
  } catch {
    // Not fatal: you're still signed in, it just won't be remembered next launch.
  }
}

export async function loadToken(): Promise<string | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const data = await readFile(filePath())
    return safeStorage.decryptString(data)
  } catch {
    return null // no saved session, or it can't be read
  }
}

export async function clearToken(): Promise<void> {
  await rm(filePath(), { force: true }).catch(() => undefined)
}
