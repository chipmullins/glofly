import numpy as np, scipy.io.wavfile as w
exec(open('synth_round1.py').read().split('# --- Pair A')[0])
# 1) Literal reverse of Glofly hello: tail becomes a swell, ends on the opening hit
sr,x=w.read('login.wav'); x=x.astype(float)/32768
r=x[::-1]; thr=0.004*np.abs(r).max()
start=max(0,np.nonzero(np.abs(r)>thr)[0][0]-int(0.05*SR)); r=r[start:]
f=int(0.06*SR); r[:f]*=np.linspace(0,1,f); r[-int(0.02*SR):]*=np.linspace(1,0,int(0.02*SR))
r=r/np.abs(r).max()*np.abs(x).max()   # same loudness as login
w.write('logoff-1-reversed.wav',SR,(r*32767).astype(np.int16)); print(f"logoff-1-reversed: {len(r)/SR:.2f}s")
# 2) Login's notes falling, in the call sounds' tone, slowing as it settles
o=buf(3.2); notes=['G5','E5','C5','G4','E4','C4']; at=0
for i,n in enumerate(notes):
    place(o,tone(hz(n),2.2,[0.6,0.65,0.75,0.8,0.85,1.0][i],decay=2.4 if i<5 else 1.2,attack=0.01),at); at+=0.09+i*0.025
t=np.arange(len(o))/SR
finish(o,'logoff-2-falling',peak=0.32/0.6*0.6)
