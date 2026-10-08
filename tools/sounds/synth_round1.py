import numpy as np, scipy.io.wavfile as w
from scipy.signal import fftconvolve, butter, sosfilt
SR=48000; rng=np.random.default_rng(7)
def hz(n):  # note name -> Hz
    names={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
    o=int(n[-1]); return 440*2**((names[n[0]]+12*(o+1)-69)/12)
def tone(f, dur, amp=1.0, decay=2.2, attack=0.006, glide=0.0):
    t=np.arange(int(SR*dur))/SR
    # warm bell / electric-piano: harmonics with faster decay up high, slight detune shimmer
    parts=[(1,1.0,1.0),(2,0.42,1.6),(3,0.12,2.4),(4,0.05,3.2),(5.4,0.025,5.0)]  # 5.4 = soft bell partial
    freq=f*(1+glide*t/dur)
    ph=2*np.pi*np.cumsum(freq)/SR
    y=np.zeros_like(t)
    for k,a,dk in parts:
        for det in (-0.0012,0.0012):
            y+=a*0.5*np.sin(k*ph*(1+det))*np.exp(-t*decay*dk)
    env=np.minimum(1,t/attack)
    return amp*y*env
def sparkle(dur, amp=0.12, f=4186):
    t=np.arange(int(SR*dur))/SR
    y=sum(np.sin(2*np.pi*f*m*t+rng.random()*6)*np.exp(-t*(14+6*i)) for i,m in enumerate((1,1.5,2)))
    return amp*y*np.minimum(1,t/0.002)
def place(out, sig, at):
    i=int(at*SR); out[i:i+len(sig)]+=sig[:max(0,len(out)-i)]
def reverb(x, wet=0.22, length=1.1):
    n=int(SR*length); t=np.arange(n)/SR
    ir=rng.standard_normal(n)*np.exp(-t*4.5)
    ir=sosfilt(butter(2,5000,'low',fs=SR,output='sos'),ir); ir/=np.abs(ir).sum()**0.5*30
    y=np.concatenate([x,np.zeros(n)])
    return y+wet*fftconvolve(y,ir)[:len(y)]
def finish(x, name, peak=0.6):
    x=reverb(x)
    # trim silence at end, short fade
    thr=1e-4*np.abs(x).max(); end=np.nonzero(np.abs(x)>thr)[0][-1]+int(0.05*SR); x=x[:end]
    f=int(0.04*SR); x[-f:]*=np.linspace(1,0,f)
    x=sosfilt(butter(1,90,'high',fs=SR,output='sos'),x)
    x=x/np.abs(x).max()*peak
    w.write(name+'.wav',SR,(x*32767).astype(np.int16))
    print(f"{name}: {len(x)/SR:.2f}s rms {np.sqrt((x**2).mean()):.3f}")

def buf(s): return np.zeros(int(SR*s))

# --- Pair A: "Spark" — quick arpeggio up / down (like the outgoing jingle, sped up) ---
o=buf(2.2)
for i,n in enumerate(['C5','E5','G5','C6']): place(o,tone(hz(n),1.6,0.8 if i<3 else 1.0,decay=2.6 if i<3 else 1.6),i*0.075)
place(o,sparkle(0.6,0.10,4186),0.225)
finish(o,'connected-A-spark')
o=buf(2.2)
for i,n in enumerate(['G5','E5','C5']): place(o,tone(hz(n),1.6,1.0 if i<2 else 0.9,decay=3.0 if i<2 else 2.0),i*0.11)
finish(o,'ended-A-spark')

# --- Pair B: "Glow" — two soft notes, up a fourth / down a fourth ---
o=buf(2.4)
place(o,tone(hz('G5'),1.2,0.85,decay=3.2,attack=0.012),0)
place(o,tone(hz('C6'),2.0,1.0,decay=1.5,attack=0.012),0.14)
place(o,tone(hz('E6'),2.0,0.22,decay=2.0,attack=0.03),0.16)   # quiet sixth-up glow on top
place(o,sparkle(0.5,0.06,5274),0.15)
finish(o,'connected-B-glow')
o=buf(2.4)
place(o,tone(hz('C6'),1.0,0.8,decay=3.6,attack=0.012),0)
place(o,tone(hz('G5'),2.0,1.0,decay=1.9,attack=0.012),0.18)
finish(o,'ended-B-glow')

# --- Pair C: "Bloom" — Cmaj7 strummed open / closing and dimming ---
o=buf(2.8)
for i,n in enumerate(['C5','E5','G5','B5','E6']): place(o,tone(hz(n),2.4,[0.8,0.7,0.7,0.55,0.4][i],decay=1.3,attack=0.02),i*0.035)
place(o,sparkle(0.7,0.08,4186),0.17)
finish(o,'connected-C-bloom')
o=buf(2.4)
for i,n in enumerate(['B5','G5','E5','C5']): place(o,tone(hz(n),1.8,[0.45,0.6,0.7,0.85][i],decay=2.3,attack=0.015,glide=-0.012),i*0.06)
x=o; t=np.arange(len(x))/SR
finish(x*np.exp(-t*0.6),'ended-C-bloom')
