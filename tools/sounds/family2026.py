"""Glofly sound family preview (Oct 28, 2026): ten themed packs, each covering every app sound.

Run:  python family2026.py <out-folder>      (needs numpy + scipy; ffmpeg on PATH for the .mp3 files)

Writes <out>/<pack>-<event>.mp3 (+ .wav) and <out>/manifest.json. Each pack has its own instrument,
key, speed and room, so every event gets ten options that still sound like one family when a whole
pack is picked. Ringtones are three cycles of their loop so they can be judged as they'd ring.
"""

import json
import os
import subprocess
import sys

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
rng = np.random.default_rng(2026)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def tvec(dur):
    return np.arange(int(dur * SR)) / SR


def attack(t, a):
    return np.clip(t / max(a, 1e-4), 0, 1)


def additive(f, partials, dur, att=0.003):
    """partials: (ratio, amp, decay seconds)."""
    t = tvec(dur)
    out = np.zeros_like(t)
    for ratio, amp, dec in partials:
        if f * ratio > SR * 0.45:
            continue
        out += amp * np.sin(2 * np.pi * f * ratio * t + rng.uniform(0, 0.3)) * np.exp(-t / dec)
    return out * attack(t, att)


def lowpass(x, cutoff, order=2):
    cutoff = min(cutoff, SR * 0.45)
    return sosfilt(butter(order, cutoff, 'low', fs=SR, output='sos'), x)


def click(dur=0.006, cutoff=4000, amp=0.15):
    n = int(dur * SR)
    noise = rng.standard_normal(n) * np.exp(-np.arange(n) / (n / 4))
    return lowpass(noise, cutoff) * amp


# ---------------------------------------------------------------- instruments (f, velocity) -> wave

def glass(f, v):
    a = additive(f, [(1, 1, 1.5), (2.756, .42, .8), (5.404, .22, .45), (8.933, .1, .25)], 3.2)
    b = additive(f + 0.8, [(1, .6, 1.4), (2.756, .2, .7)], 3.2)
    return (a + b) * v


def marimba(f, v):
    w = additive(f, [(1, 1, .55), (3.93, .32, .13), (9.2, .08, .04), (2, .12, .25)], 1.6, att=0.002)
    c = click(cutoff=3000, amp=.25)
    w[:len(c)] += c
    return w * v


def celesta(f, v):
    return additive(f, [(1, 1, 1.3), (2, .32, .6), (3, .1, .35), (6.8, .08, .08)], 2.8, att=0.002) * v


def kalimba(f, v):
    t = tvec(2.2)
    bend = f * (1 + 0.004 * np.exp(-t / 0.03))
    phase = 2 * np.pi * np.cumsum(bend) / SR
    w = np.sin(phase) * np.exp(-t / 0.95) + 0.22 * np.sin(5.9 * phase) * np.exp(-t / 0.06)
    w += 0.1 * np.sin(2 * phase) * np.exp(-t / 0.4)
    w[:int(.004 * SR)] += click(.004, 5000, .2)[:int(.004 * SR)]
    return w * attack(t, .002) * v


def vibes(f, v):
    t = tvec(3.4)
    w = additive(f, [(1, 1, 2.2), (4, .26, .45), (10, .04, .08)], 3.4, att=0.003)
    return w * (1 - 0.28 * (0.5 + 0.5 * np.sin(2 * np.pi * 5.6 * t))) * v


def drop(f, v):
    t = tvec(0.9)
    glide = f * (0.7 + 0.3 * (1 - np.exp(-t / 0.018))) * (1 + 0.06 * t)
    phase = 2 * np.pi * np.cumsum(glide) / SR
    w = (np.sin(phase) + 0.18 * np.sin(2 * phase)) * np.exp(-t / 0.2)
    return w * attack(t, .002) * v


