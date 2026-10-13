import AVFoundation

/// iPhone calls start on the speaker (Oct 13), voice and video alike.
///
/// Why not just add `.defaultToSpeaker` to the call's audio policy: with that option iOS's
/// "default" route *is* the speaker, so the Audio button could never switch to the earpiece
/// without changing the session's options mid-call — the kind of mid-call session change the
/// round-3 fix (one fixed play + record policy) removed. Instead the policy stays exactly as it is
/// and this keeps the output on the speaker whenever iOS would otherwise pick the earpiece:
///
/// - Only the built-in earpiece is overridden. Bluetooth, AirPods, wired headphones and CarPlay
///   win as usual (an override to the speaker would steal the call from them).
/// - iOS drops an override whenever the route changes or the session is re-activated (LiveKit does
///   that as the call's audio engine starts), so it's re-applied on every route change while on.
/// - Choosing "Phone" (earpiece) in the Audio menu turns it off; choosing "Speaker" turns it on.
final class CallSpeaker {
  static let shared = CallSpeaker()

  private var on = false
  private var observer: NSObjectProtocol?

  func keep(_ wanted: Bool) {
    on = wanted
    if wanted {
      if observer == nil {
        observer = NotificationCenter.default.addObserver(
          forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.apply() }
      }
      apply()
    } else {
      if let observer { NotificationCenter.default.removeObserver(observer) }
      observer = nil
      try? AVAudioSession.sharedInstance().overrideOutputAudioPort(.none)
    }
  }

  /// Stops watching without touching the route (the call ended; LiveKit lets the session go).
  func stop() {
    on = false
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
  }

  private func apply() {
    guard on else { return }
    let s = AVAudioSession.sharedInstance()
    guard s.category == .playAndRecord else { return }
    let outputs = s.currentRoute.outputs.map { $0.portType }
    if outputs.contains(.builtInReceiver) {
      try? s.overrideOutputAudioPort(.speaker)
    }
  }

  /// Where the call is playing right now, in the app's words.
  static func currentRoute() -> String {
    guard let port = AVAudioSession.sharedInstance().currentRoute.outputs.first?.portType else { return "none" }
    switch port {
    case .builtInSpeaker: return "speaker"
    case .builtInReceiver: return "earpiece"
    case .headphones, .usbAudio, .lineOut: return "headset"
    case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE: return "bluetooth"
    case .carAudio: return "car"
    case .airPlay: return "airplay"
    default: return "other"
    }
  }
}
