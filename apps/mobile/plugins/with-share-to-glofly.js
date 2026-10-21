// 0.8.0 "Share to Glofly": photos, videos, files, links and text shared from other apps.
//
// Android: the main activity takes ACTION_SEND / ACTION_SEND_MULTIPLE (text, images, videos, any
// file); modules/glofly-native/android/.../ShareIntake.kt copies what arrives and hands it to the
// app's "Send to…" screen (src/app/(main)/share.tsx).
//
// iPhone / iPad: a Share Extension ("Glofly" in the share sheet), added to the Xcode project here:
//   - target "GloflyShare" (bundle id com.glofly.app.share), Swift source in plugins/share-extension
//   - an App Group (group.com.glofly.app) on the app and the extension, so the extension can leave
//     the shared files where the app can read them (modules/glofly-native/ios/Share.swift)
//   - the extension then opens glofly://share?id=<id>
// EAS Build makes the extension's provisioning profile from extra.eas.build.experimental.ios
// .appExtensions (set below); the App Group must exist in the Apple Developer account (see the
// 0.8.0 release doc).
const fs = require('node:fs')
const path = require('node:path')
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins')

const TARGET = 'GloflyShare'
const SOURCE_DIR = path.join(__dirname, 'share-extension')

const appGroupOf = (bundleId) => `group.${bundleId}`
const extensionIdOf = (bundleId) => `${bundleId}.share`

// ---------------------------------------------------------------------------------------------
// Android

function withShareIntentFilters(config) {
  return withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults)
    const filters = activity['intent-filter'] ?? []
    const has = (action) => filters.some((f) => (f.action ?? []).some((a) => a.$['android:name'] === action))
    const filter = (action, types) => ({
      action: [{ $: { 'android:name': action } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: types.map((t) => ({ $: { 'android:mimeType': t } })),
    })
    // Single items: a link or text, a photo, a video, or any file. Several: photos, videos, files.
    if (!has('android.intent.action.SEND')) filters.push(filter('android.intent.action.SEND', ['text/plain', 'image/*', 'video/*', '*/*']))
    if (!has('android.intent.action.SEND_MULTIPLE')) filters.push(filter('android.intent.action.SEND_MULTIPLE', ['image/*', 'video/*', '*/*']))
    activity['intent-filter'] = filters
    // One Glofly: a share goes to the running app (onNewIntent) instead of opening a second copy
    // on top of the app that shared.
    activity.$['android:launchMode'] = 'singleTask'
    return cfg
  })
}

// ---------------------------------------------------------------------------------------------
// iOS

/** The app's own Info.plist: which App Group the shares come through. */
function withAppInfo(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.GloflyAppGroup = appGroupOf(cfg.ios.bundleIdentifier)
    return cfg
  })
}

function withAppGroupEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    const group = appGroupOf(cfg.ios.bundleIdentifier)
    const list = cfg.modResults['com.apple.security.application-groups'] ?? []
    if (!list.includes(group)) list.push(group)
    cfg.modResults['com.apple.security.application-groups'] = list
    return cfg
  })
}

/** EAS Build makes credentials (a provisioning profile) for every target listed here. */
function withEasExtension(config) {
  const bundleId = config.ios?.bundleIdentifier
  if (!bundleId) throw new Error('with-share-to-glofly: ios.bundleIdentifier is missing')
  config.extra = config.extra ?? {}
  config.extra.eas = config.extra.eas ?? {}
  config.extra.eas.build = config.extra.eas.build ?? {}
  config.extra.eas.build.experimental = config.extra.eas.build.experimental ?? {}
  config.extra.eas.build.experimental.ios = config.extra.eas.build.experimental.ios ?? {}
  const list = (config.extra.eas.build.experimental.ios.appExtensions ?? []).filter((e) => e.targetName !== TARGET)
  list.push({
    targetName: TARGET,
    bundleIdentifier: extensionIdOf(bundleId),
    entitlements: { 'com.apple.security.application-groups': [appGroupOf(bundleId)] },
  })
  config.extra.eas.build.experimental.ios.appExtensions = list
  return config
}

