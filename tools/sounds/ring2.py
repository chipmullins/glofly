# Ringing sound options, round 2: more instruments (electric piano, synth, chiptune, vibraphone,
# music box, steel drum, FM bell) and longer outgoing melodies. Same loop rules as ring.py.
# Run: python ring2.py <path to tools/sounds>
import sys, numpy as np, scipy.io.wavfile as w
from scipy.signal import fftconvolve, butter, sosfilt
SOUNDS = sys.argv[1]
exec(open(SOUNDS + '/synth_round1.py').read().split('# --- Pair A')[0])

def T(d): return np.arange(int(SR * d)) / SR
def env(t, a=0.004): return np.minimum(1, t/a)

# --- instruments ---
def epiano(f, dur=1.6, amp=1.0, decay=2.6):  # FM electric piano (Rhodes-ish): bell-y attack, warm body
    t = T(dur); idx = 2.2*np.exp(-t*7) + 0.4
    y = np.sin(2*np.pi*f*t + idx*np.sin(2*np.pi*f*t)) * np.exp(-t*decay)
    y += 0.18*np.sin(2*np.pi*f*14*t)*np.exp(-t*40)  # tine
    y += 0.25*np.sin(2*np.pi*f*2*t)*np.exp(-t*decay*1.6)
    return amp*y*env(t, 0.003)*(1 + 0.08*np.sin(2*np.pi*5.5*t))
def saw_pluck(f, dur=0.6, amp=1.0, decay=4.0, bright=0.35):  # synth pluck: saw with a closing filter
    t = T(dur); y = np.zeros_like(t)
    for k in range(1, 24):
        if f*k > 12000: break
        y += np.sin(2*np.pi*f*k*t)/k * np.exp(-t*decay*(1 + bright*k))
    return amp*0.6*y*env(t, 0.002)
def square(f, dur=0.25, amp=1.0, decay=6.0):  # chiptune: soft-edged square (odd harmonics)
    t = T(dur); y = sum(np.sin(2*np.pi*f*k*t)/k for k in range(1, 16, 2) if f*k < 12000)
    e = env(t, 0.002)*np.exp(-t*decay); e[-int(0.01*SR):] *= np.linspace(1, 0, int(0.01*SR))
    return amp*0.55*y*e
def vibes(f, dur=2.0, amp=1.0, decay=1.6):  # vibraphone with its motor tremolo
    t = T(dur); y = np.sin(2*np.pi*f*t)*np.exp(-t*decay) + 0.25*np.sin(2*np.pi*f*4*t)*np.exp(-t*decay*4) + 0.1*np.sin(2*np.pi*f*10*t)*np.exp(-t*30)
    return amp*y*env(t, 0.002)*(1 - 0.35*(0.5 + 0.5*np.sin(2*np.pi*5.8*t)))
def musicbox(f, dur=1.4, amp=1.0, decay=3.0):  # tiny metal comb
    t = T(dur); y = np.sin(2*np.pi*f*t)*np.exp(-t*decay) + 0.4*np.sin(2*np.pi*f*3.0*t)*np.exp(-t*decay*2.5) + 0.2*np.sin(2*np.pi*f*5.4*t)*np.exp(-t*decay*5)
    return amp*y*env(t, 0.001)
def steel(f, dur=1.2, amp=1.0, decay=3.2):  # steel drum
    t = T(dur); g = 1 + 0.01*np.exp(-t*30)
    y = np.sin(2*np.pi*f*g*t)*np.exp(-t*decay) + 0.5*np.sin(2*np.pi*f*2.01*t)*np.exp(-t*decay*1.4) + 0.3*np.sin(2*np.pi*f*3.9*t)*np.exp(-t*decay*2.5)
    return amp*y*env(t, 0.003)
def fmbell(f, dur=1.6, amp=1.0, decay=2.4):  # bright digital bell (FM, 3.5 ratio)
    t = T(dur); idx = 3*np.exp(-t*4)
    return amp*np.sin(2*np.pi*f*t + idx*np.sin(2*np.pi*f*3.5*t))*np.exp(-t*decay)*env(t, 0.002)
def synth_pad(f, dur=3.0, amp=1.0, attack=0.8, release=1.2):  # detuned saw pad, filtered warm
    t = T(dur); y = np.zeros_like(t)
    for det in (-0.006, -0.002, 0.002, 0.006):
        for k in range(1, 8): y += np.sin(2*np.pi*f*(1+det)*k*t)/(k**1.6)
    e = np.minimum(1, t/attack)**1.5*np.clip((dur-t)/release, 0, 1)
    return amp*0.25*y*e
def sub(f, dur=0.4, amp=1.0):  # soft synth bass pulse
    t = T(dur); return amp*(np.sin(2*np.pi*f*t) + 0.2*np.sin(4*np.pi*f*t))*env(t, 0.01)*np.exp(-t*7)
