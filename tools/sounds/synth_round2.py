import numpy as np, scipy.io.wavfile as w
from scipy.signal import butter, sosfilt
exec(open('synth_round1.py').read().split('# --- Pair A')[0])
import os; os.makedirs('round2', exist_ok=True); os.chdir('round2')
def T(d): return np.arange(int(SR*d))/SR
def kalimba(f,dur=1.4,amp=1.0):
    t=T(dur); y=np.sin(2*np.pi*f*t)*np.exp(-t*3.2)+0.35*np.sin(2*np.pi*f*5.95*t)*np.exp(-t*14)+0.15*np.sin(2*np.pi*f*2.0*t)*np.exp(-t*7)
    y+=0.25*np.sin(2*np.pi*f*12.1*t)*np.exp(-t*60)  # tine click
    return amp*y*np.minimum(1,t/0.002)
def marimba(f,dur=1.0,amp=1.0):
    t=T(dur); y=np.sin(2*np.pi*f*t)*np.exp(-t*5)+0.3*np.sin(2*np.pi*f*3.93*t)*np.exp(-t*16)+0.08*np.sin(2*np.pi*f*9.8*t)*np.exp(-t*40)
    return amp*y*np.minimum(1,t/0.003)
def glass(f,dur=2.0,amp=1.0):
    t=T(dur); y=sum(a*np.sin(2*np.pi*f*k*t+i)*np.exp(-t*d) for i,(k,a,d) in enumerate([(1,1,2.0),(2.32,0.35,3.5),(4.25,0.18,6),(6.63,0.08,9)]))
    return amp*y*np.minimum(1,t/0.004)
def chirp(f0,f1,dur=0.16,amp=1.0,tail=0.5):
    t=T(dur+tail); f=np.where(t<dur,f0*(f1/f0)**(t/dur),f1)
    ph=2*np.pi*np.cumsum(f)/SR
    env=np.minimum(1,t/0.004)*np.where(t<dur,1,np.exp(-(t-dur)*9))*np.exp(-t*2)
    return amp*(np.sin(ph)+0.25*np.sin(2*ph))*env
def pad(f,dur=2.2,amp=1.0,attack=0.35,glide=1.0):
    t=T(dur); ff=f*(glide**(t/dur)); ph=2*np.pi*np.cumsum(ff)/SR
    y=sum(a*np.sin(k*ph*(1+det)) for k,a in [(1,1),(2,0.3),(3,0.08)] for det in (-0.003,0,0.003))/3
    vib=1+0.15*np.sin(2*np.pi*5*t)
    env=np.minimum(1,t/attack)**1.5*np.exp(-np.maximum(0,t-attack)*2.2)
    return amp*y*env*vib

# ---------- More call connected / ended ----------
# D Firefly: two quick rising light-blinks / falling blinks
o=buf(1.6); place(o,chirp(hz('C5'),hz('G5'),0.09,0.8),0); place(o,chirp(hz('E5'),hz('C6'),0.11,1.0),0.13); place(o,sparkle(0.5,0.08,5274),0.22)
finish(o,'connected-D-firefly')
o=buf(1.6); place(o,chirp(hz('C6'),hz('E5'),0.11,1.0),0); place(o,chirp(hz('G5'),hz('C5'),0.14,0.85),0.15)
finish(o,'ended-D-firefly')
# E Kalimba: plucked tines C5 G5 E6 up / E6 C6 G5 down
o=buf(1.8)
for i,(n,a) in enumerate([('C5',0.8),('G5',0.85),('E6',0.9)]): place(o,kalimba(hz(n),1.4,a),i*0.09)
finish(o,'connected-E-kalimba')
o=buf(1.8)
for i,(n,a) in enumerate([('E6',0.75),('C6',0.8),('G5',0.9)]): place(o,kalimba(hz(n),1.4,a),i*0.12)
finish(o,'ended-E-kalimba')
# F Lantern: warm swell that opens up / swell that sinks a fifth
o=buf(2.4)
for n,a in [('C4',0.6),('G4',0.7),('E5',0.6),('B5',0.3)]: place(o,pad(hz(n),2.2,a,0.25),0)
place(o,sparkle(0.6,0.05,4186),0.25)
finish(o,'connected-F-lantern',peak=0.5)
o=buf(2.4)
for n,a in [('G4',0.7),('E5',0.6),('C5',0.5)]: place(o,pad(hz(n),2.2,a,0.15,glide=2**(-7/12)),0)
finish(o,'ended-F-lantern',peak=0.5)
# G Glass: two high glassy chimes, up a fifth / down a fifth
o=buf(2.2); place(o,glass(hz('E6'),2.0,0.8),0); place(o,glass(hz('B6'),2.0,0.9),0.12)
finish(o,'connected-G-glass',peak=0.45)
o=buf(2.2); place(o,glass(hz('B6'),2.0,0.8),0); place(o,glass(hz('E6'),2.0,0.9),0.16)
finish(o,'ended-G-glass',peak=0.45)
# H Marimba: playful quick C-E-G-E-C? -> rising C5 E5 G5 C6 roll; ended C6 G5 C5 (octave drop)
o=buf(1.6)
for i,n in enumerate(['C5','E5','G5','C6']): place(o,marimba(hz(n),1.0,0.8+0.05*i),i*0.06)
finish(o,'connected-H-marimba')
o=buf(1.6)
for i,n in enumerate(['C6','G5','C5']): place(o,marimba(hz(n),1.0,0.85),i*0.1)
finish(o,'ended-H-marimba')

# ---------- Group: someone joined / someone left (short + quieter) ----------
P=0.4
o=buf(0.9); place(o,chirp(hz('E5'),hz('B5'),0.08,1.0,0.35),0); finish(o,'join-1-blink',P)
o=buf(0.9); place(o,chirp(hz('B5'),hz('E5'),0.09,1.0,0.35),0); finish(o,'left-1-blink',P)
o=buf(1.2); place(o,tone(hz('E5'),1.0,0.7,decay=4),0); place(o,tone(hz('G5'),1.0,1.0,decay=3.5),0.07); finish(o,'join-2-bell',P)
o=buf(1.2); place(o,tone(hz('G5'),1.0,0.7,decay=4),0); place(o,tone(hz('E5'),1.0,1.0,decay=3.5),0.08); finish(o,'left-2-bell',P)
o=buf(1.2); place(o,kalimba(hz('G5'),1.0,0.8),0); place(o,kalimba(hz('C6'),1.0,1.0),0.06); finish(o,'join-3-pluck',P)
o=buf(1.2); place(o,kalimba(hz('C6'),1.0,0.8),0); place(o,kalimba(hz('G5'),1.0,1.0),0.07); finish(o,'left-3-pluck',P)
o=buf(1.0); place(o,sparkle(0.4,0.6,4186),0); place(o,glass(hz('G6'),0.9,0.8),0.0); finish(o,'join-4-twinkle',P*0.85)
o=buf(1.0); place(o,glass(hz('C6'),0.9,0.9),0.0); finish(o,'left-4-twinkle',P*0.85)
