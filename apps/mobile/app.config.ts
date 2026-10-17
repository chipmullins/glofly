/// <reference types="node" />
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ExpoConfig } from 'expo/config'

// Glofly for phones (Android first; iOS builds from the same code later).
//
// The server address comes from EXPO_PUBLIC_SERVER_URL (apps/mobile/.env.local while
// developing, e.g. http://10.0.2.2:4000 for the Android emulator talking to this PC). Builds
// without it use the live server. Plain-http addresses are only allowed in development builds.

const variant = process.env.APP_VARIANT ?? 'development' // development | preview | production
const isDev = variant === 'development'

// Firebase's settings file for push notifications. Not committed: EAS hands it to the build as a
// file variable (GOOGLE_SERVICES_JSON); locally it can sit next to this file. Without it the app
// still builds and runs, just without push notifications.
const googleServices = process.env.GOOGLE_SERVICES_JSON ?? (existsSync(join(__dirname, 'google-services.json')) ? './google-services.json' : undefined)
// The iPhone's Firebase settings file, the same way (GOOGLE_SERVICE_INFO_PLIST on EAS).
const googleServiceInfo =
  process.env.GOOGLE_SERVICE_INFO_PLIST ?? (existsSync(join(__dirname, 'GoogleService-Info.plist')) ? './GoogleService-Info.plist' : undefined)

// Over-the-air updates (expo-updates, Oct 13): JavaScript-only changes reach installed phones
// without a new build (`npm run update:preview` / `update:production` in apps/mobile, see
// scripts/update.mjs). A build only takes updates with its own RUNTIME_VERSION. **Bump it whenever
// native code changes** (modules/glofly-native, a native package added or updated, plugins, or
// native settings below) and make new builds: an update for newer native code would crash older
// builds. Development builds load from the computer instead.
const EXPO_PROJECT_ID = '3aa33fd8-907f-4f50-b1a8-db37c96e107b'
const updateChannel = variant === 'production' ? 'production' : 'preview'
// 2026-10-13.2: Glofly 0.3.0 ("is online" / "joined from your invite" notifications in glofly-native).
// 2026-10-14.1: Glofly 0.4.0, the iPad version (ios.supportsTablet below is a native setting).
// 2026-10-16.1: Glofly 0.5.0, Watch Together (react-native-webview).
// 2026-10-17.1: Glofly 0.5.0, videos in chats (expo-video), after builds of 16.1 may already exist.
const RUNTIME_VERSION = '2026-10-17.1'

