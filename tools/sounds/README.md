# Glofly sound generators

The call, group-call and log-out sounds (added Oct 8) were made with these scripts, from the
same notes (C, E, G, B) and soft bell tone as Chip's original sounds. Run with Python 3 + numpy + scipy:

```
cd tools/sounds
python synth_round1.py   # pairs A–C (writes .wav files here)
python synth_round2.py   # pairs D–H + group join/leave (writes into round2/)
python logoff.py         # log-off options (needs login.wav: ffmpeg -i ../../apps/desktop/src/renderer/src/assets/sounds/login.ogg -ac 1 -ar 48000 login.wav)
```

Convert a pick for the app: `ffmpeg -i in.wav -c:a libopus -b:a 128k out.ogg` → `apps/desktop/src/renderer/src/assets/sounds/`.

| In the app | File | Made from |
|---|---|---|
| Glow on | glow-on.ogg | round2 connected-D-firefly |
| Glow off | glow-off.ogg | round2 ended-D-firefly |
| Blink in | blink-in.ogg | round2 join-1-blink |
| Blink out | blink-out.ogg | round2 left-1-blink |
| Glofly goodnight | goodnight.ogg | Chip's own logoff-3-short.wav (Oct 8; replaced logoff-2-falling) |
| Spark trail | spark-trail.ogg | round1 ended-A-spark |
| Dewdrop | dewdrop.ogg | round2 connected-G-glass |
| Starfall | starfall.ogg | round2 ended-G-glass |
| Pebble | pebble.ogg | round2 join-3-pluck |
