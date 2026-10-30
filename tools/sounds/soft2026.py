"""Glofly soft sounds, round 6 (Oct 29, 2026): Chip found the sharp sounds overwhelming and wants
softer, unique ones. Ten per event for the sounds still open (the call sounds are picked):
new message, message sent, @mention, constellation message, friend request, friend online, log in,
log off. Two log ins sing a soft "Glo-fly", two log offs "Good-bye" (round 3's synthetic voice,
made breathy and low so it's a hint of a voice, not a person).

Soft rules: rounded attacks (4-20 ms, no clicks), low-mid notes (mostly C4-C6), few upper
partials, everything gently low-passed, quieter loudness target.

Run:  python soft2026.py <out-folder>   (numpy + scipy; ffmpeg on PATH)
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np
from scipy.signal import fftconvolve

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import signature2026 as base  # noqa: E402
from signature2026 import (SR, T, bubble, celesta, echo, glide, kalimba, lp, mix, n, noise, partials,  # noqa: E402
                           reverse_bell, sine, sweep_noise, synth, tone)
import sung2026 as v  # noqa: E402

rng = np.random.default_rng(6006)

# ---------------------------------------------------------------- soft instruments


def soften(x, cutoff=3200, attack=0.006):
    y = lp(x, cutoff)
    n_a = max(1, int(attack * SR))
    y[:n_a] *= np.linspace(0, 1, n_a)
    return y


def felt(f, dur=1.8, tau=0.8):
    """Felt piano: warm, round, a soft thump of hammer."""
    w = partials(f, dur, [(1, 1, tau), (2, .28, tau * .45), (3, .09, tau * .25), (4.02, .03, tau * .15)], a=0.007)
    return soften(w, min(3200, f * 6))


def mallet(f, dur=1.4):
    """Soft rubber mallet on wood: no click, a hollow body."""
    w = partials(f, dur, [(1, 1, .5), (3.93, .06, .08), (2, .12, .22)], a=0.005)
    return soften(w, 2600)


def softkal(f, dur=1.6):
    t = T(dur)
    ph = 2 * np.pi * np.cumsum(f * (1 + 0.003 * np.exp(-t / 0.03))) / SR
    w = np.sin(ph) * np.exp(-t / 0.75) + .07 * np.sin(5.9 * ph) * np.exp(-t / .04)
    return soften(w, 2800, .006)


def softbell(f, dur=2.4, tau=1.3):
    w = partials(f, dur, [(1, 1, tau), (2.0, .16, tau * .5), (3.0, .04, tau * .3)], a=0.012)
    return soften(w, 3000, .012)


def pad(freqs, dur=1.4, attack=.25, tau=.6, cutoff=900):
    out = np.zeros(int(dur * SR))
    for f in freqs:
        for cents in (-6, 5):
            out += synth(np.full(len(out), f * 2 ** (cents / 1200)), 'saw', None, 16)
    out = lp(out, cutoff) * base.env(dur, attack, tau)
    return out / (np.abs(out).max() + 1e-9)


def breath(dur, f0, f1, q=1.6):
    return lp(sweep_noise(dur, f0, f1, q, a=dur * .35), 3500) * .5


def softbubble(f, dur=.2):
    return soften(bubble(f, dur, 1.5, .07), 2200, .004)


def hum(f0, dur, f1=None, vowel='m'):
    """A soft hummed note (mouth closed)."""
    return soften(v.syllable(f'- {vowel} - -', f0, dur, f1, 'soft'), 2000, .03)


def sine_note(f, dur, f1=None, a=.02, tau=.3, vib=None):
    return tone(f, dur, f1, 'sine', a, tau, vib=vib)


def tri_note(f, dur, a=.01, tau=.2):
    return soften(tone(f, dur, None, 'tri', a, tau), 2400, a)


def voice(sylls, notes, style='soft', base_dur=.2, last=.42, harmony=None):
    seq, t = [], 0.0
    for i, spec in enumerate(sylls):
        onset = spec.split()[0]
        pre = v.ONSET_NOISE.get(onset, 0) if onset != '-' else 0
        dur = last if i == len(sylls) - 1 else base_dur
        seq.append((t, spec, notes[min(i, len(notes) - 1)], dur))
        t += pre + dur + .035
    return soften(v.sing(seq, style, harmony), 2600, .015)


# A soft voice: triangle source (fewer buzzy highs), breathy, gentle vibrato.
v.STYLE['soft'] = dict(shift=1.0, src='tri', vib=(4.8, .01), breath=.16, chorus=0)
v.STYLE['softchoir'] = dict(shift=1.0, src='tri', vib=(4.6, .012), breath=.18, chorus=3)
v.CLARITY.update(trans=0.08, noise=1.2, gap=0.03, bw=0.9, f4=False)


def seq(fn, notes, step, **kw):
    return mix([(i * step, fn(n(x) if isinstance(x, str) else x, **kw)) for i, x in enumerate(notes)])


# ---------------------------------------------------------------- the sounds

S = {}


def sound(event, sid, name, desc, wet=.22, gain=1.0):
    def wrap(fn):
        S.setdefault(event, []).append(dict(id=sid, name=name, desc=desc, fn=fn, wet=wet, gain=gain))
        return fn
    return wrap


# ---- New message
@sound('message', 'feltdrop', 'Felt Drop', 'Two warm felt-piano notes, up a fifth.')
def _():
    return mix([(0, felt(n('G4'))), (.11, felt(n('D5')))])


@sound('message', 'pillow', 'Pillow', 'One soft mallet note with its low octave underneath.')
def _():
    return mix([(0, mallet(n('E5'))), (0, mallet(n('E4')), .5)])


@sound('message', 'softbloop', 'Soft Bloop', 'A low, round bloop landing on a felt note.')
def _():
    return mix([(0, softbubble(330), .7), (.07, felt(n('B4')))])


@sound('message', 'moth', 'Moth', 'Two kalimba tines, a small step down.')
def _():
    return mix([(0, softkal(n('A5'))), (.13, softkal(n('F#5')))])


@sound('message', 'warmtap', 'Warm Tap', 'A rolled three-note felt chord.')
def _():
    return mix([(0, felt(n('C5')), .8), (.04, felt(n('E5')), .7), (.08, felt(n('G5')), .7)])


@sound('message', 'glowpulse', 'Glow Pulse', 'A soft bell blooming out of a warm pad.', wet=.28)
def _():
    return mix([(0, pad([n('D4'), n('A4')], .9, .12, .35), .35), (.1, softbell(n('A5')))])


@sound('message', 'hush', 'Hush', 'A breath of air settling onto one felt note.')
def _():
    return mix([(0, breath(.28, 500, 1600), .5), (.2, felt(n('E5')))])


@sound('message', 'twinglow', 'Twin Glow', 'Two soft bells, a sixth apart.', wet=.28)
def _():
    return mix([(0, softbell(n('C5'))), (.12, softbell(n('A5')), .8)])


@sound('message', 'velvet', 'Velvet', 'A single round vibraphone-like note with a slow shimmer.', wet=.26)
def _():
    t = T(1.8)
    w = sine_note(n('G5'), 1.8, None, .01, .6) * (1 - .25 * (0.5 + 0.5 * np.sin(2 * np.pi * 5 * t)))
    return mix([(0, w), (0, sine_note(n('G4'), 1.2, None, .01, .4), .3)])


@sound('message', 'mmhm', 'Mm-hm', 'A soft hummed "mm-hm", going up.')
def _():
    return mix([(0, hum(n('E4'), .18)), (.22, hum(n('A4'), .3))])


# ---- Message sent (new: when your own message goes)
@sound('sent', 'whoosh', 'Soft Whoosh', 'A small breath of air, upward.', wet=.15, gain=.75)
def _():
    return mix([(0, breath(.24, 400, 2200), .9), (.16, felt(n('C6'), 1.0, .35), .35)])


@sound('sent', 'flick', 'Flick', 'Two soft plucks flicking upward.', wet=.15, gain=.75)
def _():
    return mix([(0, soften(base.pluck(n('G4'), 1.0, .3), 2400)), (.06, soften(base.pluck(n('D5'), 1.0, .3), 2400))])


@sound('sent', 'lift', 'Lift', 'A round tone gliding up and away.', wet=.15, gain=.75)
def _():
    return sine_note(320, .3, 640, .015, .12)


@sound('sent', 'puff', 'Puff', 'A tiny soft bubble floating up.', wet=.12, gain=.75)
def _():
    return softbubble(420, .22)


@sound('sent', 'sendoff', 'Send-off', 'Two quick felt notes, up an octave.', wet=.15, gain=.75)
def _():
    return mix([(0, felt(n('E4'), 1.0, .4)), (.07, felt(n('E5'), 1.0, .4), .8)])


@sound('sent', 'float', 'Float', 'One quiet bell, high and light.', wet=.2, gain=.7)
def _():
    return softbell(n('E6'), 1.5, .6)


@sound('sent', 'paper', 'Paper Plane', 'A soft paper-like swish.', wet=.1, gain=.7)
def _():
    return lp(sweep_noise(.22, 900, 3500, 1.2, a=.05), 4000) * .8


@sound('sent', 'skip', 'Skip', 'A kalimba skipping up a fifth.', wet=.15, gain=.75)
def _():
    return mix([(0, softkal(n('D5'))), (.06, softkal(n('A5')), .8)])


@sound('sent', 'breeze', 'Breeze', 'Mostly air, with a hint of a note.', wet=.15, gain=.7)
def _():
    return mix([(0, breath(.3, 300, 1400), 1), (.1, sine_note(n('A5'), .4, None, .05, .15), .25)])


@sound('sent', 'hop', 'Hop', 'A soft mallet hopping up an octave.', wet=.15, gain=.75)
def _():
    return mix([(0, mallet(n('G4'))), (.07, mallet(n('G5')), .7)])


# ---- @mention
@sound('mention', 'nudge', 'Nudge', 'Three felt notes stepping up.')
def _():
    return seq(felt, ['C5', 'E5', 'A5'], .09)


@sound('mention', 'tapshoulder', 'Tap on the Shoulder', 'Two soft taps, then a warm bell.', wet=.24)
def _():
    tap = lambda: soften(base.knock(700, .1), 1800, .003)
    return mix([(0, tap(), .7), (.13, tap(), .7), (.3, softbell(n('G5')))])


@sound('mention', 'heyhum', 'Hey (hummed)', 'A soft, breathy "hey?" going up.')
def _():
    return voice(['h e i -'], ['D5'], last=.32)


@sound('mention', 'brightglow', 'Bright Glow', 'A soft bell triad rolling up.', wet=.28)
def _():
    return seq(softbell, ['C5', 'E5', 'G5'], .06)


@sound('mention', 'doublenudge', 'Double Nudge', 'A mallet note twice, then a step up.')
def _():
    return mix([(0, mallet(n('E5'))), (.12, mallet(n('E5')), .8), (.24, mallet(n('A5')))])


@sound('mention', 'callout', 'Call Out', 'Three kalimba tines climbing.')
def _():
    return seq(softkal, ['D5', 'F#5', 'B5'], .08)


@sound('mention', 'lanternup', 'Lantern Up', 'A warm swell that opens into a bell.', wet=.3)
def _():
    return mix([(0, pad([n('C4'), n('G4')], 1.0, .2, .4), .35), (.18, softbell(n('E5'))), (.18, softbell(n('C6')), .4)])


@sound('mention', 'mmhmq', 'Mm-hm?', 'A hummed "mm-hm?" asking for you.')
def _():
    return mix([(0, hum(n('C5'), .16)), (.2, hum(n('E5'), .3, n('G5')))])


@sound('mention', 'starnudge', 'Star Nudge', 'Three soft celesta notes, low and warm.', wet=.26)
def _():
    return seq(lambda f: soften(celesta(f, 1.6), 2600), ['G4', 'B4', 'E5'], .08)


@sound('mention', 'ripple', 'Ripple', 'A four-note felt ripple.')
def _():
    return seq(felt, ['C5', 'D5', 'E5', 'G5'], .055)


# ---- Constellation message
@sound('constellation', 'drift', 'Drift', 'A pad and a bell drifting into an echo.', wet=.32)
def _():
    return echo(mix([(0, pad([n('E4'), n('B4')], .9, .15, .4), .3), (.08, softbell(n('B5')))]), .26, .3, 2, 2200)


@sound('constellation', 'faraway', 'Far Away', 'One soft bell echoing into the distance.', wet=.32)
def _():
    return echo(softbell(n('E5')), .28, .4, 3, 1800)


@sound('constellation', 'nightswell', 'Night Swell', 'Air and a warm chord swelling up.', wet=.3)
def _():
    return mix([(0, breath(.5, 300, 1200), .5), (.1, pad([n('A3'), n('E4'), n('C#5')], 1.2, .3, .5), .45)])


@sound('constellation', 'starfelt', 'Star Felt', 'Two felt notes with a long, soft echo.', wet=.3)
def _():
    return echo(mix([(0, felt(n('B4'))), (.12, felt(n('F#5')), .8)]), .22, .35, 3, 2000)


@sound('constellation', 'orbitsoft', 'Soft Orbit', 'A round tone circling slowly.', wet=.3)
def _():
    return sine_note(n('E5'), .9, None, .06, .4, vib=(3.2, .02))


@sound('constellation', 'cosmos', 'Cosmos', 'A tiny far-off choir humming "ooh".', wet=.38)
def _():
    return soften(v.sing([(0, '- u - -', 'E4', .6)], 'softchoir', [0, 7, 12]), 1800, .08)


@sound('constellation', 'dustfall', 'Stardust Fall', 'Soft notes falling slowly.', wet=.32)
def _():
    return seq(lambda f: soften(celesta(f, 1.4), 2400), ['B5', 'G#5', 'E5', 'B4'], .1)


@sound('constellation', 'moonbeam', 'Moonbeam', 'A glass tone, softened to a glow.', wet=.32)
def _():
    return mix([(0, soften(base.glass(n('E5'), 2.0), 1500, .015)), (.1, soften(base.glass(n('B5'), 2.0), 1500, .015), .6)])


@sound('constellation', 'lanternfloat', 'Lantern Float', 'A kalimba note floating off with an echo.', wet=.3)
def _():
    return echo(softkal(n('A5')), .24, .35, 3, 2200)


@sound('constellation', 'nebulahum', 'Nebula Hum', 'A short warm chord swelling and fading.', wet=.36)
def _():
    return pad([n('D4'), n('A4'), n('F#5')], 1.3, .35, .45, 1100)


# ---- Friend request
@sound('friend', 'softknock', 'Soft Knock', 'Two gentle knocks, then a felt note.')
def _():
    tap = lambda f: soften(base.knock(f, .12), 1500, .003)
    return mix([(0, tap(650), .8), (.15, tap(700), .8), (.33, felt(n('G4'))), (.43, felt(n('C5')))])


@sound('friend', 'hellochime', 'Hello Chime', 'A low, soft two-tone doorbell.', wet=.28)
def _():
    return mix([(0, softbell(n('E5'))), (.3, softbell(n('C5'), 2.4, 1.5))])


@sound('friend', 'gift', 'Little Gift', 'A soft mallet roll up to a warm note.')
def _():
    return mix([(0, seq(mallet, ['C5', 'D5', 'E5', 'G5'], .05), .8), (.25, felt(n('C6')), .8)])


@sound('friend', 'hihum', 'Hi (hummed)', 'A soft, breathy "hi!" going up.')
def _():
    return voice(['h a i -'], ['G4'], last=.36)


@sound('friend', 'warmwelcome', 'Warm Welcome', 'A rolled felt chord, open and friendly.')
def _():
    return mix([(i * .045, felt(n(x)), .7) for i, x in enumerate(['F4', 'A4', 'C5', 'F5'])])


@sound('friend', 'twofriends', 'Two Friends', 'Two kalimba notes meeting in the middle.')
def _():
    return mix([(0, softkal(n('C5'))), (0, softkal(n('C6')), .6), (.16, softkal(n('E5'))), (.16, softkal(n('A5')), .6)])


@sound('friend', 'porchlight', 'Porch Light', 'A warm pad and a bell, like a light coming on.', wet=.3)
def _():
    return mix([(0, pad([n('G3'), n('D4')], 1.2, .15, .5), .35), (.12, softbell(n('B4'))), (.24, softbell(n('G5')), .7)])


@sound('friend', 'bubblehi', 'Bubble Hi', 'Three soft bubbles climbing.')
def _():
    return mix([(i * .08, softbubble(f), .7) for i, f in enumerate([300, 380, 470])])


@sound('friend', 'friendlyhop', 'Friendly Hop', 'Three soft mallet notes hopping up.')
def _():
    return seq(mallet, ['G4', 'B4', 'D5'], .1)


@sound('friend', 'heartglow', 'Heart Glow', 'A soft bell over a gentle swell.', wet=.3)
def _():
    return mix([(0, sine_note(n('A3'), 1.2, None, .25, .5), .4), (.15, softbell(n('E5'))), (.15, softbell(n('A5')), .45)])


# ---- Friend comes online (quiet)
@sound('online', 'softwoop', 'Soft Woop', 'A round tone sliding up, like someone walking in.', gain=.8)
def _():
    return sine_note(260, .26, 460, .02, .14)


@sound('online', 'lit', 'Lit', 'A breath and one warm note.', gain=.8)
def _():
    return mix([(0, breath(.2, 400, 1200), .4), (.12, felt(n('A4')))])


@sound('online', 'step', 'Step In', 'Two soft mallet steps up.', gain=.8)
def _():
    return mix([(0, mallet(n('C5'))), (.1, mallet(n('G5')), .8)])


@sound('online', 'peek', 'Peek', 'A single kalimba tine.', gain=.8)
def _():
    return softkal(n('E5'))


@sound('online', 'glowin', 'Glow In', 'A soft bell played backwards into the note.', gain=.8, wet=.26)
def _():
    return mix([(0, soften(reverse_bell(n('D5'), .35), 2200, .01), .6), (.35, softbell(n('D5'), 1.8, .9), .8)])


@sound('online', 'arrive', 'Arrive', 'A short, warm chord breathing in.', gain=.8, wet=.3)
def _():
    return pad([n('C4'), n('E4'), n('G4')], .8, .12, .3, 1000)


@sound('online', 'hum', 'Hum', 'A tiny hummed "mm" going up.', gain=.8)
def _():
    return hum(n('C4'), .26, n('G4'))


@sound('online', 'pebble', 'Pebble', 'One soft bubble, low and round.', gain=.8)
def _():
    return softbubble(280, .22)


@sound('online', 'twinkle', 'Quiet Twinkle', 'Two quiet celesta notes.', gain=.8, wet=.26)
def _():
    return mix([(0, soften(celesta(n('E5'), 1.4), 2400)), (.1, soften(celesta(n('B5'), 1.4), 2400), .7)])


@sound('online', 'warmblip', 'Warm Blip', 'Two soft rounded blips.', gain=.8)
def _():
    return mix([(0, tri_note(n('E5'), .12)), (.09, tri_note(n('A5'), .16))])


# ---- Log in (two sing "Glo-fly")
@sound('login', 'gloflysoft', 'Glo-fly (soft voice)', 'A soft, breathy "Glo-fly" over a warm chord.', wet=.3)
def _():
    vox = voice(['g o u -', 'f a i -'], ['G4', 'D5'], base_dur=.22, last=.5)
    return mix([(0, pad([n('G3'), n('D4'), n('B4')], 1.6, .3, .7), .3), (.08, vox), (.62, softbell(n('D6'), 2.0, .9), .25)])


@sound('login', 'gloflychoir', 'Glo-fly (little choir)', 'A tiny, soft choir singing "Glo-fly".', wet=.38)
def _():
    seq_ = [(0, 'g o u -', 'C5', .24), (.3, 'f a i -', 'G5', .52)]
    vox = soften(v.sing(seq_, 'softchoir', [0, 4, 7]), 2400, .02)
    return mix([(0, vox), (.34, softbell(n('G5'), 2.0, 1.0), .3)])


@sound('login', 'sunrise', 'Sunrise', 'A felt-piano arpeggio rising over a warm swell.', wet=.3)
def _():
    return mix([(0, pad([n('C4'), n('G4')], 1.6, .4, .7), .3), (.05, seq(felt, ['C5', 'E5', 'G5', 'C6'], .12), .9)])


@sound('login', 'lanternon', 'Lantern On', 'A breath of air, then a soft bell chord.', wet=.3)
def _():
    return mix([(0, breath(.35, 300, 1500), .45), (.3, mix([(0, softbell(n('A4'))), (0, softbell(n('C#5')), .7), (0, softbell(n('E5')), .7)]))])


@sound('login', 'gentlehello', 'Gentle Hello', 'Four kalimba notes saying hello.', wet=.26)
def _():
    return seq(softkal, ['G4', 'C5', 'D5', 'G5'], .13)


@sound('login', 'warmup', 'Warm Up', 'A slow swell into two soft mallet notes.', wet=.3)
def _():
    return mix([(0, pad([n('F3'), n('C4'), n('A4')], 1.5, .45, .6), .4), (.42, mallet(n('C5'))), (.54, mallet(n('F5')))])


@sound('login', 'fireflies', 'Fireflies', 'Soft glints gathering into a warm chord.', wet=.32)
def _():
    glints = [(rng.uniform(0, .45), sine_note(n(rng.choice(['E5', 'G5', 'A5', 'C6'])), .3, None, .02, .1), rng.uniform(.15, .3)) for _ in range(12)]
    return mix(glints + [(.5, mix([(0, felt(n('C4'))), (0, felt(n('E4')), .8), (0, felt(n('G4')), .8)]))])


@sound('login', 'dawnhum', 'Dawn Hum', 'A short hummed tune, rising.', wet=.26)
def _():
    return mix([(0, hum(n('C4'), .2)), (.22, hum(n('E4'), .2)), (.44, hum(n('G4'), .38)), (.44, softbell(n('G5'), 1.6, .8), .25)])


@sound('login', 'openwindow', 'Open Window', 'Air through a window, and two soft bells.', wet=.3)
def _():
    return mix([(0, breath(.6, 250, 1800), .4), (.25, softbell(n('D5'))), (.42, softbell(n('A5')), .7)])


@sound('login', 'bloomsoft', 'Soft Bloom', 'A gentle mallet roll opening into a bell.', wet=.28)
def _():
    return mix([(0, seq(mallet, ['D4', 'F#4', 'A4', 'D5'], .06), .8), (.28, softbell(n('A5')), .8)])


# ---- Log off (two sing "Good-bye")
@sound('logoff', 'goodbyesoft', 'Good-bye (soft voice)', 'A soft, breathy "good-bye" settling down.', wet=.3)
def _():
    vox = voice(['g u - d', 'b a i -'], ['A4', 'E4'], base_dur=.2, last=.5)
    return mix([(0, pad([n('A3'), n('E4')], 1.5, .25, .6), .25), (.05, vox)])


@sound('logoff', 'goodbyechoir', 'Good-bye (little choir)', 'A tiny, soft choir singing "good-bye".', wet=.38)
def _():
    seq_ = [(0, 'g u - d', 'E5', .22), (.3, 'b a i -', 'C5', .55)]
    return soften(v.sing(seq_, 'softchoir', [0, 4, 7]), 2400, .02)


@sound('logoff', 'sunset', 'Sunset', 'A felt-piano arpeggio falling gently.', wet=.3)
def _():
    return mix([(0, seq(felt, ['C6', 'G5', 'E5', 'C5'], .13), .9), (.3, pad([n('C4'), n('G4')], 1.4, .3, .6), .25)])


@sound('logoff', 'lanternoff', 'Lantern Off', 'A soft bell, then a puff of air.', wet=.3)
def _():
    return mix([(0, softbell(n('E5'))), (.35, lp(noise(.2), 800) * base.env(.2, .02, .06), .5)])


@sound('logoff', 'sleepy', 'Sleepy', 'Kalimba notes slowing down.', wet=.28)
def _():
    return mix([(0, softkal(n('A5'))), (.16, softkal(n('F#5'))), (.36, softkal(n('D5'))), (.62, softkal(n('A4')))])


@sound('logoff', 'nightfall', 'Nightfall', 'A warm chord sinking a step.', wet=.32)
def _():
    return mix([(0, pad([n('G4'), n('B4'), n('D5')], .7, .1, .3), .6), (.4, pad([n('F4'), n('A4'), n('C5')], 1.2, .1, .5), .6)])


@sound('logoff', 'driftaway', 'Drift Away', 'A round tone gliding down into an echo.', wet=.3)
def _():
    return echo(sine_note(560, .45, 300, .02, .25), .25, .35, 3, 1800)


@sound('logoff', 'hushhum', 'Hush Hum', 'A hummed "mm-mm", going down.', wet=.26)
def _():
    return mix([(0, hum(n('G4'), .22)), (.26, hum(n('D4'), .38))])


@sound('logoff', 'closeddoor', 'Close the Door', 'A soft knock and a low felt note.', wet=.24)
def _():
    return mix([(0, soften(base.knock(450, .16), 1200, .003), .7), (.06, felt(n('C4'), 2.0, 1.0)), (.06, felt(n('G4'), 2.0, 1.0), .5)])


@sound('logoff', 'goodnightfelt', 'Goodnight Felt', 'Two felt notes down, over a soft pad.', wet=.3)
def _():
    return mix([(0, felt(n('E5'))), (.2, felt(n('A4'))), (0, pad([n('A3'), n('E4')], 1.4, .2, .6), .25)])


# ---- Oct 30: more soft "Glo-fly" (log in) and "Good-bye" (log off) voices
v.STYLE['softcute'] = dict(shift=1.14, src='tri', vib=(5.4, .012), breath=.14, chorus=0)
v.STYLE['softdeep'] = dict(shift=.9, src='tri', vib=(4.4, .009), breath=.16, chorus=0)


def sung(steps, style='soft', cutoff=2600):
    """steps: (time, syllable, note, seconds)."""
    return soften(v.sing([(t, sy, nt, d) for t, sy, nt, d in steps], style), cutoff, .015)


@sound('login', 'gloflytiny', 'Glo-fly (tiny voice)', 'A tiny, soft "Glo-fly!" with a celesta twinkle.', wet=.28)
def _():
    vox = sung([(0, 'g o u -', 'G5', .2), (.27, 'f a i -', 'D6', .42)], 'softcute', 2800)
    return mix([(0, vox), (.3, soften(celesta(n('D6'), 1.6), 2600), .3), (.3, soften(celesta(n('G6'), 1.6), 2600), .2)])


@sound('login', 'gloflywarm', 'Glo-fly (warm voice)', 'A low, warm "Glo-fly" over a felt-piano chord.', wet=.3)
def _():
    vox = sung([(0, 'g o u -', 'C4', .24), (.31, 'f a i -', 'G4', .5)], 'softdeep', 2200)
    chord = mix([(0, felt(n('C4'))), (0, felt(n('E4')), .7), (0, felt(n('G4')), .7)])
    return mix([(0, vox), (.3, chord, .5)])


@sound('login', 'gloflysong', 'Glo-o-fly (sung)', 'A little three-note "Glo-o-fly", like a tiny tune.', wet=.3)
def _():
    vox = sung([(0, 'g o u -', 'E5', .2), (.22, '- o u -', 'G5', .18), (.45, 'f a i -', 'C6', .48)], 'soft', 2600)
    return mix([(0, pad([n('C4'), n('G4')], 1.6, .35, .7), .25), (0, vox), (.46, softkal(n('C6')), .35)])


@sound('login', 'gloflyecho', 'Glo-fly (echo)', 'A soft "Glo-fly" that echoes away, with a kalimba.', wet=.3)
def _():
    vox = sung([(0, 'g o u -', 'A4', .2), (.27, 'f a i -', 'E5', .42)], 'soft', 2400)
    return echo(mix([(0, vox), (.28, softkal(n('A5')), .35)]), .3, .3, 2, 1800)


@sound('logoff', 'goodbyetiny', 'Good-bye (tiny voice)', 'A tiny, soft "good-bye" waving off.', wet=.28)
def _():
    vox = sung([(0, 'g u - d', 'D6', .18), (.26, 'b a i -', 'A5', .42)], 'softcute', 2800)
    return mix([(0, vox), (.28, soften(celesta(n('A5'), 1.6), 2400), .25)])


@sound('logoff', 'goodbyewarm', 'Good-bye (warm voice)', 'A low, warm "good-bye" over two felt notes.', wet=.3)
def _():
    vox = sung([(0, 'g u - d', 'G4', .22), (.3, 'b a i -', 'D4', .52)], 'softdeep', 2200)
    return mix([(0, vox), (.02, felt(n('G4')), .35), (.32, felt(n('D4')), .45)])


@sound('logoff', 'goodbyesong', 'Good-bye-ye (sung)', 'A gentle "good-bye-ye", drifting down three notes.', wet=.3)
def _():
    vox = sung([(0, 'g u - d', 'E5', .2), (.26, 'b a i -', 'C5', .22), (.5, '- a i -', 'G4', .5)], 'soft', 2500)
    return mix([(0, vox), (.2, pad([n('C4'), n('G4')], 1.4, .3, .6), .22)])


@sound('logoff', 'goodbyeecho', 'Good-bye (echo)', 'A soft "good-bye" fading off into an echo.', wet=.3)
def _():
    vox = sung([(0, 'g u - d', 'B4', .2), (.27, 'b a i -', 'E4', .46)], 'soft', 2300)
    return echo(mix([(0, vox), (.28, softbell(n('E5'), 1.8, .9), .3)]), .3, .3, 2, 1700)


# ---- Oct 30 (2): the first Glo-fly voices sounded like "go die": no L in either word, and the soft
# filter took the F away. These build the blends: a "g" tap into a held L for "Glo", and an audible
# F (its hiss kept above the soft filter) into an L for "fly".


def blend_word(first, spec, f0, dur, f1=None, style='soft', l_hold=.07, cutoff=2600, hiss=.35):
    """A syllable with a two-consonant start: `first` ('g' or 'f') then the L already in `spec`."""
    shift = v.STYLE[style]['shift']
    voiced = soften(v.syllable(spec, f0, dur + l_hold, f1, style), cutoff, .02)
    if first == 'f':
        fr = lp(base.hp(noise(.1), 2200), 7000) * base.env(.1, .025, .05) * hiss
        return mix([(0, fr), (.075, voiced)])
    tap = lp(v._noise_part('g', .03, 'o', shift), 3000) * .5
    return mix([(0, tap), (.012, voiced)])


def glofly(n1, n2, style='soft', step=.3, d1=.22, d2=.5, cutoff=2600):
    glo = blend_word('g', 'l o u -', n(n1), d1, None, style, cutoff=cutoff)
    fly = blend_word('f', 'l a i -', n(n2), d2, None, style, cutoff=cutoff)
    return mix([(0, glo), (step, fly)])


v.CLARITY.update(trans=0.11)  # a longer L glide into each vowel (all voices on this page render with it)


@sound('login', 'gloflyclear', 'Glo-fly (clear)', 'A soft "Glo-fly" with the G-L and F-L blends sounded out.', wet=.28)
def _():
    return mix([(0, pad([n('G3'), n('D4')], 1.6, .3, .7), .22), (.04, glofly('G4', 'D5'))])


@sound('login', 'gloflyclearbright', 'Glo-fly (clear, bright)', 'A lighter, higher "Glo-fly" with a kalimba.', wet=.28)
def _():
    return mix([(0, glofly('C5', 'G5', 'softcute', cutoff=2900)), (.34, softkal(n('G5')), .3)])


@sound('login', 'gloflyclearwarm', 'Glo-fly (clear, warm)', 'A low, warm "Glo-fly" over a felt chord.', wet=.3)
def _():
    chord = mix([(0, felt(n('D4'))), (0, felt(n('F#4')), .7), (0, felt(n('A4')), .7)])
    return mix([(0, glofly('D4', 'A4', 'softdeep', cutoff=2400)), (.32, chord, .45)])


@sound('login', 'gloflyslow', 'Glooo-flyyy (slow)', 'A slow, sung "Glooo-flyyy", each blend taking its time.', wet=.3)
def _():
    return mix([(0, pad([n('C4'), n('G4')], 2.0, .4, .8), .22), (.04, glofly('E4', 'C5', step=.42, d1=.32, d2=.62))])


EVENTS = [
    ('message', 'New message'), ('sent', 'Message sent (new)'), ('mention', '@mention'),
    ('constellation', 'Constellation message'), ('friend', 'Friend request'), ('online', 'Friend comes online'),
    ('login', 'Log in'), ('logoff', 'Log off'),
]


def make_ir(rt=1.6, seconds=2.2):
    nlen = int(seconds * SR)
    t = np.arange(nlen) / SR
    irs = []
    for _ in range(2):
        x = lp(rng.standard_normal(nlen) * np.exp(-t * 6.9 / rt), 4500)
        x = np.concatenate([np.zeros(int(.012 * SR)), x])[:nlen]
        irs.append(x / np.sqrt(np.sum(x ** 2)))
    return irs


IRS = make_ir()


def finish_soft(dry, wet, gain):
    """Gentle: low-passed, roomy, quieter than the earlier rounds, never clipped."""
    dry = lp(dry, 6000)
    dry = dry / (np.abs(dry).max() + 1e-9)
    dry = np.concatenate([dry, np.zeros(int(1.4 * SR))])
    left = dry * (1 - wet) + fftconvolve(dry, IRS[0])[:len(dry)] * wet * 2.0
    right = dry * (1 - wet) + fftconvolve(dry, IRS[1])[:len(dry)] * wet * 2.0
    st = np.stack([left, right], axis=1)
    level = np.abs(st).max(axis=1)
    above = np.where(level > level.max() * 10 ** (-44 / 20))[0]
    st = st[:above[-1] + int(.04 * SR)]
    loud = st[np.abs(st).max(axis=1) > np.abs(st).max() * 0.1]
    rms = np.sqrt(np.mean(loud ** 2)) + 1e-9
    st = st * (10 ** (-19 / 20) / rms)
    st = st / max(1.0, np.abs(st).max() / 10 ** (-3 / 20))
    fade = int(.06 * SR)
    st[-fade:] *= np.linspace(1, 0, fade)[:, None]
    st[:int(.003 * SR)] *= np.linspace(0, 1, int(.003 * SR))[:, None]
    return st * gain


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'soft2026'
    os.makedirs(out, exist_ok=True)
    manifest = {'events': []}
    for eid, ename in EVENTS:
        items = []
        for s in S[eid]:
            st = finish_soft(s['fn'](), s['wet'], s['gain'])
            path = os.path.join(out, f"{eid}-{s['id']}")
            pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
            with wave.open(path + '.wav', 'wb') as f:
                f.setnchannels(2)
                f.setsampwidth(2)
                f.setframerate(SR)
                f.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', path + '.wav', '-c:a', 'libmp3lame',
                            '-b:a', '128k', path + '.mp3'], check=True)
            items.append({'id': s['id'], 'name': s['name'], 'desc': s['desc'], 'secs': round(len(st) / SR, 1)})
        manifest['events'].append({'id': eid, 'name': ename, 'sounds': items})
        print(eid, len(items))
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main()
