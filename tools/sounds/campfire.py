# Campfire's built-in sound board (Round B, Nov 2026): nine short table sounds made from scratch
# here (no samples, so Glofly owns them). Writes campfire-<id>.wav into the folder given; convert
# for the apps with tools/sounds/campfire.sh (Opus .ogg for desktop/web, .m4a-free .wav-free .mp3
# for phones is not needed: Expo plays .ogg on Android and the web; iOS gets .m4a).
#
#   python3 campfire.py out/
import sys, os, numpy as np, scipy.io.wavfile as w
from scipy.signal import butter, sosfilt

SR = 48000
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

def T(d): return np.arange(int(SR * d)) / SR
def env(t, a=0.004, d=4.0): return np.minimum(1, t / a) * np.exp(-t * d)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], 'band', fs=SR, output='sos'), x)
def noise(d): return rng.standard_normal(int(SR * d))
def place(buf, x, at):
    i = int(at * SR); n = min(len(x), len(buf) - i)
    if n > 0: buf[i:i + n] += x[:n]
def room(y, size=1.2, wet=0.25):
    n = int(SR * size); t = np.arange(n) / SR
    ir = lp(noise(size) * np.exp(-t * (6 / size)), 6000); ir /= np.sqrt((ir ** 2).sum()) * 6
    return y + wet * np.convolve(y, ir)[:len(y)]
def save(y, name, peak=0.85):
    y = hp(y, 40, 1)
    thr = 2e-4 * np.abs(y).max(); idx = np.nonzero(np.abs(y) > thr)[0]
    y = y[: idx[-1] + int(0.05 * SR)] if len(idx) else y
    f = int(0.03 * SR); y[-f:] *= np.linspace(1, 0, f)
    y = y / np.abs(y).max() * peak
    w.write(os.path.join(OUT, f'campfire-{name}.wav'), SR, (y * 32767).astype(np.int16))
    print(f'{name}: {len(y) / SR:.2f}s')

def bell_partials(f, dur, decay=1.2, ratios=((0.5, .5, .6), (1, 1, 1), (1.19, .45, 1.3), (1.5, .35, 1.6), (2, .3, 2.2), (2.74, .2, 3), (3.76, .12, 4))):
    t = T(dur)
    return sum(a * np.sin(2 * np.pi * f * r * t + i) * np.exp(-t * decay * d) for i, (r, a, d) in enumerate(ratios)) * np.minimum(1, t / 0.003)

# Bell toll: a big church-like bell, twice.
o = np.zeros(int(SR * 6))
place(o, bell_partials(196, 5.5, 0.7), 0); place(o, 0.8 * bell_partials(196, 4, 0.7), 2.4)
save(room(o, 2.5, 0.35), 'bell')

# Magic chime: a quick sparkle of glassy notes climbing up.
o = np.zeros(int(SR * 2.4))
for i, n in enumerate([880, 1109, 1319, 1760, 2217, 2637]):
    place(o, 0.7 * bell_partials(n, 1.6, 2.5, ((1, 1, 1), (2.32, .3, 1.7), (4.25, .15, 3))), i * 0.07)
save(room(o, 1.8, 0.45), 'chime')

# Thunder: a crack, then a long low rumble that rolls away.
d = 5.0; t = T(d)
crack = bp(noise(0.25), 800, 5000) * np.exp(-T(0.25) * 18)
rumble = lp(noise(d), 180, 4) * (np.minimum(1, t / 0.15) * np.exp(-t * 0.9)) * (1 + 0.6 * np.sin(2 * np.pi * 1.3 * t + 2 * np.sin(2 * np.pi * 0.4 * t)))
o = np.zeros(int(SR * d)); place(o, 0.5 * crack, 0); place(o, 6 * rumble, 0.05)
save(room(o, 2.0, 0.3), 'thunder')

# Heartbeat: lub-dub, three times, slowing.
def thump(f=55, dur=0.25, amp=1):
    t = T(dur); fr = f * (1 + 0.8 * np.exp(-t * 30))
    return amp * np.sin(2 * np.pi * np.cumsum(fr) / SR) * env(t, 0.004, 14)
o = np.zeros(int(SR * 3.4))
for i, at in enumerate([0, 1.0, 2.1]):
    place(o, thump(58, 0.3, 1), at); place(o, thump(50, 0.3, 0.7), at + 0.22)
save(lp(o, 900), 'heartbeat')

# Coins: a handful of coins poured onto a table.
o = np.zeros(int(SR * 1.6))
for k in range(26):
    at = 0.04 * k + rng.uniform(0, 0.05) + (0.0 if k < 18 else 0.2)
    f = rng.uniform(3200, 6200)
    t = T(0.25)
    ring = sum(a * np.sin(2 * np.pi * f * r * t) for r, a in [(1, 1), (1.47, .6), (2.1, .4)]) * env(t, 0.0008, rng.uniform(18, 30))
    place(o, rng.uniform(0.3, 1) * ring, at)
save(room(o, 0.6, 0.2), 'coins', 0.7)

# War drum: four slow, deep hits.
def drum(amp=1):
    t = T(0.9); fr = 70 * (1 + 0.6 * np.exp(-t * 20))
    body = np.sin(2 * np.pi * np.cumsum(fr) / SR) * env(t, 0.003, 4.5)
    skin = lp(noise(0.9), 1200) * env(t, 0.001, 30) * 0.4
    return amp * (body + skin)
o = np.zeros(int(SR * 4))
for i, at in enumerate([0, 0.75, 1.5, 2.25]):
    place(o, drum(1 if i % 2 == 0 else 0.75), at)
save(room(o, 1.5, 0.3), 'drum')

# Gong: one shimmering hit.
t = T(5)
g = sum(a * np.sin(2 * np.pi * f * t + i) * np.exp(-t * dcy) for i, (f, a, dcy) in enumerate([(110, 1, 0.6), (165.5, .7, 0.7), (231, .6, 0.9), (329, .45, 1.1), (417, .35, 1.3), (553, .25, 1.6), (731, .18, 2)]))
g *= (1 + 0.3 * np.sin(2 * np.pi * 3.1 * t)) * np.minimum(1, t / 0.01)
save(room(g + 0.2 * bp(noise(5), 1500, 6000) * np.exp(-t * 3), 1.8, 0.35), 'gong')

# Whoosh: something big swooping past.
d = 1.4; t = T(d)
sweep = 300 * (12 ** np.sin(np.pi * t / d))
x = noise(d)
out = np.zeros_like(x)
for i in range(0, len(x), 512):
    seg = x[i:i + 1024]
    c = float(sweep[min(i, len(sweep) - 1)])
    out[i:i + len(seg)] += bp(seg, c * 0.7, min(c * 1.4, 20000))[: len(seg)] * np.hanning(len(seg))
save(out * np.sin(np.pi * t / d) ** 2, 'whoosh', 0.75)

# Door knock: three knocks on a heavy wooden door.
def knock(amp=1):
    t = T(0.18)
    body = sum(a * np.sin(2 * np.pi * f * t) for f, a in [(140, 1), (231, .6), (377, .35)]) * env(t, 0.001, 32)
    click = bp(noise(0.18), 1500, 4000) * env(t, 0.0005, 120) * 0.4
    return amp * (body + click)
o = np.zeros(int(SR * 1.4))
for i, at in enumerate([0, 0.22, 0.44]):
    place(o, knock([1, 0.85, 1][i]), at)
save(room(o, 0.7, 0.3), 'door')
