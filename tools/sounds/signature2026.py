"""Glofly signature sounds preview (Oct 28, 2026, round 2): no packs. Every event gets about nine
sounds, each designed on its own with its own trick (bubbles, whistles, synthetic voices, wood,
glass, chiptune, FM, swoops), aiming for short, catchy hooks in the spirit of classic messengers.
All original: none copies a real app's sound.

Run:  python signature2026.py <out-folder>   (numpy + scipy; ffmpeg on PATH for .mp3)
Writes <out>/<event>-<id>.mp3 and <out>/manifest.json.
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter, sosfilt

SR = 44100
rng = np.random.default_rng(1028)

NOTE = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7,
        'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}


def n(name):
    """'A5' -> Hz."""
    pitch, octave = name[:-1], int(name[-1])
    midi = 12 * (octave + 1) + NOTE[pitch]
    return 440.0 * 2 ** ((midi - 69) / 12)


def T(dur):
    return np.arange(max(1, int(dur * SR))) / SR


# ---------------------------------------------------------------- building blocks

def glide(f0, f1, dur, curve='exp'):
    t = T(dur)
    if f1 is None or f1 == f0:
        return np.full_like(t, f0)
    x = t / max(dur, 1e-6)
    if curve == 'exp':
        return f0 * (f1 / f0) ** x
    if curve == 'fast':  # gets there quickly, then holds
        return f1 + (f0 - f1) * np.exp(-x * 8)
    return f0 + (f1 - f0) * x


def env(dur, a=0.003, tau=0.2, hold=0.0):
    t = T(dur)
    e = np.clip(t / max(a, 1e-4), 0, 1)
    after = np.clip(t - a - hold, 0, None)
    return e * np.exp(-after / tau)


def phase(freq):
    return 2 * np.pi * np.cumsum(freq) / SR


def sine(freq, vib=None):
    f = freq.copy()
    if vib:
        rate, depth = vib
        f = f * (1 + depth * np.sin(2 * np.pi * rate * np.arange(len(f)) / SR))
    return np.sin(phase(f))


def synth(freq, shape='saw', cutoff=None, harmonics=24):
    """Additive saw/square/tri with a (possibly moving) low-pass cutoff in Hz."""
    out = np.zeros_like(freq)
    ph = phase(freq)
    cut = np.full_like(freq, 20000.0) if cutoff is None else np.broadcast_to(cutoff, freq.shape)
    for k in range(1, harmonics + 1):
        if shape == 'square' and k % 2 == 0:
            continue
        if shape == 'tri' and k % 2 == 0:
            continue
        amp = (1 / k) if shape in ('saw', 'square') else (1 / k ** 2) * (-1) ** ((k - 1) // 2)
        fk = freq * k
        g = amp / np.sqrt(1 + (fk / cut) ** 4)
        g = np.where(fk < SR * 0.45, g, 0)
        out += g * np.sin(k * ph)
    return out


def tone(f0, dur, f1=None, shape='sine', a=0.003, tau=0.15, hold=0.0, vib=None, cutoff=None, curve='exp'):
    fr = glide(f0, f1, dur, curve)
    if shape == 'sine':
        w = sine(fr, vib)
    else:
        if vib:
            fr = fr * (1 + vib[1] * np.sin(2 * np.pi * vib[0] * T(dur)))
        w = synth(fr, shape, cutoff)
    return w * env(dur, a, tau, hold)


def partials(f, dur, parts, a=0.002):
    t = T(dur)
    w = np.zeros_like(t)
    for ratio, amp, tau in parts:
        if f * ratio < SR * 0.45:
            w += amp * np.sin(2 * np.pi * f * ratio * t + rng.uniform(0, 1)) * np.exp(-t / tau)
    return w * np.clip(t / a, 0, 1)


def bell(f, dur=2.0, tau=1.0):
    return partials(f, dur, [(1, 1, tau), (2.0, .35, tau * .5), (3.01, .18, tau * .35), (4.2, .1, tau * .2)])


def glass(f, dur=2.2):
    return partials(f, dur, [(1, 1, 1.2), (2.756, .4, .6), (5.404, .2, .3), (8.93, .08, .15)]) + \
        partials(f + 0.9, dur, [(1, .5, 1.1)])


def marimba(f, dur=1.0):
    w = partials(f, dur, [(1, 1, .45), (3.93, .3, .1), (9.2, .07, .03)])
    w[:len(click())] += click()
    return w


def celesta(f, dur=1.8):
    return partials(f, dur, [(1, 1, 1.0), (2, .3, .45), (3, .1, .25), (6.8, .07, .06)])


def kalimba(f, dur=1.6):
    t = T(dur)
    ph = phase(f * (1 + 0.004 * np.exp(-t / 0.03)))
    w = np.sin(ph) * np.exp(-t / 0.8) + .22 * np.sin(5.9 * ph) * np.exp(-t / .05)
    return w * np.clip(t / .002, 0, 1)


def pluck(f, dur=1.4, bright=1.0):
    return partials(f, dur, [(k, (1 / k ** 1.2), 1.3 / (1 + bright * 0.7 * (k - 1))) for k in range(1, 10)])


def fm(f, dur, ratio=3.5, idx0=4.0, idx1=0.5, idx_tau=0.2, tau=0.8, f1=None):
    t = T(dur)
    fr = glide(f, f1, dur)
    index = idx1 + (idx0 - idx1) * np.exp(-t / idx_tau)
    mod = np.sin(phase(fr * ratio))
    return np.sin(phase(fr) + index * mod) * env(dur, .002, tau)


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def bp(x, f, q=8.0):
    f = min(max(f, 40), SR * 0.45)
    w0 = 2 * np.pi * f / SR
    alpha = np.sin(w0) / (2 * q)
    b = [alpha, 0, -alpha]
    a = [1 + alpha, -2 * np.cos(w0), 1 - alpha]
    return lfilter(b, a, x)


def lp(x, f, order=2):
    return sosfilt(butter(order, min(f, SR * 0.45), 'low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)


def sweep_noise(dur, f0, f1, q=4.0, a=0.01, tau=None, block=256):
    """Noise through a band-pass that moves from f0 to f1 (whoosh / zip)."""
    x = noise(dur)
    out = np.zeros_like(x)
    fr = glide(f0, f1, dur)
    for i in range(0, len(x), block):
        seg = x[max(0, i - 512):i + block]
        out[i:i + block] = bp(seg, fr[min(i, len(fr) - 1)], q)[-len(x[i:i + block]):]
    e = np.clip(T(dur) / a, 0, 1)
    if tau:
        e *= np.exp(-T(dur) / tau)
    else:
        e *= np.clip((dur - T(dur)) / (dur * 0.35), 0, 1)
    return out * e / (np.abs(out).max() + 1e-9)


def click(dur=0.005, f=3500, amp=.25):
    x = noise(dur) * np.exp(-np.arange(int(dur * SR)) / (dur * SR / 4))
    return lp(x, f) * amp


def bubble(f, dur=0.16, rise=2.2, tau=0.05):
    """A water bloop: pitch shoots up fast."""
    t = T(dur)
    fr = f * (1 + (rise - 1) * (1 - np.exp(-t / 0.025)))
    return np.sin(phase(fr)) * np.exp(-t / tau) * np.clip(t / 0.002, 0, 1)


def pop(f=1400, dur=0.05):
    t = T(dur)
    fr = f * 0.25 + f * 0.75 * np.exp(-t / 0.006)
    w = np.sin(phase(fr)) * np.exp(-t / 0.012)
    c = click(0.004, 6000, .5)
    w[:len(c)] += c
    return w


def knock(f=900, dur=0.12):
    t = T(dur)
    body = bp(noise(dur) * np.exp(-t / 0.008), f, 6) * 3
    thump = np.sin(phase(glide(f * 0.22, f * 0.14, dur))) * np.exp(-t / 0.03)
    return (body + thump * .8) * np.clip(t / 0.001, 0, 1)


def wood(f, dur=0.25):
    w = partials(f, dur, [(1, 1, .06), (2.57, .4, .03), (4.8, .2, .015)])
    c = click(.003, 6000, .3)
    w[:len(c)] += c
    return w


def whistle(f0, dur, f1=None, vib=(5.5, 0.012), tau=None, a=0.03):
    fr = glide(f0, f1, dur, 'fast' if f1 else 'exp')
    w = sine(fr, vib)
    breath = bp(noise(dur), f0 * 1.0, 12) * 0.08
    e = np.clip(T(dur) / a, 0, 1) * np.clip((dur - T(dur)) / 0.05, 0, 1)
    if tau:
        e *= np.exp(-T(dur) / tau)
    return (w + breath) * e


VOWELS = {
    'a': [(800, 1.0, 80), (1150, .5, 90), (2900, .15, 120)],
    'e': [(400, 1.0, 70), (1700, .5, 100), (2600, .2, 120)],
    'i': [(280, 1.0, 60), (2250, .4, 100), (3000, .2, 120)],
    'o': [(450, 1.0, 70), (800, .55, 80), (2830, .1, 100)],
    'u': [(325, 1.0, 50), (700, .35, 60), (2530, .07, 100)],
    'm': [(250, 1.0, 50), (1000, .12, 80), (2200, .05, 100)],
}


def vowel_filter(src, v):
    out = np.zeros_like(src)
    for f, amp, bw in VOWELS[v]:
        out += bp(src, f, f / bw) * amp
    return out


def voice(f0, dur, v0='u', v1=None, f1=None, a=0.02, tau=None, vib=(5.0, 0.01), release=0.06):
    """A synthetic sung syllable: a buzzy source through vowel formants, morphing v0 -> v1."""
    fr = glide(f0, f1, dur, 'fast' if f1 else 'exp')
    fr = fr * (1 + vib[1] * np.sin(2 * np.pi * vib[0] * T(dur)))
    src = synth(fr, 'saw', None, 30)
    first = vowel_filter(src, v0)
    if v1:
        x = np.clip(T(dur) / dur * 1.6 - 0.3, 0, 1)
        out = first * (1 - x) + vowel_filter(src, v1) * x
    else:
        out = first
    e = np.clip(T(dur) / a, 0, 1) * np.clip((dur - T(dur)) / release, 0, 1)
    if tau:
        e *= np.exp(-T(dur) / tau)
    return out * e / (np.abs(out).max() + 1e-9)


def boing(f, dur=0.45, depth=0.35, rate=16):
    t = T(dur)
    fr = f * (1 + depth * np.exp(-t / 0.12) * np.sin(2 * np.pi * rate * t))
    return np.sin(phase(fr)) * env(dur, .002, .16)


def reverse_bell(f, dur=0.6):
    b = bell(f, dur * 2.5, 0.5)[:int(dur * SR)]
    b = b[::-1] * np.linspace(0.2, 1, len(b)) ** 2
    return b


def chord(fn, freqs, spread=0.0, **kw):
    parts = [(i * spread, fn(f, **kw)) for i, f in enumerate(freqs)]
    return mix(parts)


def mix(parts, gains=None):
    """parts: list of (time seconds, wave) or (time, wave, gain)."""
    length = max(int(p[0] * SR) + len(p[1]) for p in parts)
    out = np.zeros(length)
    for p in parts:
        i = int(p[0] * SR)
        g = p[2] if len(p) > 2 else 1.0
        out[i:i + len(p[1])] += p[1] * g
    return out


def echo(x, delay=0.18, fb=0.4, repeats=4, lowpass=5000):
    out = np.concatenate([x, np.zeros(int(delay * SR * repeats))])
    tap = x
    for r in range(1, repeats + 1):
        tap = lp(tap, lowpass) * fb
        i = int(delay * SR * r)
        out[i:i + len(tap)] += tap
    return out


def loop3(pattern, cycle):
    """Three cycles of a ringing pattern."""
    return mix([(c * cycle, pattern) for c in range(3)])


# ---------------------------------------------------------------- the sounds

S = {}


def sound(event, sid, name, desc, wet=0.18, rt=1.4, gain=1.0):
    def wrap(fn):
        S.setdefault(event, []).append(dict(id=sid, name=name, desc=desc, fn=fn, wet=wet, rt=rt, gain=gain))
        return fn
    return wrap


# ---- New message
@sound('message', 'bloop', 'Bloop', 'Two water bloops, the second one higher.')
def _():
    return mix([(0, bubble(520, .18, 2.3)), (.085, bubble(780, .2, 2.1))])


@sound('message', 'pingpong', 'Ping Pong', 'A bright jump up a fourth with a tiny echo.', wet=.22)
def _():
    return echo(mix([(0, fm(n('E6'), .5, 2.0, 2.5, .3, .08, .25)), (.1, fm(n('A6'), .7, 2.0, 2.5, .3, .08, .35))]), .14, .3, 2)


@sound('message', 'blink', 'Firefly Blink', 'Three quick sparks over a soft glow.', wet=.3, rt=1.8)
def _():
    sparks = [(i * .035, tone(f, .25, shape='sine', tau=.07)) for i, f in enumerate([n('C7'), n('E7'), n('G7')])]
    return mix(sparks + [(0, tone(n('C5'), .6, shape='tri', a=.04, tau=.25), .4)])


@sound('message', 'popnote', 'Pop Note', 'A little pop, then one warm marimba note.')
def _():
    return mix([(0, pop(1600), .9), (.05, marimba(n('G5'))), (.05, marimba(n('D6')), .35)])


@sound('message', 'boodee', 'Boo-Dee', 'A tiny sung "boo-dee", like the app saying hi.', wet=.15)
def _():
    return mix([(0, voice(n('E5'), .11, 'u', None, n('G5'))), (.12, voice(n('B5'), .16, 'e', 'i', n('B5')))])


@sound('message', 'drip', 'Drip', 'One clear drop into a glass of water.', wet=.25)
def _():
    return mix([(0, bubble(900, .22, 1.8, .07)), (.03, glass(n('B6'), 1.2), .25)])


@sound('message', 'zipding', 'Zip Ding', 'A quick zip up into a bell.', wet=.22)
def _():
    return mix([(0, sweep_noise(.09, 1200, 7000, 5), .35), (.08, bell(n('A6'), 1.4, .5))])


@sound('message', 'chirp', 'Chirp', 'Three fast chiptune notes, soft around the edges.')
def _():
    notes = [n('G5'), n('D6'), n('G6')]
    return mix([(i * .045, tone(f, .1, shape='square', a=.002, tau=.06, cutoff=f * 4), .7) for i, f in enumerate(notes)])


@sound('message', 'wobble', 'Wobble', 'A short rubbery boing.', wet=.12)
def _():
    return boing(n('A5'), .35, .25, 22)


@sound('message', 'glasstap', 'Glass Tap', 'Two taps on a wine glass, high then low.', wet=.3, rt=1.8)
def _():
    return mix([(0, glass(n('D7'), 1.2)), (.09, glass(n('A6'), 1.4), .8)])


# ---- @mention
@sound('mention', 'doubleping', 'Double Ping', 'Ping, ping, then up a fifth: hard to miss.', wet=.2)
def _():
    p = lambda f: fm(f, .5, 2.0, 3.0, .3, .06, .2)
    return mix([(0, p(n('E6'))), (.11, p(n('E6')), .8), (.22, fm(n('B6'), .8, 2.0, 3.0, .3, .08, .35))])


@sound('mention', 'heyyou', 'Hey You', 'A sung "hey!" with a ding behind it.', wet=.15)
def _():
    return mix([(0, voice(n('A5'), .2, 'e', 'i', n('C#6'))), (.16, bell(n('E7'), 1.2, .4), .35)])


@sound('mention', 'spotlight', 'Spotlight', 'A short whoosh that lands on a sparkly chord.', wet=.3, rt=2)
def _():
    sw = sweep_noise(.28, 600, 5000, 3)
    ch = chord(celesta, [n('C6'), n('E6'), n('G6'), n('C7')], .02)
    return mix([(0, sw, .3), (.24, ch)])


@sound('mention', 'taptaptap', 'Tap Tap Tap', 'Three woodblock taps speeding up, then a ding.')
def _():
    return mix([(0, wood(n('E6'))), (.13, wood(n('E6'))), (.22, wood(n('E6'))), (.3, bell(n('E7'), 1.2, .45), .7)])


@sound('mention', 'yoohoo', 'Yoo-Hoo', 'A two-note whistle calling your name.', wet=.18)
def _():
    return mix([(0, whistle(n('G6'), .16, n('E7'))), (.2, whistle(n('C7'), .28, n('A6')))])


@sound('mention', 'beacon', 'Beacon', 'A friendly pager: two tones, three times.')
def _():
    beep = lambda f: tone(f, .07, shape='tri', a=.003, tau=.06, hold=.03)
    seq = []
    for i in range(3):
        seq += [(i * .16, beep(n('A6'))), (i * .16 + .08, beep(n('E6')))]
    return mix(seq)


@sound('mention', 'bubbleburst', 'Bubble Burst', 'Four bubbles racing upward.')
def _():
    return mix([(i * .055, bubble(420 * 1.25 ** i, .16, 2.2)) for i in range(4)])


@sound('mention', 'ribbon', 'Ribbon', 'A shimmering FM swoop up.', wet=.28, rt=1.8)
def _():
    return fm(400, .55, 1.5, 6, 1.5, .2, .3, f1=2400)


@sound('mention', 'chimetrio', 'Chime Trio', 'Three bright celesta notes, quick.', wet=.25)
def _():
    return mix([(0, celesta(n('C6'))), (.07, celesta(n('E6'))), (.14, celesta(n('A6')))])


# ---- Constellation message
@sound('constellation', 'starfall', 'Starfall', 'Tiny stars falling left to right.', wet=.35, rt=2.2)
def _():
    notes = ['E7', 'C#7', 'B6', 'G#6', 'E6', 'B6']
    return echo(mix([(i * .045, tone(n(x), .3, tau=.08), .8 - i * .08) for i, x in enumerate(notes)]), .16, .3, 2)


@sound('constellation', 'comet', 'Comet', 'A soft whoosh with a glowing tail.', wet=.3, rt=2)
def _():
    return mix([(0, sweep_noise(.4, 3000, 700, 3), .35), (.18, tone(n('E6'), .9, n('B5'), 'sine', .01, .3), .5)])


@sound('constellation', 'satellite', 'Satellite', 'A sci-fi beep-boop with an echo.', wet=.2)
def _():
    return echo(mix([(0, fm(n('A6'), .12, 1.41, 2, .5, .05, .06)), (.1, fm(n('E6'), .14, 1.41, 2, .5, .05, .07))]), .2, .35, 3)


@sound('constellation', 'windchime', 'Wind Chime', 'A breeze through glass chimes.', wet=.35, rt=2.4)
def _():
    notes = ['E6', 'B6', 'F#6', 'C#7']
    return mix([(t, glass(n(x), 1.6), .6) for t, x in zip([0, .07, .13, .22], notes)])


@sound('constellation', 'orbit', 'Orbit', 'A rising "woo-oo" that circles around.', wet=.25)
def _():
    return tone(n('E5'), .45, n('E6'), 'sine', .02, .25, vib=(9, .04))


@sound('constellation', 'shwip', 'Shwip', 'A bell played backwards, then a twinkle.', wet=.3, rt=2)
def _():
    return mix([(0, reverse_bell(n('B6'), .35), .7), (.35, tone(n('E7'), .3, tau=.07)), (.42, tone(n('B7'), .3, tau=.06), .5)])


@sound('constellation', 'ripple', 'Crystal Ripple', 'A tiny arpeggio up and back down.', wet=.3)
def _():
    notes = ['B5', 'E6', 'G#6', 'B6', 'G#6']
    return mix([(i * .04, celesta(n(x), 1.0), .7) for i, x in enumerate(notes)])


@sound('constellation', 'spacedrop', 'Space Drop', 'One bloop echoing out into space.', wet=.25, rt=2)
def _():
    return echo(bubble(660, .2, 1.9, .06), .17, .45, 5, 3000)


@sound('constellation', 'nebula', 'Nebula Hum', 'A short glowing swell with a bell on top.', wet=.4, rt=2.6)
def _():
    pad = synth(glide(n('E4'), None, .8), 'saw', np.full(int(.8 * SR), 1600.0)) * env(.8, .15, .3)
    return mix([(0, lp(pad, 2000), .3), (.12, bell(n('B6'), 1.5, .6), .7)])


# ---- Friend request
@sound('friend', 'knock', 'Knock Knock', 'Two knocks on the door, then a hopeful chime.')
def _():
    return mix([(0, knock()), (.14, knock(950)), (.32, celesta(n('C6'))), (.42, celesta(n('G6')))])


@sound('friend', 'dingdong', 'Ding Dong', 'A soft two-tone doorbell.', wet=.25, rt=1.8)
def _():
    return mix([(0, bell(n('E6'), 1.4, .7)), (.3, bell(n('C6'), 1.8, .9))])


@sound('friend', 'hellowhistle', 'Hello Whistle', 'Whistled "hel-lo-o", up, up, down.', wet=.18)
def _():
    return mix([(0, whistle(n('D6'), .12)), (.14, whistle(n('A6'), .14)), (.3, whistle(n('F#6'), .3, None, tau=.4))])


@sound('friend', 'giftbox', 'Gift Box', 'A little shake, a pop, and a sparkle.', wet=.22)
def _():
    rattle = mix([(i * .03, bp(noise(.025), 3500, 2) * env(.025, .001, .008), .5) for i in range(5)])
    return mix([(0, rattle, .5), (.17, pop(1200)), (.21, celesta(n('E6'))), (.27, celesta(n('B6')))])


@sound('friend', 'fanfare', 'Tiny Fanfare', 'Three-note mini fanfare, brassy but soft.')
def _():
    br = lambda f, d: tone(f, d, shape='saw', a=.015, tau=.3, hold=d * .4, cutoff=f * 3.5, vib=(5, .006))
    return mix([(0, br(n('G5'), .12)), (.13, br(n('C6'), .12)), (.26, br(n('E6'), .45))])


@sound('friend', 'bubblesup', 'Bubbles Up', 'Five bubbles climbing a scale.')
def _():
    notes = [n('C5'), n('D5'), n('E5'), n('G5'), n('C6')]
    return mix([(i * .06, bubble(f, .16, 2.0)) for i, f in enumerate(notes)])


@sound('friend', 'hiya', 'Hi-ya', 'A sung "hi-ya!", cheerful and quick.', wet=.15)
def _():
    return mix([(0, voice(n('C6'), .14, 'a', 'i', n('E6'))), (.16, voice(n('G6'), .22, 'i', 'a', n('G6')))])


@sound('friend', 'boinghello', 'Boing Hello', 'A springy boing that lands on a bell.')
def _():
    return mix([(0, boing(n('C6'), .4, .3, 14)), (.28, bell(n('G6'), 1.3, .5), .7)])


@sound('friend', 'handshake', 'Handshake', 'Two plucks meeting in the middle.', wet=.2)
def _():
    return mix([(0, pluck(n('C5'))), (0, pluck(n('C6')), .7), (.16, pluck(n('E5'))), (.16, pluck(n('A5')), .7), (.32, chord(pluck, [n('G5'), n('D6')]))])


# ---- Friend comes online
@sound('online', 'woop', 'Woop', 'A soft upward "woop", like someone walking in.', gain=.85)
def _():
    return tone(300, .22, 620, 'tri', .02, .12, curve='fast')


@sound('online', 'lanternlit', 'Lantern Lit', 'A match strike and a warm glow.', wet=.28, gain=.85)
def _():
    strike = hp(noise(.08), 2500) * env(.08, .002, .025)
    return mix([(0, strike, .4), (.05, tone(n('G4'), .9, None, 'tri', .12, .4), .7), (.12, bell(n('D6'), 1.2, .5), .4)])


@sound('online', 'stepup', 'Step Up', 'Three quiet marimba steps.', gain=.85)
def _():
    return mix([(0, marimba(n('C5'))), (.1, marimba(n('E5'))), (.2, marimba(n('A5')))])


@sound('online', 'hellblip', 'Hello Blip', 'Two little blips, up a sixth.', gain=.85)
def _():
    return mix([(0, tone(n('E5'), .08, shape='tri', tau=.05)), (.08, tone(n('C#6'), .12, shape='tri', tau=.07))])


@sound('online', 'peekaboo', 'Peek', 'A tiny sung "oo-ah", like a peek around the door.', wet=.15, gain=.85)
def _():
    return voice(n('G4'), .3, 'u', 'a', n('D5'))


@sound('online', 'pluckduo', 'Pluck Duo', 'Two soft plucked strings.', wet=.2, gain=.85)
def _():
    return mix([(0, pluck(n('D5'), bright=1.4)), (.12, pluck(n('A5'), bright=1.4))])


@sound('online', 'glowswell', 'Glow Swell', 'A reversed shimmer landing on a soft ding.', wet=.3, gain=.85)
def _():
    return mix([(0, reverse_bell(n('A5'), .4), .6), (.4, bell(n('A5'), 1.2, .5))])


@sound('online', 'breezein', 'Breeze In', 'Air rushing in with a tiny chime.', wet=.3, gain=.85)
def _():
    return mix([(0, sweep_noise(.3, 500, 2500, 2), .25), (.22, glass(n('E6'), 1.2), .5)])


@sound('online', 'kalihi', 'Kalimba Hi', 'Two kalimba tines, bright and short.', wet=.2, gain=.85)
def _():
    return mix([(0, kalimba(n('E5'))), (.1, kalimba(n('B5')))])


# ---- Log in
@sound('login', 'glofly', 'Glofly Hello', 'A four-note hook made to be Glofly’s own.', wet=.3, rt=2)
def _():
    notes = [(0, 'G5'), (.14, 'C6'), (.28, 'D6'), (.46, 'G6')]
    pad = lp(synth(glide(n('G3'), None, 1.6), 'saw'), 1200) * env(1.6, .3, .7) * .25
    return mix([(t, celesta(n(x), 1.8)) for t, x in notes] + [(.46, bell(n('D7'), 1.6, .7), .35), (.1, pad)])


@sound('login', 'liftoff', 'Liftoff', 'A rising whoosh and bubbles, landing on a chord.', wet=.3, rt=2)
def _():
    bubbles = [(i * .07, bubble(300 * 1.3 ** i, .14, 2.0), .5) for i in range(5)]
    land = chord(bell, [n('C6'), n('E6'), n('G6')], .015, dur=1.6, tau=.8)
    return mix([(0, sweep_noise(.4, 300, 4000, 2.5), .25)] + bubbles + [(.42, land)])


@sound('login', 'dawn', 'Dawn Chorus', 'A two-bird whistle over a warm chord.', wet=.3, rt=2)
def _():
    ch = chord(lambda f: tone(f, 1.4, None, 'tri', .25, .6), [n('C4'), n('G4'), n('E5')])
    return mix([(0, ch, .4), (.1, whistle(n('G6'), .12, n('C7'))), (.28, whistle(n('E7'), .1, n('G7'))), (.45, whistle(n('C7'), .4, n('C7'), tau=.5))])


@sound('login', 'swarm', 'Firefly Swarm', 'Dozens of tiny sparks gathering into one chord.', wet=.35, rt=2.2)
def _():
    sparks = [(rng.uniform(0, .5), tone(n(rng.choice(['C7', 'E7', 'G7', 'A7', 'D7'])), .15, tau=.04), rng.uniform(.15, .4)) for _ in range(26)]
    land = chord(celesta, [n('C6'), n('G6'), n('E7')], .01)
    return mix(sparks + [(.55, land)])


@sound('login', 'synthwelcome', 'Synth Welcome', 'An 80s synth arpeggio rising over a chord.', wet=.25)
def _():
    arp = [n(x) for x in ['A4', 'C#5', 'E5', 'A5', 'C#6', 'E6']]
    notes = [(i * .07, tone(f, .25, shape='saw', a=.004, tau=.12, cutoff=f * 3), .5) for i, f in enumerate(arp)]
    pad = chord(lambda f: tone(f, 1.2, None, 'saw', .1, .5, cutoff=1800), [n('A3'), n('E4'), n('C#5')])
    return mix(notes + [(.4, lp(pad, 2400), .3)])


@sound('login', 'doorchime', 'Door Chime', 'Shop-door chimes swinging, then settling.', wet=.35, rt=2.2)
def _():
    notes = ['G6', 'D7', 'B6', 'E7', 'A6', 'D7', 'G6']
    return mix([(i * .06 + rng.uniform(0, .02), glass(n(x), 1.8), .55) for i, x in enumerate(notes)])


@sound('login', 'choir', 'Little Choir', 'A tiny synthetic choir singing "ooh-ah".', wet=.35, rt=2)
def _():
    ch = mix([(0, voice(n(x), 1.0, 'u', 'a', None, .15, .7)) for x in ['C5', 'E5', 'G5']])
    return mix([(0, ch, .6), (.5, bell(n('C7'), 1.3, .6), .4)])


@sound('login', 'arcade', 'Arcade Start', 'A chiptune "player one ready" fanfare.')
def _():
    seq = [('C5', 0), ('E5', .07), ('G5', .14), ('C6', .21), ('G5', .3), ('C6', .37)]
    notes = [(t, tone(n(x), .1, shape='square', a=.002, tau=.08, hold=.04, cutoff=n(x) * 5), .6) for x, t in seq]
    return mix(notes + [(.44, tone(n('E6'), .5, shape='square', a=.002, tau=.3, hold=.1, cutoff=4000, vib=(7, .01)), .6)])


@sound('login', 'bloom', 'Lantern Bloom', 'A marimba roll opening into a bell.', wet=.28)
def _():
    roll = [(i * .045, marimba(n(x)), .7) for i, x in enumerate(['D5', 'F#5', 'A5', 'D6', 'F#6'])]
    return mix(roll + [(.3, fm(n('A6'), 1.6, 3.5, 3, .5, .3, .9), .5)])


# ---- Log off
@sound('logoff', 'goodnight', 'Goodnight Hook', 'The Glofly Hello hook, played backwards and sleepy.', wet=.3, rt=2)
def _():
    notes = [(0, 'G6'), (.18, 'D6'), (.36, 'C6'), (.6, 'G5')]
    return mix([(t, celesta(n(x), 1.8)) for t, x in notes])


@sound('logoff', 'powerdown', 'Power Down', 'A long slide down as the lights go out.', wet=.2)
def _():
    fr = glide(900, 110, .8)
    return synth(fr, 'saw', glide(4000, 300, .8)) * env(.8, .005, .5) * .7


@sound('logoff', 'sleepywhistle', 'Sleepy Whistle', 'A whistle sighing down two notes.', wet=.2)
def _():
    return mix([(0, whistle(n('A6'), .2, n('F#6'))), (.24, whistle(n('D6'), .4, n('A5'), tau=.5))])


@sound('logoff', 'scatter', 'Fireflies Leave', 'Sparks drifting off and fading out.', wet=.35, rt=2.2)
def _():
    return mix([(i * .08 + rng.uniform(0, .03), tone(n(x), .2, tau=.05), .5 - i * .05) for i, x in enumerate(['E7', 'C7', 'A6', 'E6', 'C6', 'A5'])])


@sound('logoff', 'synthfade', 'Synth Fade', 'An arpeggio falling as the filter closes.', wet=.25)
def _():
    arp = [n(x) for x in ['E6', 'C#6', 'A5', 'E5', 'C#5', 'A4']]
    return mix([(i * .08, tone(f, .3, shape='saw', a=.004, tau=.15, cutoff=3000 - i * 400), .5) for i, f in enumerate(arp)])


@sound('logoff', 'doorclose', 'Door Close', 'A soft wooden thunk and a low note.', wet=.25)
def _():
    return mix([(0, knock(500, .2)), (.02, tone(n('C3'), .6, None, 'tri', .005, .25), .6), (.05, bell(n('G4'), 1.0, .4), .3)])


@sound('logoff', 'byebye', 'Bye-Bye', 'A sung "bye-bye", falling gently.', wet=.15)
def _():
    return mix([(0, voice(n('E5'), .2, 'a', 'i', n('E5'))), (.24, voice(n('B4'), .32, 'a', 'i', n('A4')))])


@sound('logoff', 'arcadeexit', 'Game Over (nice)', 'A chiptune goodbye that isn’t sad.')
def _():
    seq = [('C6', 0), ('G5', .09), ('E5', .18), ('C5', .3)]
    return mix([(t, tone(n(x), .14 if i < 3 else .4, shape='square', a=.002, tau=.12, hold=.04, cutoff=n(x) * 4), .6) for i, (x, t) in enumerate(seq)])


@sound('logoff', 'lanternout', 'Lantern Out', 'A soft puff, and the bell fades away.', wet=.3)
def _():
    puff = lp(noise(.18), 900) * env(.18, .01, .05)
    return mix([(0, bell(n('E6'), 1.6, .8), .6), (.25, puff, .8)])


# ---- Incoming call (three rings each)
def ring_sound(sid, name, desc, cycle, wet=.22, rt=1.6, gain=1.0):
    def wrap(fn):
        sound('ring', sid, name, desc, wet, rt, gain)(lambda: loop3(fn(), cycle))
        return fn
    return wrap


@ring_sound('hop', 'Firefly Hop', 'A bouncy marimba tune you can hum.', 2.4)
def _():
    seq = [('E5', 0), ('G5', .15), ('A5', .3), ('C6', .6), ('A5', .75), ('G5', .9), ('E5', 1.2), ('D5', 1.35), ('E5', 1.5)]
    return mix([(t, marimba(n(x))) for x, t in seq])


@ring_sound('synthpop', 'Synth Pop', 'A modern plucky synth riff.', 2.2)
def _():
    seq = [('A5', 0), ('E5', .14), ('A5', .28), ('B5', .42), ('C#6', .56), ('B5', .84), ('A5', .98), ('E5', 1.12)]
    return mix([(t, tone(n(x), .3, shape='saw', a=.003, tau=.11, cutoff=n(x) * 3.5), .6) for x, t in seq] +
               [(t, knock(1200, .1), .25) for t in (0, .56, 1.12)])


@ring_sound('chiptune', 'Chip Ring', 'A pocket video-game ringtone.', 2.0)
def _():
    seq = [('E6', 0), ('E6', .1), ('C6', .2), ('E6', .3), ('G6', .5), ('G5', .7), ('C6', 1.0), ('G5', 1.15), ('E5', 1.3)]
    return mix([(t, tone(n(x), .09, shape='square', a=.002, tau=.07, hold=.03, cutoff=n(x) * 5), .55) for x, t in seq])


@ring_sound('whistletune', 'Whistle Tune', 'Someone whistling a little calling tune.', 2.6, wet=.25)
def _():
    seq = [('G6', 0, .14), ('E6', .16, .14), ('G6', .32, .14), ('C7', .5, .3), ('B6', .9, .14), ('G6', 1.06, .14), ('A6', 1.22, .4)]
    return mix([(t, whistle(n(x), d)) for x, t, d in seq])


@ring_sound('bubblering', 'Bubble Ring', 'Bloops bubbling up in rhythm.', 2.0)
def _():
    seq = [(0, 500), (.12, 700), (.24, 900), (.48, 700), (.72, 500), (.84, 700), (.96, 1100)]
    return mix([(t, bubble(f, .18, 2.0)) for t, f in seq])


@ring_sound('belltower', 'Bell Tower', 'Little FM bells ringing a hook.', 2.8, wet=.3, rt=2)
def _():
    seq = [('E6', 0), ('C6', .2), ('D6', .4), ('G5', .6), ('G5', 1.0), ('D6', 1.2), ('E6', 1.4), ('C6', 1.6)]
    return mix([(t, fm(n(x), 1.0, 3.5, 3.5, .5, .2, .6), .6) for x, t in seq])


@ring_sound('doowop', 'Doo-Wop', 'A tiny voice singing "doo, doo-doo".', 2.4, wet=.18)
def _():
    seq = [('C5', 0, .18), ('E5', .3, .12), ('G5', .45, .3), ('A5', .9, .12), ('G5', 1.05, .3)]
    return mix([(t, voice(n(x), d, 'u', 'o')) for x, t, d in seq])


@ring_sound('kaligroove', 'Kalimba Groove', 'Kalimba with a little knock beat.', 2.4)
def _():
    seq = [('A5', 0), ('C6', .15), ('E6', .3), ('D6', .6), ('C6', .75), ('A5', .9), ('G5', 1.2), ('A5', 1.35)]
    beat = [(t, knock(1100, .1), .3) for t in (0, .3, .6, .9, 1.2)]
    return mix([(t, kalimba(n(x))) for x, t in seq] + beat)


@ring_sound('retrophone', 'Retro Trill', 'A friendly take on the old phone trill.', 2.6)
def _():
    trill = []
    for burst in (0, .5):
        for i in range(10):
            f = n('A5') if i % 2 == 0 else n('C#6')
            trill.append((burst + i * .035, tone(f, .04, shape='tri', a=.002, tau=.05, hold=.02), .6))
    return mix(trill)


# ---- Outgoing call (three rounds each)
def out_sound(sid, name, desc, cycle, wet=.2, rt=1.5, gain=.8):
    def wrap(fn):
        sound('outgoing', sid, name, desc, wet, rt, gain)(lambda: loop3(fn(), cycle))
        return fn
    return wrap


@out_sound('softpulse', 'Soft Pulse', 'A gentle two-tone purr, then a pause.', 2.0)
def _():
    return mix([(0, tone(n('E5'), .35, None, 'tri', .03, .2, hold=.1)), (.3, tone(n('C5'), .4, None, 'tri', .03, .2, hold=.1))])


@out_sound('heartbeat', 'Heartbeat Glow', 'A soft thump-thump with a glow.', 1.6)
def _():
    th = lambda: tone(80, .2, 50, 'sine', .004, .08)
    return mix([(0, th()), (.18, th(), .7), (0, tone(n('E5'), .5, None, 'sine', .05, .25), .2)])


@out_sound('sonar', 'Sonar', 'A sonar ping echoing out.', 2.2, wet=.25)
def _():
    return echo(tone(n('B5'), .5, n('A5'), 'sine', .003, .2), .3, .35, 3, 2500)


@out_sound('bubblewait', 'Bubble Wait', 'One bloop, a breath, another bloop.', 1.8)
def _():
    return mix([(0, bubble(500, .2, 1.8)), (.6, bubble(600, .2, 1.8), .7)])


@out_sound('pluckwait', 'Pluck Wait', 'Two plucks, waiting for an answer.', 2.0)
def _():
    return mix([(0, pluck(n('G4'))), (.25, pluck(n('D5')))])


@out_sound('beacon', 'Space Beacon', 'A soft beacon beep with an echo trail.', 2.2, wet=.25)
def _():
    return echo(fm(n('E6'), .25, 1.0, 1.5, .3, .1, .12), .22, .4, 3, 3000)


@out_sound('hum', 'Hum Hum', 'Someone humming "mm-mm" while they wait.', 2.0, wet=.15)
def _():
    return mix([(0, voice(n('E4'), .3, 'm', 'u')), (.36, voice(n('G4'), .35, 'm', 'u'))])


@out_sound('warmring', 'Warm Ringback', 'The classic ringback tone, made warmer.', 3.0)
def _():
    t = T(1.4)
    w = (np.sin(2 * np.pi * 440 * t) + np.sin(2 * np.pi * 480 * t)) * .5
    return lp(w, 1500) * np.clip(t / .05, 0, 1) * np.clip((1.4 - t) / .1, 0, 1) * .6


@out_sound('marimbawait', 'Marimba Wait', 'Three soft marimba notes.', 2.2)
def _():
    return mix([(0, marimba(n('C5'))), (.2, marimba(n('G5'))), (.4, marimba(n('E5')))])


# ---- Call connected / ended / join / leave (pairs designed together)
@sound('connected', 'clickin', 'Click In', 'A pop and a bright blip: you’re live.')
def _():
    return mix([(0, pop(1800)), (.03, tone(n('A6'), .15, shape='tri', tau=.08))])


@sound('connected', 'bloopup', 'Bloop Up', 'Two bloops stepping up.')
def _():
    return mix([(0, bubble(500, .16, 1.8)), (.08, bubble(800, .2, 1.8))])


@sound('connected', 'spark', 'Spark', 'A zap up into a sparkle.', wet=.25)
def _():
    return mix([(0, tone(300, .12, 2400, 'saw', .002, .08, cutoff=4000), .4), (.1, celesta(n('E7')), .7)])


@sound('connected', 'chordpop', 'Chord Pop', 'A short, happy major chord.')
def _():
    return chord(lambda f: tone(f, .3, None, 'tri', .004, .12), [n('C5'), n('E5'), n('G5'), n('C6')])


@sound('connected', 'whistleup', 'Whistle Up', 'A quick whistle up.')
def _():
    return whistle(n('C6'), .2, n('G6'))


@sound('connected', 'glassup', 'Glass Up', 'Two glass notes, up.', wet=.28)
def _():
    return mix([(0, glass(n('E6'), 1.2), .7), (.08, glass(n('B6'), 1.4))])


@sound('connected', 'swoop', 'Synth Swoop', 'A filtered synth swooping up.')
def _():
    return tone(200, .25, 900, 'saw', .005, .15, cutoff=glide(400, 5000, .25)) * .6


@sound('connected', 'yo', 'Yo!', 'A sung "yo!", going up.', wet=.15)
def _():
    return voice(n('E5'), .22, 'i', 'o', n('A5'))


@sound('connected', 'chipup', 'Chip Up', 'Two chiptune notes, up.')
def _():
    return mix([(0, tone(n('E6'), .07, shape='square', tau=.05, hold=.02, cutoff=6000), .6), (.07, tone(n('B6'), .12, shape='square', tau=.08, hold=.02, cutoff=7000), .6)])


@sound('ended', 'clickout', 'Click Out', 'A blip down and a soft pop.')
def _():
    return mix([(0, tone(n('A6'), .15, n('E6'), 'tri', tau=.08)), (.1, pop(900), .8)])


@sound('ended', 'bloopdown', 'Bloop Down', 'Two bloops stepping down.')
def _():
    return mix([(0, bubble(800, .16, 1.5)), (.09, bubble(500, .2, 1.4))])


@sound('ended', 'fizzle', 'Fizzle', 'A zap down that fizzles out.', wet=.2)
def _():
    return mix([(0, tone(2000, .2, 250, 'saw', .002, .12, cutoff=3000), .4), (.1, hp(noise(.2), 3000) * env(.2, .005, .06), .2)])


@sound('ended', 'chorddrop', 'Chord Drop', 'A soft chord sliding down a step.')
def _():
    a = chord(lambda f: tone(f, .2, None, 'tri', .004, .1), [n('G4'), n('B4'), n('D5')])
    b = chord(lambda f: tone(f, .4, None, 'tri', .004, .2), [n('F4'), n('A4'), n('C5')])
    return mix([(0, a), (.14, b)])


@sound('ended', 'whistledown', 'Whistle Down', 'A quick whistle down.')
def _():
    return whistle(n('G6'), .26, n('C6'))


@sound('ended', 'glassdown', 'Glass Down', 'Two glass notes, down.', wet=.28)
def _():
    return mix([(0, glass(n('B6'), 1.2), .8), (.1, glass(n('E6'), 1.4), .8)])


@sound('ended', 'swoopdown', 'Synth Swoop Down', 'A filtered synth swooping down.')
def _():
    return tone(900, .3, 180, 'saw', .005, .18, cutoff=glide(5000, 300, .3)) * .6


@sound('ended', 'bumbum', 'Bum-Bum', 'A sung "bum-bum", closing the door.', wet=.15)
def _():
    return mix([(0, voice(n('G4'), .14, 'm', 'u')), (.16, voice(n('C4'), .24, 'u', 'm'))])


@sound('ended', 'chipdown', 'Chip Down', 'Two chiptune notes, down.')
def _():
    return mix([(0, tone(n('B6'), .07, shape='square', tau=.05, hold=.02, cutoff=7000), .6), (.07, tone(n('E6'), .14, shape='square', tau=.09, hold=.02, cutoff=6000), .6)])


JOIN_LEAVE = [
    ('blip', 'Blip', 'Tiny triangle blips.', lambda up: mix([(0, tone(n('C6') if up else n('G6'), .06, shape='tri', tau=.04)), (.06, tone(n('G6') if up else n('C6'), .09, shape='tri', tau=.06))])),
    ('bubble', 'Bubble', 'A bubble coming or going.', lambda up: bubble(500, .2, 2.0) if up else bubble(900, .2, 0.55, .06)),
    ('pluck', 'Pluck', 'Two plucked notes.', lambda up: mix([(0, pluck(n('D5') if up else n('A5'))), (.07, pluck(n('A5') if up else n('D5')))])),
    ('glass', 'Glass', 'Two glassy taps.', lambda up: mix([(0, glass(n('E6') if up else n('B6'), 1.0), .6), (.07, glass(n('B6') if up else n('E6'), 1.0), .6)])),
    ('wood', 'Wood', 'Two woodblock taps.', lambda up: mix([(0, wood(n('A5') if up else n('E6'))), (.07, wood(n('E6') if up else n('A5')))])),
    ('chip', 'Chip', 'Two chiptune notes.', lambda up: mix([(0, tone(n('C6') if up else n('G6'), .06, shape='square', tau=.04, hold=.02, cutoff=5000), .6), (.06, tone(n('G6') if up else n('C6'), .08, shape='square', tau=.05, hold=.02, cutoff=5000), .6)])),
    ('whistle', 'Whistle', 'A short whistle slide.', lambda up: whistle(n('D6'), .14, n('A6')) if up else whistle(n('A6'), .14, n('D6'))),
    ('voice', 'Doo', 'A tiny sung "doo".', lambda up: voice(n('C5'), .14, 'u', 'o', n('G5')) if up else voice(n('G5'), .14, 'o', 'u', n('C5'))),
    ('zap', 'Zap', 'A quick sci-fi zap.', lambda up: tone(400 if up else 1800, .1, 1800 if up else 400, 'saw', .002, .06, cutoff=3500) * .5),
]
for sid, name, desc, fn in JOIN_LEAVE:
    sound('join', sid, name, desc, gain=.85)(lambda fn=fn: fn(True))
    sound('leave', sid, name, desc, gain=.8)(lambda fn=fn: fn(False))

EVENTS = [
    ('message', 'New message'), ('mention', '@mention'), ('constellation', 'Constellation message'),
    ('friend', 'Friend request'), ('online', 'Friend comes online'), ('login', 'Log in'), ('logoff', 'Log off'),
    ('ring', 'Incoming call'), ('outgoing', 'Outgoing call'), ('connected', 'Call connected'),
    ('ended', 'Call ended'), ('join', 'Someone joins a call'), ('leave', 'Someone leaves a call'),
]

# ---------------------------------------------------------------- finishing


def make_ir(rt, seconds=2.4):
    nlen = int(seconds * SR)
    t = np.arange(nlen) / SR
    irs = []
    for _ in range(2):
        x = lp(rng.standard_normal(nlen) * np.exp(-t * 6.9 / rt), 7000)
        x = np.concatenate([np.zeros(int(.01 * SR)), x])[:nlen]
        irs.append(x / np.sqrt(np.sum(x ** 2)))
    return irs


def finish(dry, wet, rt, gain):
    dry = dry / (np.abs(dry).max() + 1e-9)
    dry = np.concatenate([dry, np.zeros(int(1.6 * SR))])
    irs = make_ir(rt)
    left = dry * (1 - wet) + fftconvolve(dry, irs[0])[:len(dry)] * wet * 2.2
    right = dry * (1 - wet) + fftconvolve(dry, irs[1])[:len(dry)] * wet * 2.2
    st = np.stack([left, right], axis=1)
    level = np.abs(st).max(axis=1)
    above = np.where(level > level.max() * 10 ** (-46 / 20))[0]
    st = st[:above[-1] + int(.04 * SR)]
    # Even out loudness: match the loud part's RMS, then a soft limiter.
    loud = st[np.abs(st).max(axis=1) > np.abs(st).max() * 0.1]
    rms = np.sqrt(np.mean(loud ** 2)) + 1e-9
    st = st * (10 ** (-15 / 20) / rms)
    st = np.tanh(st * 1.2) / 1.2
    st = st / max(1.0, np.abs(st).max() / 10 ** (-1 / 20))
    fade = int(.05 * SR)
    st[-fade:] *= np.linspace(1, 0, fade)[:, None]
    st[:int(.002 * SR)] *= np.linspace(0, 1, int(.002 * SR))[:, None]
    return st * gain


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'signature2026'
    os.makedirs(out, exist_ok=True)
    manifest = {'events': []}
    for eid, ename in EVENTS:
        items = []
        for s in S[eid]:
            st = finish(s['fn'](), s['wet'], s['rt'], s['gain'])
            base = os.path.join(out, f"{eid}-{s['id']}")
            pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
            with wave.open(base + '.wav', 'wb') as f:
                f.setnchannels(2)
                f.setsampwidth(2)
                f.setframerate(SR)
                f.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', base + '.wav', '-c:a', 'libmp3lame',
                            '-b:a', '128k', base + '.mp3'], check=True)
            items.append({'id': s['id'], 'name': s['name'], 'desc': s['desc'], 'secs': round(len(st) / SR, 1)})
        manifest['events'].append({'id': eid, 'name': ename, 'sounds': items})
        print(eid, len(items))
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main()
