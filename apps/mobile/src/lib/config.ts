import Constants from 'expo-constants'
import * as Application from 'expo-application'
import { Platform } from 'react-native'

/** Where the Glofly server is. Development builds can point at a PC (see .env.example). */
export const SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_URL || 'https://api.glofly.app').replace(/\/+$/, '')

/** This app's version (the store version on phones, the config's on the web preview). */
export const APP_VERSION: string =
  (Platform.OS !== 'web' ? Application.nativeApplicationVersion : null) ?? Constants.expoConfig?.version ?? '1.0.0'

/** The platform name the server keeps a minimum version for. The web preview counts as Android. */
export const PLATFORM: 'android' | 'ios' = Platform.OS === 'ios' ? 'ios' : 'android'

/** Sent with every request: the server checks it against the minimum version for this platform. */
export const VERSION_HEADERS = { 'X-Glofly-Version': APP_VERSION, 'X-Glofly-Platform': PLATFORM }

export const SITE_URL = 'https://glofly.app'
export const SUPPORT_EMAIL = 'support@glofly.app'

/** Where people allow a permission for Glofly on this phone (for "not allowed" messages). */
export const APP_SETTINGS = Platform.OS === 'ios' ? 'Settings → Glofly' : 'Android Settings → Apps → Glofly → Permissions'
