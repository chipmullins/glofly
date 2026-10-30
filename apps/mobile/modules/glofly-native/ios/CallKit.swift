import AVFoundation
import CallKit
import PushKit
import UIKit

/// Lock-screen ringing on iPhone, like a phone call (CallKit + PushKit VoIP pushes).
///
/// The server sends a "VoIP" push straight to Apple when someone rings you and Glofly isn't open
/// (server: push/apns.ts). iOS wakes Glofly even if it was closed, and Glofly must show the call
/// through CallKit right away: the full-screen incoming call on the lock screen (or the banner
/// when unlocked), with Glofly's ringtone, and the call afterwards in the Phone app's Recents.
///
/// - Answer: the app joins the call (JS: takeCallKitAnswer → openIncomingFromLink(answer)).
///   Works from the lock screen; Glofly runs in the background during the call.
/// - Decline: declined straight from here over HTTP (the session saved for notification Reply),
///   so it works even before the app's JavaScript is up.
/// - Hang up from iOS's call screen: JS leaves the call ("callEnd").
/// - The call stops ringing elsewhere (answered on another device, cancelled, timed out): the
///   app's live connection or the silent call_stop push ends it here (endCall).
final class GloflyCallKit: NSObject, CXProviderDelegate, PKPushRegistryDelegate {
  static let shared = GloflyCallKit()

  private let provider: CXProvider
  private var registry: PKPushRegistry?
  private struct Info {
    let uuid: UUID
    let video: Bool
    var answered: Bool
  }
  private var calls: [String: Info] = [:]
  private var timers: [String: DispatchWorkItem] = [:]
  /// An answer waiting for the app's JavaScript (cold start from the lock screen).
  private var pendingAnswer: [String: String]?
  /// Apple's VoIP token as hex ("sandbox:" in front for development builds).
  private(set) var voipToken: String?
  /// iOS has switched the audio on for a CallKit call (didActivate) and not off again yet.
  /// JS reads it when it starts late (answered from the lock screen while Glofly was closed).
  private(set) var audioActive = false

