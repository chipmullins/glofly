// Glofly's sounds. Each one is a placeholder until the sound file is ready.
//
// To add one: put the file in src/renderer/src/assets/sounds/ (e.g. message.mp3),
// then import it here and play it, for example:
//
//   import messageSound from '../assets/sounds/message.mp3'
//   const files = { message: messageSound, ... }
//   new Audio(files[name]).play()
//
// Everywhere in the app that should make a sound already calls playSound().

export type SoundName =
  | 'message' // a message arrives
  | 'friendRequest' // someone sends you a friend request
  | 'login' // the firefly takeoff finishes

// While you're set to Do not disturb, Glofly stays silent.
let quiet = false
export function setQuiet(value: boolean): void {
  quiet = value
}

export function playSound(name: SoundName): void {
  if (quiet) return
  void name // no sound files yet
}
