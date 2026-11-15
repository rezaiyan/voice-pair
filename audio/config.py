"""Runtime settings for the audio sidecar, read from VOICE_PAIR_* environment variables."""

from __future__ import annotations

import os
from pathlib import Path

CACHE_DIR = Path(os.environ.get("VOICE_PAIR_CACHE", Path.home() / ".cache" / "voice-pair"))
KOKORO_MODEL = CACHE_DIR / "kokoro-v1.0.onnx"
KOKORO_VOICES = CACHE_DIR / "voices-v1.0.bin"

STT_MODEL = os.environ.get("VOICE_PAIR_STT_MODEL", "mlx-community/parakeet-tdt-0.6b-v3")
STT_REVISION = os.environ.get("VOICE_PAIR_STT_REVISION", "")  # empty = pinned default (models.py)

# "kokoro" (natural, local onnx) or "say" (macOS built-in, zero setup).
TTS_ENGINE = os.environ.get("VOICE_PAIR_TTS", "kokoro")
TTS_VOICE = os.environ.get("VOICE_PAIR_VOICE", "af_heart")
SAY_VOICE = os.environ.get("VOICE_PAIR_SAY_VOICE", "")  # empty = system default
TTS_SPEED = float(os.environ.get("VOICE_PAIR_SPEED", "1.0"))

SAMPLE_RATE = 16_000
FRAME_MS = 30  # webrtcvad accepts 10/20/30 ms frames
VAD_AGGRESSIVENESS = int(os.environ.get("VOICE_PAIR_VAD_LEVEL", "2"))  # 0..3
START_FRAMES = 6  # ~180 ms of voiced frames (in a 10-frame window) opens an utterance
END_SILENCE_MS = int(os.environ.get("VOICE_PAIR_END_SILENCE_MS", "1300"))
MIN_UTTERANCE_MS = 400
MAX_UTTERANCE_S = 60
PREROLL_MS = 300  # audio kept from before speech onset, so first syllable isn't clipped
POST_TTS_MUTE_MS = 350  # keep mic closed briefly after playback to drop speaker echo tail

MIN_WORDS = 2  # transcripts shorter than this are dropped as noise ("uh", "hm")