def pad(f, v):
    t = tvec(2.8)
    w = np.zeros_like(t)
    for cents in (-8, 0, 7):
        ff = f * 2 ** (cents / 1200)
        for k in range(1, 9):  # soft saw
            w += np.sin(2 * np.pi * ff * k * t + rng.uniform(0, 6)) / k * 0.4
    w = lowpass(w, f * 3.2)
    env = attack(t, .05) * np.exp(-t / 0.9)
    bell = additive(f * 2, [(1, .35, .9), (3, .06, .3)], 2.8, att=.004)
    return (w * env * 0.55 + bell) * v


def fmbell(f, v):
    t = tvec(3.0)
    index = 3.5 * np.exp(-t / 0.25) + 0.6
    mod = np.sin(2 * np.pi * f * 3.5 * t)
    w = np.sin(2 * np.pi * f * t + index * mod) * np.exp(-t / 1.3)
    w += 0.3 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / 0.5)
    return w * attack(t, .002) * v


def poppluck(f, v):
    parts = [(k, (1 / k) * (0.9 if k % 2 else 0.5), 0.5 / (1 + 0.9 * (k - 1))) for k in range(1, 11)]
    w = additive(f, parts, 1.2, att=0.002)
    w += additive(f / 2, [(1, .35, .25)], 1.2)
    return w * v


def harp(f, v):
    parts = [(k, 1 / k ** 1.4, 1.9 / (1 + 0.5 * (k - 1))) for k in range(1, 9)]
    w = additive(f, parts, 3.0, att=0.002)
    c = click(.005, 2500, .12)
    w[:len(c)] += c
    return w * v


# ---------------------------------------------------------------- room

def make_ir(rt, seconds=2.6):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    irs = []
    for _ in range(2):
        noise = rng.standard_normal(n) * np.exp(-t * 6.9 / rt)
        noise = lowpass(noise, 6500)
        pre = int(0.012 * SR)
        noise = np.concatenate([np.zeros(pre), noise])[:n]
        irs.append(noise / np.sqrt(np.sum(noise ** 2)))
    return irs


# ---------------------------------------------------------------- packs

MAJOR = [0, 2, 4, 5, 7, 9, 11]
LYDIAN = [0, 2, 4, 6, 7, 9, 11]


def degree(scale, d):
    octave, step = divmod(d, 7)
    return octave * 12 + scale[step]


PACKS = [
    dict(id='lantern', name='Lantern Glass', inst=glass, root=64, scale=LYDIAN, speed=1.0, wet=.32, rt=2.2,
         blurb='Clear glass chimes with a slow shimmer, in a big soft room.'),
    dict(id='marimba', name='Firefly Marimba', inst=marimba, root=62, scale=MAJOR, speed=.9, wet=.16, rt=1.2,
         blurb='Warm wooden mallets, quick and friendly.'),
    dict(id='celesta', name='Starlight Celesta', inst=celesta, root=67, scale=MAJOR, speed=1.0, wet=.28, rt=1.8,
         blurb='A music-box celesta: tiny, bright and sweet.'),
    dict(id='kalimba', name='Night Kalimba', inst=kalimba, root=60, scale=MAJOR, speed=1.05, wet=.22, rt=1.5,
         blurb='Thumb-piano tines with a little twang.'),
    dict(id='vibes', name='Velvet Vibes', inst=vibes, root=58, scale=MAJOR, speed=1.15, wet=.28, rt=1.9,
         blurb='Vibraphone with a slow tremolo and jazzy sevenths.'),
    dict(id='dewdrop', name='Dewdrop', inst=drop, root=65, scale=MAJOR, speed=.85, wet=.2, rt=1.3,
         blurb='Round water-drop bloops, the most classic-messenger of the set.'),
    dict(id='aurora', name='Aurora Pad', inst=pad, root=63, scale=LYDIAN, speed=1.2, wet=.4, rt=2.6,
         blurb='Soft synth glow with a bell on top, dreamy and slow.'),
    dict(id='silver', name='Silver Bells', inst=fmbell, root=57, scale=MAJOR, speed=1.0, wet=.28, rt=2.0,
         blurb='Shiny FM bells, like a tiny clock tower.'),
    dict(id='pocket', name='Pocket Pop', inst=poppluck, root=61, scale=MAJOR, speed=.85, wet=.14, rt=1.0,
         blurb='Bouncy modern synth plucks, short and snappy.'),
    dict(id='harp', name='Moonlit Harp', inst=harp, root=56, scale=LYDIAN, speed=1.1, wet=.32, rt=2.2,
         blurb='Harp strings rolling up and down.'),
]

