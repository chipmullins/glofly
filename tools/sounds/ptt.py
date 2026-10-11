# Push-to-talk sound options: a short "you're live" sound when the key goes down and a
# softer, falling "let go" sound when it comes up. Same notes and soft bell tone as the other
# Glofly sounds (tools/sounds/synth_round1.py), but much shorter and quieter, since they play
# every time you talk. Writes ptt-<n>-<name>-down.wav / -up.wav into the current folder.
import sys, numpy as np, scipy.io.wavfile as w
from scipy.signal import butter, sosfilt
SOUNDS = sys.argv[1]
exec(open(SOUNDS + '/synth_round1.py').read().split('# --- Pair A')[0])

def T(d): return np.arange(int(SR * d)) / SR
def kalimba(f, dur=0.6, amp=1.0, decay=7.0):
    t = T(dur)
    y = np.sin(2*np.pi*f*t)*np.exp(-t*decay) + 0.3*np.sin(2*np.pi*f*5.95*t)*np.exp(-t*decay*4) + 0.2*np.sin(2*np.pi*f*12.1*t)*np.exp(-t*80)
    return amp*y*np.minimum(1, t/0.002)
def marimba(f, dur=0.5, amp=1.0, decay=9.0):
    t = T(dur)
    y = np.sin(2*np.pi*f*t)*np.exp(-t*decay) + 0.3*np.sin(2*np.pi*f*3.93*t)*np.exp(-t*decay*3)
    return amp*y*np.minimum(1, t/0.003)
def glass(f, dur=0.7, amp=1.0, decay=6.0):
    t = T(dur)
    y = sum(a*np.sin(2*np.pi*f*k*t+i)*np.exp(-t*decay*d) for i, (k, a, d) in enumerate([(1, 1, 1), (2.32, .35, 1.7), (4.25, .18, 3)]))
    return amp*y*np.minimum(1, t/0.003)
def chirp(f0, f1, dur=0.06, amp=1.0, tail=0.18):
    t = T(dur+tail); f = np.where(t < dur, f0*(f1/f0)**(t/dur), f1)
    ph = 2*np.pi*np.cumsum(f)/SR
    env = np.minimum(1, t/0.003)*np.where(t < dur, 1, np.exp(-(t-dur)*22))
    return amp*(np.sin(ph)+0.2*np.sin(2*ph))*env
def tick(amp=0.5, f=3500, dur=0.02):
    t = T(dur); n = rng.standard_normal(len(t))*np.exp(-t*260)
    return amp*sosfilt(butter(2, [f*0.6, f*1.4], 'band', fs=SR, output='sos'), n)

def done(x, name, peak):
    # A shorter, drier room than the call sounds: these are tiny and frequent.
    n = int(SR*0.35); t = np.arange(n)/SR
    ir = rng.standard_normal(n)*np.exp(-t*12)
    ir = sosfilt(butter(2, 5000, 'low', fs=SR, output='sos'), ir); ir /= np.abs(ir).sum()**0.5*30
    y = np.concatenate([x, np.zeros(n)]); y = y + 0.12*np.convolve(y, ir)[:len(y)]
    thr = 3e-4*np.abs(y).max(); end = np.nonzero(np.abs(y) > thr)[0][-1] + int(0.02*SR); y = y[:end]
    f = int(0.02*SR); y[-f:] *= np.linspace(1, 0, f)
    y = sosfilt(butter(1, 120, 'high', fs=SR, output='sos'), y)
    y = y/np.abs(y).max()*peak
    w.write(name + '.wav', SR, (y*32767).astype(np.int16))
    print(f"{name}: {len(y)/SR:.2f}s")

DOWN, UP = 0.32, 0.26  # the let-go sound is a touch quieter

# 1 Blink: one quick rising light-blink / falling blink
o = buf(0.4); place(o, chirp(hz('E5'), hz('B5'), 0.05), 0); done(o, 'ptt-1-blink-down', DOWN)
o = buf(0.4); place(o, chirp(hz('B5'), hz('E5'), 0.06), 0); done(o, 'ptt-1-blink-up', UP)
# 2 Firefly: two tiny rising blinks / two falling
o = buf(0.45); place(o, chirp(hz('C6'), hz('E6'), 0.03, 0.8, 0.1), 0); place(o, chirp(hz('E6'), hz('G6'), 0.04, 1.0, 0.16), 0.055); done(o, 'ptt-2-firefly-down', DOWN)
o = buf(0.45); place(o, chirp(hz('G6'), hz('E6'), 0.03, 0.9, 0.1), 0); place(o, chirp(hz('E6'), hz('C6'), 0.045, 0.8, 0.18), 0.06); done(o, 'ptt-2-firefly-up', UP)
# 3 Pluck: a bright kalimba tine / one a fourth lower
o = buf(0.6); place(o, kalimba(hz('C6'), 0.6, 1.0, 9), 0); done(o, 'ptt-3-pluck-down', DOWN)
o = buf(0.6); place(o, kalimba(hz('G5'), 0.6, 1.0, 11), 0); done(o, 'ptt-3-pluck-up', UP)
# 4 Bell: the Glofly bell, a short G5 / a softer E5
o = buf(0.6); place(o, tone(hz('G5'), 0.6, 1.0, decay=9), 0); done(o, 'ptt-4-bell-down', DOWN)
o = buf(0.6); place(o, tone(hz('E5'), 0.6, 1.0, decay=12), 0); done(o, 'ptt-4-bell-up', UP)
# 5 Glass: a small glassy ping / the same ping a fifth down
o = buf(0.7); place(o, glass(hz('E6'), 0.7, 1.0, 7), 0); done(o, 'ptt-5-glass-down', DOWN*0.9)
o = buf(0.7); place(o, glass(hz('A5'), 0.7, 1.0, 9), 0); done(o, 'ptt-5-glass-up', UP*0.9)
# 6 Radio: a soft key-click plus a rising blip / a click plus a falling blip (walkie-talkie feel, gentle)
o = buf(0.4); place(o, tick(0.6, 3200), 0); place(o, chirp(hz('G5'), hz('D6'), 0.04, 0.9, 0.12), 0.012); done(o, 'ptt-6-radio-down', DOWN)
o = buf(0.4); place(o, chirp(hz('D6'), hz('G5'), 0.05, 0.8, 0.1), 0); place(o, tick(0.5, 2400), 0.07); done(o, 'ptt-6-radio-up', UP)
# 7 Tap: a soft marimba tap C6 / G5 (the quietest, least musical)
o = buf(0.5); place(o, marimba(hz('C6'), 0.5, 1.0, 12), 0); done(o, 'ptt-7-tap-down', DOWN)
o = buf(0.5); place(o, marimba(hz('G5'), 0.5, 1.0, 14), 0); done(o, 'ptt-7-tap-up', UP)
# 8 Spark: two notes up together (C6+G6) / together down (G5+C5), very short
o = buf(0.45); place(o, tone(hz('C6'), 0.45, 0.8, decay=14), 0); place(o, tone(hz('G6'), 0.45, 0.7, decay=16), 0.025); place(o, sparkle(0.2, 0.05, 5274), 0.03); done(o, 'ptt-8-spark-down', DOWN)
o = buf(0.45); place(o, tone(hz('G5'), 0.45, 0.8, decay=14), 0); place(o, tone(hz('C5'), 0.45, 0.8, decay=16), 0.03); done(o, 'ptt-8-spark-up', UP)
