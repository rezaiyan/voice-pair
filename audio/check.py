"""Interactive hardware check: mic level, one live transcription, one spoken reply.

Run from your own terminal (it needs that terminal's microphone permission):  voice-pair check
"""

from __future__ import annotations

import sys
import threading
import time

import numpy as np

import config
import models
from segmenter import Segmenter


def main() -> int:
    import sounddevice as sd
    import webrtcvad

    from stt import Transcriber, pcm16_to_float
    from tts import Speaker

    print(f"input device: {sd.query_devices(kind='input')['name']}")
    print("opening microphone (macOS may ask for permission now)...", flush=True)
    opened = threading.Event()

    def watchdog():
        if not opened.wait(10):
            print(
                "\nmicrophone did not open within 10s. Grant this terminal app access in\n"
                "System Settings > Privacy & Security > Microphone, then run again.",
                flush=True,
            )

    threading.Thread(target=watchdog, daemon=True).start()
    ambient = sd.rec(int(config.SAMPLE_RATE * 1.5), samplerate=config.SAMPLE_RATE, channels=1, dtype="int16")
    sd.wait()
    opened.set()
    print(f"mic ok, ambient peak level {int(np.abs(ambient).max())} / 32767")

    print("loading speech models...", flush=True)
    t0 = time.monotonic()
    stt = Transcriber(models.stt_dir(), config.SAMPLE_RATE)
    done = threading.Event()
    speaker = Speaker(config.TTS_ENGINE, on_state=lambda s: (not s) and done.set(), log=print)
    print(f"models ready in {time.monotonic() - t0:.1f}s (tts={speaker.engine})")

    vad = webrtcvad.Vad(config.VAD_AGGRESSIVENESS)
    seg = Segmenter.from_config()
    block = config.SAMPLE_RATE * config.FRAME_MS // 1000
    print("\nSay a sentence now (you have 15 seconds)...", flush=True)
    audio = None
    with sd.RawInputStream(samplerate=config.SAMPLE_RATE, channels=1, dtype="int16", blocksize=block) as stream:
        end = time.monotonic() + 15
        while time.monotonic() < end:
            frame, _ = stream.read(block)
            ev, pcm = seg.push(bytes(frame), vad.is_speech(bytes(frame), config.SAMPLE_RATE))
            if ev == "start":
                print("  hearing you...", flush=True)
            elif ev == "end":
                audio = pcm
                break
    if audio is None:
        print("no speech detected. Try speaking louder or set VOICE_PAIR_VAD_LEVEL=1.")
        return 1
    t1 = time.monotonic()
    text = stt.transcribe(pcm16_to_float(audio))
    print(f'  heard ({(time.monotonic() - t1) * 1000:.0f} ms): "{text}"')
    speaker.say(f"I heard: {text}")
    done.wait(30)
    speaker.close()
    print("\ncheck passed: mic, speech-to-text and voice output all work.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