function plist(obj) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const value = (v, indent) => {
    const pad = '  '.repeat(indent)
    if (Array.isArray(v)) return `${pad}<array>\n${v.map((x) => value(x, indent + 1)).join('\n')}\n${pad}</array>`
    if (typeof v === 'boolean') return `${pad}<${v}/>`
    if (typeof v === 'number') return `${pad}<integer>${v}</integer>`
    if (v && typeof v === 'object') {
      const rows = Object.entries(v).map(([k, x]) => `${pad}  <key>${esc(k)}</key>\n${value(x, indent + 1)}`)
      return `${pad}<dict>\n${rows.join('\n')}\n${pad}</dict>`
    }
    return `${pad}<string>${esc(v)}</string>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${value(obj, 0)}\n</plist>\n`
}

/** The extension's files: its Swift code (copied), Info.plist, entitlements, privacy manifest. */
function withExtensionFiles(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const bundleId = cfg.ios.bundleIdentifier
      const dir = path.join(cfg.modRequest.platformProjectRoot, TARGET)
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(path.join(SOURCE_DIR, 'ShareViewController.swift'), path.join(dir, 'ShareViewController.swift'))
      fs.writeFileSync(
        path.join(dir, 'Info.plist'),
        plist({
          CFBundleDevelopmentRegion: '$(DEVELOPMENT_LANGUAGE)',
          CFBundleDisplayName: cfg.name,
          CFBundleExecutable: '$(EXECUTABLE_NAME)',
          CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
          CFBundleInfoDictionaryVersion: '6.0',
          CFBundleName: '$(PRODUCT_NAME)',
          CFBundlePackageType: '$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
          // The App Store wants these equal to the app's: the same values the app's Info.plist gets
          // (EAS puts the build number in ios.buildNumber before it generates the project).
          CFBundleShortVersionString: cfg.version || '1.0.0',
          CFBundleVersion: String(cfg.ios?.buildNumber || '1'),
          GloflyAppGroup: appGroupOf(bundleId),
          GloflyScheme: Array.isArray(cfg.scheme) ? cfg.scheme[0] : cfg.scheme || 'glofly',
          NSExtension: {
            NSExtensionAttributes: {
              // What Glofly shows up for: up to 10 photos / videos / files, a web page or link, text.
              NSExtensionActivationRule: {
                NSExtensionActivationSupportsImageWithMaxCount: 10,
                NSExtensionActivationSupportsMovieWithMaxCount: 10,
                NSExtensionActivationSupportsFileWithMaxCount: 10,
                NSExtensionActivationSupportsWebURLWithMaxCount: 1,
                NSExtensionActivationSupportsWebPageWithMaxCount: 1,
                NSExtensionActivationSupportsText: true,
              },
            },
            NSExtensionPointIdentifier: 'com.apple.share-services',
            NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).ShareViewController',
          },
        }),
      )
      fs.writeFileSync(path.join(dir, `${TARGET}.entitlements`), plist({ 'com.apple.security.application-groups': [appGroupOf(bundleId)] }))
      fs.writeFileSync(
        path.join(dir, 'PrivacyInfo.xcprivacy'),
        plist({
          // No required-reason APIs (file sizes come from URL resource values, not file dates).
          NSPrivacyAccessedAPITypes: [],
          NSPrivacyCollectedDataTypes: [],
          NSPrivacyTracking: false,
        }),
      )
      return cfg
    },
  ])
}

