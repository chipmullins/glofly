"""Glofly sung lines, round 5 (Oct 28, 2026): round 3's cute synthetic voice (not a real person,
which Chip disliked in round 4) singing round 4's witty lines, pronounced more clearly: crisper
consonants, sharper vowels, a fourth formant and a little more time on each syllable.

Run:  python sung2026b.py <out-folder>   (numpy + scipy; ffmpeg on PATH)
Syllables use sung2026.py's spelling: "onset vowel glide coda", '-' for none.
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sung2026 as v  # noqa: E402
from signature2026 import SR, bell, celesta, finish, glass, knock, marimba, mix, n, pluck  # noqa: E402
import signature2026 as base  # noqa: E402

v.CLARITY.update(trans=0.085, noise=1.8, gap=0.035, bw=0.8, f4=True)


def say(sylls, notes, style='normal', base_dur=.17, last=.34, gap=.03, harmony=None):
    """Sing syllables one after another on the given notes (last note repeats if there are more)."""
    seq, t = [], 0.0
    for i, spec in enumerate(sylls):
        onset = spec.split()[0]
        pre = v.ONSET_NOISE.get(onset, 0) if onset != '-' else 0
        dur = last if i == len(sylls) - 1 else base_dur
        p = notes[min(i, len(notes) - 1)]
        seq.append((t, spec, p, dur))
        t += pre + dur + gap + (v.CLARITY['gap'] if onset in ('t', 'k', 'p', 'ch') else 0)
    return v.sing(seq, style, harmony)


def bed(spec):
    if not spec:
        return None
    kind, _, note = spec.partition(':')
    f = n(note) if note else None
    return {
        'celesta': lambda: celesta(f), 'bell': lambda: bell(f, 1.5, .6), 'glass': lambda: glass(f, 1.4),
        'marimba': lambda: marimba(f), 'pluck': lambda: pluck(f), 'knock': lambda: mix([(0, knock()), (.13, knock(950))]),
        'ringbed': lambda: mix([(t, marimba(f * r), .5) for t, r in ((0, 1), (.3, 1.5), (.6, 2), (.9, 1.5))]),
        'waitbed': lambda: pluck(f / 2, 1.5),
    }[kind]()


# (id, name, syllables "a | b | c", notes "C5 E5 G5", style, bed, extra)
LINES = {
    'login': [
        ('hellothere', 'Hello there!', 'h e - l | l o u - | th e - r', 'G4 C5 E5', 'normal', 'celesta:C6'),
        ('heyback', 'Hey hey, you’re back!', 'h e i - | h e i - | y u - r | b ae - k', 'C5 E5 G5 C6', 'normal', 'marimba:C5'),
        ('welcomeback', 'Welcome back!', 'w e - l | k uh - m | b ae - k', 'E5 G5 C6', 'normal', 'bell:C6'),
        ('gloflytime', 'Glofly time!', 'g o u - | f a i - | t a i m', 'G4 D5 G5', 'normal', 'celesta:G5'),
        ('lookwho', 'Look who’s here!', 'l u - k | h u - s | h i - r', 'D5 F#5 A5', 'cute', 'celesta:D6'),
        ('lightson', 'Lights on!', 'l a i t | - aw - n', 'A4 E5', 'normal', 'glass:E6'),
        ('hifriend', 'Hi, friend!', 'h a i - | f e - n', 'C5 G5', 'choir', 'bell:C6'),
        ('readysetglow', 'Ready, set, glow!', 'r e - d | d i - - | s e - t | g o u -', 'C5 D5 E5 G5', 'normal', 'marimba:C5'),
        ('wellhello', 'Well, hello!', 'w e - l | h e - l | l o u -', 'E4 A4 C#5', 'deep', 'pluck:A3'),
        ('letsglow', 'Let’s glow!', 'l e - t | g o u -', 'G5 D6', 'cute', 'celesta:G6'),
    ],
    'logoff': [
        ('seeya', 'See ya!', 's i - - | y a - -', 'A5 E5', 'normal', 'celesta:A5'),
        ('byefornow', 'Bye for now!', 'b a i - | f o - r | n a u -', 'G5 E5 C5', 'normal', 'bell:C5'),
        ('catchyoulater', 'Catch you later!', 'k ae - ch | y u - - | l e i - | d er - -', 'G5 E5 D5 C5', 'normal', 'marimba:C5'),
        ('goodnight', 'Goodnight!', 'g u - d | n a i t', 'D5 A4', 'normal', 'glass:A5'),
        ('peaceout', 'Peace out!', 'p i - s | - a u t', 'E5 B4', 'normal', 'pluck:E4'),
        ('lightsout', 'Lights out!', 'l a i t | - a u t', 'E5 A4', 'cute', 'celesta:A5'),
        ('toodleoo', 'Toodle-oo!', 't u - - | d uh - l | - u - -', 'C6 A5 F5', 'cute', 'celesta:F6'),
        ('latergator', 'Later, gator!', 'l e i - | d er - - | g e i - | d er - -', 'G5 E5 G5 C5', 'normal', 'marimba:C5'),
        ('sweetdreams', 'Sweet dreams!', 's i - t | d i - m', 'E5 C5', 'choir', 'bell:C5'),
        ('byebyenow', 'Bye-bye now!', 'b a i - | b a i - | n a u -', 'A5 E5 C#5', 'normal', 'pluck:A3'),
    ],
    'message': [
        ('newmessage', 'New message!', 'n u - - | m e - s | s i - ch', 'E5 G5 B5', 'normal', 'celesta:E6'),
        ('messageforyou', 'Message for you!', 'm e - s | s i - ch | f o - r | y u - -', 'C5 E5 G5 C6', 'normal', 'marimba:C6'),
        ('dingnew', 'Ding! New message!', 'd i - ng | n u - - | m e - s | s i - ch', 'B5 E5 G#5 B5', 'cute', 'bell:B6'),
        ('psstnew', 'Psst, new message!', 'p uh - s | n u - - | m e - s | s i - ch', 'C5 D5 F#5 A5', 'normal', 'glass:D6'),
        ('someonesaidhi', 'Someone said hi!', 's uh - m | w uh - n | s e - d | h a i -', 'C5 D5 E5 G5', 'normal', 'marimba:C5'),
        ('oohamessage', 'Ooh, a message!', 'w u - - | - uh - - | m e - s | s i - ch', 'G4 C5 E5 G5', 'normal', 'celesta:G5'),
        ('incoming', 'Incoming!', '- i - n | k uh - m | - i - ng', 'C5 E5 G5', 'normal', 'pluck:C5'),
        ('readme', 'Read me!', 'r i - d | m i - -', 'A5 E6', 'cute', 'celesta:A6'),
        ('gotone', 'Got one!', 'g a - t | w uh - n', 'D5 A5', 'normal', 'marimba:D5'),
        ('checkthis', 'Hey, check this!', 'h e i - | ch e - k | th i - s', 'E5 G5 B5', 'normal', 'glass:B6'),
    ],
    'mention': [
        ('thatsyou', 'Hey, that’s you!', 'h e i - | th ae - t | y u - -', 'A5 C#6 E6', 'normal', 'bell:E6'),
        ('yoohooyou', 'Yoo-hoo, it’s you!', 'y u - - | h u - - | - i - t | y u - -', 'G5 E5 G5 C6', 'cute', 'celesta:C7'),
        ('overhere', 'Psst, over here!', 'p uh - s | - o u - | v er - - | h i - r', 'C5 D5 F#5 A5', 'normal', 'glass:D6'),
        ('mentioned', 'You got mentioned!', 'y u - - | g a - t | m e - n | sh uh - n', 'E5 G5 B5 E6', 'normal', 'marimba:E5'),
        ('earsburning', 'Ears burning?', '- i - r | b er - - | n i - ng', 'C5 E5 G5', 'normal', 'bell:C6'),
        ('heyyou', 'Hey you!', 'h e i - | y u - -', 'B5 E6', 'normal', 'pluck:B4'),
        ('callingyouout', 'Calling you out!', 'k aw - l | l i - ng | y u - - | - a u t', 'A5 G5 E5 A5', 'normal', 'marimba:A5'),
        ('lookitsyou', 'Look, it’s you!', 'l u - k | - i - t | y u - -', 'D5 A5 D6', 'choir', 'bell:D6'),
        ('headsup', 'Heads up!', 'h e - d | - uh - p', 'G5 D6', 'cute', 'glass:D6'),
        ('saidyourname', 'Someone said your name!', 's uh - m | w uh - n | s e - d | y o - r | n e i m', 'C5 D5 E5 G5 C6', 'normal', 'celesta:C6'),
    ],
    'constellation': [
        ('newinstars', 'New in the stars!', 'n u - - | - i - n | th uh - - | s a - r', 'E5 G#5 B5 E6', 'normal', 'glass:E6'),
        ('constellation', 'Constellation!', 'k aw - n | s uh - - | l e i - | sh uh - n', 'C5 E5 G5 C6', 'choir', 'bell:C6'),
        ('starmessage', 'Star message!', 's a - r | m e - s | s i - ch', 'A5 E6 C#6', 'cute', 'celesta:A6'),
        ('twinkle', 'Twinkle, twinkle!', 't i - ng | k uh - l | t i - ng | k uh - l', 'C5 C5 G5 G5', 'cute', 'celesta:C7'),
        ('starrynews', 'Starry news!', 's a - r | r i - - | n u - s', 'D5 F#5 A5', 'normal', 'glass:D6'),
        ('shootingstar', 'Shooting star!', 'sh u - - | d i - ng | s a - r', 'B5 G5 E6', 'normal', 'celesta:E7'),
        ('innebula', 'Over in the nebula!', '- o u - | v er - - | - i - n | th uh - - | n e - b | y u - - | l uh - -', 'E5 G5 A5 B5 D6 B5 E6', 'normal', 'glass:E6'),
        ('outofthisworld', 'Out of this world!', '- a u t | - uh - v | th i - s | w er - l', 'C5 E5 G5 C6', 'deep', 'glass:C6'),
        ('cosmic', 'Cosmic!', 'k aw - s | m i - k', 'A4 E5', 'choir', 'bell:A5'),
        ('starlight', 'Starlight!', 's a - r | l a i t', 'G5 D6', 'cute', 'celesta:G6'),
    ],
    'friend': [
        ('newfriend', 'New friend!', 'n u - - | f e - n', 'C5 G5', 'normal', 'celesta:C6'),
        ('wannabefriends', 'Wanna be friends?', 'w aw - n | n uh - - | b i - - | f e - n', 'E5 D5 E5 A5', 'cute', 'celesta:A6'),
        ('knockknock', 'Knock knock!', 'n aw - k | n aw - k', 'G5 D5', 'normal', 'knock'),
        ('friendrequest', 'Friend request!', 'f e - n | r i - - | k e - s', 'A5 C#6 E6', 'normal', 'bell:A6'),
        ('canijoin', 'Hi, can I join?', 'h a i - | k ae - n | - a i - | ch o i n', 'D5 E5 F#5 A5', 'normal', 'pluck:D5'),
        ('makeafriend', 'Make a friend!', 'm e i k | - uh - - | f e - n', 'G5 B5 D6', 'choir', 'bell:G6'),
        ('buddyalert', 'Buddy alert!', 'b uh - d | d i - - | - uh - - | l er - t', 'C6 G5 E5 G5', 'normal', 'marimba:C6'),
        ('hellonewfriend', 'Hello, new friend!', 'h e - l | l o u - | n u - - | f e - n', 'E5 G5 A5 E6', 'normal', 'celesta:E6'),
        ('bemybuddy', 'Be my buddy?', 'b i - - | m a i - | b uh - d | d i - -', 'C5 E5 G5 C6', 'cute', 'celesta:C7'),
        ('hiyafriend', 'Hi-ya, friend!', 'h a i - | y a - - | f e - n', 'C6 E6 G6', 'cute', 'celesta:G6'),
    ],
    'online': [
        ('theyrehere', 'They’re here!', 'th e - r | h i - r', 'C5 G5', 'normal', 'glass:G6'),
        ('friendison', 'Your friend is on!', 'y o - r | f e - n | - i - s | - aw - n', 'C5 D5 E5 G5', 'normal', 'marimba:C5'),
        ('lookwhosonline', 'Look who’s online!', 'l u - k | h u - s | - aw - n | l a i n', 'D5 F#5 A5 D6', 'normal', 'celesta:D6'),
        ('hiagain', 'Hi again!', 'h a i - | - uh - - | g e - n', 'E5 G5 B5', 'cute', 'celesta:E6'),
        ('readytochat', 'Ready to chat!', 'r e - d | d i - - | t u - - | ch ae - t', 'G4 B4 D5 G5', 'normal', 'pluck:G4'),
        ('glowingnow', 'Glowing now!', 'g o u - | - i - ng | n a u -', 'A4 C#5 E5', 'choir', 'bell:A5'),
        ('backonline', 'Back online!', 'b ae - k | - aw - n | l a i n', 'C5 E5 G5', 'normal', 'marimba:C5'),
        ('guesswho', 'Guess who!', 'g e - s | h u - -', 'G5 C6', 'normal', 'celesta:C6'),
        ('peekaboo', 'Peekaboo!', 'p i - k | - uh - - | b u - -', 'E6 C6 G6', 'cute', 'celesta:G6'),
        ('online', 'Online!', '- aw - n | l a i n', 'D5 A5', 'deep', 'pluck:D4'),
    ],
    'ring': [
        ('ringpickup', 'Ring ring! Pick up!', 'r i - ng | r i - ng | p i - k | - uh - p', 'E5 E5 A5 C#6', 'normal', 'ringbed:A4', 2.6),
        ('someonescalling', 'Someone’s calling!', 's uh - m | w uh - n | k aw - l | l i - ng', 'C5 E5 G5 C6', 'normal', 'ringbed:C5', 2.6),
        ('pickupphone', 'Hello? Pick up the phone!', 'h e - l | l o u - | p i - k | - uh - p | th uh - - | f o u n', 'G4 C5 E5 D5 E5 C6', 'normal', 'ringbed:C5', 3.0),
        ('callingcalling', 'Calling, calling!', 'k aw - l | l i - ng | k aw - l | l i - ng', 'A5 E5 A5 E5', 'cute', 'ringbed:A4', 2.4),
        ('itsforyou', 'It’s for you!', '- i - t | f o - r | y u - -', 'D5 F#5 A5', 'normal', 'ringbed:D5', 2.4),
        ('answerme', 'Answer me!', '- ae - n | s er - - | m i - -', 'E5 G5 B5', 'choir', 'ringbed:E5', 2.6),
        ('ringadingding', 'Ring-a-ding-ding!', 'r i - ng | - uh - - | d i - ng | d i - ng', 'C6 G5 E6 C6', 'cute', 'ringbed:C5', 2.4),
        ('incomingcall', 'Incoming call!', '- i - n | k uh - m | - i - ng | k aw - l', 'A4 C5 E5 A5', 'normal', 'ringbed:A4', 2.6),
        ('heypickup', 'Hey, pick up!', 'h e i - | p i - k | - uh - p', 'G5 E5 C6', 'normal', 'ringbed:C5', 2.4),
        ('itsme', 'Ring ring, it’s me!', 'r i - ng | r i - ng | - i - t | m i - -', 'C5 C5 E5 G5', 'cute', 'ringbed:C5', 2.6),
    ],
    'outgoing': [
        ('calling', 'Calling…', 'k aw - l | l i - ng', 'E5 C5', 'normal', 'waitbed:C5', 2.4),
        ('ringing', 'Ringing…', 'r i - ng | - i - ng', 'G5 E5', 'normal', 'waitbed:C5', 2.4),
        ('comeonpickup', 'Come on, pick up.', 'k uh - m | - aw - n | p i - k | - uh - p', 'C5 E5 D5 C5', 'normal', 'waitbed:C5', 2.8),
        ('holdon', 'Hold on…', 'h o u l | - aw - n', 'G4 E4', 'deep', 'waitbed:C4', 2.4),
        ('waiting', 'Waiting…', 'w e i - | d i - ng', 'E5 C5', 'cute', 'waitbed:C5', 2.4),
        ('anysecond', 'Any second now.', '- e - n | n i - - | s e - k | k uh - n | n a u -', 'C5 D5 E5 D5 C5', 'normal', 'waitbed:C5', 3.0),
        ('ringring', 'Ring, ring…', 'r i - ng | r i - ng', 'A4 F#4', 'choir', 'waitbed:D4', 2.4),
        ('hellohello', 'Hello? Hello?', 'h e - l | l o u - | h e - l | l o u -', 'E5 G5 E5 A5', 'normal', 'waitbed:C5', 2.8),
        ('stillringing', 'Still ringing…', 's i - l | r i - ng | - i - ng', 'C5 E5 D5', 'normal', 'waitbed:C5', 2.8),
        ('dialing', 'Dialing…', 'd a i - | - uh - l | l i - ng', 'A4 C5 E5', 'robot', 'waitbed:A4', 2.4),
    ],
    'connected': [
        ('yourein', 'You’re in!', 'y u - r | - i - n', 'C5 G5', 'normal', 'celesta:G6'),
        ('connected', 'Connected!', 'k uh - n | n e - k | d i - d', 'C5 E5 G5', 'normal', 'bell:C6'),
        ('hithere', 'Hi there!', 'h a i - | th e - r', 'E5 B5', 'cute', 'celesta:B6'),
        ('werelive', 'We’re live!', 'w i - r | l a i v', 'G5 D6', 'normal', 'marimba:G5'),
        ('heyitsyou', 'Hey, it’s you!', 'h e i - | - i - t | y u - -', 'D5 F#5 A5', 'normal', 'glass:A6'),
        ('gotem', 'Got ’em!', 'g a - t | - uh - m', 'A5 E6', 'normal', 'pluck:A4'),
        ('youreon', 'You’re on!', 'y u - r | - aw - n', 'C6 G6', 'choir', 'bell:C7'),
        ('talkaway', 'Talk away!', 't aw - k | - uh - - | w e i -', 'E5 G5 C6', 'cute', 'celesta:C6'),
        ('hellohello', 'Hello, hello!', 'h e - l | l o u - | h e - l | l o u -', 'G4 C5 E5 G5', 'normal', 'marimba:C5'),
        ('letstalk', 'Let’s talk!', 'l e - t | t aw - k', 'A4 E5', 'deep', 'pluck:A3'),
    ],
    'ended': [
        ('callended', 'Call ended.', 'k aw - l | - e - n | d i - d', 'G5 E5 C5', 'normal', 'bell:C5'),
        ('byefornow', 'Bye for now!', 'b a i - | f o - r | n a u -', 'A5 F#5 D5', 'normal', 'celesta:D6'),
        ('talksoon', 'Talk soon!', 't aw - k | s u - n', 'E5 C5', 'cute', 'celesta:C6'),
        ('thatsawrap', 'That’s a wrap!', 'th ae - t | s uh - - | r ae - p', 'G5 E5 C5', 'normal', 'marimba:C5'),
        ('later', 'Later!', 'l e i - | d er - -', 'A5 E5', 'normal', 'pluck:A4'),
        ('hungup', 'Hung up!', 'h uh - ng | - uh - p', 'E5 A4', 'robot', 'pluck:A3'),
        ('overandout', 'Over and out!', '- o u - | v er - - | - ae - n | - a u t', 'G5 E5 D5 C5', 'deep', 'bell:C5'),
        ('catchyoulater', 'Catch you later!', 'k ae - ch | y u - - | l e i - | d er - -', 'C6 A5 G5 E5', 'cute', 'celesta:C6'),
        ('goodchat', 'Good chat!', 'g u - d | ch ae - t', 'D5 A4', 'choir', 'bell:D5'),
        ('tillnexttime', 'Till next time!', 't i - l | n e - k | t a i m', 'E5 D5 C5', 'normal', 'glass:A5'),
    ],
}

# Joins / leaves: (id, name, join syllables, join notes, leave syllables, leave notes, style)
PAIRS = [
    ('hibye', 'Hi! / Bye!', 'h a i -', 'C5 G5', 'b a i -', 'G5 C5', 'normal'),
    ('imhere', 'I’m here! / I’m out!', '- a i m | h i - r', 'D5 A5', '- a i m | - a u t', 'A5 D5', 'normal'),
    ('heyall', 'Hey, all! / See ya!', 'h e i - | - aw - l', 'E5 B5', 's i - - | y a - -', 'B5 E5', 'normal'),
    ('joinedleft', 'Joined! / Left!', 'ch o i n', 'G5', 'l e - f', 'D6', 'cute'),
    ('whatsup', 'What’s up! / Peace!', 'w uh - t | - uh - p', 'C5 G5', 'p i - s', 'G5', 'normal'),
    ('hellogoodbye', 'Hello! / Goodbye!', 'h e - l | l o u -', 'E5 A5', 'g u - d | b a i -', 'A5 E5', 'normal'),
    ('gottago', 'Knock knock! / Gotta go!', 'n aw - k | n aw - k', 'G5 C6', 'g aw - - | d uh - - | g o u -', 'C6 A5 F5', 'cute'),
    ('madeit', 'Made it! / Later!', 'm e i - | d i - t', 'C5 G5', 'l e i - | d er - -', 'G5 C5', 'normal'),
    ('yocya', 'Yo! / Cya!', 'y o u -', 'D5', 's i - - | y a - -', 'A5 D5', 'deep'),
    ('welcomesolong', 'Welcome! / So long!', 'w e - l | k uh - m', 'C5 G5', 's o u - | l aw - ng', 'G5 C5', 'choir'),
]


def split(s):
    return [x.strip() for x in s.split('|')]


def render_line(sylls, notes, style, bedspec, cycle=None, short=False):
    voice = say(split(sylls), notes.split(), style, base_dur=.14 if short else .17, last=.24 if short else .34)
    b = bed(bedspec)
    one = mix([(0.03, voice)] + ([(0, b, .26)] if b is not None else [])) if b is not None else voice
    if cycle:
        cyc = max(cycle, len(one) / SR + .5)
        one = mix([(c * cyc, one) for c in range(3)])
    return one


STYLE_NOTE = {'normal': '', 'cute': 'Tiny voice. ', 'deep': 'Deep voice. ', 'choir': 'Choir. ', 'robot': 'Robot voice. '}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'sung2026b'
    os.makedirs(out, exist_ok=True)
    jobs = {e: [] for e, _ in base.EVENTS}
    for event, items in LINES.items():
        for it in items:
            sid, name, sylls, notes, style, bedspec = it[:6]
            cycle = it[6] if len(it) > 6 else None
            wet = .3 if style == 'choir' or event == 'constellation' else .18
            gain = .8 if event == 'outgoing' else .85 if event == 'online' else 1.0
            desc = f"{STYLE_NOTE[style]}Sung “{name}”" + (' Three rings.' if event == 'ring' else ' Three rounds.' if event == 'outgoing' else '')
            jobs[event].append((sid, name, desc, lambda s=sylls, nt=notes, st=style, b=bedspec, c=cycle: render_line(s, nt, st, b, c), wet, gain))
    for sid, name, js, jn, ls, ln, style in PAIRS:
        wet = .25 if style == 'choir' else .15
        jobs['join'].append((sid, name, f"{STYLE_NOTE[style]}Sung “{name.split(' / ')[0]}” when someone joins.",
                             lambda s=js, nt=jn, st=style: render_line(s, nt, st, None, short=True), wet, .85))
        jobs['leave'].append((sid, name, f"{STYLE_NOTE[style]}Sung “{name.split(' / ')[1]}” when someone leaves.",
                              lambda s=ls, nt=ln, st=style: render_line(s, nt, st, None, short=True), wet, .8))
    manifest = {'events': []}
    for eid, ename in base.EVENTS:
        items = []
        for sid, name, desc, fn, wet, gain in jobs[eid]:
            st = finish(fn(), wet, 1.5, gain)
            path = os.path.join(out, f'{eid}-{sid}')
            pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
            with wave.open(path + '.wav', 'wb') as f:
                f.setnchannels(2)
                f.setsampwidth(2)
                f.setframerate(SR)
                f.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', path + '.wav', '-c:a', 'libmp3lame',
                            '-b:a', '128k', path + '.mp3'], check=True)
            items.append({'id': sid, 'name': name, 'desc': desc, 'secs': round(len(st) / SR, 1)})
        manifest['events'].append({'id': eid, 'name': ename, 'sounds': items})
        print(eid, len(items))
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main()
