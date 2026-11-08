import ExpoModulesCore
import FirebaseCore
import FirebaseMessaging
import UIKit

/// Hooks into the app's start-up and Apple's push callbacks: starts Firebase (only when the build
/// has GoogleService-Info.plist), takes over notification taps and buttons, and hands Apple's
/// device token to Firebase (Info.plist turns Firebase's own automatic hook-in off).
public class GloflyAppDelegate: ExpoAppDelegateSubscriber, MessagingDelegate {
  static var firebaseReady = false
  /// Waiting for Apple's device token (getPushToken asked before it arrived).
  static var apnsWaiters: [(Bool) -> Void] = []
  static var hasApnsToken = false

  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    if FirebaseApp.app() == nil, Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
      FirebaseApp.configure()
    }
    if FirebaseApp.app() != nil {
      Self.firebaseReady = true
      Messaging.messaging().delegate = self
    }
    GloflyNotifications.shared.install()
    // Lock-screen calls: register for VoIP pushes (one may be what just launched the app).
    GloflyCallKit.shared.start()
    // 0.9.1: keep your camera going when you leave Glofly mid-call (the call shrinks to iOS's
    // floating window). Before, iOS paused the camera and the others saw your video freeze.
    Self.allowCameraWhileMultitasking()
    return true
  }

  /// iOS lets calling apps (voip background mode, built with the iOS 18 SDK or later) keep the
  /// camera while another app is on screen. LiveKit's WebRTC switches it on for each camera it
  /// opens when this option is set, so it's set at launch, before any call. Looked up by name so
  /// this module needn't link LiveKit's pod; if the class or option isn't there, nothing changes.
  static func allowCameraWhileMultitasking() {
    guard let options = NSClassFromString("WebRTCModuleOptions") as? NSObject.Type else { return }
    let sharedInstance = NSSelectorFromString("sharedInstance")
    guard options.responds(to: sharedInstance),
          let shared = (options as AnyObject).perform(sharedInstance)?.takeUnretainedValue() as? NSObject,
          shared.responds(to: NSSelectorFromString("setEnableMultitaskingCameraAccess:"))
    else { return }
    shared.setValue(true, forKey: "enableMultitaskingCameraAccess")
  }

  public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    if Self.firebaseReady { Messaging.messaging().apnsToken = deviceToken }
    Self.hasApnsToken = true
    Self.finishWaiting(true)
  }

  public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    Self.finishWaiting(false)
  }

  public func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
    GloflyNotifications.shared.handleBackground(userInfo)
    // Give the removal a moment before iOS suspends the app again.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { completionHandler(.noData) }
  }

  public func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
    guard let fcmToken else { return }
    GloflyNativeModule.emit("pushToken", ["token": fcmToken])
  }

  static func finishWaiting(_ ok: Bool) {
    DispatchQueue.main.async {
      let waiters = apnsWaiters
      apnsWaiters = []
      waiters.forEach { $0(ok) }
    }
  }
}
