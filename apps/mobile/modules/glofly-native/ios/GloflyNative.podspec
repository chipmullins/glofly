Pod::Spec.new do |s|
  s.name           = 'GloflyNative'
  s.version        = '1.0.0'
  s.summary        = "Glofly's own iPhone code: push notifications, notification actions, voice recording"
  s.description    = s.summary
  s.license        = 'UNLICENSED'
  s.author         = 'Glofly'
  s.homepage       = 'https://glofly.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/chipmullins/glofly.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Push notifications go through Firebase Cloud Messaging (it hands them to Apple), like Android.
  s.dependency 'FirebaseMessaging'

  s.source_files = '*.swift'
  # Notification sounds must sit in the app itself (`resources` copies them there).
  s.resources = ['sounds/*.caf']
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
