# Ringing sound options: outgoing (what the caller hears while it rings), incoming (the
# ringtone) and "no answer" (once, when nobody picks up). Same notes and soft bell tone as the
# other Glofly sounds. Outgoing and incoming are written as ONE seamless loop cycle each (the app
# loops them while ringing); the room echo at the end is wrapped onto the start so the loop has
# no click or gap. Run: python ring.py <path to tools/sounds>
import sys, numpy as np, scipy.io.wavfile as w
from scipy.signal import fftconvolve, butter, sosfilt
SOUNDS = sys.argv[1]
exec(open(SOUNDS + '/synth_round1.py').read().split('# --- Pair A')[0])

def T(d): return np.arange(int(SR * d)) / SR
def kalimba(f, dur=1.4, amp=1.0, decay=3.2):
    t = T(dur)
    y = np.sin(2*np.pi*f*t)*np.exp(-t*decay) + 0.35*np.sin(2*np.pi*f*5.95*t)*np.exp(-t*decay*4.4) + 0.15*np.sin(2*np.pi*f*2*t)*np.exp(-t*decay*2.2)
    y += 0.22*np.sin(2*np.pi*f*12.1*t)*np.exp(-t*60)
    return amp*y*np.minimum(1, t/0.002)
def marimba(f, dur=1.0, amp=1.0, decay=5):
    t = T(dur)
    y = np.sin(2*np.pi*f*t)*np.exp(-t*decay) + 0.3*np.sin(2*np.pi*f*3.93*t)*np.exp(-t*decay*3.2) + 0.08*np.sin(2*np.pi*f*9.8*t)*np.exp(-t*decay*8)
    return amp*y*np.minimum(1, t/0.003)
def glass(f, dur=2.0, amp=1.0, decay=2.0):
    t = T(dur)
    y = sum(a*np.sin(2*np.pi*f*k*t+i)*np.exp(-t*decay*d) for i, (k, a, d) in enumerate([(1, 1, 1), (2.32, .35, 1.75), (4.25, .18, 3), (6.63, .08, 4.5)]))
    return amp*y*np.minimum(1, t/0.004)
def chirp(f0, f1, dur=0.12, amp=1.0, tail=0.4):
    t = T(dur+tail); f = np.where(t < dur, f0*(f1/f0)**(t/dur), f1)
    ph = 2*np.pi*np.cumsum(f)/SR
    env = np.minimum(1, t/0.004)*np.where(t < dur, 1, np.exp(-(t-dur)*9))*np.exp(-t*2)
    return amp*(np.sin(ph)+0.25*np.sin(2*ph))*env
def pad(f, dur=2.2, amp=1.0, attack=0.6, release=1.0, glide=1.0):
    t = T(dur); ff = f*(glide**(t/dur)); ph = 2*np.pi*np.cumsum(ff)/SR
    y = sum(a*np.sin(k*ph*(1+det)) for k, a in [(1, 1), (2, .3), (3, .08)] for det in (-.003, 0, .003))/3
    env = np.minimum(1, t/attack)**1.5 * np.clip((dur-t)/release, 0, 1)
    return amp*y*env*(1+0.12*np.sin(2*np.pi*5*t))

def room(x, wet, length):
    n = int(SR*length); t = np.arange(n)/SR
    ir = rng.standard_normal(n)*np.exp(-t*4.5)
    ir = sosfilt(butter(2, 5000, 'low', fs=SR, output='sos'), ir); ir /= np.abs(ir).sum()**0.5*30
    return x + wet*fftconvolve(x, ir)[:len(x)]

def loop(sig_fn, cycle, name, peak):
    """One loop cycle `cycle` seconds long. Notes may ring past the end: that tail is folded
    back onto the start, so playing it on repeat is seamless."""
    tail = 1.5
    o = buf(cycle + tail); sig_fn(o)
    o = room(o, 0.2, 1.0)
    n = int(cycle*SR); t = len(o) - n
    o[:t] += o[n:n+t]; o = o[:n]
    o = sosfilt(butter(1, 90, 'high', fs=SR, output='sos'), np.concatenate([o, o]))[n:]  # filter as a loop
    o = o/np.abs(o).max()*peak
    w.write(name + '.wav', SR, (o*32767).astype(np.int16)); print(f"{name}: {cycle:.2f}s loop")

def once(o, name, peak):
    finish(o, name, peak)

OUT, IN, NA = 0.42, 0.6, 0.45  # outgoing stays gentle; the ringtone has to be heard