/** The extension target in Glofly.xcodeproj, built and embedded with the app. */
function withExtensionTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults
    if (project.pbxTargetByName(TARGET)) return cfg
    const bundleId = cfg.ios.bundleIdentifier
    const objects = project.hash.project.objects
    objects.PBXTargetDependency = objects.PBXTargetDependency || {}
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {}

    // Its folder in the project navigator.
    const group = project.addPbxGroup(['ShareViewController.swift', 'Info.plist', `${TARGET}.entitlements`, 'PrivacyInfo.xcprivacy'], TARGET, TARGET)
    const mainGroup = project.getFirstProject().firstProject.mainGroup
    project.addToPbxGroup(group.uuid, mainGroup)

    // The target (the xcode package also adds the "embed in the app" copy phase and the dependency).
    const target = project.addTarget(TARGET, 'app_extension', TARGET, extensionIdOf(bundleId))
    project.addBuildPhase(['ShareViewController.swift'], 'PBXSourcesBuildPhase', 'Sources', target.uuid)
    project.addBuildPhase(['PrivacyInfo.xcprivacy'], 'PBXResourcesBuildPhase', 'Resources', target.uuid)
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid)

    // The embed phase the xcode package made: name it like Xcode does, and only copy on install.
    for (const [key, phase] of Object.entries(objects.PBXCopyFilesBuildPhase || {})) {
      if (key.endsWith('_comment') || typeof phase !== 'object') continue
      if (phase.dstSubfolderSpec === 13 && (phase.name === '"Copy Files"' || phase.name === 'Copy Files')) {
        phase.name = '"Embed Foundation Extensions"'
        objects.PBXCopyFilesBuildPhase[`${key}_comment`] = 'Embed Foundation Extensions'
        for (const t of Object.values(objects.PBXNativeTarget)) {
          if (typeof t !== 'object') continue
          for (const p of t.buildPhases || []) if (p.value === key) p.comment = 'Embed Foundation Extensions'
        }
      }
    }

    // Embed the extension straight after the app's resources, before the script phases (an embed
    // phase after them can make Xcode report a dependency cycle).
    const appTarget = project.getFirstTarget().firstTarget
    const phases = appTarget.buildPhases || []
    const embedAt = phases.findIndex((p) => p.comment === 'Embed Foundation Extensions')
    const resourcesAt = phases.findIndex((p) => p.comment === 'Resources')
    if (embedAt > resourcesAt && resourcesAt >= 0) {
      const [embed] = phases.splice(embedAt, 1)
      phases.splice(resourcesAt + 1, 0, embed)
    }

    // Build settings: the same Apple team, version and iOS version as the app.
    const appSettings = mainAppSettings(project)
    const configs = project.pbxXCBuildConfigurationSection()
    for (const [key, c] of Object.entries(configs)) {
      if (key.endsWith('_comment') || !c.buildSettings) continue
      if (c.buildSettings.PRODUCT_NAME !== `"${TARGET}"`) continue
      Object.assign(c.buildSettings, {
        INFOPLIST_FILE: `${TARGET}/Info.plist`,
        CODE_SIGN_ENTITLEMENTS: `${TARGET}/${TARGET}.entitlements`,
        CODE_SIGN_STYLE: 'Automatic',
        PRODUCT_BUNDLE_IDENTIFIER: `"${extensionIdOf(bundleId)}"`,
        IPHONEOS_DEPLOYMENT_TARGET: appSettings.IPHONEOS_DEPLOYMENT_TARGET || '16.4',
        CURRENT_PROJECT_VERSION: String(cfg.ios?.buildNumber || appSettings.CURRENT_PROJECT_VERSION || '1'),
        MARKETING_VERSION: cfg.version || appSettings.MARKETING_VERSION || '1.0',
        SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: '"1,2"',
        CLANG_ENABLE_MODULES: 'YES',
        GENERATE_INFOPLIST_FILE: 'NO',
        // Required for extensions (Xcode refuses NO); opening Glofly afterwards is looked up at
        // run time instead (ShareViewController.openGlofly).
        APPLICATION_EXTENSION_API_ONLY: 'YES',
        SKIP_INSTALL: 'YES',
        ...(appSettings.DEVELOPMENT_TEAM ? { DEVELOPMENT_TEAM: appSettings.DEVELOPMENT_TEAM } : {}),
      })
      if (c.name === 'Debug') c.buildSettings.SWIFT_ACTIVE_COMPILATION_CONDITIONS = '"DEBUG $(inherited)"'
    }
    if (appSettings.DEVELOPMENT_TEAM) {
      project.addTargetAttribute('DevelopmentTeam', appSettings.DEVELOPMENT_TEAM, { uuid: target.uuid })
    }
    return cfg
  })
}

/** Settings of the app's own target (the first with a bundle id and an Info.plist that isn't ours). */
function mainAppSettings(project) {
  const out = {}
  const configs = project.pbxXCBuildConfigurationSection()
  for (const [key, c] of Object.entries(configs)) {
    if (key.endsWith('_comment') || !c.buildSettings) continue
    const bs = c.buildSettings
    if (!bs.PRODUCT_BUNDLE_IDENTIFIER || !bs.INFOPLIST_FILE || String(bs.INFOPLIST_FILE).includes(TARGET)) continue
    for (const k of ['IPHONEOS_DEPLOYMENT_TARGET', 'CURRENT_PROJECT_VERSION', 'MARKETING_VERSION', 'DEVELOPMENT_TEAM']) {
      if (bs[k] !== undefined && out[k] === undefined) out[k] = bs[k]
    }
  }
  return out
}

module.exports = function withShareToGlofly(config) {
  config = withShareIntentFilters(config)
  config = withEasExtension(config)
  config = withAppInfo(config)
  config = withAppGroupEntitlement(config)
  config = withExtensionFiles(config)
  config = withExtensionTarget(config)
  return config
}
