"""Glofly login "Glo-fly", round 9 (Nov 5, 2026).

Round 7 (re-sung speech) sounded like a real person and round 8 hid the word. Chip pointed at two
round 3 sounds he likes: "Hel-lo (deep)" (low, smooth) and "Glo-fly!" (the app singing its own
name, but high: G5 -> D6). So: round 3's homemade synthetic voice (sung2026.py, no speech engine,
no person) singing "Glo-fly" in Hel-lo (deep)'s smooth style and register, around C4-A4.

Run:  python glofly2026c.py <out-folder>   (numpy + scipy; ffmpeg on PATH)
      python glofly2026c.py --install <repo root>   writes Chip's picks (Nov 5) into the desktop app:
        Duskwing  = deep-long  -> login-duskwing.ogg  (the login default)
        Low glow  = deep-c     -> login-low-glow.ogg
      Every sound is rendered in page order either way, so the files match the preview exactly
      (the voice's breath noise comes from one shared random stream).
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sung2026 as v  # noqa: E402
from signature2026 import SR, celesta, finish, lp, mix, n  # noqa: E402
import soft2026 as soft  # noqa: E402

GLO, FLY = 'g o u -', 'f a i -'
# between round 3's deep (.86) and normal (1.0): smooth, not dark
v.STYLE['warm'] = dict(shift=.93, src='saw', vib=(4.6, .01), breath=.06, chorus=0)
v.STYLE['warmsoft'] = dict(shift=.93, src='tri', vib=(4.6, .01), breath=.12, chorus=0)


def glofly(lo, hi, style='deep', d1=.2, d2=.4, gap=.21):
    return v.sing([(0, GLO, lo, d1), (gap, FLY, hi, d2)], style)


S = []


def sound(sid, name, desc, fn, wet=.22, rt=1.5):
    S.append(dict(id=sid, name=name, desc=desc, fn=fn, wet=wet, rt=rt))


def build():
    # the two he pointed at, for comparison
    sound('ref-hellodeep', 'Reference: Hel-lo (deep)', 'Round 3, the one you liked (C to G).',
          lambda: v.sing([(0, 'h e - l', 'C4', .18), (.19, 'l o u -', 'G4', .4)], 'deep'))
    sound('ref-glofly', 'Reference: Glo-fly!', 'Round 3, the one you liked, but high (G to D, an octave up).',
          lambda: mix([(0, glofly('G5', 'D6', 'normal', .2, .38)), (.22, celesta(n('D7')), .25)]))
    # the new ones
    sound('deep-c', 'Glo-fly (deep)', 'Exactly Hel-lo (deep)\'s voice and notes (C to G), saying "Glo-fly".',
          lambda: glofly('C4', 'G4', 'deep'))
    sound('deep-d', 'Glo-fly (deep, a step up)', 'The same deep voice, one step higher (D to A).',
          lambda: glofly('D4', 'A4', 'deep'))
    sound('warm-c', 'Glo-fly (warm)', 'A touch brighter than deep (C to G): smooth, not dark.',
          lambda: glofly('C4', 'G4', 'warm'))
    sound('warm-e', 'Glo-fly (warm, E to A)', 'Warm voice on a smaller jump (E to A), gentler.',
          lambda: glofly('E4', 'A4', 'warm'))
    sound('deep-sparkle', 'Glo-fly! (deep, with sparkle)', 'Like Glo-fly! with its little celesta, but low and smooth (C to G).',
          lambda: mix([(0, glofly('C4', 'G4', 'deep')), (.24, soft.soften(celesta(n('G5')), 3000), .18)]))
    sound('deep-long', 'Glo-fly (deep, held)', 'Deep voice, "fly" held a little longer so it settles (C to G).',
          lambda: glofly('C4', 'G4', 'deep', .2, .56))
    sound('warm-soft', 'Glo-fly (soft)', 'Warm voice with a softer, breathier tone (D to A).',
          lambda: lp(glofly('D4', 'A4', 'warmsoft'), 3200))
    sound('deep-slide', 'Glo-fly (deep, slide)', '"Fly" slides up into its note instead of jumping (C to G).',
          lambda: v.sing([(0, GLO, 'C4', .2), (.21, FLY, 'E4', .42, 'G4')], 'deep'))


INSTALL = {'deep-long': 'login-duskwing', 'deep-c': 'login-low-glow'}


def install(root):
    import tempfile
    build()
    dst = os.path.join(root, 'apps/desktop/src/renderer/src/assets/sounds')
    tmp = tempfile.mkdtemp()
    for s in S:
        st = finish(s['fn'](), s['wet'], s['rt'], 1.0)
        if s['id'] in INSTALL:
            wav = os.path.join(tmp, INSTALL[s['id']] + '.wav')
            pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
            with wave.open(wav, 'wb') as f:
                f.setnchannels(2)
                f.setsampwidth(2)
                f.setframerate(SR)
                f.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'libopus', '-b:a', '128k',
                            os.path.join(dst, INSTALL[s['id']] + '.ogg')], check=True)
            print('wrote', INSTALL[s['id']] + '.ogg')


def main():
    if sys.argv[1] == '--install':
        return install(sys.argv[2])
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    build()
    manifest = []
    for s in S:
        st = finish(s['fn'](), s['wet'], s['rt'], 1.0)
        path = os.path.join(out, f"login-{s['id']}")
        pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
        with wave.open(path + '.wav', 'wb') as f:
            f.setnchannels(2)
            f.setsampwidth(2)
            f.setframerate(SR)
            f.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', path + '.wav', '-c:a', 'libmp3lame', '-b:a', '128k', path + '.mp3'], check=True)
        manifest.append({'id': s['id'], 'name': s['name'], 'desc': s['desc'], 'secs': round(len(st) / SR, 1)})
        print(s['id'], round(len(st) / SR, 1))
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main()
