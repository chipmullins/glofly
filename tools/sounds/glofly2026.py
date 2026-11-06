"""Glofly login "Glo-fly", round 7 (Nov 5, 2026).

Chip wanted a "Glo-fly" login sound like the others, but: not robotic (the talking-chord vocoder
sounds like a machine), not deep, not high. So:

- Sung, not vocoded: the WORLD vocoder re-sings the word, keeping a little of the word's own
  natural rise and fall (so it isn't stepped notes), a slow vibrato that fades in, and a tiny
  pitch drift. That is what takes the robot out.
- Middle range: everything sits around C4-A4 (about 260-440 Hz), formants left near natural
  (no chipmunk lift, no deep pull).
- Still no particular person: the voice envelope is blurred (cepstral smoothing), breathier, and
  low-passed; most options double it with a second take or blend it with a soft instrument, like
  the round 6 sounds.

Run:  python glofly2026.py <kokoro model folder> <out-folder>
(same needs as talkbox2026.py: kokoro-onnx, pyworld, numpy, scipy, ffmpeg)
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
import talkbox2026 as tb  # noqa: E402

FS = 16000
FP = 5  # ms per WORLD frame


def sing(text='Glow fly.', notes=('D4', 'A4'), voice='af_heart', shift=1.0, breathy=.22, natural=.25,
         lifter=40, glide=10, vib=(4.6, .009), seed=1, cutoff=4200, speed=.8, mid=None):
    """Re-sing the word on a melody, keeping some of its own intonation.

    notes: one note per syllable; mid = an optional note the second syllable passes through first."""
    x = tb.speak(text, voice, speed)
    xs = resample_poly(x, FS, SR).astype(np.float64)
    f0, tt = pw.harvest(xs, FS, frame_period=FP, f0_floor=60, f0_ceil=600)
    sp = pw.cheaptrick(xs, f0, tt, FS)
    ap = pw.d4c(xs, f0, tt, FS)
    cut = tb.syllable_split(x) * FS // SR // (FS * FP // 1000)
    frames = np.arange(len(f0))
    target = np.where(frames < cut, n(notes[0]), n(notes[1])).astype(float)
    if mid is not None:  # second syllable starts on `mid`, then settles on its note
        voiced2 = np.where((frames >= cut) & (f0 > 0))[0]
        if len(voiced2):
            half = voiced2[0] + (voiced2[-1] - voiced2[0]) * 2 // 5
            target[(frames >= cut) & (frames < half)] = n(mid)
    # glide between notes (a sung legato, not a step)
    sm = target.copy()
    for i in range(1, len(sm)):
        sm[i] = sm[i - 1] + (target[i] - sm[i - 1]) / glide
    # keep part of the word's own pitch movement around each syllable's average
    logf = np.log(np.where(f0 > 0, f0, np.nan))
    dev = np.zeros(len(f0))
    for lo, hi in ((0, cut), (cut, len(f0))):
        seg = logf[lo:hi]
        if np.isfinite(seg).any():
            dev[lo:hi] = np.nan_to_num(seg - np.nanmean(seg))
    dev = np.clip(np.convolve(dev, np.ones(9) / 9, 'same'), -.12, .12)
    for lo, hi in ((0, cut), (cut, len(f0))):  # stay centred on the note (in tune)
        v = f0[lo:hi] > 0
        if v.any():
            dev[lo:hi] -= np.mean(dev[lo:hi][v])
    # vibrato that fades in on held parts, and a tiny slow drift
    rng = np.random.default_rng(seed)
    t = tt
    vib_amt = vib[1] * np.clip((t - .12) / .35, 0, 1)
    drift = np.convolve(rng.standard_normal(len(t)), np.ones(40) / 40, 'same') * .004
    newf0 = np.where(f0 > 0, sm * np.exp(dev * natural) * (1 + vib_amt * np.sin(2 * np.pi * vib[0] * t) + drift), 0)
    # blur the envelope (no particular person) and nudge it
    logsp = np.log(sp + 1e-12)
    cep = np.fft.irfft(logsp, axis=1)
    cep[:, lifter:-lifter] = 0
    sp2 = np.exp(np.fft.rfft(cep, axis=1).real)
    bins = sp2.shape[1]
    src = np.clip(np.arange(bins) / shift, 0, bins - 1)
    sp2 = np.array([np.interp(src, np.arange(bins), r) for r in sp2])
    ap2 = np.clip(ap + breathy, 0, .999)
    y = pw.synthesize(newf0, sp2, ap2, FS, FP)
    y = resample_poly(y, SR, FS)
    return soft.soften(lp(y / (np.abs(y).max() + 1e-9), cutoff), cutoff, .02)


def double(a, b, gain_b=.6, delay=.018):
    """Two takes together: warmer and less like one person."""
    d = int(delay * SR)
    out = np.zeros(max(len(a), len(b) + d))
    out[:len(a)] += a
    out[d:d + len(b)] += b * gain_b
    return out / (np.abs(out).max() + 1e-9)


S = []


def sound(sid, name, desc, fn, wet=.3):
    S.append(dict(id=sid, name=name, desc=desc, fn=fn, wet=wet))


def build():
    p = soft.pad
    sound('sung-fifth', 'Glo-fly (sung)', 'A soft sung "Glo-fly" rising a fifth, D to A, with a felt piano under it.',
          lambda: mix([(0, sing(notes=('D4', 'A4'))), (.0, soft.felt(n('D4'), 1.2), .18), (.42, soft.felt(n('A4'), 1.4), .18)]))
    sound('duet', 'Glo-fly (duet)', 'Two soft voices in harmony, a third apart, settling into a warm chord.',
          lambda: mix([(0, sing(notes=('D4', 'A4'), seed=1)), (.012, sing(notes=('F#4', 'C#5'), voice='af_bella', seed=2, natural=.25), .55),
                       (0, p([n('D3'), n('A3')], 1.8, .35, .8), .12)]))
    sound('firefly-lift', 'Glo-fly (firefly lift)', '"Fly" lifts up and settles, like a firefly taking off, with a kalimba twinkle.',
          lambda: mix([(0, sing(notes=('E4', 'G4'), mid='A4', glide=12)), (.62, soft.softkal(n('B5'), 1.4), .16)]))
    sound('warm-double', 'Glo-fly (warm double)', 'The same sung "Glo-fly" twice at once, very slightly apart, for a warm, rounded voice.',
          lambda: mix([(0, double(sing(notes=('C4', 'G4'), seed=3), sing(notes=('C4', 'G4'), voice='af_bella', seed=4, natural=.28)))]))
    sound('breathy-pad', 'Glo-fly (soft breath)', 'Breathier and gentle, floating over a soft pad chord.',
          lambda: mix([(0, p([n('C4'), n('E4'), n('G4')], 1.9, .3, .9), .22), (.05, sing(notes=('E4', 'B4'), breathy=.42, cutoff=3600), .9)]))
    sound('hello-bell', 'Glo-fly (with a bell)', 'A sung "Glo-fly" (D to G) that lands on a soft bell, like the old Glofly hello.',
          lambda: mix([(0, sing(notes=('D4', 'G4'), natural=.4)), (.55, soft.softbell(n('G5'), 2.0, 1.1), .2), (.55, soft.softbell(n('D5'), 2.0, 1.1), .12)]))
    sound('three-note', 'Glo-o-fly', 'A little three-note "Glo-o-fly": up, a step more, then home.',
          lambda: mix([(0, sing(notes=('C4', 'G4'), mid='A4', glide=9, natural=.3)), (0, soft.felt(n('C4'), 1.0), .14),
                       (.4, soft.felt(n('A4'), .6), .12), (.62, soft.felt(n('G4'), 1.2), .14)]))
    sound('choir', 'Glo-fly (soft choir)', 'Three quiet voices together, like a tiny choir, on a gentle rising fifth.',
          lambda: mix([(0, sing(notes=('D4', 'A4'), seed=5)), (.01, sing(notes=('A3', 'E4'), voice='af_bella', seed=6), .45),
                       (.02, sing(notes=('F#4', 'D5'), voice='af_nicole', seed=7, breathy=.35), .35)]))


def main():
    tb.kokoro = None
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