def sweep(f0, f1, dur, amp=1.0):  # electric "power down" / "power up"
    t = T(dur); f = f0*(f1/f0)**(t/dur); ph = 2*np.pi*np.cumsum(f)/SR
    y = sum(np.sin(k*ph)/k for k in range(1, 6))
    return amp*0.6*y*env(t, 0.005)*np.clip((dur-t)/(dur*0.6), 0, 1)

def echo(x, time=0.27, fb=0.35, mix=0.35, n=5):
    d = int(time*SR); y = x.copy()
    for i in range(1, n+1):
        y[d*i:] += x[:len(x)-d*i] * mix * fb**(i-1)
    return y

def room(x, wet, length=1.0):
    n = int(SR*length); t = np.arange(n)/SR
    ir = rng.standard_normal(n)*np.exp(-t*4.5)
    ir = sosfilt(butter(2, 5000, 'low', fs=SR, output='sos'), ir); ir /= np.abs(ir).sum()**0.5*30
    return x + wet*fftconvolve(x, ir)[:len(x)]

def loop(fill, cycle, name, peak, wet=0.2, tail=2.5, fx=None):
    o = buf(cycle + tail); fill(o)
    if fx: o = fx(o)
    o = room(o, wet)
    n = int(cycle*SR); t = len(o) - n
    o[:t] += o[n:n+t]; o = o[:n]
    o = sosfilt(butter(1, 90, 'high', fs=SR, output='sos'), np.concatenate([o, o]))[n:]
    o = o/np.abs(o).max()*peak
    w.write(name + '.wav', SR, (o*32767).astype(np.int16)); print(f"{name}: {cycle:.2f}s loop")

def seq(o, inst, notes, step, start=0.0, **kw):
    """notes: list of (note or None, beats). Plays them one after another."""
    at = start
    for n, beats in notes:
        if n: place(o, inst(hz(n), **kw), at)
        at += beats*step
    return at

OUT, IN, NA = 0.42, 0.6, 0.45

# ================= Outgoing, round 2: longer tunes and other styles =================
# 7 Evening (electric piano, 8-note tune over 6 s)
loop(lambda o: seq(o, epiano, [('E5', 1), ('G5', 1), ('C6', 2), ('B5', 1), ('G5', 1), ('A5', 2), ('G5', 1), ('E5', 3)], 0.32, amp=0.9), 6.0, 'out-7-evening', OUT)
# 8 Synth arp (electric: filtered saw arpeggio with echo)
loop(lambda o: seq(o, saw_pluck, [(n, 1) for n in ['C4', 'G4', 'C5', 'E5', 'G5', 'E5', 'C5', 'G4']] + [(None, 4)], 0.16, amp=0.9), 1.92 + 0.64 + 1.44, 'out-8-synth-arp', OUT, wet=0.12, fx=lambda x: echo(x, 0.24, 0.4, 0.4))
# 9 Pixel (chiptune melody, 10 notes)
loop(lambda o: seq(o, square, [('C5', 1), ('E5', 1), ('G5', 1), ('C6', 2), ('B5', 1), ('G5', 1), ('A5', 1), ('G5', 1), ('E5', 2), (None, 5)], 0.14, amp=0.8), 0.14*16, 'out-9-pixel', OUT*0.85, wet=0.08)
# 10 Vibes (vibraphone, 6-note phrase, 5 s)
loop(lambda o: seq(o, vibes, [('G4', 1), ('C5', 1), ('E5', 1), ('D5', 1.5), ('C5', 0.5), ('E5', 3)], 0.38, amp=0.9), 5.0, 'out-10-vibes', OUT)
# 11 Music box (8 tinkly notes)
loop(lambda o: seq(o, musicbox, [('E6', 1), ('G6', 1), ('C7', 1), ('G6', 1), ('A6', 1), ('G6', 1), ('E6', 2), (None, 2)], 0.26, amp=0.85), 0.26*10 + 0.6, 'out-11-musicbox', OUT*0.9)
# 12 Night drive (electric ambient: warm synth pad, soft bass pulse, a bleep)
def night(o):
    for n, a in [('C3', .6), ('G3', .5), ('E4', .45), ('B4', .25)]: place(o, synth_pad(hz(n), 4.0, a, 1.0, 1.6), 0)
    for i in range(4): place(o, sub(hz('C2'), 0.5, 0.9), i*1.0)
    place(o, fmbell(hz('G6'), 1.2, 0.25), 0.5); place(o, fmbell(hz('E6'), 1.2, 0.2), 2.5)
