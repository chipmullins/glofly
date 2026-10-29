"""Glofly sung sounds preview, round 4 (Oct 28, 2026): clear, witty sung lines ("New message!",
"Hello there!", "Ring ring! Pick up!", "See ya!"), ten per event.

How: an open-source speech model (Kokoro-82M, Apache 2.0, run with the kokoro-onnx package) speaks
each line clearly; the WORLD vocoder (pyworld) then moves every syllable onto a note of a melody
(with a little vibrato), so the words stay sharp but are sung. Some lines get a tiny/deep/choir/
robot/whisper treatment, and a soft instrument under the first note.

Setup (once):
  pip install kokoro-onnx soundfile pyworld numpy scipy
  download kokoro-v1.0.int8.onnx and voices-v1.0.bin from
  https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
Run:  python sing2026.py <model-folder> <out-folder>
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
import signature2026 as base  # noqa: E402
from signature2026 import SR, bell, celesta, finish, glass, kalimba, knock, marimba, mix, n, pluck  # noqa: E402

TTS_SR = 24000
FRAME = 5.0  # ms
kokoro = None

PENTA = [0, 2, 4, 7, 9]


def tts(text, voice, speed):
    audio, sr = kokoro.create(text, voice=voice, speed=speed, lang='en-us' if voice[0] in 'a' else 'en-gb')
    return np.asarray(audio, dtype=np.float64), sr


def segments(f0, min_len=6, merge_gap=8):
    """Voiced runs (in frames), small gaps merged, tiny runs dropped."""
    voiced = f0 > 0
    runs, start = [], None
    for i, v in enumerate(voiced):
        if v and start is None:
            start = i
        if not v and start is not None:
            runs.append([start, i])
            start = None
    if start is not None:
        runs.append([start, len(f0)])
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= merge_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [r for r in merged if r[1] - r[0] >= min_len]


def split_long(runs, f0, max_len=46):
    """A long voiced run often holds several syllables: split it where the spoken pitch dips."""
    out = []
    for a, b in runs:
        if b - a <= max_len:
            out.append([a, b])
            continue
        pieces = int(np.ceil((b - a) / max_len))
        cuts = [a]
        for k in range(1, pieces):
            target = a + (b - a) * k // pieces
            lo, hi = max(a + 8, target - 10), min(b - 8, target + 10)
            seg = f0[lo:hi]
            cuts.append(lo + int(np.argmin(seg)) if len(seg) else target)
        cuts.append(b)
        out += [[cuts[i], cuts[i + 1]] for i in range(len(cuts) - 1)]
    return out


def melody(count, notes):
    """Notes for each syllable: the given list, its last note repeated if the line has more syllables."""
    return [notes[min(i, len(notes) - 1)] for i in range(count)]


def sing_line(text, notes, voice='af_heart', speed=1.0, style='normal', harmony=None, vib=0.014,
              shift=None, stretch=1.08):
    x, sr = tts(text, voice, speed)
    x = x / (np.abs(x).max() + 1e-9) * 0.9
    f0, t = pw.harvest(x, sr, frame_period=FRAME, f0_floor=60, f0_ceil=600)
    sp = pw.cheaptrick(x, f0, t, sr)
    ap = pw.d4c(x, f0, t, sr)
    runs = split_long(segments(f0), f0)
    freqs = [n(p) if isinstance(p, str) else p for p in melody(len(runs), notes)]
    # Stretch the timeline a little so the notes ring (WORLD frames are re-sampled).
    if stretch != 1.0:
        idx = np.clip(np.arange(0, len(f0), 1 / stretch), 0, len(f0) - 1)
        lo = np.floor(idx).astype(int)
        f0 = f0[lo]
        sp = sp[lo]
        ap = ap[lo]
        runs = [[int(a * stretch), int(b * stretch)] for a, b in runs]
    new = np.zeros_like(f0)
    if style != 'whisper':
        for (a, b), f in zip(runs, freqs):
            a, b = max(0, a), min(len(new), b)
            new[a:b] = f
        # Glide between notes and add vibrato on held notes.
        voiced = f0 > 0
        fill = new.copy()
        last = 0
        for i in range(len(fill)):  # carry the note across the voiced frames around each run
            if fill[i] > 0:
                last = fill[i]
            elif voiced[i] and last:
                fill[i] = last
        nxt = 0
        for i in range(len(fill) - 1, -1, -1):
            if fill[i] > 0:
                nxt = fill[i]
            elif voiced[i] and nxt:
                fill[i] = nxt
        smooth = fill.copy()
        k = 6  # 30 ms glide
        for i in range(1, len(smooth)):
            if smooth[i] > 0 and smooth[i - 1] > 0:
                smooth[i] = smooth[i - 1] + (fill[i] - smooth[i - 1]) / k
        tt = np.arange(len(smooth)) * FRAME / 1000
        depth = 0 if style == 'robot' else vib
        new = np.where(voiced, smooth * (1 + depth * np.sin(2 * np.pi * 5.6 * tt)), 0)
    if style == 'robot':
        ap = np.zeros_like(ap) + 0.001
    if shift is None:
        shift = {'cute': 1.16, 'deep': 0.88}.get(style, 1.0)
    if shift != 1.0:
        bins = sp.shape[1]
        src = np.clip(np.arange(bins) / shift, 0, bins - 1)
        sp = np.array([np.interp(src, np.arange(bins), row) for row in sp])
    voices = harmony or ([0, 4, 7] if style == 'choir' else [0])
    out = None
    for i, semis in enumerate(voices):
        y = pw.synthesize(new * 2 ** (semis / 12), sp, ap, sr, FRAME)
        y = np.concatenate([np.zeros(int(sr * 0.008 * i)), y])
        out = y if out is None else np.pad(out, (0, max(0, len(y) - len(out)))) + np.pad(y, (0, max(0, len(out) - len(y))))
    out = resample_poly(out, SR, sr)
    if style == 'robot':
        out = np.round(out * 24) / 24  # a little digital grit
    return out / (np.abs(out).max() + 1e-9)


S = {}


def add(event, sid, name, text, notes, voice='af_heart', style='normal', bed=None, speed=1.0, wet=.16, gain=1.0,
        cycle=None, harmony=None):
    S.setdefault(event, []).append(dict(id=sid, name=name, text=text, notes=notes, voice=voice, style=style,
                                        bed=bed, speed=speed, wet=wet, gain=gain, cycle=cycle, harmony=harmony))


# Voices: af_heart (warm), af_bella (bright), af_nicole (soft), af_sky (light), am_puck (playful),
# am_michael (friendly), am_adam (low), bf_emma (British), bm_george (British, low).

# ---- Log in
add('login', 'hellothere', 'Hello there!', 'Hello there!', ['G4', 'C5', 'E5', 'G5'], 'af_heart', bed='celesta:C6')
add('login', 'heyback', 'Hey hey, you’re back!', 'Hey hey, you’re back!', ['C5', 'E5', 'G5', 'A5', 'C6'], 'am_puck', bed='marimba:C5')
add('login', 'welcomeback', 'Welcome back!', 'Welcome back!', ['E5', 'G5', 'C6'], 'af_bella', bed='bell:C6')
add('login', 'gloflytime', 'Glofly time!', 'Glo-fly time!', ['G4', 'B4', 'D5', 'G5'], 'am_michael', bed='celesta:G5')
add('login', 'lookwho', 'Look who’s here!', 'Look who’s here!', ['D5', 'F#5', 'A5', 'D6'], 'af_sky', style='cute', bed='celesta:D6')
add('login', 'lightson', 'Lights on!', 'Lights on!', ['A4', 'E5'], 'af_nicole', bed='glass:E6')
add('login', 'hifriend', 'Hi, friend!', 'Hi, friend!', ['C5', 'G5'], 'af_heart', style='choir', bed='bell:C6', wet=.3)
add('login', 'readysetglow', 'Ready, set, glow!', 'Ready, set, glow!', ['C5', 'D5', 'E5', 'G5', 'C6'], 'am_puck', bed='marimba:C5')
add('login', 'wellhello', 'Well hello!', 'Well, hello!', ['E4', 'A4', 'C#5'], 'am_adam', style='deep', bed='pluck:A3')
add('login', 'letsglow', 'Let’s glow!', 'Let’s glow!', ['G5', 'D6'], 'bf_emma', bed='celesta:G6')

# ---- Log off
add('logoff', 'seeya', 'See ya!', 'See ya!', ['A5', 'E5'], 'af_bella', bed='celesta:A5')
add('logoff', 'byefornow', 'Bye for now!', 'Bye for now!', ['G5', 'E5', 'C5'], 'af_heart', bed='bell:C5')
add('logoff', 'catchyoulater', 'Catch you later!', 'Catch you later!', ['G5', 'G5', 'E5', 'D5', 'C5'], 'am_puck', bed='marimba:C5')
add('logoff', 'goodnight', 'Goodnight!', 'Good night!', ['D5', 'A4'], 'af_nicole', bed='glass:A5', wet=.25)
add('logoff', 'peaceout', 'Peace out!', 'Peace out!', ['E5', 'B4'], 'am_michael', bed='pluck:E4')
add('logoff', 'lightsout', 'Lights out!', 'Lights out!', ['E5', 'A4'], 'af_sky', style='cute', bed='celesta:A5')
add('logoff', 'toodleoo', 'Toodle-oo!', 'Toodle-oo!', ['C6', 'A5', 'F5'], 'bf_emma', bed='celesta:F6')
add('logoff', 'latergator', 'Later, gator!', 'Later, gator!', ['G5', 'E5', 'G5', 'C5'], 'am_puck', bed='marimba:C5')
add('logoff', 'sweetdreams', 'Sweet dreams!', 'Sweet dreams!', ['E5', 'C5'], 'af_heart', style='choir', bed='bell:C5', wet=.32)
add('logoff', 'byebyenow', 'Bye-bye now!', 'Bye-bye now!', ['A5', 'E5', 'C#5'], 'am_adam', style='deep', bed='pluck:A3')

# ---- New message
add('message', 'newmessage', 'New message!', 'New message!', ['E5', 'G5', 'B5', 'E6'], 'af_heart', bed='celesta:E6')
add('message', 'messageforyou', 'Message for you!', 'Message for you!', ['C5', 'E5', 'G5', 'C6'], 'af_bella', bed='marimba:C6')
add('message', 'dingnew', 'Ding! New message!', 'Ding! New message!', ['B5', 'E5', 'G#5', 'B5', 'E6'], 'af_sky', style='cute', bed='bell:B6')
add('message', 'psstnew', 'Psst, new message!', 'Psst, new message!', ['D5', 'F#5', 'A5', 'D6'], 'af_nicole', bed='glass:D6')
add('message', 'someonesaidhi', 'Someone said hi!', 'Someone said hi!', ['C5', 'D5', 'E5', 'G5', 'C6'], 'am_puck', bed='marimba:C5')
add('message', 'oohamessage', 'Ooh, a message!', 'Ooh, a message!', ['G4', 'C5', 'E5', 'G5'], 'af_heart', bed='celesta:G5')
add('message', 'incoming', 'Incoming!', 'Incoming!', ['C5', 'E5', 'G5'], 'am_michael', bed='pluck:C5')
add('message', 'readme', 'Read me!', 'Read me!', ['A5', 'E6'], 'af_sky', style='cute', bed='celesta:A6')
add('message', 'gotone', 'Got one!', 'Got one!', ['D5', 'A5'], 'bm_george', bed='marimba:D5')
add('message', 'checkthis', 'Hey, check this!', 'Hey, check this!', ['E5', 'G5', 'B5'], 'af_bella', bed='glass:B6')

# ---- @mention
add('mention', 'thatsyou', 'Hey, that’s you!', 'Hey, that’s you!', ['A5', 'A5', 'C#6', 'E6'], 'af_bella', bed='bell:E6')
add('mention', 'saidyourname', 'Someone said your name!', 'Someone said your name!', ['C5', 'D5', 'E5', 'G5', 'A5', 'C6'], 'af_heart', bed='celesta:C6')
add('mention', 'overhere', 'Psst, over here!', 'Psst, over here!', ['D5', 'F#5', 'A5', 'D6'], 'af_nicole', bed='glass:D6')
add('mention', 'mentioned', 'You got mentioned!', 'You got mentioned!', ['E5', 'G5', 'A5', 'B5', 'E6'], 'am_puck', bed='marimba:E5')
add('mention', 'yoohooyou', 'Yoo-hoo, it’s you!', 'Yoo-hoo, it’s you!', ['G5', 'E5', 'G5', 'C6'], 'af_sky', style='cute', bed='celesta:C7')
add('mention', 'earsburning', 'Ears burning?', 'Ears burning?', ['C5', 'E5', 'G5', 'C6'], 'bf_emma', bed='bell:C6')
add('mention', 'heyyou', 'Hey you!', 'Hey you!', ['B5', 'E6'], 'am_michael', bed='pluck:B4')
add('mention', 'callingyouout', 'Calling you out!', 'Calling you out!', ['A5', 'G5', 'E5', 'A5'], 'af_bella', bed='marimba:A5')
add('mention', 'lookitsyou', 'Look, it’s you!', 'Look, it’s you!', ['D5', 'A5', 'B5', 'D6'], 'af_heart', style='choir', bed='bell:D6', wet=.28)
add('mention', 'headsup', 'Heads up!', 'Heads up!', ['G5', 'D6'], 'am_puck', bed='glass:D6')

# ---- Constellation message
add('constellation', 'newinstars', 'New in the stars!', 'New in the stars!', ['E5', 'G#5', 'B5', 'E6', 'B5'], 'af_nicole', bed='glass:E6', wet=.3)
add('constellation', 'constellation', 'Constellation!', 'Constellation!', ['C5', 'E5', 'G5', 'C6'], 'af_heart', style='choir', bed='bell:C6', wet=.35)
add('constellation', 'starmessage', 'Star message!', 'Star message!', ['A5', 'E6', 'C#6', 'A5'], 'af_sky', style='cute', bed='celesta:A6', wet=.3)
add('constellation', 'twinkle', 'Twinkle, twinkle!', 'Twinkle, twinkle!', ['C5', 'C5', 'G5', 'G5'], 'af_bella', bed='celesta:C7', wet=.3)
add('constellation', 'newsfromspace', 'News from space!', 'News from space!', ['D5', 'F#5', 'A5', 'D6'], 'am_michael', bed='glass:D6', wet=.3)
add('constellation', 'shootingstar', 'Shooting star!', 'Shooting star!', ['B5', 'G5', 'E6'], 'af_heart', bed='celesta:E7', wet=.32)
add('constellation', 'innebula', 'Over in the nebula!', 'Over in the nebula!', ['E5', 'G5', 'A5', 'B5', 'D6', 'E6'], 'am_puck', bed='glass:E6', wet=.3)
add('constellation', 'starry', 'Starry message!', 'Starry message!', ['G5', 'B5', 'D6', 'G6'], 'bf_emma', bed='celesta:G6', wet=.3)
add('constellation', 'outofthisworld', 'Out of this world!', 'Out of this world!', ['C5', 'E5', 'G5', 'C6'], 'am_adam', style='deep', bed='glass:C6', wet=.32)
add('constellation', 'cosmic', 'Cosmic!', 'Cosmic!', ['A4', 'E5'], 'af_nicole', style='choir', bed='bell:A5', wet=.38)

# ---- Friend request
add('friend', 'newfriend', 'New friend!', 'New friend!', ['C5', 'E5', 'G5'], 'af_bella', bed='celesta:C6')
add('friend', 'wannabefriends', 'Wanna be friends?', 'Wanna be friends?', ['E5', 'D5', 'E5', 'A5'], 'af_sky', style='cute', bed='celesta:A6')
add('friend', 'knockknock', 'Knock knock!', 'Knock knock!', ['G5', 'D5'], 'am_puck', bed='knock')
add('friend', 'wantstosayhi', 'Someone wants to say hi!', 'Someone wants to say hi!', ['C5', 'D5', 'E5', 'G5', 'A5', 'C6'], 'af_heart', bed='marimba:C5')
add('friend', 'friendrequest', 'Friend request!', 'Friend request!', ['A5', 'C#6', 'E6', 'A6'], 'af_bella', bed='bell:A6')
add('friend', 'canijoin', 'Hi, can I join?', 'Hi, can I join?', ['D5', 'E5', 'F#5', 'A5'], 'am_michael', bed='pluck:D5')
add('friend', 'makeafriend', 'Make a friend!', 'Make a friend!', ['G5', 'B5', 'D6'], 'af_heart', style='choir', bed='bell:G6', wet=.28)
add('friend', 'buddyalert', 'Buddy alert!', 'Buddy alert!', ['C6', 'G5', 'E5', 'G5'], 'am_puck', bed='marimba:C6')
add('friend', 'hellonewfriend', 'Hello, new friend!', 'Hello, new friend!', ['E5', 'G5', 'A5', 'B5', 'E6'], 'bf_emma', bed='celesta:E6')
add('friend', 'bemybuddy', 'Be my buddy?', 'Be my buddy?', ['C5', 'E5', 'G5', 'C6'], 'af_sky', style='cute', bed='celesta:C7')

# ---- Friend comes online
add('online', 'theyrehere', 'They’re here!', 'They’re here!', ['C5', 'G5'], 'af_nicole', bed='glass:G6', gain=.85)
add('online', 'friendison', 'Your friend is on!', 'Your friend is on!', ['C5', 'D5', 'E5', 'G5'], 'af_heart', bed='marimba:C5', gain=.85)
add('online', 'lookwhosonline', 'Look who’s online!', 'Look who’s online!', ['D5', 'F#5', 'A5', 'B5', 'D6'], 'af_bella', bed='celesta:D6', gain=.85)
add('online', 'hiagain', 'Hi again!', 'Hi again!', ['E5', 'G5', 'B5'], 'af_sky', style='cute', bed='celesta:E6', gain=.85)
add('online', 'readytochat', 'Ready to chat!', 'Ready to chat!', ['G4', 'B4', 'D5', 'G5'], 'am_michael', bed='pluck:G4', gain=.85)
add('online', 'glowingnow', 'Glowing now!', 'Glowing now!', ['A4', 'C#5', 'E5'], 'af_heart', style='choir', bed='bell:A5', wet=.28, gain=.85)
add('online', 'backonline', 'Back online!', 'Back online!', ['C5', 'E5', 'G5', 'C6'], 'am_puck', bed='marimba:C5', gain=.85)
add('online', 'guesswho', 'Guess who!', 'Guess who!', ['G5', 'C6'], 'bf_emma', bed='celesta:C6', gain=.85)
add('online', 'peekaboo', 'Peekaboo!', 'Peek-a-boo!', ['E6', 'C6', 'G6'], 'af_sky', style='cute', bed='celesta:G6', gain=.85)
add('online', 'online', 'Online!', 'On-line!', ['D5', 'A5'], 'am_adam', style='deep', bed='pluck:D4', gain=.85)

# ---- Incoming call (three cycles; cycle length in seconds)
add('ring', 'ringpickup', 'Ring ring! Pick up!', 'Ring ring! Pick up!', ['E5', 'E5', 'A5', 'C#6'], 'af_bella', bed='ringbed:A4', cycle=2.6)
add('ring', 'someonescalling', 'Someone’s calling!', 'Someone’s calling!', ['C5', 'E5', 'G5', 'C6'], 'af_heart', bed='ringbed:C5', cycle=2.6)
add('ring', 'pickupphone', 'Hello? Pick up the phone!', 'Hello? Pick up the phone!', ['G4', 'C5', 'E5', 'D5', 'E5', 'G5', 'C6'], 'am_puck', bed='ringbed:C5', cycle=3.0)
add('ring', 'callingcalling', 'Calling, calling!', 'Calling, calling!', ['A5', 'E5', 'A5', 'E5'], 'af_sky', style='cute', bed='ringbed:A4', cycle=2.4)
add('ring', 'itsforyou', 'It’s for you!', 'It’s for you!', ['D5', 'F#5', 'A5', 'D6'], 'am_michael', bed='ringbed:D5', cycle=2.4)
add('ring', 'answerme', 'Answer me!', 'Answer me!', ['E5', 'G5', 'B5', 'E6'], 'af_heart', style='choir', bed='ringbed:E5', cycle=2.6, wet=.25)
add('ring', 'ringadingding', 'Ring-a-ding-ding!', 'Ring-a-ding-ding!', ['C6', 'G5', 'E6', 'C6'], 'af_bella', bed='ringbed:C5', cycle=2.4)
add('ring', 'incomingcall', 'Incoming call!', 'Incoming call!', ['A4', 'C5', 'E5', 'A5'], 'bf_emma', bed='ringbed:A4', cycle=2.6)
add('ring', 'heypickup', 'Hey, pick up!', 'Hey, pick up!', ['G5', 'E5', 'G5', 'C6'], 'am_puck', bed='ringbed:C5', cycle=2.4)
add('ring', 'itsme', 'Ring ring, it’s me!', 'Ring ring, it’s me!', ['C5', 'C5', 'E5', 'G5', 'C6'], 'af_sky', style='cute', bed='ringbed:C5', cycle=2.6)

# ---- Outgoing call (three rounds)
add('outgoing', 'calling', 'Calling…', 'Calling...', ['E5', 'C5'], 'af_nicole', bed='waitbed:C5', cycle=2.4, gain=.8)
add('outgoing', 'ringing', 'Ringing…', 'Ringing...', ['G5', 'E5'], 'af_heart', bed='waitbed:C5', cycle=2.4, gain=.8)
add('outgoing', 'comeonpickup', 'Come on, pick up.', 'Come on, pick up.', ['C5', 'E5', 'D5', 'C5'], 'am_puck', bed='waitbed:C5', cycle=2.8, gain=.8)
add('outgoing', 'holdon', 'Hold on…', 'Hold on...', ['G4', 'E4'], 'am_adam', style='deep', bed='waitbed:C4', cycle=2.4, gain=.8)
add('outgoing', 'waiting', 'Waiting…', 'Waiting...', ['E5', 'D5', 'C5'], 'af_sky', style='cute', bed='waitbed:C5', cycle=2.4, gain=.8)
add('outgoing', 'anysecond', 'Any second now.', 'Any second now.', ['C5', 'D5', 'E5', 'G5'], 'af_heart', bed='waitbed:C5', cycle=2.8, gain=.8)
add('outgoing', 'ringring', 'Ring, ring…', 'Ring, ring...', ['A4', 'F#4'], 'af_nicole', style='choir', bed='waitbed:D4', cycle=2.4, wet=.25, gain=.8)
add('outgoing', 'hellohello', 'Hello? Hello?', 'Hello? Hello?', ['E5', 'G5', 'E5', 'A5'], 'am_michael', bed='waitbed:C5', cycle=2.8, gain=.8)
add('outgoing', 'stillringing', 'Still ringing…', 'Still ringing...', ['C5', 'E5', 'D5'], 'bf_emma', bed='waitbed:C5', cycle=2.8, gain=.8)
add('outgoing', 'dialing', 'Dialing…', 'Dialing...', ['A4', 'C5', 'E5'], 'af_bella', style='robot', bed='waitbed:A4', cycle=2.4, gain=.8)

# ---- Call connected
add('connected', 'yourein', 'You’re in!', 'You’re in!', ['C5', 'G5'], 'af_bella', bed='celesta:G6')
add('connected', 'connected', 'Connected!', 'Connected!', ['C5', 'E5', 'G5'], 'af_heart', bed='bell:C6')
add('connected', 'hithere', 'Hi there!', 'Hi there!', ['E5', 'B5'], 'af_sky', style='cute', bed='celesta:B6')
add('connected', 'werelive', 'We’re live!', 'We’re live!', ['G5', 'D6'], 'am_puck', bed='marimba:G5')
add('connected', 'heyitsyou', 'Hey, it’s you!', 'Hey, it’s you!', ['D5', 'F#5', 'A5'], 'af_heart', bed='glass:A6')
add('connected', 'gotem', 'Got ’em!', 'Got ’em!', ['A5', 'E6'], 'am_michael', bed='pluck:A4')
add('connected', 'youreon', 'You’re on!', 'You’re on!', ['C6', 'G6'], 'af_bella', style='choir', bed='bell:C7', wet=.25)
add('connected', 'talkaway', 'Talk away!', 'Talk away!', ['E5', 'G5', 'C6'], 'bf_emma', bed='celesta:C6')
add('connected', 'hellohello', 'Hello, hello!', 'Hello, hello!', ['G4', 'C5', 'E5', 'G5'], 'am_puck', bed='marimba:C5')
add('connected', 'letstalk', 'Let’s talk!', 'Let’s talk!', ['A4', 'E5'], 'am_adam', style='deep', bed='pluck:A3')

# ---- Call ended
add('ended', 'callended', 'Call ended.', 'Call ended.', ['G5', 'E5', 'C5'], 'af_heart', bed='bell:C5')
add('ended', 'byefornow', 'Bye for now!', 'Bye for now!', ['A5', 'F#5', 'D5'], 'af_bella', bed='celesta:D6')
add('ended', 'talksoon', 'Talk soon!', 'Talk soon!', ['E5', 'C5'], 'af_sky', style='cute', bed='celesta:C6')
add('ended', 'thatsawrap', 'That’s a wrap!', 'That’s a wrap!', ['G5', 'E5', 'C5'], 'am_puck', bed='marimba:C5')
add('ended', 'later', 'Later!', 'Later!', ['A5', 'E5'], 'am_michael', bed='pluck:A4')
add('ended', 'hungup', 'Hung up!', 'Hung up!', ['E5', 'A4'], 'af_heart', style='robot', bed='pluck:A3')
add('ended', 'overandout', 'Over and out!', 'Over and out!', ['G5', 'E5', 'D5', 'C5'], 'bm_george', bed='bell:C5')
add('ended', 'catchyoulater', 'Catch you later!', 'Catch you later!', ['C6', 'A5', 'G5', 'E5', 'C5'], 'af_bella', bed='celesta:C6')
add('ended', 'goodchat', 'Good chat!', 'Good chat!', ['D5', 'A4'], 'af_heart', style='choir', bed='bell:D5', wet=.28)
add('ended', 'tillnexttime', 'Till next time!', 'Till next time!', ['E5', 'D5', 'C5', 'A4'], 'bf_emma', bed='glass:A5')

# ---- Someone joins / leaves (pairs share an id)
PAIRS = [
    ('hibye', 'Hi! / Bye!', 'Hi!', 'Bye!', ['C5', 'G5'], ['G5', 'C5'], 'af_bella', 'normal'),
    ('imhere', 'I’m here! / I’m out!', 'I’m here!', 'I’m out!', ['D5', 'A5'], ['A5', 'D5'], 'af_heart', 'normal'),
    ('heyall', 'Hey all! / See ya!', 'Hey, all!', 'See ya!', ['E5', 'B5'], ['B5', 'E5'], 'am_puck', 'normal'),
    ('joinedleft', 'Joined! / Left!', 'Joined!', 'Left!', ['G5', 'D6'], ['D6', 'G5'], 'af_sky', 'cute'),
    ('whatsup', 'What’s up! / Peace!', 'What’s up!', 'Peace!', ['C5', 'E5', 'G5'], ['G5', 'C5'], 'am_michael', 'normal'),
    ('hellogoodbye', 'Hello! / Goodbye!', 'Hello!', 'Goodbye!', ['E5', 'A5'], ['A5', 'E5'], 'bf_emma', 'normal'),
    ('gottago', 'Knock knock! / Gotta go!', 'Knock knock!', 'Gotta go!', ['G5', 'C6'], ['C6', 'A5', 'F5'], 'af_bella', 'normal'),
    ('madeit', 'Made it! / Later!', 'Made it!', 'Later!', ['C5', 'G5'], ['G5', 'C5'], 'am_puck', 'normal'),
    ('yocya', 'Yo! / Cya!', 'Yo!', 'Cya!', ['D5', 'A5'], ['A5', 'D5'], 'am_adam', 'deep'),
    ('welcomesolong', 'Welcome! / So long!', 'Welcome!', 'So long!', ['C5', 'E5', 'G5'], ['G5', 'E5', 'C5'], 'af_heart', 'choir'),
]
for sid, name, up, down, nu, nd, v, st in PAIRS:
    add('join', sid, name, up, nu, v, st, bed=None, gain=.85, wet=.2 if st == 'choir' else .14)
    add('leave', sid, name, down, nd, v, st, bed=None, gain=.8, wet=.2 if st == 'choir' else .14)


def bed_for(spec, length):
    if not spec:
        return None
    kind, _, note = spec.partition(':')
    if kind == 'knock':
        return mix([(0, knock()), (.14, knock(950))])
    f = n(note) if note else None
    if kind == 'celesta':
        return celesta(f)
    if kind == 'bell':
        return bell(f, 1.6, .7)
    if kind == 'glass':
        return glass(f, 1.6)
    if kind == 'marimba':
        return marimba(f)
    if kind == 'pluck':
        return pluck(f)
    if kind == 'ringbed':  # a little marimba pulse under the ringing line
        return mix([(t, marimba(f * r), .5) for t, r in ((0, 1), (.3, 1.5), (.6, 2), (.9, 1.5))])
    if kind == 'waitbed':  # one soft low note per round
        return mix([(0, pluck(f / 2, 1.6), .5)])
    return None


def render(s):
    voice = sing_line(s['text'], s['notes'], s['voice'], s['speed'], s['style'], s['harmony'])
    bed = bed_for(s['bed'], len(voice))
    parts = [(0.03 if bed is not None else 0, voice)]
    if bed is not None:
        parts.append((0, bed, .28))
    one = mix(parts)
    if s['cycle']:
        cycle = max(s['cycle'], len(one) / SR + .5)
        one = mix([(c * cycle, one) for c in range(3)])
    return one


def main():
    global kokoro
    from kokoro_onnx import Kokoro
    model_dir, out = sys.argv[1], sys.argv[2]
    kokoro = Kokoro(os.path.join(model_dir, 'kokoro.int8.onnx'), os.path.join(model_dir, 'voices.bin'))
    os.makedirs(out, exist_ok=True)
    manifest = {'events': []}
    for eid, ename in base.EVENTS:
        items = []
        for s in S[eid]:
            st = finish(render(s), s['wet'], 1.5, s['gain'])
            path = os.path.join(out, f"{eid}-{s['id']}")
            pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
            with wave.open(path + '.wav', 'wb') as f:
                f.setnchannels(2)
                f.setsampwidth(2)
                f.setframerate(SR)
                f.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', path + '.wav', '-c:a', 'libmp3lame',
                            '-b:a', '128k', path + '.mp3'], check=True)
            style = {'normal': '', 'cute': 'Tiny voice. ', 'deep': 'Deep voice. ', 'choir': 'Choir. ',
                     'robot': 'Robot voice. ', 'whisper': 'Whispered. '}[s['style']]
            desc = f"{style}Sung “{s['text']}”."
            if s['cycle']:
                desc += ' Three rings.' if eid == 'ring' else ' Three rounds.'
            items.append({'id': s['id'], 'name': s['name'], 'desc': desc, 'secs': round(len(st) / SR, 1)})
            print(eid, s['id'], round(len(st) / SR, 1))
        manifest['events'].append({'id': eid, 'name': ename, 'sounds': items})
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main()