# Events: label, octave shift, gain, cycles (ringing), variants of (time, degree, velocity).
EVENTS = [
    ('message', 'New message', 12, 1.0, 1, [
        [(0, 4, .85), (.09, 7, 1)],
        [(0, 2, .75), (.075, 4, .85), (.15, 7, 1)],
        [(0, 5, .85), (.12, 9, 1)],
    ]),
    ('mention', '@mention', 12, 1.0, 1, [
        [(0, 4, .8), (.08, 7, .9), (.16, 9, 1)],
        [(0, 7, .9), (.1, 7, .65), (.2, 11, 1)],
        [(0, 2, .8), (.07, 4, .85), (.14, 7, .9), (.24, 11, 1)],
    ]),
    ('constellation', 'Constellation message', 19, .8, 1, [
        [(0, 0, .55), (.05, 2, .55), (.1, 4, .6), (.15, 7, .65), (.24, 9, .75)],
        [(0, 7, .7), (.16, 4, .55), (.24, 11, .7)],
        [(0, 9, .6), (.06, 7, .5), (.12, 4, .5), (.22, 11, .7)],
    ]),
    ('friend', 'Friend request', 12, 1.0, 1, [
        [(0, 4, .8), (.15, 4, .75), (.3, 8, 1)],
        [(0, 2, .75), (.12, 4, .85), (.24, 5, .85), (.4, 9, 1)],
        [(0, 0, .8), (.14, 7, .9), (.28, 9, 1)],
    ]),
    ('online', 'Friend comes online', 0, .75, 1, [
        [(0, 0, .65), (.13, 4, .75)],
        [(0, 4, .6), (.12, 6, .65), (.24, 7, .75)],
        [(0, 2, .6), (.14, 7, .75)],
    ]),
    ('login', 'Log in', 0, 1.0, 1, [
        [(0, 0, .6), (.12, 2, .65), (.24, 4, .7), (.36, 7, .8), (.55, 9, 1), (.55, 4, .4), (.55, 0, .35)],
        [(0, 0, .65), (.14, 4, .7), (.28, 7, .75), (.42, 11, .85), (.62, 14, 1), (.62, 7, .4)],
        [(0, 4, .6), (.1, 2, .55), (.2, 4, .7), (.34, 7, .8), (.5, 11, .9), (.5, 9, .5), (.72, 14, 1)],
    ]),
    ('logoff', 'Log off', 0, .9, 1, [
        [(0, 9, .9), (.16, 7, .8), (.32, 4, .7), (.5, 2, .6), (.72, 0, .7)],
        [(0, 7, .85), (.2, 4, .75), (.4, 0, .7), (.66, -3, .65)],
        [(0, 11, .8), (.14, 9, .7), (.28, 7, .65), (.5, 4, .6), (.5, 0, .45)],
    ]),
    ('ring', 'Incoming call', 12, 1.0, 3, [
        [(0, 4, .9), (.18, 7, .85), (.36, 9, .9), (.54, 7, .8), (.9, 4, .85), (1.08, 7, .8), (1.26, 11, 1),
         (1.44, 9, .85), 2.8],
        [(0, 0, .85), (.15, 4, .8), (.3, 7, .85), (.45, 9, .9), (.6, 7, .8), (.75, 4, .75),
         (1.2, 2, .8), (1.35, 4, .8), (1.5, 9, .9), (1.65, 7, .85), 2.6],
        [(0, 7, .9), (.2, 9, .85), (.4, 11, .95), (.8, 9, .8), (1.0, 7, .8), (1.2, 4, .85), 2.4],
    ]),
    ('outgoing', 'Outgoing call', 0, .75, 3, [
        [(0, 4, .7), (0, 0, .5), (.28, 2, .6), 2.2],
        [(0, 7, .65), (.22, 4, .6), (.44, 7, .5), 2.4],
        [(0, 0, .6), (.18, 4, .6), (.36, 7, .65), 2.0],
    ]),
    ('connected', 'Call connected', 12, .95, 1, [
        [(0, 0, .65), (0, 4, .55), (.1, 7, 1)],
        [(0, 4, .8), (.08, 9, 1)],
        [(0, 2, .7), (.07, 4, .8), (.14, 9, 1)],
    ]),
    ('ended', 'Call ended', 12, .9, 1, [
        [(0, 7, .9), (.14, 4, .8), (.28, 0, .7)],
        [(0, 9, .85), (.12, 4, .75)],
        [(0, 7, .8), (.1, 6, .6), (.22, 2, .65)],
    ]),
    ('join', 'Someone joins a call', 12, .8, 1, [
        [(0, 4, .7), (.07, 7, .85)],
        [(0, 2, .7), (.07, 9, .85)],
    ]),
    ('leave', 'Someone leaves a call', 12, .75, 1, [
        [(0, 7, .7), (.07, 4, .6)],
        [(0, 9, .7), (.07, 2, .6)],
    ]),
]


