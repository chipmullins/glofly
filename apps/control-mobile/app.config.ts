/// <reference types="node" />
import type { ExpoConfig } from 'expo/config'

// Glofly Control for iPhone (0.8.2): the admin app in Chip's pocket. iPhone only, installed through
// TestFlight (internal testing only; never on the App Store for others).
//
// The server address comes from EXPO_PUBLIC_SERVER_URL (apps/control-mobile/.env.local while
// developing, e.g. http://192.168.1.20:4000 for the PC on the home network). Builds without it use
// the live server. Plain-http addresses are only allowed in development builds.

const variant = process.env.APP_VARIANT ?? 'development' // development | preview | production
const isDev = variant === 'development'
// Screens in a browser with sample data (README → "Screens in a browser"); never for builds.
const webPreview = process.env.CONTROL_WEB_PREVIEW === '1'

// The Expo project (@chipmullins/glofly-control): fill in after `eas init` (run once in this folder;
// it prints the id). Until then over-the-air updates are off and EAS asks to link the project.
const EXPO_PROJECT_ID = '2bfe0f09-3dce-481d-aae5-c95aa18244a7'

// Over-the-air updates (expo-updates), like the Glofly phone app: JavaScript-only changes reach the
// installed app without a new build (`npm run update:preview` / `update:production`, see
// scripts/update.mjs). A build only takes updates with its own RUNTIME_VERSION. **Bump it whenever
// native code changes** (a native package added or updated, plugins, or native settings below) and
// make a new build: an update for newer native code would crash older builds.
// 2026-10-21.1: Glofly Control for iPhone 1.0.0.
const RUNTIME_VERSION = '2026-10-21.1'
const updateChannel = variant === 'production' ? 'production' : 'preview'

const FACE_ID = 'Glofly Control uses Face ID to unlock your admin key.'

const config: ExpoConfig = {
  name: 'Glofly Control',
  slug: 'glofly-control',
  scheme: 'glofly-control',
  version: '1.0.0',
  runtimeVersion: RUNTIME_VERSION,
  platforms: webPreview ? ['ios', 'web'] : ['ios'],
  updates: {
    ...(EXPO_PROJECT_ID ? { url: `https://u.expo.dev/${EXPO_PROJECT_ID}` } : {}),
    enabled: !isDev && !!EXPO_PROJECT_ID,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    requestHeaders: { 'expo-channel-name': updateChannel },
  },
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#1b1238',
  ios: {
    bundleIdentifier: 'com.glofly.control',
    supportsTablet: false,
    infoPlist: {
      NSFaceIDUsageDescription: FACE_ID,
      ITSAppUsesNonExemptEncryption: false,
      // Plain-http server addresses only in development builds (the PC on the home network).
      // Other builds say "HTTPS only" explicitly (Expo's iOS template allows plain http otherwise).
      NSAppTransportSecurity: isDev ? { NSAllowsArbitraryLoads: true } : { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false },
    },
    entitlements: {
      // Development builds get alerts from Apple's sandbox; TestFlight builds from production.
      'aps-environment': isDev ? 'development' : 'production',
      // Urgent alerts (server down, sign-in somewhere new, report spike) break through Focus.
      'com.apple.developer.usernotifications.time-sensitive': true,
    },
  },
  plugins: [
    'expo-router',
    'expo-updates',
    ['expo-secure-store', { faceIDPermission: FACE_ID }],
    ['expo-local-authentication', { faceIDPermission: FACE_ID }],
    ['expo-notifications', { mode: isDev ? 'development' : 'production' }],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 140,
        backgroundColor: '#1b1238',
      },
    ],
  ],
  ...(webPreview ? { web: { output: 'single' as const } } : {}),
  experiments: { typedRoutes: false },
  extra: {
    variant,
    ...(EXPO_PROJECT_ID ? { eas: { projectId: EXPO_PROJECT_ID } } : {}),
  },
}

export default config
