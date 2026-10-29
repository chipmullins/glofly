"""Glofly sung sounds preview (Oct 28, 2026, round 3): little synthetic voices singing short words
("hel-lo", "bye-bye", "yoo-hoo"...), in several voices (normal, cute, deep, choir, robot, whisper),
about ten per event. Builds on round 2 (signature2026.py), whose "Bye-Bye" Chip loved.

Run:  python sung2026.py <out-folder>   (numpy + scipy; ffmpeg on PATH)
Writes <out>/<event>-<id>.mp3 and <out>/manifest.json.

Syllables are written as "onset vowel glide coda" separated by spaces, '-' for none:
  "h e - l" = hel, "l o u -" = lo(w), "b a i -" = bye, "y u - -" = you.
Vowels: a (father), ae (cat), e (bed), i (see), o (go), u (too), uh (cup), aw (saw), er.
Onsets/codas: h b d g p t k m n l r w y s sh f th ch z v ng.
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import signature2026 as base  # noqa: E402  (shared building blocks)
from signature2026 import (SR, T, bell, bp, celesta, env, finish, glass, glide, hp, lp, marimba,  # noqa: E402
                           mix, n, noise, synth, tone, whistle, kalimba, pluck)

rng = np.random.default_rng(3003)

# Round 5 (sung2026b.py) turns these up for clearer words; the defaults are round 3's.
CLARITY = dict(trans=0.06, noise=1.0, gap=0.02, bw=1.0, f4=False)

F = {  # formant sets: (Hz, gain, bandwidth)
    'a': [(780, 1.0, 80), (1150, .55, 90), (2850, .15, 120)],
    'ae': [(660, 1.0, 80), (1720, .5, 100), (2410, .2, 120)],
    'e': [(500, 1.0, 70), (1750, .5, 100), (2600, .2, 120)],
    'i': [(290, 1.0, 60), (2250, .4, 100), (3000, .22, 120)],
    'o': [(470, 1.0, 70), (820, .55, 80), (2700, .1, 100)],
    'u': [(330, 1.0, 50), (760, .35, 60), (2500, .07, 100)],
    'uh': [(620, 1.0, 80), (1200, .5, 90), (2550, .12, 120)],
    'aw': [(570, 1.0, 80), (840, .5, 90), (2410, .1, 120)],
    'er': [(490, 1.0, 70), (1350, .5, 90), (1690, .35, 100)],
    'm': [(250, 1.0, 50), (1000, .1, 80), (2200, .04, 100)],
    'n': [(250, 1.0, 50), (1700, .12, 90), (2600, .05, 100)],
    'l': [(360, 1.0, 60), (1100, .35, 80), (2700, .12, 120)],
    'r': [(460, 1.0, 70), (1300, .4, 90), (1650, .3, 100)],
    'bL': [(300, 1.0, 60), (900, .3, 80), (2200, .1, 100)],
    'dL': [(300, 1.0, 60), (1700, .35, 90), (2600, .15, 100)],
    'gL': [(300, 1.0, 60), (2000, .35, 90), (2400, .2, 100)],
}
F['w'] = F['u']
F['y'] = F['i']
F['ng'] = F['n']
F['z'] = F['i']
F['v'] = F['bL']
QUIET = {'m': .45, 'n': .45, 'ng': .45, 'l': .8, 'r': .8, 'bL': .5, 'dL': .5, 'gL': .5, 'v': .5}

VOICED_ONSET = {'m': 'm', 'n': 'n', 'l': 'l', 'r': 'r', 'w': 'w', 'y': 'y', 'b': 'bL', 'd': 'dL', 'g': 'gL',
                'z': 'z', 'v': 'v', 'p': 'bL', 't': 'dL', 'k': 'gL', 'ch': 'dL', 'th': 'dL'}

STYLE = {
    'normal': dict(shift=1.0, src='saw', vib=(5.2, .012), breath=.05, chorus=0),
    'cute': dict(shift=1.2, src='saw', vib=(6.5, .016), breath=.04, chorus=0),
    'deep': dict(shift=.86, src='saw', vib=(4.6, .01), breath=.05, chorus=0),
    'choir': dict(shift=1.0, src='saw', vib=(5.0, .014), breath=.08, chorus=3),
    'robot': dict(shift=1.05, src='square', vib=(0, 0), breath=0, chorus=0),
    'whisper': dict(shift=1.05, src='noise', vib=(0, 0), breath=1, chorus=0),
}


def formant_filter(src, name, shift):
    out = np.zeros_like(src)
    sets = F[name] + ([(3500, .08, 160)] if CLARITY['f4'] else [])
    for f, g, bw in sets:
        out += bp(src, f * shift, (f * shift) / (bw * CLARITY['bw'])) * g
    rms = np.sqrt(np.mean(out ** 2)) + 1e-9
    return out / rms * QUIET.get(name, 1.0)


def blend(src, states, dur, shift):
    """states: [(time, formant-set)]; weights move linearly between neighbours."""
    t = T(dur)
    names = list(dict.fromkeys(s for _, s in states))
    filtered = {name: formant_filter(src, name, shift) for name in names}
    out = np.zeros_like(src)
    times = [s[0] for s in states]
    for name in names:
        indicator = np.array([1.0 if s == name else 0.0 for _, s in states])
        out += filtered[name] * np.interp(t, times, indicator)
    return out


def noise_part(kind, dur, vowel, shift):
    return _noise_part(kind, dur, vowel, shift) * CLARITY['noise']


def _noise_part(kind, dur, vowel, shift):
    x = noise(dur)
    e = env(dur, .008, dur / 2.5)
    if kind == 'h':
        return formant_filter(x, vowel, shift) * env(dur, .01, dur / 2) * .35
    if kind in ('s', 'z'):
        return bp(x, 6500, 2.5) * e * .5
    if kind in ('sh', 'ch'):
        return bp(x, 3000, 2.0) * e * .5
    if kind in ('f', 'th', 'v'):
        return hp(x, 3000) * e * .2
    if kind in ('t', 'd'):
        return hp(x, 3500) * env(dur, .001, .006) * .6
    if kind in ('k', 'g'):
        return bp(x, 2200, 3) * env(dur, .001, .008) * .9
    if kind in ('p', 'b'):
        return lp(x, 1500) * env(dur, .001, .005) * .6
    return np.zeros(len(x))


ONSET_NOISE = {'h': .06, 's': .09, 'sh': .09, 'f': .07, 'th': .06, 'ch': .07, 't': .03, 'k': .035, 'p': .03,
               'b': .015, 'd': .015, 'g': .015, 'z': .05, 'v': .04}
CODA_NOISE = {'s': .1, 'sh': .1, 't': .03, 'k': .04, 'p': .03, 'f': .08, 'ch': .07}


def syllable(spec, f0, dur, f1=None, style='normal', vib_delay=.08, amp=1.0):
    onset, vowel, glide_to, coda = [None if p == '-' else p for p in spec.split()]
    assert vowel in ('a', 'ae', 'e', 'i', 'o', 'u', 'uh', 'aw', 'er', 'm'), spec
    st = STYLE[style]
    shift = st['shift']
    pre = ONSET_NOISE.get(onset, 0) if onset in ONSET_NOISE else 0
    voiced = max(dur, .06)
    t = T(voiced)
    fr = glide(f0, f1, voiced, 'fast') if f1 else np.full(len(t), f0)
    if st['vib'][1]:
        vibe = np.clip((t - vib_delay) / .1, 0, 1) * st['vib'][1]
        fr = fr * (1 + vibe * np.sin(2 * np.pi * st['vib'][0] * t))
    if st['src'] == 'noise':
        src = noise(voiced)
    else:
        src = synth(fr * (1 + 0.002 * rng.standard_normal(len(fr)).cumsum() / 200), st['src'], None, 40)
        src = src + noise(voiced) * st['breath']
    states = []
    if onset in VOICED_ONSET:
        states.append((0.0, VOICED_ONSET[onset]))
        states.append((min(CLARITY['trans'], voiced * .35), vowel))
    else:
        states.append((0.0, vowel))
    if glide_to:
        states.append((voiced * .45, vowel))
        states.append((voiced * (.8 if coda else .95), glide_to))
    if coda and coda in F:
        states.append((voiced * .7, states[-1][1]))
        states.append((voiced, coda))
    else:
        states.append((voiced, states[-1][1]))
    states.sort(key=lambda s: s[0])
    voice = blend(src, states, voiced, shift)
    release = .04 if coda in CODA_NOISE else .07
    e = np.clip(t / .012, 0, 1) * np.clip((voiced - t) / release, 0, 1)
    if onset in ('m', 'n', 'l', 'w', 'y', 'r'):
        e = np.clip(t / .025, 0, 1) * np.clip((voiced - t) / release, 0, 1)
    voice *= e
    parts = []
    if pre:
        parts.append((0, noise_part(onset, pre, vowel, shift)))
    gap = CLARITY['gap'] if onset in ('t', 'k', 'p', 'ch') else 0
    start = pre * (0.55 if onset in ('h', 's', 'sh', 'f', 'th', 'z', 'v') else 1) + gap
    parts.append((start, voice))
    if coda in CODA_NOISE:
        parts.append((start + voiced + (.02 if coda in ('t', 'k', 'p') else 0), noise_part(coda, CODA_NOISE[coda], vowel, shift)))
    out = mix(parts)
    out /= (np.abs(out).max() + 1e-9)
    return out * amp


def sing(notes, style='normal', harmony=None):
    """notes: (time, "syllable spec", pitch, dur[, end pitch]). harmony: list of semitone offsets (choir)."""
    st = STYLE[style]
    parts = []
    offsets = harmony if harmony else ([0] if not st['chorus'] else [0, 0, 0])
    for k, semis in enumerate(offsets):
        detune = 2 ** ((semis + (k - 1) * 0.08 * (st['chorus'] > 0)) / 12)
        for nt in notes:
            t0, spec, p, d = nt[:4]
            p1 = nt[4] if len(nt) > 4 else None
            f0 = (n(p) if isinstance(p, str) else p) * detune
            f1 = ((n(p1) if isinstance(p1, str) else p1) * detune) if p1 else None
            parts.append((t0 + k * 0.006, syllable(spec, f0, d, f1, style), 1 / len(offsets) ** .5))
    return mix(parts)


S = {}


def sound(event, sid, name, desc, wet=.18, rt=1.5, gain=1.0):
    def wrap(fn):
        S.setdefault(event, []).append(dict(id=sid, name=name, desc=desc, fn=fn, wet=wet, rt=rt, gain=gain))
        return fn
    return wrap


def loop3(pattern, cycle):
    return mix([(c * cycle, pattern) for c in range(3)])


# Syllables used a lot
HEL, LO, LOW = 'h e - l', 'l o u -', 'l o u -'
BYE = 'b a i -'
HI = 'h a i -'
HEY = 'h e i -'
YO = 'y o u -'
DOO, DEE = 'd u - -', 'd i - -'

# ---------------------------------------------------------------- Log in
@sound('login', 'hello', 'Hel-lo', 'A sung "hel-lo", stepping up. The friendly default.', wet=.2)
def _():
    return mix([(0, sing([(0, HEL, 'G5', .16), (.17, LO, 'C6', .36)])), (.2, celesta(n('G6')), .25)])


@sound('login', 'hellooo', 'Hel-lo-o!', 'A sing-song "hel-lo-o" over three notes.', wet=.2)
def _():
    return sing([(0, HEL, 'E5', .15), (.16, 'l o - -', 'A5', .14), (.31, 'w o u -', 'C#6', .38)])


@sound('login', 'hellocute', 'Hel-lo (tiny)', 'A tiny, high "hel-lo!", the cutest one.', wet=.18)
def _():
    return mix([(0, sing([(0, HEL, 'C6', .12), (.13, LO, 'G6', .3)], 'cute')), (.14, celesta(n('G7')), .2)])


@sound('login', 'hellochoir', 'Hel-lo Choir', 'A little choir singing "hel-lo" in harmony.', wet=.35, rt=2.2)
def _():
    return mix([(0, sing([(0, HEL, 'C5', .2), (.21, LO, 'F5', .55)], 'choir', [0, 4, 7])), (.25, bell(n('F6'), 1.6, .7), .3)])


@sound('login', 'hellorobot', 'Hel-lo Robot', 'A friendly robot saying "hel-lo".', wet=.15)
def _():
    return sing([(0, HEL, 'A4', .16), (.17, LO, 'A4', .32)], 'robot')


@sound('login', 'heythere', 'Hey There!', 'A bright "hey there!", up then down.', wet=.18)
def _():
    return sing([(0, HEY, 'D6', .2, 'F#6'), (.22, 'th e - r', 'E6', .3)])


@sound('login', 'hii', 'Hi-i!', 'A long "hi-i!" that slides up.', wet=.2)
def _():
    return sing([(0, HI, 'D5', .42, 'A5')])


@sound('login', 'welcome', 'Wel-come!', 'A warm "wel-come!" with a chime.', wet=.22)
def _():
    return mix([(0, sing([(0, 'w e - l', 'E5', .15), (.16, 'k uh - m', 'B5', .38)])), (.2, bell(n('B6'), 1.4, .6), .3)])


@sound('login', 'glofly', 'Glo-fly!', 'The app singing its own name.', wet=.22)
def _():
    return mix([(0, sing([(0, 'g o u -', 'G5', .2), (.21, 'f a i -', 'D6', .38)])), (.22, celesta(n('D7')), .25)])


@sound('login', 'tada', 'Ta-da!', 'A "ta-da!" for a big entrance.', wet=.22)
def _():
    return mix([(0, sing([(0, 't a - -', 'G5', .12), (.14, 'd a - -', 'C6', .45)])), (.14, bell(n('E6'), 1.5, .8), .3)])


@sound('login', 'hellodeep', 'Hel-lo (deep)', 'A low, smooth "hel-lo".', wet=.22)
def _():
    return sing([(0, HEL, 'C4', .18), (.19, LO, 'G4', .4)], 'deep')


# ---------------------------------------------------------------- Log off
@sound('logoff', 'byebye', 'Bye-Bye', 'The round 2 favorite, re-sung with clearer words.', wet=.18)
def _():
    return sing([(0, BYE, 'E5', .2), (.24, BYE, 'B4', .34, 'A4')])


@sound('logoff', 'byebyesong', 'Bye-Bye Sing-Song', 'A sing-song "bye-bye", up then down.', wet=.2)
def _():
    return sing([(0, BYE, 'A5', .18), (.2, BYE, 'E5', .38)])


@sound('logoff', 'byebyecute', 'Bye-Bye (tiny)', 'A tiny voice waving goodbye.', wet=.18)
def _():
    return sing([(0, BYE, 'G6', .14), (.16, BYE, 'D6', .3)], 'cute')


@sound('logoff', 'goodnight', 'Good-night', 'A soft, sleepy "good-night".', wet=.25)
def _():
    return mix([(0, sing([(0, 'g u - d', 'D5', .16), (.18, 'n a i t', 'A4', .42)])), (.3, bell(n('A5'), 1.4, .7), .2)])


@sound('logoff', 'seeya', 'See Ya!', 'A quick, cheerful "see ya!"', wet=.18)
def _():
    return sing([(0, 's i - -', 'B5', .16), (.18, 'y a - -', 'E5', .28)])


@sound('logoff', 'byeee', 'Bye-ee', 'One long "bye-ee" sliding down.', wet=.2)
def _():
    return sing([(0, BYE, 'C6', .55, 'F5')])


@sound('logoff', 'nightnight', 'Night-Night', 'A cozy "night-night".', wet=.25)
def _():
    return sing([(0, 'n a i t', 'G5', .17), (.21, 'n a i t', 'D5', .32)])


@sound('logoff', 'babye', 'Ba-Bye', 'A playful "ba-bye!"', wet=.18)
def _():
    return sing([(0, 'b a - -', 'D6', .1), (.12, BYE, 'G5', .34)])


@sound('logoff', 'byechoir', 'Bye-Bye Choir', 'A little choir singing goodbye.', wet=.35, rt=2.2)
def _():
    return sing([(0, BYE, 'G5', .22), (.25, BYE, 'C5', .5)], 'choir', [0, 4, 7])


@sound('logoff', 'later', 'Lat-er!', 'A laid-back "lat-er!"', wet=.18)
def _():
    return sing([(0, 'l e i -', 'A5', .14), (.16, 'd er - -', 'E5', .3)])


@sound('logoff', 'byerobot', 'Bye-Bye Robot', 'The robot powering down with a "bye-bye".', wet=.15)
def _():
    return mix([(0, sing([(0, BYE, 'A4', .18), (.21, BYE, 'E4', .32)], 'robot')),
                (.5, tone(500, .35, 120, 'saw', .005, .2, cutoff=1500), .25)])


# ---------------------------------------------------------------- New message
@sound('message', 'boodee', 'Boo-Dee', 'The round 2 "boo-dee", re-sung.')
def _():
    return sing([(0, 'b u - -', 'E5', .1, 'G5'), (.12, DEE, 'B5', .15)])


@sound('message', 'bip', 'Bip!', 'One tiny, bright "bip!"', gain=.9)
def _():
    return sing([(0, 'b i - p', 'A6', .07)], 'cute')


@sound('message', 'doodeedoo', 'Doo-Dee-Doo', 'Three quick notes, sung.')
def _():
    return sing([(0, DOO, 'C6', .07), (.08, DEE, 'E6', .07), (.16, DOO, 'G6', .14)])


@sound('message', 'bading', 'Ba-Ding!', 'A sung "ba-ding!" with a little bell.', wet=.2)
def _():
    return mix([(0, sing([(0, 'b a - -', 'E5', .07), (.08, 'd i - ng', 'B5', .2)])), (.08, bell(n('B6'), 1.0, .4), .3)])


@sound('message', 'hmm', 'Hm?', 'A curious little "hm?" going up.')
def _():
    return sing([(0, 'm m - -', 'D5', .22, 'A5')])


@sound('message', 'ooh', 'Ooh!', 'An interested "ooh!"', wet=.2)
def _():
    return sing([(0, 'w u - -', 'G5', .2, 'D6')], 'cute')


@sound('message', 'heymsg', 'Hey!', 'A short, friendly "hey!"')
def _():
    return sing([(0, HEY, 'B5', .18, 'D6')])


@sound('message', 'yip', 'Yip!', 'A tiny excited "yip!"')
def _():
    return sing([(0, 'y i - p', 'D6', .08, 'A6')], 'cute')


@sound('message', 'bipbop', 'Bip-Bop', 'A robot saying "bip-bop".', gain=.9)
def _():
    return sing([(0, 'b i - p', 'C6', .07), (.1, 'b a - p', 'G5', .09)], 'robot')


@sound('message', 'pssst', 'Psst', 'A whispered "psst", like a secret note.', wet=.12)
def _():
    return sing([(0, 'p uh - s', 'C5', .05)], 'whisper')


# ---------------------------------------------------------------- @mention
@sound('mention', 'heyyou', 'Hey You!', 'A clear "hey you!" that gets your attention.')
def _():
    return sing([(0, HEY, 'C#6', .16), (.18, 'y u - -', 'A5', .22, 'E6')])


@sound('mention', 'yoohoo', 'Yoo-Hoo!', 'A sung "yoo-hoo!" calling across the room.', wet=.2)
def _():
    return sing([(0, 'y u - -', 'G5', .18, 'E6'), (.22, 'h u - -', 'C6', .3, 'A5')])


@sound('mention', 'overhere', 'Over Here!', 'A sing-song "o-ver here!"', wet=.18)
def _():
    return sing([(0, '- o u -', 'E5', .12), (.13, 'v er - -', 'G5', .1), (.24, 'h i - r', 'C6', .3)])


@sound('mention', 'heyhey', 'Hey Hey!', 'Two quick "hey"s, the second higher.')
def _():
    return sing([(0, HEY, 'A5', .13), (.16, HEY, 'E6', .2)])


@sound('mention', 'ahhah', 'Ah-Hah!', 'An "ah-hah!" like you’ve been spotted.')
def _():
    return sing([(0, '- a - -', 'E5', .12), (.15, 'h a - -', 'B5', .26)])


@sound('mention', 'look', 'Look!', 'A cute, quick "look!"')
def _():
    return sing([(0, 'l u - k', 'D6', .14, 'G6')], 'cute')


@sound('mention', 'youyou', 'You, You!', 'A pointing "you, you!"')
def _():
    return sing([(0, 'y u - -', 'B5', .11), (.14, 'y u - -', 'B5', .11), (.28, 'y u - -', 'E6', .18)])


@sound('mention', 'psstmention', 'Psst! Hey!', 'A whisper, then a sung "hey!"', wet=.15)
def _():
    return mix([(0, sing([(0, 'p uh - s', 'C5', .05)], 'whisper'), .8), (.2, sing([(0, HEY, 'A5', .2, 'C#6')]))])


@sound('mention', 'dingdong', 'Ding-Dong!', 'A sung doorbell: "ding-dong!"', wet=.2)
def _():
    return sing([(0, 'd i - ng', 'E6', .17), (.21, 'd aw - ng', 'C6', .3)])


# ---------------------------------------------------------------- Constellation message
@sound('constellation', 'oowee', 'Ooh-Wee-Ooh', 'A spacey "ooh-wee-ooh" with echo.', wet=.3, rt=2.2)
def _():
    return base.echo(sing([(0, 'w u - -', 'E5', .14), (.15, 'w i - -', 'B5', .14), (.3, 'w u - -', 'G5', .24)]), .2, .3, 2)


@sound('constellation', 'twinkle', 'Twin-kle', 'A tiny "twin-kle" with a sparkle.', wet=.3, rt=2)
def _():
    return mix([(0, sing([(0, 't i - n', 'E6', .1), (.12, 'k uh - l', 'B6', .16)], 'cute')), (.14, celesta(n('E7')), .3)])


@sound('constellation', 'star', 'Star!', 'A sung "star!" that rises.', wet=.25)
def _():
    return sing([(0, 's a - r', 'A5', .26, 'E6')])


@sound('constellation', 'lala', 'La-La Choir', 'A soft choir "la-la" from far away.', wet=.4, rt=2.4)
def _():
    return sing([(0, 'l a - -', 'E5', .15), (.17, 'l a - -', 'A5', .3)], 'choir', [0, 4, 7])


@sound('constellation', 'ahhh', 'Aah', 'A short angelic "aah".', wet=.45, rt=2.6)
def _():
    return mix([(0, sing([(0, '- a - -', 'B4', .5)], 'choir', [0, 7, 12])), (.1, glass(n('F#6'), 1.4), .3)])


@sound('constellation', 'zoom', 'Zoom!', 'A "zoom!" shooting past.', wet=.25)
def _():
    return sing([(0, 'z u - m', 'C5', .3, 'G5')])


@sound('constellation', 'hmmm', 'Hmm-mm', 'A soft hummed "hmm-mm" in space.', wet=.35, rt=2.2)
def _():
    return sing([(0, 'h m - -', 'E5', .18), (.2, 'm m - -', 'B5', .26)], 'choir', [0, 7])


@sound('constellation', 'woowoo', 'Woo-Woo', 'Two airy "woo"s, like a far-off signal.', wet=.3)
def _():
    return base.echo(sing([(0, 'w u - -', 'A5', .14, 'C#6'), (.2, 'w u - -', 'E6', .2)], 'cute'), .18, .3, 2)


@sound('constellation', 'pew', 'Pew!', 'A sci-fi "pew!"')
def _():
    return sing([(0, 'p i u -', 'E6', .16, 'E5')], 'robot')


# ---------------------------------------------------------------- Friend request
@sound('friend', 'hiya', 'Hi-ya!', 'A cheerful "hi-ya!"')
def _():
    return sing([(0, HI, 'C6', .14, 'E6'), (.17, 'y a - -', 'G6', .22)])


@sound('friend', 'knockknock', 'Knock-Knock', 'A sung "knock-knock" with real knocks.', wet=.18)
def _():
    return mix([(0, base.knock()), (.12, base.knock(950)), (.3, sing([(0, 'n aw - k', 'E5', .13), (.17, 'n aw - k', 'B5', .18)]))])


@sound('friend', 'friend', 'Friend?', 'A hopeful "friend?" ending on a question.')
def _():
    return sing([(0, 'f e - n', 'C6', .3, 'G6')])


@sound('friend', 'helloq', 'Hel-lo?', 'A questioning "hel-lo?" that rises.', wet=.18)
def _():
    return sing([(0, HEL, 'D5', .14), (.15, LO, 'G5', .3, 'D6')])


@sound('friend', 'yay', 'Yay!', 'A happy "yay!"', wet=.18)
def _():
    return mix([(0, sing([(0, 'y e i -', 'A5', .26, 'E6')], 'cute')), (.12, celesta(n('A6')), .3)])


@sound('friend', 'ohhi', 'Oh, Hi!', 'A surprised "oh, hi!"')
def _():
    return sing([(0, '- o u -', 'E5', .14), (.18, HI, 'B5', .24, 'E6')])


@sound('friend', 'buddy', 'Bud-dy!', 'A friendly "bud-dy!"')
def _():
    return sing([(0, 'b uh - d', 'G5', .12), (.14, DEE, 'D6', .2)])


@sound('friend', 'hihi', 'Hi Hi!', 'A tiny double "hi hi!"')
def _():
    return sing([(0, HI, 'G6', .1), (.14, HI, 'C7', .16)], 'cute')


@sound('friend', 'heychoir', 'Hey Friend Choir', 'A tiny choir singing "hey!"', wet=.3, rt=2)
def _():
    return sing([(0, HEY, 'G5', .3, 'C6')], 'choir', [0, 4, 7])


# ---------------------------------------------------------------- Friend comes online
@sound('online', 'ohhi', 'Oh Hi', 'A soft "oh hi".', gain=.85)
def _():
    return sing([(0, '- o u -', 'C5', .13), (.17, HI, 'G5', .2)])


@sound('online', 'heyonline', 'Hey', 'A quiet, warm "hey".', gain=.85)
def _():
    return sing([(0, HEY, 'E5', .22, 'A5')])


@sound('online', 'peekaboo', 'Peek-a-Boo', 'A playful "peek-a-boo".', gain=.85)
def _():
    return sing([(0, 'p i - k', 'E6', .09), (.12, '- uh - -', 'C6', .06), (.19, 'b u - -', 'G6', .2)], 'cute')


@sound('online', 'yo', 'Yo!', 'A laid-back "yo!"', gain=.85)
def _():
    return sing([(0, YO, 'D5', .2, 'G5')])


@sound('online', 'here', 'I’m Here', 'A sung "I’m here".', gain=.85)
def _():
    return sing([(0, '- a i m', 'C5', .14), (.16, 'h i - r', 'G5', .24)])


@sound('online', 'ooh', 'Ooh', 'A small, soft "ooh".', gain=.85, wet=.22)
def _():
    return sing([(0, 'w u - -', 'A4', .26, 'E5')], 'choir', [0, 7])


@sound('online', 'hiyaonline', 'Hi-ya', 'A gentle "hi-ya".', gain=.85)
def _():
    return sing([(0, HI, 'D5', .13), (.15, 'y a - -', 'A5', .18)])


@sound('online', 'hellosoft', 'Hel-lo (soft)', 'A quiet "hel-lo", almost whispered.', gain=.85, wet=.2)
def _():
    return sing([(0, HEL, 'A4', .13), (.14, LO, 'D5', .26)], 'deep')


@sound('online', 'tiny', 'Hi! (tiny)', 'The tiniest "hi!"', gain=.8)
def _():
    return sing([(0, HI, 'A6', .12, 'D7')], 'cute')


# ---------------------------------------------------------------- Incoming call (three cycles)
def ring(sid, name, desc, cycle, wet=.2, rt=1.6):
    def wrap(fn):
        sound('ring', sid, name, desc, wet, rt)(lambda: loop3(fn(), cycle))
        return fn
    return wrap


@ring('ringaling', 'Ring-a-Ling', 'A sung "ring-a-ling, ring-a-ling".', 2.2)
def _():
    phrase = [(0, 'r i - ng', 'E6', .12), (.14, '- uh - -', 'C6', .06), (.22, 'l i - ng', 'G6', .2)]
    return mix([(0, sing(phrase)), (.6, sing(phrase))])


@ring('pickup', 'Pick Up!', 'A sing-song "pick up, pick up!"', 2.2)
def _():
    return sing([(0, 'p i - k', 'C6', .11), (.15, '- uh - p', 'G5', .13), (.45, 'p i - k', 'D6', .11), (.6, '- uh - p', 'A5', .2)])


@ring('hellohello', 'Hel-lo Hel-lo', 'Someone singing "hel-lo, hel-lo!"', 2.4)
def _():
    return sing([(0, HEL, 'G5', .13), (.14, LO, 'D6', .22), (.5, HEL, 'A5', .13), (.64, LO, 'E6', .32)])


@ring('lalala', 'La-La-La', 'A bouncy "la-la-la" tune.', 2.4)
def _():
    seq = [(0, 'C6', .12), (.15, 'E6', .12), (.3, 'G6', .2), (.6, 'E6', .12), (.75, 'D6', .12), (.9, 'C6', .3)]
    return sing([(t, 'l a - -', p, d) for t, p, d in seq], 'cute')


@ring('beeboo', 'Bee-Boo', 'A robot singing "bee-boo, bee-boo".', 2.0)
def _():
    return sing([(0, 'b i - -', 'A5', .14), (.18, 'b u - -', 'E5', .14), (.45, 'b i - -', 'A5', .14), (.63, 'b u - -', 'E5', .14)], 'robot')


@ring('dingaling', 'Ding-a-Ling', 'A choir going "ding-a-ling".', 2.4, wet=.3)
def _():
    return sing([(0, 'd i - ng', 'G5', .14), (.17, '- uh - -', 'E5', .07), (.26, 'l i - ng', 'C6', .3)], 'choir', [0, 4, 7])


@ring('bumbadum', 'Bum-ba-Dum', 'A deep, groovy "bum-ba-dum" with a beat.', 2.0)
def _():
    voc = sing([(0, 'b uh - m', 'C4', .14), (.18, 'b a - -', 'E4', .08), (.3, 'd uh - m', 'G4', .22)], 'deep')
    return mix([(0, voc), (0, base.knock(1100, .1), .3), (.3, base.knock(1100, .1), .3), (.6, base.knock(1100, .1), .3)])


@ring('callingyou', 'Calling You', 'A sung "call-ing you!"', 2.4)
def _():
    return sing([(0, 'k aw - l', 'E5', .14), (.16, 'l i - ng', 'A5', .14), (.32, 'y u - -', 'C#6', .34)])


@ring('doowop', 'Doo-Wop', 'The round 2 doo-wop, with real "d" sounds.', 2.4)
def _():
    return sing([(0, DOO, 'C5', .18), (.3, DOO, 'E5', .12), (.45, 'w a - p', 'G5', .28), (.9, DOO, 'A5', .12), (1.05, 'w a - p', 'G5', .3)])


# ---------------------------------------------------------------- Outgoing call (three rounds)
def outgoing(sid, name, desc, cycle, wet=.2, rt=1.5):
    def wrap(fn):
        sound('outgoing', sid, name, desc, wet, rt, .8)(lambda: loop3(fn(), cycle))
        return fn
    return wrap


@outgoing('hmmhmm', 'Hm-Mm', 'Humming "hm-mm" while waiting.', 2.0)
def _():
    return sing([(0, 'h m - -', 'E4', .3), (.36, 'm m - -', 'G4', .35)])


@outgoing('ringring', 'Ring Ring', 'A soft, sung "ring, ring".', 2.2)
def _():
    return sing([(0, 'r i - ng', 'A5', .2), (.3, 'r i - ng', 'F#5', .24)])


@outgoing('doodoo', 'Doo... Doo', 'Two gentle "doo"s, then a pause.', 2.0)
def _():
    return sing([(0, DOO, 'E5', .22), (.32, DOO, 'C5', .26)])


@outgoing('lala', 'La... La', 'A slow, sleepy "la... la".', 2.2, wet=.25)
def _():
    return sing([(0, 'l a - -', 'G5', .24), (.4, 'l a - -', 'D5', .3)], 'choir', [0, 4])


@outgoing('oohooh', 'Ooh... Ooh', 'Soft "ooh"s rising and falling.', 2.2, wet=.25)
def _():
    return sing([(0, 'w u - -', 'C5', .3, 'E5'), (.42, 'w u - -', 'E5', .3, 'C5')])


@outgoing('calling', 'Call-ing', 'A sung "call-ing..." each round.', 2.2)
def _():
    return sing([(0, 'k aw - l', 'G5', .16), (.18, 'l i - ng', 'E5', .3)])


@outgoing('badum', 'Ba-Dum', 'A heartbeat-like "ba-dum".', 1.6)
def _():
    return sing([(0, 'b a - -', 'C5', .1), (.14, 'd uh - m', 'G4', .2)], 'deep')


@outgoing('brring', 'Brr-ing', 'A robot phone going "brr-ing".', 2.2)
def _():
    return sing([(0, 'b er - -', 'E5', .12), (.13, 'r i - ng', 'G5', .3)], 'robot')


@outgoing('hmhmhm', 'Hm-Hm-Hm', 'A little hummed tune.', 2.2)
def _():
    return sing([(0, 'h m - -', 'C5', .14), (.17, 'm m - -', 'E5', .14), (.34, 'm m - -', 'G5', .24)])


# ---------------------------------------------------------------- Call connected
@sound('connected', 'yo', 'Yo!', 'A sung "yo!" going up.')
def _():
    return sing([(0, YO, 'E5', .2, 'A5')])


@sound('connected', 'hi', 'Hi!', 'A happy "hi!"')
def _():
    return sing([(0, HI, 'A5', .18, 'E6')])


@sound('connected', 'heyconn', 'Hey!', 'An excited "hey!"')
def _():
    return sing([(0, HEY, 'C6', .18, 'G6')])


@sound('connected', 'tada', 'Ta-Da!', 'A quick "ta-da!"', wet=.2)
def _():
    return sing([(0, 't a - -', 'C6', .08), (.1, 'd a - -', 'G6', .2)])


@sound('connected', 'oh', 'Oh!', 'A pleased "oh!"')
def _():
    return sing([(0, '- o u -', 'D5', .18, 'A5')])


@sound('connected', 'yay', 'Yay!', 'A tiny "yay!"')
def _():
    return sing([(0, 'y e i -', 'B5', .2, 'F#6')], 'cute')


@sound('connected', 'here', 'Here!', 'A sung "here!"')
def _():
    return sing([(0, 'h i - r', 'G5', .2, 'D6')])


@sound('connected', 'ahchoir', 'Ah! Choir', 'A short choir "ah!"', wet=.3)
def _():
    return sing([(0, '- a - -', 'C5', .25)], 'choir', [0, 4, 7, 12])


@sound('connected', 'bing', 'Bing!', 'A robot "bing!"')
def _():
    return sing([(0, 'b i - ng', 'E6', .14)], 'robot')


# ---------------------------------------------------------------- Call ended
@sound('ended', 'bye', 'Bye!', 'A short "bye!" going down.')
def _():
    return sing([(0, BYE, 'A5', .24, 'E5')])


@sound('ended', 'byebyeend', 'Bye-Bye', 'A quick "bye-bye".')
def _():
    return sing([(0, BYE, 'D6', .13), (.16, BYE, 'A5', .2)])


@sound('ended', 'seeya', 'See Ya', 'A casual "see ya".')
def _():
    return sing([(0, 's i - -', 'A5', .13), (.15, 'y a - -', 'D5', .22)])


@sound('ended', 'aww', 'Aww', 'A sad-but-cute "aww".', wet=.2)
def _():
    return sing([(0, '- aw - -', 'E5', .3, 'B4')], 'cute')


@sound('ended', 'done', 'Done', 'A matter-of-fact "done".')
def _():
    return sing([(0, 'd uh - n', 'G5', .22, 'C5')])


@sound('ended', 'byeee', 'Bye-ee', 'A long "bye-ee" sliding down.', wet=.2)
def _():
    return sing([(0, BYE, 'G5', .36, 'C5')])


@sound('ended', 'bopbop', 'Bop-Bop', 'A robot "bop-bop".')
def _():
    return sing([(0, 'b a - p', 'G5', .08), (.12, 'b a - p', 'C5', .1)], 'robot')


@sound('ended', 'ciao', 'Ciao!', 'A breezy "ciao!"')
def _():
    return sing([(0, 'ch a u -', 'E5', .3, 'A4')])


@sound('ended', 'later', 'Later!', 'A quick "lat-er!"')
def _():
    return sing([(0, 'l e i -', 'G5', .12), (.14, 'd er - -', 'C5', .2)])


# ---------------------------------------------------------------- Joins / leaves (pairs)
PAIRS = [
    ('hibye', 'Hi / Bye', '"Hi!" when they join, "bye!" when they leave.',
     lambda: sing([(0, HI, 'E5', .14, 'B5')]), lambda: sing([(0, BYE, 'B5', .16, 'E5')])),
    ('yo', 'Yo / Cya', '"Yo!" and "cya".',
     lambda: sing([(0, YO, 'D5', .15, 'A5')]), lambda: sing([(0, 's i - -', 'A5', .08), (.1, 'y a - -', 'D5', .12)])),
    ('hey', 'Hey / Aww', '"Hey!" and a little "aww".',
     lambda: sing([(0, HEY, 'C6', .15, 'G6')]), lambda: sing([(0, '- aw - -', 'G5', .2, 'C5')], 'cute')),
    ('ooh', 'Ooh / Oh', 'A rising "ooh" and a falling "oh".',
     lambda: sing([(0, 'w u - -', 'G5', .16, 'D6')]), lambda: sing([(0, '- o u -', 'D6', .16, 'G5')])),
    ('bip', 'Bip / Bop', 'A robot "bip" and "bop".',
     lambda: sing([(0, 'b i - p', 'A5', .07)], 'robot'), lambda: sing([(0, 'b a - p', 'D5', .08)], 'robot')),
    ('doo', 'Doo / Doo', 'A tiny "doo" up and down.',
     lambda: sing([(0, DOO, 'C6', .12, 'G6')], 'cute'), lambda: sing([(0, DOO, 'G6', .12, 'C6')], 'cute')),
    ('yay', 'Yay / Ciao', '"Yay!" and "ciao".',
     lambda: sing([(0, 'y e i -', 'A5', .16, 'E6')]), lambda: sing([(0, 'ch a u -', 'E5', .18, 'A4')])),
    ('here', 'Here / Gone', '"Here!" and "gone".',
     lambda: sing([(0, 'h i - r', 'G5', .16, 'D6')]), lambda: sing([(0, 'g aw - n', 'D6', .18, 'G5')])),
    ('choir', 'Ah / Oh Choir', 'A tiny choir "ah" up and "oh" down.',
     lambda: sing([(0, '- a - -', 'E5', .18, 'A5')], 'choir', [0, 4]), lambda: sing([(0, '- o u -', 'A5', .18, 'E5')], 'choir', [0, 4])),
]
for sid, name, desc, up, down in PAIRS:
    sound('join', sid, name, desc, gain=.85)(up)
    sound('leave', sid, name, desc, gain=.8)(down)

EVENTS = base.EVENTS


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'sung2026'
    os.makedirs(out, exist_ok=True)
    manifest = {'events': []}
    for eid, ename in EVENTS:
        items = []
        for s in S[eid]:
            st = finish(s['fn'](), s['wet'], s['rt'], s['gain'])
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