loop(night, 4.0, 'out-12-nightdrive', OUT, wet=0.25)
# 13 Steel drum (island tune, 7 notes)
loop(lambda o: seq(o, steel, [('C5', 1), ('E5', 1), ('G5', 1), ('A5', 1), ('G5', 1), ('E5', 1), ('G5', 2), (None, 4)], 0.22, amp=0.9), 0.22*12 + 0.4, 'out-13-steel', OUT)
# 14 Digital (modern ringback: two FM tones with a soft pulse, a bit like a phone line)
def digital(o):
    for r in (0, 0.5):
        place(o, fmbell(hz('E5'), 0.45, 0.6, 6), r); place(o, fmbell(hz('A5'), 0.45, 0.45, 6), r)
loop(digital, 3.0, 'out-14-digital', OUT*0.9, wet=0.12, fx=lambda x: echo(x, 0.18, 0.3, 0.2, 3))

# ================= Incoming, round 2 =================
# 7 Electro (fast synth arp with echo, two bars)
loop(lambda o: (seq(o, saw_pluck, [(n, 1) for n in ['C5', 'E5', 'G5', 'C6', 'G5', 'E5', 'G5', 'C6']], 0.12, amp=0.9, bright=0.25),
                seq(o, saw_pluck, [(n, 1) for n in ['D5', 'G5', 'B5', 'D6', 'B5', 'G5', 'B5', 'E6']], 0.12, start=0.96, amp=0.9, bright=0.25)), 2.6, 'in-7-electro', IN, wet=0.12, fx=lambda x: echo(x, 0.24, 0.35, 0.3))
# 8 Chiptune ring (8-bit, quick and catchy)
loop(lambda o: (seq(o, square, [('C6', 1), ('G5', 1), ('C6', 1), ('E6', 1), ('G6', 2), ('E6', 1), ('C6', 1)], 0.11, amp=0.9),
                seq(o, square, [('C6', 1), ('G5', 1), ('C6', 1), ('E6', 1), ('G6', 2), ('C7', 2)], 0.11, start=1.1, amp=0.9)), 2.6, 'in-8-chiptune', IN*0.8, wet=0.08)
# 9 Groove (electric piano chords with a little bounce)
def groove(o):
    for at, chord in [(0, ['C5', 'E5', 'G5']), (0.36, ['C5', 'E5', 'G5']), (0.72, ['D5', 'G5', 'B5']), (1.26, ['E5', 'G5', 'C6'])]:
        for n in chord: place(o, epiano(hz(n), 1.2, 0.5, 3), at)
    place(o, sub(hz('C3'), 0.4, 0.8), 0); place(o, sub(hz('G2'), 0.4, 0.8), 0.72)
loop(groove, 2.6, 'in-9-groove', IN)
# 10 Steel drums (calypso bounce)
loop(lambda o: seq(o, steel, [('G5', 1), ('C6', 1), ('E6', 1), ('C6', 0.5), ('D6', 0.5), ('E6', 1), ('G6', 2), (None, 1)], 0.17, amp=0.9) and
     seq(o, steel, [('G5', 1), ('C6', 1), ('E6', 1), ('G6', 2)], 0.17, start=1.5, amp=0.9), 2.8, 'in-10-steel', IN)
# 11 Vibes (bright vibraphone run, up and back)
loop(lambda o: seq(o, vibes, [(n, 1) for n in ['C5', 'E5', 'G5', 'C6', 'E6', 'C6', 'G5', 'E5']], 0.14, amp=0.9, decay=2.2), 2.8, 'in-11-vibes', IN)
# 12 FM bells (modern digital phone: bright bell trio, repeated)
loop(lambda o: [seq(o, fmbell, [('E6', 1), ('G6', 1), ('C7', 1)], 0.1, start=r, amp=0.8, decay=3.5) for r in (0, 0.55, 1.1)], 2.8, 'in-12-fmbells', IN*0.85, fx=lambda x: echo(x, 0.2, 0.3, 0.2, 3))

# ================= No answer, round 2 =================
def once(o, name, peak): finish(o, name, peak)
o = buf(2.4)
for n, a in [('G4', .5), ('C5', .5), ('E5', .5)]: place(o, epiano(hz(n), 2.0, a, 2.2), 0)
for n, a in [('F4', .5), ('A4', .5), ('C5', .5)]: place(o, epiano(hz(n), 2.0, a, 2.2), 0.42)
once(o, 'noanswer-6-epiano', NA)
o = buf(1.6); place(o, sweep(hz('G5'), hz('C3'), 0.9, 0.8), 0); place(o, sub(hz('C2'), 0.5, 0.6), 0.7)
once(o, 'noanswer-7-powerdown', NA*0.9)
o = buf(1.6); seq(o, square, [('G5', 1), ('E5', 1), ('C5', 1), ('G4', 3)], 0.16, amp=0.9, decay=3)
once(o, 'noanswer-8-pixel', NA*0.8)
o = buf(2.2); seq(o, musicbox, [('G6', 1), ('E6', 1), ('D6', 1), ('C6', 3)], 0.28, amp=0.9)
once(o, 'noanswer-9-musicbox', NA*0.9)
