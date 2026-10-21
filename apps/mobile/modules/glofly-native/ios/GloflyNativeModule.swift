import AVFoundation
import ExpoModulesCore
import FirebaseMessaging
import UIKit
import UserNotifications

/// Glofly's own iPhone code, called from src/GloflyNative.ts. Mirrors the Android module; things
/// only Android has (the call foreground service, lock-screen flags, full-screen call settings)
/// are safe no-ops here. Lock-screen ringing is CallKit.swift.
public class GloflyNativeModule: Module {
  private static weak var current: GloflyNativeModule?
  private var notificationsOn = false
  private let voice = VoiceRecorder()

  static func emit(_ event: String, _ body: [String: String]) {
    DispatchQueue.main.async { current?.sendEvent(event, body) }
  }

  public func definition() -> ModuleDefinition {
    Name("GloflyNative")
    Events("pushToken", "callRing", "hangUp", "voipToken", "callAnswer", "callEnd", "callDeclined", "callMute", "pipChanged", "share", "keyCommand")

    OnCreate {
      GloflyNativeModule.current = self
      self.refreshNotificationStatus()
    }

    OnAppEntersForeground {
      self.refreshNotificationStatus()
    }

    // ---- Push ----

    AsyncFunction("getPushToken") { (promise: Promise) in
      guard GloflyAppDelegate.firebaseReady else { return promise.resolve(nil) }
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        let allowed = GloflyNativeModule.allowed(settings.authorizationStatus)
        guard allowed else { return promise.resolve(nil) }
        DispatchQueue.main.async {
          let fetch = {
            Messaging.messaging().token { token, _ in promise.resolve(token) }
          }
          if GloflyAppDelegate.hasApnsToken {
            fetch()
            return
          }
          var settled = false
          GloflyAppDelegate.apnsWaiters.append { ok in
            if settled { return }
            settled = true
            if ok { fetch() } else { promise.resolve(nil) }
          }
          DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
            if settled { return }
            settled = true
            promise.resolve(nil)
          }
          UIApplication.shared.registerForRemoteNotifications()
        }
      }
    }

    Function("configurePush") { (c: [String: Any]) in
      guard let serverUrl = c["serverUrl"] as? String, let token = c["token"] as? String else { return }
      PushStore.save(PushConfig(
        serverUrl: serverUrl,
        token: token,
        version: (c["version"] as? String) ?? "",
        platform: (c["platform"] as? String) ?? "ios",
        meId: (c["meId"] as? String) ?? ""
      ))
    }

    Function("clearPush") {
      PushStore.clear()
      UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    }

    Function("cancelChatNotification") { (conversationId: String) in
      GloflyNotifications.removeChat(conversationId)
    }

    Function("cancelCallNotification") { (callId: String) in
      GloflyNotifications.removeCall(callId)
    }

    // ---- Notification permission (iPhone asks once) ----

    Function("notificationsEnabled") { () -> Bool in
      self.notificationsOn
    }

    AsyncFunction("notificationStatus") { (promise: Promise) in
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: promise.resolve("granted")
        case .denied: promise.resolve("denied")
        default: promise.resolve("unknown")
        }
      }
    }

    AsyncFunction("requestNotifications") { (promise: Promise) in
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
        self.notificationsOn = granted
        promise.resolve(granted)
      }
    }

    Function("openNotificationSettings") { () -> Bool in
      guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else { return false }
      DispatchQueue.main.async { UIApplication.shared.open(url) }
      return true
    }

    // Android only.
    Function("canUseFullScreenIntent") { () -> Bool in true }
    Function("openFullScreenIntentSettings") { () -> Bool in false }

    /// The screen a tapped notification should open, if it was tapped before the app was ready.
    Function("takeLaunchLink") { () -> String? in
      GloflyNotifications.shared.takePendingLink()
    }

    // ---- Calls ----

    Function("showOverLockScreen") { (_: Bool) in }

    // Android only: on iPhone, picture-in-picture comes from LiveKit's video view (iosPIP).
    Function("pipSupported") { () -> Bool in false }
    Function("setPipCall") { (_: Bool, _: Int, _: Int) in }
    Function("enterPip") { () -> Bool in false }
    Function("isInPip") { () -> Bool in false }

    Function("keepScreenOn") { (on: Bool) in
      DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = on }
    }

    // Android shows an ongoing-call notification; on iPhone the "audio" background mode keeps the
    // call going with the screen locked, and iOS shows its own green call indicator.
    Function("startOngoingCall") { (_: String, _: String, _: String, _: Bool) in }
    Function("stopOngoingCall") {}

    // ---- Lock-screen calls (CallKit.swift) ----

    Function("voipToken") { () -> String? in
      GloflyCallKit.shared.voipToken
    }
    Function("takeCallKitAnswer") { () -> [String: String]? in
      GloflyCallKit.shared.takePendingAnswer()
    }
    Function("endCallKitCall") { (callId: String) in
      GloflyCallKit.shared.endCall(callId)
    }
    Function("callKitAnsweredInApp") { (callId: String) in
      GloflyCallKit.shared.answeredInApp(callId)
    }

    // Sounds picked in Settings (message sound, ringtone): in-app tones and lock-screen ringing.
    // iPhone notifications name the sound too; the app tells the server (PUT /devices/push).
    Function("setSounds") { (message: String, ringtone: String) in
      ToneChoices.save(message: message, ringtone: ringtone)
      DispatchQueue.main.async { GloflyCallKit.shared.refreshRingtone() }
    }

    // Call sounds that don't disturb the call's audio session (see CallTones.swift).
    Function("playCallTone") { (name: String, repeating: Bool, volume: Double) -> Bool in
      CallTones.shared.play(name, repeat: repeating, volume: Float(volume))
    }
    Function("stopCallTone") {
      CallTones.shared.stop()
    }

    // Calls start on the speaker; the Audio menu turns this off for the earpiece (CallSpeaker.swift).
    Function("keepCallOnSpeaker") { (on: Bool) in
      DispatchQueue.main.async { CallSpeaker.shared.keep(on) }
    }
    Function("stopCallSpeaker") {
      DispatchQueue.main.async { CallSpeaker.shared.stop() }
    }
    Function("callAudioRoute") { () -> String in
      CallSpeaker.currentRoute()
    }

    // Call diagnostics (long-press the call's title): what iOS's one shared audio session is doing.
    Function("audioSessionInfo") { () -> [String: String] in
      let s = AVAudioSession.sharedInstance()
      let route = s.currentRoute
      let ports = { (list: [AVAudioSessionPortDescription]) -> String in
        list.isEmpty ? "none" : list.map { "\($0.portType.rawValue) (\($0.portName))" }.joined(separator: ", ")
      }
      var mic = "unknown"
      switch s.recordPermission {
      case .granted: mic = "granted"
      case .denied: mic = "denied"
      case .undetermined: mic = "not asked"
      @unknown default: break
      }
      return [
        "category": s.category.rawValue.replacingOccurrences(of: "AVAudioSessionCategory", with: ""),
        "mode": s.mode.rawValue.replacingOccurrences(of: "AVAudioSessionMode", with: ""),
        "options": String(s.categoryOptions.rawValue),
        "inputs": ports(route.inputs),
        "outputs": ports(route.outputs),
        "input available": String(s.isInputAvailable),
        "other audio playing": String(s.isOtherAudioPlaying),
        "volume": String(format: "%.2f", s.outputVolume),
        "sample rate": String(format: "%.0f", s.sampleRate),
        "mic permission": mic,
      ]
    }

    // ---- 0.8.0: things shared to Glofly from other apps (Share.swift + the Share Extension) ----

    /// The share waiting for the "Send to…" screen (once), or nil. `id` from glofly://share?id=…
    AsyncFunction("takePendingShare") { (id: String?) -> [String: Any]? in
      GloflyShareInbox.take(id)
    }

    Function("discardShare") { (id: String) in
      GloflyShareInbox.discard(id)
    }

    // ---- 0.8.0: hardware keyboard shortcuts (KeyCommands.swift) ----

    /// The commands the app can do right now ("quick", "find", …); the rest are left alone.
    Function("setKeyCommands") { (ids: [String]) in
      GloflyKeyCommands.set(ids)
    }

    // ---- Voice messages (AAC in .m4a: iPhones can't record Opus) ----

    AsyncFunction("startVoice") { (promise: Promise) in
      self.voice.start { error in
        if let error { promise.reject(error) } else { promise.resolve(nil) }
      }
    }

    Function("voiceLevel") { () -> Double in
      self.voice.level()
    }

    AsyncFunction("stopVoice") { () -> [String: Any]? in
      self.voice.stop()
    }

    Function("cancelVoice") {
      self.voice.cancel()
    }
  }

  static func allowed(_ status: UNAuthorizationStatus) -> Bool {
    status == .authorized || status == .provisional || status == .ephemeral
  }

  private func refreshNotificationStatus() {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      self.notificationsOn = GloflyNativeModule.allowed(settings.authorizationStatus)
    }
  }
}
