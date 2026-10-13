import ExpoModulesCore
import FirebaseMessaging
import UIKit
import UserNotifications

/// Glofly's own iPhone code, called from src/GloflyNative.ts. Mirrors the Android module; things
/// only Android has (the call foreground service, lock-screen flags, full-screen call settings)
/// are safe no-ops here. Lock-screen ringing (CallKit) comes in round two.
public class GloflyNativeModule: Module {
  private static weak var current: GloflyNativeModule?
  private var notificationsOn = false
  private let voice = VoiceRecorder()

  static func emit(_ event: String, _ body: [String: String]) {
    DispatchQueue.main.async { current?.sendEvent(event, body) }
  }

  public func definition() -> ModuleDefinition {
    Name("GloflyNative")
    Events("pushToken", "callRing", "hangUp")

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

    Function("keepScreenOn") { (on: Bool) in
      DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = on }
    }

    // Android shows an ongoing-call notification; on iPhone the "audio" background mode keeps the
    // call going with the screen locked, and iOS shows its own green call indicator.
    Function("startOngoingCall") { (_: String, _: String, _: String, _: Bool) in }
    Function("stopOngoingCall") {}

    // Call sounds that don't disturb the call's audio session (see CallTones.swift).
    Function("playCallTone") { (name: String, repeating: Bool, volume: Double) -> Bool in
      CallTones.shared.play(name, repeat: repeating, volume: Float(volume))
    }
    Function("stopCallTone") {
      CallTones.shared.stop()
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
