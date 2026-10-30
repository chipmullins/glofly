# Glofly sound generators

The call, group-call and log-out sounds (added Oct 8) were made with these scripts, from the
same notes (C, E, G, B) and soft bell tone as Chip's original sounds. Run with Python 3 + numpy + scipy:

```
cd tools/sounds
python synth_round1.py   # pairs A–C (writes .wav files here)
python synth_round2.py   # pairs D–H + group join/leave (writes into round2/)
python ring.py .         # 0.2.2 ringing round 1: out-1..6, in-1..6, noanswer-1..5 (loops are one cycle each)
python ring2.py .        # 0.2.2 ringing round 2: out-7..14, in-7..12, noanswer-6..9
python ptt.py .         # 0.2.2 push-to-talk pairs: ptt-<n>-<name>-down/-up
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

**0.2.2 push-to-talk sounds** (Oct 10, Chip kept all eight pairs). `ptt.py` writes `ptt-<n>-<name>-down.wav` (key goes down, you're live) and `-up.wav` (let go); in the app they are `ptt-<name>-down.ogg` / `ptt-<name>-up.ogg` for Firefly (default), Blink, Pluck, Bell, Glass, Radio, Tap and Spark. Picked in Settings → Voice & video (shown when Push to talk is on), plus None. They play only on your own computer.

**Oct 28, 2026 sound family preview** (`family2026.py <out>`): ten themed packs (Lantern Glass, Firefly Marimba,
Starlight Celesta, Night Kalimba, Velvet Vibes, Dewdrop, Aurora Pad, Silver Bells, Pocket Pop, Moonlit Harp), each
covering message, @mention, constellation, friend request, friend online, log in, log off, incoming and outgoing call
(three cycles each), call connected/ended, join and leave. Preview page: the "Glofly Sound Family" artifact. Nothing
from it is in the app yet.

**Oct 28, 2026 signature sounds, round 2** (`signature2026.py <out>`): no packs; about nine one-off sounds per event
(bloops, whistles, synthetic sung syllables, knocks, glass, chiptune, FM, swoops), 118 in all. Preview page: the
"Glofly Signature Sounds" artifact. Nothing from it is in the app yet.

**Oct 28, 2026 sung sounds, round 3** (`sung2026.py <out>`, uses round 2's building blocks): little synthetic voices
singing short words ("hel-lo", "bye-bye", "yoo-hoo", "ring-a-ling"...) in normal, tiny, deep, choir, robot and
whispered voices, about ten per event (122 in all). Preview page: the "Glofly Sung Sounds" artifact. Nothing from it
is in the app yet.

**Oct 28, 2026 sing-along lines, round 4** (`sing2026.py <model-folder> <out>`): clear sung one-liners ("New message!",
"Hello there!", "Ring ring! Pick up!", "See ya!"), ten per event (130 in all). An open-source speech model
(Kokoro-82M, Apache 2.0, via the kokoro-onnx package) speaks each line; pyworld moves each syllable onto a melody.
Model files (not in the repo, ~120 MB): kokoro-v1.0.int8.onnx + voices-v1.0.bin from
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0 (rename to kokoro.int8.onnx / voices.bin).
Preview page: the "Glofly Sing-Along Sounds" artifact. Nothing from it is in the app yet.

Round 4 was not liked (Chip: too much like a real person). **Round 5, sung lines** (`sung2026b.py <out>`): round 3's
synthetic voice singing round 4's witty lines with clearer pronunciation (`sung2026.CLARITY`: longer consonant
transitions, louder consonants, narrower formants, a fourth formant; round 3's defaults unchanged), ten per event
(130 in all). Preview page: the "Glofly Sung Lines" artifact. Nothing from it is in the app yet.

**Oct 29, 2026: new call sounds (Chip's picks from round 2).** `defaults2026.py <repo root>` makes them:
Doo-wop (ringtone, `ring-in-doowop.ogg`, 2.4 s loop), Hum hum (outgoing, `ring-out-hum.ogg`, 2.0 s loop), Whistle up /
Whistle down (call connected / ended), Bubble in / Bubble out (someone joins / leaves). They are the defaults and the
only choices in those rows (desktop, web, phones). The older call sounds stay in the apps but aren't offered; the phone
natives they replaced (glofly_ringtone, glofly_outgoing, glofly_connected, glofly_ended, glofly_joined, glofly_left,
Android glofly_ringtone) are kept in `retired-2026-10-29/`. To bring one back: re-add it to the row's list
(`CALL_ROW_CHOICES` + `CALL_ROW_SOUNDS` in desktop/web, `PHONE_RINGTONES` from `RETIRED_PHONE_RINGTONES`).

**Oct 30, 2026 soft sounds, round 6** (`soft2026.py <out>`): Chip found the sharp sounds overwhelming. Ten soft ones
each for new message, message sent (new), @mention, constellation message, friend request, friend online, log in and
log off (felt piano, soft mallets, kalimba, warm pads, breaths, hums; rounded attacks, low-passed, quieter). Two log ins
sing a soft "Glo-fly", two log offs "Good-bye" (round 3's voice with a triangle source, breathy). Preview page: the
"Glofly Soft Sounds" artifact. Nothing from it is in the app yet.