const config: ExpoConfig = {
  name: 'Glofly',
  slug: 'glofly',
  scheme: 'glofly',
  version: '1.0.0',
  runtimeVersion: RUNTIME_VERSION,
  updates: {
    url: `https://u.expo.dev/${EXPO_PROJECT_ID}`,
    enabled: !isDev,
    // Checked at launch without waiting for it: a downloaded update is used from the next launch
    // (src/lib/updates.ts also applies it when you leave the app, so it lands within minutes).
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    // Builds made outside EAS (the GitHub Android check) still know their channel; EAS builds set
    // it from eas.json (the same names).
    requestHeaders: { 'expo-channel-name': updateChannel },
  },
  // Rotation is allowed so the call screen can go landscape; on phones every other screen locks
  // itself upright (expo-screen-orientation: starts locked, src/app/_layout.tsx keeps it locked,
  // call.tsx unlocks). iPads turn any way everywhere (src/lib/orientation.ts), which Split View and
  // Stage Manager also need.
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#1E1916',
  android: {
    package: 'com.glofly.app',
    versionCode: 1,
    adaptiveIcon: {
      backgroundImage: './assets/android-icon-background.png',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
      backgroundColor: '#251852',
    },
    ...(googleServices ? { googleServicesFile: googleServices } : {}),
    predictiveBackGestureEnabled: true,
    softwareKeyboardLayoutMode: 'resize',
    permissions: [
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECORD_AUDIO',
      'android.permission.CAMERA',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.VIBRATE',
      'android.permission.WAKE_LOCK',
    ],
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
    ],
  },
  ios: {
    bundleIdentifier: 'com.glofly.app',
    // 0.4.0: the iPad version. Two panes on wide screens (src/lib/layout.ts), the phone layout when
    // the window is narrow (Split View, Stage Manager).
    supportsTablet: true,
    icon: './assets/icon-ios.png',
    ...(googleServiceInfo ? { googleServicesFile: googleServiceInfo } : {}),
    infoPlist: {
      NSMicrophoneUsageDescription: 'Glofly uses the microphone for calls and voice messages.',
      NSCameraUsageDescription: 'Glofly uses the camera for video calls and the photos and videos you take.',
      NSPhotoLibraryUsageDescription: 'Glofly lets you pick photos and videos to send, and a photo for your profile.',
      NSPhotoLibraryAddUsageDescription: 'Glofly saves photos from chats when you ask it to.',
      // audio: a call keeps going with the screen locked. remote-notification: silent pushes that
      // clear notifications read elsewhere. voip: calls ring on the lock screen (CallKit + PushKit).
      UIBackgroundModes: ['audio', 'remote-notification', 'voip'],
      // Glofly hands Apple's device token to Firebase itself (modules/glofly-native/ios).
      FirebaseAppDelegateProxyEnabled: false,
      ITSAppUsesNonExemptEncryption: false,
      // Plain-http server addresses only in development builds (a PC on the home network).
      ...(isDev ? { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } } : {}),
    },
    entitlements: {
      // Development builds get pushes from Apple's sandbox; ad hoc and App Store builds from production.
      'aps-environment': isDev ? 'development' : 'production',
      // Incoming-call notifications break through Focus (time-sensitive).
      'com.apple.developer.usernotifications.time-sensitive': true,
    },
  },
  web: { output: 'single', favicon: './assets/firefly.png' },
  plugins: [
    'expo-router',
    'expo-updates',
    'expo-secure-store',
    'expo-localization',
    ['expo-screen-orientation', { initialOrientation: 'PORTRAIT_UP' }],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        backgroundColor: '#1C1210',
        dark: { image: './assets/splash-icon.png', backgroundColor: '#1C1210' },
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // Android 8: Core-Telecom (lock-screen calls) needs it, and it covers ~99% of phones.
          minSdkVersion: 26,
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          usesCleartextTraffic: isDev,
        },
        // Firebase's iPhone pods (push notifications) need static frameworks.
        ios: { useFrameworks: 'static' },
      },
    ],
    [
      'expo-audio',
      { microphonePermission: 'Glofly uses the microphone for calls and voice messages.', recordAudioAndroid: true, enableBackgroundPlayback: false },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Glofly lets you pick photos and videos to send, and a photo for your profile.',
        cameraPermission: 'Glofly uses the camera for video calls and the photos and videos you take.',
      },
    ],
    // Videos in chats (0.5.0).
    ['expo-video', { supportsBackgroundPlayback: false, supportsPictureInPicture: false }],
    ['expo-media-library', { savePhotosPermission: 'Glofly saves photos from chats when you ask it to.', granularPermissions: ['photo'] }],
    '@livekit/react-native-expo-plugin',
    // Calls shrink into a floating window when you leave Glofly (Android; iPhone needs nothing extra).
    './plugins/with-picture-in-picture.js',
    [
      '@config-plugins/react-native-webrtc',
      {
        cameraPermission: 'Glofly uses the camera for video calls.',
        microphonePermission: 'Glofly uses the microphone for calls.',
      },
    ],
  ],
  experiments: { typedRoutes: false },
  extra: {
    variant,
    // The Expo project (@chipmullins/glofly), from `eas init` (Oct 12).
    eas: { projectId: EXPO_PROJECT_ID },
  },
}

export default config
