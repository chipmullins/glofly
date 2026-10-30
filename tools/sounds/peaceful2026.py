"""Glofly peaceful words, round 7 (Oct 30, 2026): more "Glo-fly" (log in) and "Good-bye" (log off).

Chip picked "Glo-fly (hummed)" from talkbox2026.py as the login default and wants more like it:
pretty, peaceful, not loud, the words still just about clear. Same method as the hummed one
(the word's shape from Kokoro, re-sung by the WORLD vocoder on a melody, its envelope blurred so it's
no particular person, breathy), plus: two- and three-voice harmonies, slower and whispery takes,
and soft instruments around it (pads, felt piano, kalimba, bells, a little wind). Everything is
mixed about 3 dB quieter than round 6.

Run:  python peaceful2026.py <kokoro model folder> <out-folder>
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np
import pyworld as pw
from scipy.signal import resample_poly

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from signature2026 import SR, lp, mix, n  # noqa: E402
import soft2026 as soft  # noqa: E402

kokoro = None
_said = {}


def speak(text, voice='af_heart', speed=0.85):
    key = (text, voice, speed)
    if key not in _said:
        audio, sr = kokoro.create(text, voice=voice, speed=speed, lang='en-us')
        x = np.asarray(audio, dtype=np.float64)
        x = x / (np.abs(x).max() + 1e-9)
        env = np.convolve(np.abs(x), np.ones(240) / 240, 'same')
        idx = np.where(env > 0.02)[0]
        x = x[max(0, idx[0] - 240): idx[-1] + 480]
        _said[key] = resample_poly(x, SR, sr)
    return _said[key]


def split_at(x):
    """Where the second syllable starts: the deepest energy dip in the middle of the word."""
    env = np.convolve(np.abs(x), np.ones(1323) / 1323, 'same')
    a, b = int(len(x) * .25), int(len(x) * .7)
    return a + int(np.argmin(env[a:b]))


def sing(text, notes, voice='af_heart', speed=0.85, shift=1.08, breathy=.35, cutoff=3600, glide=8,
         vibrato=.008, blur=30):
    """The word re-sung on two notes (one per syllable), no particular person, a little breathy."""
    x = speak(text, voice, speed)
    xs = resample_poly(x, 16000, SR).astype(np.float64)
    fs = 16000
    f0, tt = pw.harvest(xs, fs, frame_period=5, f0_floor=60, f0_ceil=600)
    sp = pw.cheaptrick(xs, f0, tt, fs)
    ap = pw.d4c(xs, f0, tt, fs)
    cut = split_at(x) * fs // SR // 80
    melody = np.where(np.arange(len(f0)) < cut, n(notes[0]), n(notes[1]))
    sm = melody.astype(float).copy()
    for i in range(1, len(sm)):
        sm[i] = sm[i - 1] + (melody[i] - sm[i - 1]) / glide
    sm *= 1 + vibrato * np.sin(2 * np.pi * 4.5 * tt)
    newf0 = np.where(f0 > 0, sm, 0)
    logsp = np.log(sp + 1e-12)
    cep = np.fft.irfft(logsp, axis=1)
    cep[:, blur:-blur] = 0
    sp2 = np.exp(np.fft.rfft(cep, axis=1).real)
    bins = sp2.shape[1]
    src = np.clip(np.arange(bins) / shift, 0, bins - 1)
    sp2 = np.array([np.interp(src, np.arange(bins), r) for r in sp2])
    ap2 = np.clip(ap + breathy, 0, .999)
    y = pw.synthesize(newf0, sp2, ap2, fs, 5)
    y = resample_poly(y, SR, fs)
    return soft.soften(lp(y / (np.abs(y).max() + 1e-9), cutoff), cutoff, .02)


def choir(text, chords, gains=None, **kw):
    """Several hummed voices together: chords = [(note1, note2) for each voice]."""
    gains = gains or [1.0] + [.55] * (len(chords) - 1)
    parts = []
    for i, (notes, g) in enumerate(zip(chords, gains)):
        # each voice a touch different so they blend instead of phasing
        parts.append((i * .012, sing(text, notes, shift=kw.get('shift', 1.08) * (1 + .02 * i),
                                     breathy=kw.get('breathy', .35) + .05 * i,
                                     voice=kw.get('voice', 'af_heart'), speed=kw.get('speed', .85)), g))
    return mix(parts)


S = {}


def sound(event, sid, name, desc, fn, wet=.34):
    S.setdefault(event, []).append(dict(id=sid, name=name, desc=desc, fn=fn, wet=wet))


def build():
    p, bell, kal, felt = soft.pad, soft.softbell, soft.softkal, soft.felt
    G, B = 'Glow fly.', 'Good bye.'

    # ---------------------------------------------------------------- Log in: "Glo-fly"
    sound('login', 'pf-glofly-duet', 'Glo-fly duet', 'Two soft hummed voices in harmony, a third apart.',
          lambda: choir(G, [('G4', 'D5'), ('B4', 'F#5')]))
    sound('login', 'pf-glofly-choir', 'Glo-fly choir', 'Three hummed voices singing a gentle chord.',
          lambda: mix([(0, p([n('C4'), n('G4')], 1.8, .4, .8), .18),
                       (.05, choir(G, [('E4', 'B4'), ('G4', 'D5'), ('C4', 'G4')], [1, .5, .4]))]))
    sound('login', 'pf-glofly-lullaby', 'Glo-fly lullaby', 'A low, slow hum with a soft felt-piano chord.',
          lambda: mix([(0, felt(n('C4'), 2.2), .35), (0, felt(n('G4'), 2.2), .25),
                       (.08, sing(G, ['E4', 'G4'], speed=.72, breathy=.42))]))
    sound('login', 'pf-glofly-kalimba', 'Glo-fly and kalimba', 'A hummed "Glo-fly" answered by a kalimba playing the same two notes.',
          lambda: mix([(0, sing(G, ['G4', 'D5'])), (.75, kal(n('G5')), .28), (.95, kal(n('D6')), .22)]))
    sound('login', 'pf-glofly-dawn', 'Glo-fly at dawn', 'A slow pad swells, then a warm hummed "Glo-fly" rises over it.',
          lambda: mix([(0, p([n('F3'), n('C4'), n('A4')], 2.4, .7, 1.1), .3),
                       (.35, sing(G, ['F4', 'C5'], speed=.78)), (1.05, bell(n('C6'), 2.0), .14)]))
    sound('login', 'pf-glofly-whisper', 'Glo-fly whisper', 'Mostly air, very quiet: a whispered hum over a warm chord.',
          lambda: mix([(0, p([n('D4'), n('A4'), n('F#5')], 1.8, .35, .8), .3),
                       (.05, sing(G, ['F#4', 'C#5'], voice='af_nicole', breathy=.7))]))
    sound('login', 'pf-glofly-light', 'Glo-fly (light)', 'Higher and lighter, like a small happy hum, with one bell.',
          lambda: mix([(0, sing(G, ['C5', 'G5'], shift=1.14, breathy=.4)), (.55, bell(n('E6'), 1.8), .16)]))
    sound('login', 'pf-glofly-breeze', 'Glo-fly on the breeze', 'A soft gust of wind carrying a hummed "Glo-fly".',
          lambda: mix([(0, soft.breath(1.6, 400, 1400), .35),
                       (.15, sing(G, ['A4', 'E5'], breathy=.5, speed=.8))]))
    sound('login', 'pf-glofly-warm', 'Glo-fly (warm)', 'A deeper, warmer hum with a slow glide between the notes.',
          lambda: mix([(0, p([n('A3'), n('E4')], 1.8, .4, .8), .2),
                       (.03, sing(G, ['C#4', 'A4'], voice='af_bella', shift=1.0, glide=14))]))
    sound('login', 'pf-glofly-echo', 'Glo-fly echo', 'A hummed "Glo-fly", then a quieter echo of it, further away.',
          lambda: mix([(0, sing(G, ['G4', 'D5'])),
                       (.9, lp(sing(G, ['G4', 'D5'], breathy=.55), 1800), .3)]))

    # ---------------------------------------------------------------- Log off: "Good-bye"
    sound('logoff', 'pf-goodbye-duet', 'Good-bye duet', 'Two soft hummed voices in harmony, stepping down.',
          lambda: choir(B, [('A4', 'E4'), ('C#5', 'G#4')]))
    sound('logoff', 'pf-goodbye-choir', 'Good-bye choir', 'Three hummed voices settling into a gentle chord.',
          lambda: mix([(0, p([n('A3'), n('E4')], 1.9, .4, .9), .18),
                       (.05, choir(B, [('E5', 'C5'), ('C5', 'A4'), ('A4', 'E4')], [1, .5, .4]))]))
    sound('logoff', 'pf-goodbye-lullaby', 'Good-bye lullaby', 'A low, slow "Good-bye" with a soft felt-piano chord.',
          lambda: mix([(0, felt(n('F3'), 2.2), .3), (0, felt(n('C4'), 2.2), .22),
                       (.08, sing(B, ['A4', 'F4'], speed=.72, breathy=.42))]))
    sound('logoff', 'pf-goodbye-kalimba', 'Good-bye and kalimba', 'A hummed "Good-bye", then a kalimba playing it back softly.',
          lambda: mix([(0, sing(B, ['D5', 'A4'])), (.75, kal(n('D5')), .25), (.95, kal(n('A4')), .22)]))
    sound('logoff', 'pf-goodbye-dusk', 'Good-bye at dusk', 'A warm "Good-bye" that fades into a slow, dimming pad.',
          lambda: mix([(0, sing(B, ['E5', 'B4'], speed=.78)),
                       (.25, p([n('E3'), n('B3'), n('G#4')], 2.4, .5, 1.2), .28)]))
    sound('logoff', 'pf-goodbye-whisper', 'Good-bye whisper', 'Mostly air, very quiet: a whispered "Good-bye".',
          lambda: mix([(0, p([n('G3'), n('D4'), n('B4')], 1.8, .35, .8), .28),
                       (.05, sing(B, ['D5', 'B4'], voice='af_nicole', breathy=.7))]))
    sound('logoff', 'pf-goodbye-light', 'Good-bye (light)', 'A lighter, higher hum with a soft bell at the end.',
          lambda: mix([(0, sing(B, ['G5', 'D5'], shift=1.14, breathy=.4)), (.55, bell(n('G5'), 1.8), .14)]))
    sound('logoff', 'pf-goodbye-breeze', 'Good-bye on the breeze', 'A hummed "Good-bye" drifting off on a soft gust of wind.',
          lambda: mix([(0, sing(B, ['C5', 'G4'], breathy=.5, speed=.8)),
                       (.3, soft.breath(1.6, 1400, 350), .32)]))
    sound('logoff', 'pf-goodbye-warm', 'Good-bye (warm)', 'A deeper, warmer hum gliding slowly down.',
          lambda: mix([(0, p([n('D3'), n('A3')], 1.8, .4, .8), .2),
                       (.03, sing(B, ['A4', 'D4'], voice='af_bella', shift=1.0, glide=14))]))
    sound('logoff', 'pf-goodbye-echo', 'Good-bye echo', 'A hummed "Good-bye", then a quieter echo of it, further away.',
          lambda: mix([(0, sing(B, ['A4', 'E4'])),
                       (.9, lp(sing(B, ['A4', 'E4'], breathy=.55), 1800), .3)]))


def build_warm():
    """Round 7b (Oct 30, 2026): Chip liked "Glo-fly (warm)" and found the rest squeaky. So: lower
    notes (A3-A4, an alto's range), formants left where they are or lowered a little (shift <= 1.0, no
    chipmunk), less vibrato, softer top end, slow glides."""
    p, bell, kal, felt = soft.pad, soft.softbell, soft.softkal, soft.felt
    G, B = 'Glow fly.', 'Good bye.'

    def w(text, notes, **kw):
        kw.setdefault('voice', 'af_bella')
        kw.setdefault('shift', .97)
        kw.setdefault('glide', 14)
        kw.setdefault('vibrato', .005)
        kw.setdefault('cutoff', 3000)
        kw.setdefault('breathy', .32)
        return sing(text, notes, **kw)

    def wduet(text, a, b, **kw):
        return mix([(0, w(text, a, **kw)), (.015, w(text, b, shift=kw.get('shift', .97) * .98, breathy=.4), .5)])

    # Log in
    sound('loginwarm', 'wm-glofly-warm', 'Glo-fly Warm (your favorite)', 'The one you liked: a deeper, warmer hum with a slow glide.',
          lambda: mix([(0, p([n('A3'), n('E4')], 1.8, .4, .8), .2),
                       (.03, sing(G, ['C#4', 'A4'], voice='af_bella', shift=1.0, glide=14))]))
    sound('loginwarm', 'wm-glofly-low', 'Glo-fly Low', 'Lower still, calm and round, over a soft pad.',
          lambda: mix([(0, p([n('F3'), n('C4')], 1.9, .4, .9), .2), (.03, w(G, ['A3', 'F4'], shift=.94))]))
    sound('loginwarm', 'wm-glofly-duet', 'Glo-fly Warm Duet', 'Two low hums in harmony, like two friends.',
          lambda: mix([(0, p([n('A3'), n('E4')], 1.8, .4, .8), .16), (.03, wduet(G, ['C#4', 'A4'], ['A3', 'E4']))]))
    sound('loginwarm', 'wm-glofly-felt', 'Glo-fly Fireside', 'A warm hum with a soft felt-piano chord, like a fireplace.',
          lambda: mix([(0, felt(n('C3'), 2.4), .3), (0, felt(n('G3'), 2.4), .22), (0, felt(n('E4'), 2.4), .16),
                       (.1, w(G, ['C4', 'G4']))]))
    sound('loginwarm', 'wm-glofly-velvet', 'Glo-fly Velvet', 'The deepest one: a low, velvety hum.',
          lambda: mix([(0, p([n('D3'), n('A3')], 2.0, .45, .9), .18), (.03, w(G, ['G3', 'D4'], shift=.92, breathy=.38))]))
    sound('loginwarm', 'wm-glofly-glow', 'Glo-fly Glow', 'A warm hum that rises slowly and blooms into a low bell.',
          lambda: mix([(0, w(G, ['B3', 'F#4'], glide=22)), (.8, bell(n('F#4'), 2.2), .16)]))
    sound('loginwarm', 'wm-glofly-kalimba', 'Glo-fly Warm Kalimba', 'A warm hum, then a low kalimba answering softly.',
          lambda: mix([(0, w(G, ['C4', 'G4'])), (.8, kal(n('C4')), .22), (1.0, kal(n('G4')), .2)]))
    sound('loginwarm', 'wm-glofly-hush', 'Glo-fly Hush', 'Very soft and breathy, low, like saying it under your breath.',
          lambda: mix([(0, p([n('E3'), n('B3'), n('G#4')], 1.9, .4, .8), .24), (.04, w(G, ['B3', 'G#4'], breathy=.55))]))
    sound('loginwarm', 'wm-glofly-sway', 'Glo-fly Sway', 'Three low notes, Glo-o-fly, gently swaying.',
          lambda: mix([(0, p([n('G3'), n('D4')], 2.0, .4, .9), .18), (.03, w('Glow, oh fly.', ['D4', 'B4'], speed=.8, glide=18))]))
    sound('loginwarm', 'wm-glofly-echo', 'Glo-fly Warm Echo', 'A warm hum, then a softer, farther echo.',
          lambda: mix([(0, w(G, ['C#4', 'A4'])), (.95, lp(w(G, ['C#4', 'A4'], breathy=.5), 1500), .28)]))

    # Log off
    sound('logoffwarm', 'wm-goodbye-warm', 'Good-bye Warm', 'Same voice as your favorite: a deeper, warmer hum gliding down.',
          lambda: mix([(0, p([n('D3'), n('A3')], 1.8, .4, .8), .2),
                       (.03, sing(B, ['A4', 'D4'], voice='af_bella', shift=1.0, glide=14))]))
    sound('logoffwarm', 'wm-goodbye-low', 'Good-bye Low', 'Lower still, calm and round, settling down.',
          lambda: mix([(0, p([n('F3'), n('C4')], 1.9, .4, .9), .2), (.03, w(B, ['F4', 'A3'], shift=.94))]))
    sound('logoffwarm', 'wm-goodbye-duet', 'Good-bye Warm Duet', 'Two low hums in harmony, waving off together.',
          lambda: mix([(0, p([n('D3'), n('A3')], 1.8, .4, .8), .16), (.03, wduet(B, ['A4', 'D4'], ['F#4', 'A3']))]))
    sound('logoffwarm', 'wm-goodbye-felt', 'Good-bye Fireside', 'A warm hum with a soft felt-piano chord.',
          lambda: mix([(0, felt(n('F3'), 2.4), .28), (0, felt(n('C4'), 2.4), .2), (.1, w(B, ['A4', 'F4']))]))
    sound('logoffwarm', 'wm-goodbye-velvet', 'Good-bye Velvet', 'The deepest one: a low, velvety good-bye.',
          lambda: mix([(0, p([n('G3'), n('D3')], 2.0, .45, .9), .18), (.03, w(B, ['D4', 'G3'], shift=.92, breathy=.38))]))
    sound('logoffwarm', 'wm-goodbye-dusk', 'Good-bye Dusk', 'A warm hum fading into a slow, dimming pad.',
          lambda: mix([(0, w(B, ['E4', 'B3'], glide=22)), (.3, p([n('E3'), n('B3'), n('G#4')], 2.2, .5, 1.1), .24)]))
    sound('logoffwarm', 'wm-goodbye-kalimba', 'Good-bye Warm Kalimba', 'A warm hum, then a low kalimba playing it back.',
          lambda: mix([(0, w(B, ['G4', 'C4'])), (.8, kal(n('G4')), .2), (1.0, kal(n('C4')), .22)]))
    sound('logoffwarm', 'wm-goodbye-hush', 'Good-bye Hush', 'Very soft and breathy, low, like a whispered good night.',
          lambda: mix([(0, p([n('A3'), n('E4')], 1.9, .4, .8), .24), (.04, w(B, ['E4', 'A3'], breathy=.55))]))
    sound('logoffwarm', 'wm-goodbye-sleepy', 'Good-bye Sleepy', 'A slow, sleepy good-bye drifting down.',
          lambda: mix([(0, w(B, ['D4', 'G3'], speed=.7, glide=20)), (.6, felt(n('G3'), 2.0), .2)]))
    sound('logoffwarm', 'wm-goodbye-echo', 'Good-bye Warm Echo', 'A warm good-bye, then a softer, farther echo.',
          lambda: mix([(0, w(B, ['A4', 'D4'])), (.95, lp(w(B, ['A4', 'D4'], breathy=.5), 1500), .28)]))


def main():
    global kokoro
    from kokoro_onnx import Kokoro
    model_dir, out = sys.argv[1], sys.argv[2]
    kokoro = Kokoro(os.path.join(model_dir, 'kokoro.int8.onnx'), os.path.join(model_dir, 'voices.bin'))
    os.makedirs(out, exist_ok=True)
    (build_warm if '--warm' in sys.argv else build)()
    manifest = {}
    for eid, items in S.items():
        manifest[eid] = []
        for s in items:
            st = soft.finish_soft(s['fn'](), s['wet'], 0.72)  # ~3 dB quieter than round 6
            path = os.path.join(out, f"{eid}-{s['id']}")
            pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
            with wave.open(path + '.wav', 'wb') as f:
                f.setnchannels(2)
                f.setsampwidth(2)
                f.setframerate(SR)
                f.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', path + '.wav',
                            '-c:a', 'libmp3lame', '-b:a', '128k', path + '.mp3'], check=True)
            manifest[eid].append({'id': s['id'], 'name': s['name'], 'desc': s['desc'], 'secs': round(len(st) / SR, 1)})
            print(eid, s['id'], round(len(st) / SR, 1), flush=True)
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main()
