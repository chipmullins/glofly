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
    guard let file = CallTones.files[name],
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
