// Makes the phone copies of the pickable sounds (@glofly/shared src/sounds.ts) from the desktop
// app's files: apps/mobile/assets/sounds (in-app), Android res/raw (.ogg) and iPhone .caf
// (IMA4, 22.05 kHz mono; ringtones looped to ~22–24 s since an iPhone notification sound plays
// once). Needs ffmpeg. Run from the repo root after adding a sound to the list:
//   node apps/mobile/scripts/phone-sounds.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, copyFileSync, mkdirSync } from 'node:fs'
const root = process.argv[2] ?? process.cwd()
const src = `${root}/apps/desktop/src/renderer/src/assets/sounds`
const raw = `${root}/apps/mobile/modules/glofly-native/android/src/main/res/raw`
const ios = `${root}/apps/mobile/modules/glofly-native/ios/sounds`
const app = `${root}/apps/mobile/assets/sounds`
// Read the list straight from the shared TS source (simple regex; it's our own file).
import { readFileSync } from 'node:fs'
const ts = readFileSync(`${root}/packages/shared/src/sounds.ts`, 'utf8')
const re = /\{ id: '([^']+)', label: '[^']+', file: '([^']+)', native: '([^']+)' \}/g
const ringStart = ts.indexOf('PHONE_RINGTONES')
let m
const dur = (f) => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString())
while ((m = re.exec(ts))) {
  const [, id, file, native] = m
  const ring = m.index > ringStart
  const inFile = `${src}/${file}.ogg`
  if (!existsSync(inFile)) throw new Error(`missing ${inFile}`)
  // In-app copy (expo-audio plays these on Android and the web preview).
  if (!existsSync(`${app}/${file}.ogg`)) copyFileSync(inFile, `${app}/${file}.ogg`)
  if (native === 'glofly_message' || native === 'glofly_ringtone') continue // shipped already
  copyFileSync(inFile, `${raw}/${native}.ogg`)
  // iPhone: IMA4 .caf, 22.05 kHz mono (like the existing ones). Ringtones are looped to ~24 s,
  // since an iPhone notification sound plays once (max 30 s) and CallKit plays it as given.
  const args = ['-y', '-v', 'error']
  if (ring) {
    const d = dur(inFile)
    const loops = d > 20 ? 0 : Math.max(1, Math.floor(24 / d)) - 1
    args.push('-stream_loop', String(loops))
  }
  args.push('-i', inFile, '-ac', '1', '-ar', '22050', '-c:a', 'adpcm_ima_qt', '-t', '29', `${ios}/${native}.caf`)
  execFileSync('ffmpeg', args)
  console.log(native, ring ? 'ring' : 'msg', dur(`${ios}/${native}.caf`).toFixed(1))
}