# ---------- Outgoing: calm, patient, low-key (you're waiting, not being alerted) ----------
loop(lambda o: (place(o, tone(hz('E5'), 1.6, 0.9, decay=2.4), 0), place(o, tone(hz('G5'), 1.6, 1.0, decay=2.2), 0.22)), 3.0, 'out-1-lantern', OUT)
loop(lambda o: (place(o, chirp(hz('C5'), hz('G5'), 0.12, 0.9), 0), place(o, chirp(hz('E5'), hz('C6'), 0.14, 1.0), 0.2)), 2.8, 'out-2-firefly', OUT)
loop(lambda o: [place(o, marimba(hz(n), 1.0, a), t) for n, a, t in [('C5', .9, 0), ('E5', .9, .18), ('G5', 1, .36)]], 3.0, 'out-3-marimba', OUT)
loop(lambda o: [place(o, glass(hz(n), 2.0, a, 2.4), t) for n, a, t in [('G6', .8, 0), ('E6', .9, .3)]], 3.2, 'out-4-glass', OUT*0.9)
loop(lambda o: [place(o, pad(hz(n), 2.6, a, 0.9, 1.4), 0) for n, a in [('C4', .7), ('G4', .6), ('E5', .45)]], 3.4, 'out-5-breathe', OUT)
loop(lambda o: [place(o, kalimba(hz(n), 1.4, a), t) for n, a, t in [('G4', .8, 0), ('C5', .85, .24), ('E5', .9, .48)]], 3.0, 'out-6-kalimba', OUT)

# ---------- Incoming: brighter and more rhythmic, so it's heard across the room ----------
def in1(o):  # Glow bells: C E G C arpeggio, twice
    for r in (0, 1.15):
        for i, n in enumerate(['C5', 'E5', 'G5', 'C6']): place(o, tone(hz(n), 1.4, .8+.05*i, decay=3), r + i*0.12)
loop(in1, 3.2, 'in-1-glowbells', IN)
def in2(o):  # Firefly dance: rising chirps that skip upward
    for i, (a, b) in enumerate([('C5', 'G5'), ('E5', 'C6'), ('G5', 'E6'), ('E5', 'C6')]): place(o, chirp(hz(a), hz(b), 0.09, 1.0, 0.3), i*0.17)
    for i, (a, b) in enumerate([('C5', 'G5'), ('E5', 'C6'), ('G5', 'E6')]): place(o, chirp(hz(a), hz(b), 0.09, 1.0, 0.3), 1.0 + i*0.17)
    place(o, sparkle(0.6, 0.06, 5274), 1.4)
loop(in2, 2.8, 'in-2-firefly', IN)
def in3(o):  # Marimba: C E G E · C E G C, a bouncy two-bar figure
    for i, n in enumerate(['C5', 'E5', 'G5', 'E5', 'C5', 'E5', 'G5', 'C6']): place(o, marimba(hz(n), 1.0, .85 + (.1 if i == 7 else 0)), i*0.16 + (0.12 if i >= 4 else 0))
loop(in3, 2.8, 'in-3-marimba', IN)
def in4(o):  # Kalimba melody: C6 G5 E5 G5 · C6 E6
    for n, t in [('C6', 0), ('G5', .2), ('E5', .4), ('G5', .6), ('C6', .95), ('E6', 1.15)]: place(o, kalimba(hz(n), 1.4, .9), t)
loop(in4, 3.0, 'in-4-kalimba', IN)
def in5(o):  # Glass chimes tumbling down then up
    for n, t in [('C7', 0), ('G6', .14), ('E6', .28), ('G6', .55), ('C7', .69)]: place(o, glass(hz(n), 1.8, .8, 2.6), t)
loop(in5, 3.0, 'in-5-glass', IN*0.85)
def in6(o):  # Classic double ring, made soft: two quick trills of bell tones
    for r in (0, 0.55):
        for k in range(8): place(o, tone(hz('E6') if k % 2 == 0 else hz('C6'), 0.5, .7, decay=6), r + k*0.045)
loop(in6, 3.0, 'in-6-classic', IN*0.85)

# ---------- No answer: once, gentle and falling (the lights going out) ----------
o = buf(2.2)
for i, n in enumerate(['G5', 'E5', 'C5']): place(o, tone(hz(n), 1.6, .9, decay=2.6), i*0.22)
once(o, 'noanswer-1-fade', NA)
o = buf(2.4)
for n, a in [('G4', .7), ('E5', .5)]: place(o, pad(hz(n), 1.9, a, 0.15, 1.2, glide=2**(-5/12)), 0)
once(o, 'noanswer-2-sigh', NA)
o = buf(2.0); place(o, kalimba(hz('E5'), 1.4, .9), 0); place(o, kalimba(hz('C5'), 1.6, 1.0, 2.4), 0.28)
once(o, 'noanswer-3-pluck', NA)
o = buf(2.0); place(o, glass(hz('E6'), 1.6, .8, 2.6), 0); place(o, chirp(hz('C6'), hz('C5'), 0.35, 0.6, 0.5), 0.18)
once(o, 'noanswer-4-dim', NA*0.9)
o = buf(2.0)
for i, n in enumerate(['E5', 'D5', 'C5']): place(o, marimba(hz(n), 1.2, .9, 3.5), i*0.26)
once(o, 'noanswer-5-marimba', NA)
