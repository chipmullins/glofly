// Android picture-in-picture during calls (Oct 13): the app's main screen has to say it can shrink
// into a floating window, and it must not restart when the window changes size (the call would
// drop). The native side is modules/glofly-native/android/.../Pip.kt.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins')

const NEEDED = ['screenSize', 'smallestScreenSize', 'screenLayout', 'orientation']

module.exports = function withPictureInPicture(config) {
  return withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults)
    activity.$['android:supportsPictureInPicture'] = 'true'
    activity.$['android:resizeableActivity'] = 'true'
    const current = (activity.$['android:configChanges'] ?? '').split('|').filter(Boolean)
    for (const c of NEEDED) if (!current.includes(c)) current.push(c)
    activity.$['android:configChanges'] = current.join('|')
    return cfg
  })
}
