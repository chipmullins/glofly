"""Glofly login "Glo-fly", round 8 (Nov 5, 2026).

Round 7 (sung) was too intense and too much like a real person. The feedback: the word should come through when you
really listen, not up front. So here the instrument leads and the word is only a ghost:

- The word's shape comes from a vocoder with few, wide bands (8-12), so only the vowel movement
  "oh" -> "eye" and a soft breath for the F survive. No voice, no person.
- Its carrier is a mellow, low-passed tone (few harmonics), not a buzzy saw.
- That ghost is mixed quietly under, or blended into, a soft instrument playing the same two notes
  (felt piano, pad, kalimba, bell, ocarina-like tone), middle range around C4-A4.

Run:  python glofly2026b.py <kokoro model folder> <out-folder>
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from signature2026 import SR, lp, mix, n, synth, tone  # noqa: E402
import soft2026 as soft  # noqa: E402
import talkbox2026 as tb  # noqa: E402


def mellow(length, notes_at, harmonics=10, cutoff=2200, chord=(0,), air=.02):
    """A soft, rounded carrier: few harmonics, low-passed, gentle note joins."""
    out = np.zeros(length)
    for i, (start, f) in enumerate(notes_at):
        end = notes_at[i + 1][0] if i + 1 < len(notes_at) else length
        seg = np.zeros(end - start)
        for s in chord:
            ff = f * 2 ** (s / 12)
            for cents in (-4, 4):
                seg += synth(np.full(len(seg), ff * 2 ** (cents / 1200)), 'saw', None, harmonics) / len(chord)
        ramp = min(900, len(seg) // 3)
        seg[:ramp] *= np.linspace(0, 1, ramp)
        seg[-ramp:] *= np.linspace(1, 0, ramp)
        out[start:end] += seg
    out = lp(out, cutoff)
    return out + np.random.default_rng(3).standard_normal(length) * air


def ghost(notes=('D4', 'A4'), bands=10, harmonics=10, cutoff=2200, chord=(0,), air=.02, voice='af_heart', speed=.78):
    """The faint word: 'Glow fly' shape on a mellow tone. Returns (signal, seconds where 'fly' starts)."""
    x = tb.speak('Glow fly.', voice, speed)
    cut = tb.syllable_split(x)
    c = mellow(len(x), [(0, n(notes[0])), (cut, n(notes[1]))], harmonics, cutoff, chord, air)
    y = tb.vocode(x, c, bands=bands, nper=2048)
    y = lp(y, cutoff)
    # round the edges so it eases in and out
    a = int(.04 * SR)
    y[:a] *= np.linspace(0, 1, a)
    y[-a * 2:] *= np.linspace(1, 0, a * 2)
    return y / (np.abs(y).max() + 1e-9), cut / SR


def ocarina(f, dur, a=.06, tau=.5):
    """A breathy round flute-ish note."""
    w = tone(f, dur, None, 'sine', a, tau, vib=(4.5, .004))
    w += .08 * tone(2 * f, dur, None, 'sine', a, tau * .6)
    br = lp(np.random.default_rng(int(f)).standard_normal(len(w)), 1800) * .03 * np.exp(-np.arange(len(w)) / SR / .15)
    return soft.soften(w + br, 2400, a)


S = []


def sound(sid, name, desc, fn, wet=.3):
    S.append(dict(id=sid, name=name, desc=desc, fn=fn, wet=wet))


def two(fn, notes, at, gain=1.0, **kw):
    return [(0, fn(n(notes[0]), **kw), gain), (at, fn(n(notes[1]), **kw), gain)]


def build():
    p = soft.pad

    def felt_hint():
        g, at = ghost(('D4', 'A4'), bands=10)
        return mix(two(soft.felt, ('D4', 'A4'), at, 1.0, dur=1.6) + [(0, g, .32)])
    sound('felt-hint', 'Felt piano, hint of "Glo-fly"', 'Two felt-piano notes (D, A). The word is tucked underneath, quiet.', felt_hint)

    def pad_hint():
        g, at = ghost(('C4', 'G4'), bands=9, chord=(0, 7))
        return mix([(0, p([n('C4'), n('G4')], 1.9, .3, .8), .55), (0, g, .5)])
    sound('pad-hint', 'Warm pad, hint of "Glo-fly"', 'A soft pad chord that very gently opens like it says "Glo-fly".', pad_hint)

    def kal_hint():
        g, at = ghost(('E4', 'B4'), bands=10)
        return mix(two(soft.softkal, ('E4', 'B4'), at, 1.0) + [(.45 + at, soft.softkal(n('E5')), .4), (0, g, .28)])
    sound('kalimba-hint', 'Kalimba, hint of "Glo-fly"', 'Kalimba notes (E, B, E) with a faint "Glo-fly" under them.', kal_hint)

    def ocarina_hint():
        g, at = ghost(('D4', 'G4'), bands=8, harmonics=6, cutoff=1800)
        return mix(two(ocarina, ('D4', 'G4'), at, 1.0, dur=1.3) + [(0, g, .4)])
    sound('ocarina-hint', 'Soft flute, hint of "Glo-fly"', 'A breathy flute-like tone, two notes, the word barely shaping it.', ocarina_hint)

    def bell_hint():
        g, at = ghost(('D4', 'A4'), bands=10)
        return mix(two(soft.softbell, ('D5', 'A4'), at, .7, dur=2.2, tau=1.2) + [(0, g, .4)])
    sound('bell-hint', 'Soft bells, hint of "Glo-fly"', 'Two soft bells with the faint word between them.', bell_hint)

    def blend():
        g, at = ghost(('D4', 'A4'), bands=12, chord=(0, 7))
        return mix([(0, g, .55), (0, p([n('D4'), n('A4')], 1.8, .35, .8), .45), (at + .05, soft.felt(n('A4'), 1.4), .35)])
    sound('blend', 'Glo-fly blend', 'The word and a pad blended as one soft sound, a bit clearer than the others.', blend)

    def whisper_only():
        g, at = ghost(('C4', 'G4'), bands=8, harmonics=6, cutoff=1600, air=.06)
        return mix(two(soft.felt, ('C4', 'G4'), at, 1.0, dur=1.6) + [(0, p([n('C3'), n('G3')], 1.8, .3, .8), .15), (0, g, .22)])
    sound('faintest', 'Faintest "Glo-fly"', 'Felt piano first; the word is only there if you listen for it.', whisper_only)


def main():
    from kokoro_onnx import Kokoro
    model_dir, out = sys.argv[1], sys.argv[2]
    tb.kokoro = Kokoro(os.path.join(model_dir, 'kokoro.int8.onnx'), os.path.join(model_dir, 'voices.bin'))
    os.makedirs(out, exist_ok=True)
    build()
    manifest = []
    for s in S:
        st = soft.finish_soft(s['fn'](), s['wet'], 1.0)
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
