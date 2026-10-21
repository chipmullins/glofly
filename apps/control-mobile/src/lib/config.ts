import Constants from 'expo-constants'

/** Where the Glofly server is. Development builds can point at the PC (see .env.example). */
export const SERVER_URL = (process.env.EXPO_PUBLIC_SERVER_URL || 'https://api.glofly.app').replace(/\/+$/, '')

/** development | preview | production (app.config.ts → extra.variant). */
export const VARIANT: string = (Constants.expoConfig?.extra as { variant?: string } | undefined)?.variant ?? 'development'

export const APP_VERSION: string = Constants.expoConfig?.version ?? '1.0.0'

/** Sign out after this long in the background. */
export const BACKGROUND_LIMIT_MS = 5 * 60 * 1000
