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

const config: ExpoConfig = {
  name: 'Glofly',
  slug: 'glofly',
  scheme: 'glofly',
  version: '1.0.0',
  // Rotation is allowed so the call screen can go landscape; every other screen locks itself upright
  // (expo-screen-orientation: starts locked, src/app/_layout.tsx keeps it locked, call.tsx unlocks).
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
    supportsTablet: false,
    icon: './assets/icon-ios.png',
    ...(googleServiceInfo ? { googleServicesFile: googleServiceInfo } : {}),
    infoPlist: {
      NSMicrophoneUsageDescription: 'Glofly uses the microphone for calls and voice messages.',
      NSCameraUsageDescription: 'Glofly uses the camera for video calls and photos you take.',
      NSPhotoLibraryUsageDescription: 'Glofly lets you pick photos to send and for your profile.',
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
        photosPermission: 'Glofly lets you pick photos to send and for your profile.',
        cameraPermission: 'Glofly uses the camera for video calls and photos you take.',
      },
    ],
    ['expo-media-library', { savePhotosPermission: 'Glofly saves photos from chats when you ask it to.', granularPermissions: ['photo'] }],
    '@livekit/react-native-expo-plugin',
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
    eas: { projectId: '3aa33fd8-907f-4f50-b1a8-db37c96e107b' },
  },
}

export default config