def render(pack, event, pi, ei):
    key, label, octave, gain, cycles, variants = event
    notes = list(variants[(pi + ei) % len(variants)])
    cycle = notes.pop() if not isinstance(notes[-1], tuple) else None
    speed = pack['speed']
    events = []
    for c in range(cycles):
        start = (c * cycle * speed) if cycle else 0
        for (t, d, v) in notes:
            events.append((start + t * speed, d, v))
    end = max(t for t, _, _ in events) + 3.4
    dry = np.zeros(int(end * SR) + SR)
    for t, d, v in events:
        midi = pack['root'] + octave + degree(pack['scale'], d)
        w = pack['inst'](hz(midi), v)
        # A touch quieter for very high notes so nothing pierces.
        w *= min(1.0, (1100 / max(hz(midi), 1)) ** 0.35)
        i = int(t * SR)
        dry[i:i + len(w)] += w[:len(dry) - i]
    irs = make_ir(pack['rt'])
    wet = pack['wet']
    left = dry * (1 - wet) + fftconvolve(dry, irs[0])[:len(dry)] * wet * 2.2
    right = dry * (1 - wet) + fftconvolve(dry, irs[1])[:len(dry)] * wet * 2.2
    st = np.stack([left, right], axis=1)
    # Trim the silent tail, fade the last 60 ms.
    level = np.abs(st).max(axis=1)
    peak = level.max()
    above = np.where(level > peak * 10 ** (-48 / 20))[0]
    st = st[:above[-1] + int(0.05 * SR)]
    fade = int(0.06 * SR)
    st[-fade:] *= np.linspace(1, 0, fade)[:, None]
    st[:int(.002 * SR)] *= np.linspace(0, 1, int(.002 * SR))[:, None]
    st = np.tanh(st / peak * 1.1) / np.tanh(1.1)  # gentle soft clip after normalising
    return st * 10 ** (-1.5 / 20) * gain


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'family2026'
    os.makedirs(out, exist_ok=True)
    manifest = {'packs': [], 'events': []}
    for ei, ev in enumerate(EVENTS):
        manifest['events'].append({'id': ev[0], 'name': ev[1]})
    for pi, pack in enumerate(PACKS):
        manifest['packs'].append({'id': pack['id'], 'name': pack['name'], 'blurb': pack['blurb']})
        for ei, ev in enumerate(EVENTS):
            st = render(pack, ev, pi, ei)
            base = os.path.join(out, f"{pack['id']}-{ev[0]}")
            pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
            import wave
            with wave.open(base + '.wav', 'wb') as f:
                f.setnchannels(2)
                f.setsampwidth(2)
                f.setframerate(SR)
                f.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', base + '.wav', '-c:a', 'libmp3lame',
                            '-b:a', '128k', base + '.mp3'], check=True)
            print(f"{pack['id']}-{ev[0]}  {len(st) / SR:.1f}s")
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main()
