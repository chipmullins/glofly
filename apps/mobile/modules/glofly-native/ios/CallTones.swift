import AVFoundation

/// Glofly's in-app sounds on iPhone (message chime, ringtone, outgoing jingle, call chimes).
///
/// Played with AVAudioPlayer and **never touch the audio session**. During a call, LiveKit/WebRTC
/// owns iOS's one shared audio session (play + record, voice processing). Playing these through
/// expo-audio switched that session to its own settings, which took the microphone and speaker
/// away from the call: no audio on either side when an iPhone called out (the outgoing jingle and
/// the "connected" chime land right as the call's audio starts). A plain AVAudioPlayer just plays
/// inside whatever session is already set up.
final class CallTones {
  static let shared = CallTones()

  private static let files: [String: String] = [
    "message": "glofly_message",
    "ringtone": "glofly_ringtone",
    "outgoing": "glofly_outgoing",
    "connected": "glofly_connected",
    "ended": "glofly_ended",
    "noAnswer": "glofly_no_answer",
    "joined": "glofly_joined",
    "left": "glofly_left",
  ]

  /// The repeating sound (ringtone or outgoing jingle), if one is playing.
  private var loop: AVAudioPlayer?
  /// One-off chimes, kept alive until they finish.
  private var chimes: [AVAudioPlayer] = []

  /// Plays a call sound; `repeat` keeps it going until `stop()`. False if the sound is unknown.
  func play(_ name: String, repeat repeating: Bool, volume: Float) -> Bool {
    // The message sound and ringtone are the ones picked in Settings (ToneChoices).
    let picked = name == "message" ? ToneChoices.message() : name == "ringtone" ? ToneChoices.ringtone() : nil
    // 0.7.0: a message sound's own file name (the constellation message sound) plays as itself.
    let named = name.hasPrefix("glofly_msg_") ? name : nil
    guard let file = picked ?? CallTones.files[name] ?? named,
          let url = Bundle.main.url(forResource: file, withExtension: "caf"),
          let player = try? AVAudioPlayer(contentsOf: url)
    else { return false }
    player.volume = max(0, min(1, volume))
    player.numberOfLoops = repeating ? -1 : 0
    player.prepareToPlay()
    if repeating {
      loop?.stop()
      loop = player
    } else {
      chimes.removeAll { !$0.isPlaying }
      chimes.append(player)
    }
    return player.play()
  }

  /// Stops the repeating sound (chimes finish by themselves).
  func stop() {
    loop?.stop()
    loop = nil
  }
}

/// The message sound and ringtone picked in Settings → Notifications & sounds (Oct 13), as .caf
/// names in the app. A phone setting, kept in UserDefaults (it survives signing out). Names that
/// aren't in this build fall back to the originals.
enum ToneChoices {
  private static let defaults = UserDefaults.standard

  private static func valid(_ name: String?, _ fallback: String) -> String {
    guard let name, Bundle.main.url(forResource: name, withExtension: "caf") != nil else { return fallback }
    return name
  }

  static func message() -> String { valid(defaults.string(forKey: "glofly.sound.message"), "glofly_message") }
  static func ringtone() -> String { valid(defaults.string(forKey: "glofly.sound.ringtone"), "glofly_ringtone") }

  /// For CallKit's ringtoneSound (nil = iOS's own ringtone, if even the default is missing).
  static func ringtoneFile() -> String? {
    let name = ringtone()
    return Bundle.main.url(forResource: name, withExtension: "caf") != nil ? name + ".caf" : nil
  }

  static func save(message: String, ringtone: String) {
    defaults.set(message, forKey: "glofly.sound.message")
    defaults.set(ringtone, forKey: "glofly.sound.ringtone")
  }
}
