"""Glofly "talkbox" words (Oct 30, 2026): soft instruments that say "Glo-fly" and "Good-bye".

The homemade voice (sung2026.py) couldn't make the consonants ("Glo-fly" came out like "go die"),
and a real speech voice (round 4) sounded too much like a person. This takes the middle road, the
way a talkbox or vocoder works: a speech engine (Kokoro, open source) says the word only so the
SHAPE of the word can be measured; that shape is then played by a soft instrument (a warm synth
pad, a hum, a breath) on a little melody. The words stay clear, and no person is heard.

Two methods:
- vocoder: the word's spectral shape, in ~24 bands, filters a soft pad chord (notes per syllable).
- world: the word re-sung by the WORLD vocoder on a melody, its envelope blurred (no voice
  identity), made breathy, then softened.

Run:  python talkbox2026.py <kokoro model folder> <out-folder>
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np
import pyworld as pw
from scipy.signal import resample_poly, stft, istft

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from signature2026 import SR, T, lp, mix, n, noise, synth  # noqa: E402
import soft2026 as soft  # noqa: E402

kokoro = None


def speak(text, voice='af_heart', speed=0.85):
    audio, sr = kokoro.create(text, voice=voice, speed=speed, lang='en-us')
    x = np.asarray(audio, dtype=np.float64)
    x = x / (np.abs(x).max() + 1e-9)
    # trim silence
    env = np.convolve(np.abs(x), np.ones(240) / 240, 'same')
    idx = np.where(env > 0.02)[0]
    x = x[max(0, idx[0] - 240): idx[-1] + 480]
    return resample_poly(x, SR, sr)


def syllable_split(x):
    """Where the second syllable starts: the deepest energy dip in the middle part of the word."""
    env = np.convolve(np.abs(x), np.ones(1323) / 1323, 'same')
    a, b = int(len(x) * .25), int(len(x) * .7)
    return a + int(np.argmin(env[a:b]))


def carrier(length, notes_at, kind='pad'):
    """A soft rich tone: notes_at = [(start sample, [freqs])]."""
    out = np.zeros(length)
    for i, (start, freqs) in enumerate(notes_at):
        end = notes_at[i + 1][0] if i + 1 < len(notes_at) else length
        seg = np.zeros(end - start)
        for f in freqs:
            for cents in (-7, 0, 6):
                ff = f * 2 ** (cents / 1200)
                seg += synth(np.full(len(seg), ff), 'saw', None, 40) / len(freqs)
        if kind == 'hum':
            seg = seg * .6 + np.random.default_rng(8).standard_normal(len(seg)) * .02
        # soft joins between notes
        ramp = min(400, len(seg) // 4)
        seg[:ramp] *= np.linspace(0, 1, ramp)
        seg[-ramp:] *= np.linspace(1, 0, ramp)
        out[start:end] += seg
    return out + np.random.default_rng(7).standard_normal(length) * 0.04  # a little air so F / S / H come through


def vocode(speech, carrier_sig, bands=24, nper=1024):
    f, t, S = stft(speech, SR, nperseg=nper, noverlap=nper * 3 // 4)
    _, _, C = stft(carrier_sig[:len(speech)], SR, nperseg=nper, noverlap=nper * 3 // 4)
    edges = np.geomspace(80, 9000, bands + 1)
    gainS = np.zeros_like(np.abs(S))
    gainC = np.ones_like(np.abs(C))
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = (f >= lo) & (f < hi)
        if not sel.any():
            continue
        gainS[sel] = np.sqrt(np.mean(np.abs(S[sel]) ** 2, axis=0, keepdims=True))
        gainC[sel] = np.sqrt(np.mean(np.abs(C[sel]) ** 2, axis=0, keepdims=True)) + 1e-6
    # smooth the band envelopes a little over time
    k = np.ones(3) / 3
    gainS = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 1, gainS)
    Y = np.nan_to_num(C / gainC * gainS)
    _, y = istft(Y, SR, nperseg=nper, noverlap=nper * 3 // 4)
    return y / (np.abs(y).max() + 1e-9)


def talk(text, notes, kind='pad', voice='af_heart', cutoff=4200, chord=(0,)):
    x = speak(text, voice)
    cut = syllable_split(x)
    f1, f2 = n(notes[0]), n(notes[1])
    c = carrier(len(x), [(0, [f1 * 2 ** (s / 12) for s in chord]), (cut, [f2 * 2 ** (s / 12) for s in chord])], kind)
    y = vocode(x, c)
    return soft.soften(lp(y, cutoff), cutoff, .02)


def world_sing(text, notes, voice='af_heart', shift=1.08, breathy=.35, cutoff=3800):
    x = speak(text, voice)
    xs = resample_poly(x, 16000, SR).astype(np.float64)
    fs = 16000
    f0, tt = pw.harvest(xs, fs, frame_period=5, f0_floor=60, f0_ceil=600)
    sp = pw.cheaptrick(xs, f0, tt, fs)
    ap = pw.d4c(xs, f0, tt, fs)
    cut = syllable_split(x) * fs // SR // 80  # samples → 5 ms frames
    melody = np.where(np.arange(len(f0)) < cut, n(notes[0]), n(notes[1]))
    # glide 40 ms between the notes, and a slow gentle vibrato
    sm = melody.astype(float).copy()
    for i in range(1, len(sm)):
        sm[i] = sm[i - 1] + (melody[i] - sm[i - 1]) / 8
    sm *= 1 + .008 * np.sin(2 * np.pi * 4.5 * tt)
    newf0 = np.where(f0 > 0, sm, 0)
    # blur the envelope (cepstral smoothing) so it's no particular person, and shift it a little
    logsp = np.log(sp + 1e-12)
    cep = np.fft.irfft(logsp, axis=1)
    cep[:, 30:-30] = 0
    sp2 = np.exp(np.fft.rfft(cep, axis=1).real)
    bins = sp2.shape[1]
    src = np.clip(np.arange(bins) / shift, 0, bins - 1)
    sp2 = np.array([np.interp(src, np.arange(bins), r) for r in sp2])
    ap2 = np.clip(ap + breathy, 0, .999)
    y = pw.synthesize(newf0, sp2, ap2, fs, 5)
    y = resample_poly(y, SR, fs)
    return soft.soften(lp(y / (np.abs(y).max() + 1e-9), cutoff), cutoff, .02)


S = {}


def sound(event, sid, name, desc, fn, wet=.3):
    S.setdefault(event, []).append(dict(id=sid, name=name, desc=desc, fn=fn, wet=wet))


def build():
    p = soft.pad
    # Log in: "Glo-fly"
    sound('login', 'tb-glofly-pad', 'Glo-fly (talking pad)', 'A warm synth pad that says "Glo-fly", like a soft talkbox.',
          lambda: mix([(0, talk('Glow fly.', ['G4', 'D5'], chord=(0, 7)))]))
    sound('login', 'tb-glofly-chord', 'Glo-fly (talking chord)', 'A soft three-note chord saying "Glo-fly", with a bell after.',
          lambda: mix([(0, talk('Glow fly.', ['C4', 'G4'], chord=(0, 4, 7))), (.55, soft.softbell(n('G5'), 2.0, 1.0), .25)]))
    sound('login', 'tb-glofly-hum', 'Glo-fly (hummed)', 'A breathy hum shaped into "Glo-fly", over a warm pad.',
          lambda: mix([(0, p([n('G3'), n('D4')], 1.6, .3, .7), .2), (.03, world_sing('Glow fly.', ['G4', 'D5']))]))
    sound('login', 'tb-glofly-hum-high', 'Glo-fly (light hum)', 'A lighter, higher hummed "Glo-fly" with a kalimba.',
          lambda: mix([(0, world_sing('Glow fly.', ['C5', 'G5'], shift=1.14)), (.4, soft.softkal(n('G5')), .3)]))
    sound('login', 'tb-glofly-whisper', 'Glo-fly (breath)', 'Mostly breath: a soft, airy "Glo-fly" over a chord.',
          lambda: mix([(0, p([n('C4'), n('G4'), n('E5')], 1.6, .3, .7), .3), (.03, world_sing('Glow fly.', ['E4', 'B4'], breathy=.75), .9)]))
    # Log off: "Good-bye"
    sound('logoff', 'tb-goodbye-pad', 'Good-bye (talking pad)', 'A warm synth pad that says "Good-bye", settling down.',
          lambda: mix([(0, talk('Good bye.', ['A4', 'E4'], chord=(0, 7)))]))
    sound('logoff', 'tb-goodbye-chord', 'Good-bye (talking chord)', 'A soft chord saying "Good-bye", stepping down.',
          lambda: mix([(0, talk('Good bye.', ['E4', 'C4'], chord=(0, 4, 7)))]))
    sound('logoff', 'tb-goodbye-hum', 'Good-bye (hummed)', 'A breathy hum shaped into "Good-bye".',
          lambda: mix([(0, world_sing('Good bye.', ['A4', 'E4'])), (.1, p([n('A3'), n('E4')], 1.4, .3, .6), .2)]))
    sound('logoff', 'tb-goodbye-hum-high', 'Good-bye (light hum)', 'A lighter hummed "Good-bye" with a soft celesta.',
          lambda: mix([(0, world_sing('Good bye.', ['D5', 'A4'], shift=1.14)), (.4, soft.soften(soft.celesta(n('A5'), 1.6), 2400), .25)]))
    sound('logoff', 'tb-goodbye-whisper', 'Good-bye (breath)', 'Mostly breath: a soft, airy "Good-bye".',
          lambda: mix([(0, p([n('A3'), n('E4'), n('C#5')], 1.5, .3, .6), .3), (.03, world_sing('Good bye.', ['C#5', 'A4'], breathy=.75), .9)]))


def main():
    global kokoro
    from kokoro_onnx import Kokoro
    model_dir, out = sys.argv[1], sys.argv[2]
    kokoro = Kokoro(os.path.join(model_dir, 'kokoro.int8.onnx'), os.path.join(model_dir, 'voices.bin'))
    os.makedirs(out, exist_ok=True)
    build()
    manifest = {}
    for eid, items in S.items():
        manifest[eid] = []
        for s in items:
            st = soft.finish_soft(s['fn'](), s['wet'], 1.0)
            path = os.path.join(out, f"{eid}-{s['id']}")
            pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
            with wave.open(path + '.wav', 'wb') as f:
                f.setnchannels(2)
                f.setsampwidth(2)
                f.setframerate(SR)
                f.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', path + '.wav', '-c:a', 'libmp3lame', '-b:a', '128k', path + '.mp3'], check=True)
            manifest[eid].append({'id': s['id'], 'name': s['name'], 'desc': s['desc'], 'secs': round(len(st) / SR, 1)})
            print(eid, s['id'], round(len(st) / SR, 1))
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main()
