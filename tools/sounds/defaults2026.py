"""Oct 29, 2026: Chip's picks from round 2 ("Glofly Signature Sounds") become the call sounds.

  Incoming call   Doo-Wop       ring-in-doowop.ogg     (one seamless 2.4 s loop cycle)
  Outgoing call   Hum Hum       ring-out-hum.ogg       (one seamless 2.0 s loop cycle)
  Call connected  Whistle Up    whistle-up.ogg
  Call ended      Whistle Down  whistle-down.ogg
  Someone joins   Bubble        bubble-in.ogg
  Someone leaves  Bubble        bubble-out.ogg

Run from tools/sounds:  python defaults2026.py <repo root>
Writes the desktop files (apps/desktop/src/renderer/src/assets/sounds), the phone app's in-app
copies (apps/mobile/assets/sounds) and the phones' native copies that replace the fixed call
sounds (iPhone .caf, Android res/raw for the ringtone). Needs numpy, scipy, ffmpeg.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import signature2026 as sig  # noqa: E402

SR = sig.SR


def pick(event, sid):
    return next(s for s in sig.S[event] if s['id'] == sid)


def write_wav(path, st):
    pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())


def one_cycle(event, sid, cycle):
    """The middle of three rendered cycles: it holds the previous cycle's echo at its start, so it
    repeats with no seam."""
    s = pick(event, sid)
    st = sig.finish(s['fn'](), s['wet'], s['rt'], s['gain'])
    a, b = int(cycle * SR), int(2 * cycle * SR)
    return st[a:b]


def short(event, sid):
    s = pick(event, sid)
    return sig.finish(s['fn'](), s['wet'], s['rt'], s['gain'])


def opus(wav, out):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'libopus', '-b:a', '128k', out], check=True)


def caf(wav, out, repeat_to=None):
    """iPhone copy: IMA4 .caf, 22.05 kHz mono (like the others); ringing sounds repeated to ~24 s."""
    args = ['ffmpeg', '-loglevel', 'error', '-y']
    if repeat_to:
        args += ['-stream_loop', str(repeat_to - 1)]
    args += ['-i', wav, '-ac', '1', '-ar', '22050', '-c:a', 'adpcm_ima_qt', '-t', '29', out]
    subprocess.run(args, check=True)


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '../..'
    desktop = f'{root}/apps/desktop/src/renderer/src/assets/sounds'
    phone = f'{root}/apps/mobile/assets/sounds'
    ios = f'{root}/apps/mobile/modules/glofly-native/ios/sounds'
    raw = f'{root}/apps/mobile/modules/glofly-native/android/src/main/res/raw'
    tmp = tempfile.mkdtemp()

    sounds = [
        # (file, audio, loop cycle seconds or None, iPhone native name, Android raw name)
        ('ring-in-doowop', one_cycle('ring', 'doowop', 2.4), 2.4, 'glofly_ringtone', 'glofly_ringtone'),
        ('ring-out-hum', one_cycle('outgoing', 'hum', 2.0), 2.0, 'glofly_outgoing', None),
        ('whistle-up', short('connected', 'whistleup'), None, 'glofly_connected', None),
        ('whistle-down', short('ended', 'whistledown'), None, 'glofly_ended', None),
        ('bubble-in', short('join', 'bubble'), None, 'glofly_joined', None),
        ('bubble-out', short('leave', 'bubble'), None, 'glofly_left', None),
    ]
    for name, st, cycle, ios_name, raw_name in sounds:
        wav = f'{tmp}/{name}.wav'
        write_wav(wav, st)
        opus(wav, f'{desktop}/{name}.ogg')
        shutil.copyfile(f'{desktop}/{name}.ogg', f'{phone}/{name}.ogg')
        reps = max(1, int(24 // cycle)) if cycle else None
        caf(wav, f'{ios}/{ios_name}.caf', reps)
        if raw_name:
            # Android's lock-screen ringing (notification channel sound): repeated to ~24 s too.
            long_wav = f'{tmp}/{name}-long.wav'
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-stream_loop', str(reps - 1), '-i', wav, '-t', '29', long_wav], check=True)
            opus(long_wav, f'{raw}/{raw_name}.ogg')
        print(name, f'{len(st) / SR:.2f}s', ios_name, raw_name or '')


if __name__ == '__main__':
    main()
