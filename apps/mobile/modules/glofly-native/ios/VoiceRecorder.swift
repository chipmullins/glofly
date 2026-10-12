import AVFoundation
import ExpoModulesCore

final class MicDeniedException: Exception {
  override var code: String { "ERR_MIC_DENIED" }
  override var reason: String { "Glofly isn't allowed to use the microphone" }
}

final class RecordingFailedException: Exception {
  override var reason: String { "Couldn't start recording" }
}

/// Voice messages on iPhone: AAC in an .m4a file (iPhones can't record Opus). The server accepts
/// it, the desktop app plays it, and Android plays it natively.
final class VoiceRecorder {
  private var recorder: AVAudioRecorder?
  private var file: URL?

  func start(_ done: @escaping (Exception?) -> Void) {
    let session = AVAudioSession.sharedInstance()
    session.requestRecordPermission { granted in
      DispatchQueue.main.async {
        guard granted else { return done(MicDeniedException()) }
        do {
          self.cancel()
          try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
          try session.setActive(true)
          let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(UUID().uuidString).m4a")
          let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 24_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32_000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
          ]
          let r = try AVAudioRecorder(url: url, settings: settings)
          r.isMeteringEnabled = true
          guard r.record() else { throw RecordingFailedException() }
          self.recorder = r
          self.file = url
          done(nil)
        } catch {
          done(RecordingFailedException())
        }
      }
    }
  }

  /// 0–1, how loud the microphone is right now (for the live waveform).
  func level() -> Double {
    guard let r = recorder, r.isRecording else { return 0 }
    r.updateMeters()
    let db = Double(r.averagePower(forChannel: 0))
    return min(1, pow(10, db / 20) * 1.4)
  }

  func stop() -> [String: Any]? {
    guard let r = recorder, let url = file else { return nil }
    let durationMs = Int(r.currentTime * 1000)
    r.stop()
    recorder = nil
    file = nil
    deactivate()
    let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
    guard size > 0 else { return nil }
    return ["uri": url.absoluteString, "durationMs": durationMs, "mime": "audio/mp4", "size": size]
  }

  func cancel() {
    guard let r = recorder else { return }
    r.stop()
    r.deleteRecording()
    recorder = nil
    file = nil
    deactivate()
  }

  private func deactivate() {
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