  private override init() {
    let config = CXProviderConfiguration()
    config.supportsVideo = true
    config.maximumCallGroups = 1
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.generic]
    config.includesCallsInRecents = true
    config.ringtoneSound = ToneChoices.ringtoneFile()
    provider = CXProvider(configuration: config)
    super.init()
    provider.setDelegate(self, queue: nil)
  }

  /// The ringtone was changed in Settings: lock-screen calls ring with it from now on.
  func refreshRingtone() {
    let config = provider.configuration
    config.ringtoneSound = ToneChoices.ringtoneFile()
    provider.configuration = config
  }

  /// At app launch (a VoIP push can be what launched it).
  func start() {
    guard registry == nil else { return }
    let r = PKPushRegistry(queue: .main)
    r.delegate = self
    r.desiredPushTypes = [.voIP]
    registry = r
  }

  // MARK: PushKit

  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    let hex = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    voipToken = GloflyCallKit.isSandboxBuild ? "sandbox:" + hex : hex
    GloflyNativeModule.emit("voipToken", ["token": voipToken ?? ""])
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    voipToken = nil
    GloflyNativeModule.emit("voipToken", ["token": ""])
  }

  func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    // iOS requires every VoIP push to show a call, right now, or it stops delivering them.
    reportIncoming(payload.dictionaryPayload, completion: completion)
  }

  // MARK: Calls

  private func reportIncoming(_ info: [AnyHashable: Any], completion: @escaping () -> Void) {
    let callId = (info["callId"] as? String) ?? UUID().uuidString
    let video = (info["video"] as? String) == "1"
    let callerName = (info["callerName"] as? String) ?? "Glofly"
    let chatTitle = (info["chatTitle"] as? String) ?? ""
    let until = (info["ringingUntil"] as? String).flatMap { ISO8601DateFormatter.flexible($0) }

    if calls[callId] != nil {
      // Rung again (Add people, ring again): already showing.
      return completion()
    }
    let uuid = UUID()
    calls[callId] = Info(uuid: uuid, video: video, answered: false)

    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: (info["conversationId"] as? String) ?? callId)
    update.localizedCallerName = chatTitle.isEmpty ? callerName : "\(callerName) · \(chatTitle)"
    update.hasVideo = video
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false

    provider.reportNewIncomingCall(with: uuid, update: update) { error in
      DispatchQueue.main.async {
        if error != nil {
          // Focus / Do Not Disturb or a duplicate: iOS didn't show it.
          self.calls[callId] = nil
        } else if let until, until.timeIntervalSinceNow <= 0 {
          // A late push for a call that already stopped ringing.
          self.endCall(callId, reason: .unanswered)
        } else {
          // Stop ringing when the ring time is up, if nothing else ended it first.
          let item = DispatchWorkItem { [weak self] in
            if self?.calls[callId]?.answered == false { self?.endCall(callId, reason: .unanswered) }
          }
          self.timers[callId] = item
          DispatchQueue.main.asyncAfter(deadline: .now() + max(5, until?.timeIntervalSinceNow ?? 45), execute: item)
          GloflyNativeModule.emit("callRing", ["callId": callId])
        }
        completion()
      }
    }
  }

  /// Ends a CallKit call that ended elsewhere (or that the app hung up).
  func endCall(_ callId: String, reason: CXCallEndedReason = .remoteEnded) {
    DispatchQueue.main.async {
      guard let info = self.calls.removeValue(forKey: callId) else { return }
      self.timers.removeValue(forKey: callId)?.cancel()
      if self.pendingAnswer?["callId"] == callId { self.pendingAnswer = nil }
      self.provider.reportCall(with: info.uuid, endedAt: nil, reason: reason)
    }
  }

  /// The app answered this call itself (on its own Incoming card): CallKit stops ringing.
  func answeredInApp(_ callId: String) {
    endCall(callId, reason: .answeredElsewhere)
  }

  func takePendingAnswer() -> [String: String]? {
    defer { pendingAnswer = nil }
    return pendingAnswer
  }

  private func callId(for uuid: UUID) -> String? {
    calls.first { $0.value.uuid == uuid }?.key
  }

  // MARK: CXProviderDelegate

  func providerDidReset(_ provider: CXProvider) {
    if audioActive {
      audioActive = false
      GloflyNativeModule.emit("callAudio", ["active": "0"])
    }
    calls.removeAll()
    timers.values.forEach { $0.cancel() }
    timers.removeAll()
    pendingAnswer = nil
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard let id = callId(for: action.callUUID), var info = calls[id] else { return action.fail() }
    info.answered = true
    calls[id] = info
    timers.removeValue(forKey: id)?.cancel()
    // Oct 29: give the session a call's shape BEFORE fulfilling (Apple's documented order). iOS
    // switches a CallKit call's audio on with whatever category the app has at this moment; it was
    // whatever was left over (often a previous call's mixable play-and-record, or playback after a
    // voice message), and with another app holding the audio (TikTok) iOS sometimes never switched
    // it on at all: no didActivate, a silent call both ways. Not activated here: iOS does that.
    GloflyCallKit.prepareCallAudioSession(video: info.video)
    pendingAnswer = ["callId": id, "video": info.video ? "1" : "0"]
    GloflyNativeModule.emit("callAnswer", [:])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    guard let id = callId(for: action.callUUID), let info = calls.removeValue(forKey: id) else { return action.fulfill() }
    timers.removeValue(forKey: id)?.cancel()
    if info.answered {
      GloflyNativeModule.emit("callEnd", ["callId": id])
      action.fulfill()
    } else {
      // Declined from the lock screen / banner.
      if pendingAnswer?["callId"] == id { pendingAnswer = nil }
      GloflyNativeModule.emit("callDeclined", ["callId": id])
      if let config = PushStore.load() {
        GloflyHttp.send(config, "POST", "/calls/\(id)/decline") { _ in action.fulfill() }
      } else {
        action.fulfill()
      }
    }
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    if callId(for: action.callUUID) != nil {
      GloflyNativeModule.emit("callMute", ["muted": action.isMuted ? "1" : "0"])
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
    action.fail() // Glofly calls can't be put on hold
  }

  // The call's audio. A call answered here belongs to CallKit, and iOS switches its audio session
  // on by itself a moment after Answer (didActivate). LiveKit's audio engine must not start before
  // that: when the call connected first, the engine came up on a session iOS was about to take
  // over and stayed silent both ways until the call was redialed. JS holds the engine off while a
  // CallKit call connects and lets it go on "callAudio" active (src/calls/controller.ts).
  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    audioActive = true
    GloflyNativeModule.emit("callAudio", ["active": "1"])
  }
  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    audioActive = false
    GloflyNativeModule.emit("callAudio", ["active": "0"])
  }

  /// A call's audio shape (play + record, voice or video chat, not mixable with other apps), set
  /// without switching the session on. Used when a CallKit call is answered.
  static func prepareCallAudioSession(video: Bool) {
    var options: AVAudioSession.CategoryOptions = [.allowBluetooth, .allowBluetoothA2DP, .allowAirPlay]
    if video { options.insert(.defaultToSpeaker) }
    try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: video ? .videoChat : .voiceChat, options: options)
  }

  /// TestFlight / ad hoc builds made for development have Apple's sandbox push environment.
  static var isSandboxBuild: Bool {
    guard let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
          let data = FileManager.default.contents(atPath: path),
          let text = String(data: data, encoding: .isoLatin1)
    else { return false } // App Store / TestFlight: no embedded profile → production
    guard let key = text.range(of: "<key>aps-environment</key>") else { return false }
    let after = text[key.upperBound...].prefix(80)
    return after.contains("<string>development</string>")
  }
}

extension ISO8601DateFormatter {
  /// Parses the server's ISO dates, with or without milliseconds.
  static func flexible(_ text: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: text) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: text)
  }
}
