# Glofly sound generators

The call, group-call and log-out sounds (added Oct 8) were made with these scripts, from the
same notes (C, E, G, B) and soft bell tone as Chip's original sounds. Run with Python 3 + numpy + scipy:

```
cd tools/sounds
python synth_round1.py   # pairs A–C (writes .wav files here)
python synth_round2.py   # pairs D–H + group join/leave (writes into round2/)
python ring.py .         # 0.2.2 ringing round 1: out-1..6, in-1..6, noanswer-1..5 (loops are one cycle each)
python ring2.py .        # 0.2.2 ringing round 2: out-7..14, in-7..12, noanswer-6..9
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

**0.2.2 ringing sounds** (Oct 10, Chip kept them all as choices). Each outgoing/incoming file is **one seamless loop cycle**: the echo at its end is folded onto its start, and Opus trims the file to that exact length, so the app loops the whole decoded buffer with no gap (Web Audio in `lib/sounds.ts`). Files: `ring-out-<name>.ogg` (from `out-<n>-<name>`) and `ring-in-<name>.ogg` (from `in-<n>-<name>`). Defaults: **Synth arp** (outgoing, `out-8-synth-arp`) and **Firefly dance** (incoming, `in-2-firefly`).

| In the app | File | Made from |
|---|---|---|
| No answer (fixed, not a setting) | no-answer.ogg | ring.py noanswer-4-dim |
| Pluck (any short sound) | pluck.ogg | ring.py noanswer-3-pluck |
| Fade (any short sound, meant for Log out) | fade.ogg | ring.py noanswer-1-fade |
