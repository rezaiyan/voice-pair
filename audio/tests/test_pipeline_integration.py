"""Integration: real speech (macOS `say`) -> webrtcvad -> Segmenter -> Parakeet.

Exercises everything the sidecar does except the live microphone. Slow (~model load), macOS only.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import config
import models
from segmenter import Segmenter
from sidecar import is_noise

pytestmark = pytest.mark.skipif(sys.platform != "darwin", reason="needs macOS say")


def spoken(text: str) -> np.ndarray:
    """Render text with `say` to 16 kHz mono int16."""
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / "s.wav"
        subprocess.run(
            ["say", "-o", str(wav), "--file-format=WAVE", "--data-format=LEI16@16000", text], check=True
        )
        data, sr = sf.read(wav, dtype="int16")
    assert sr == 16000
    return data if data.ndim == 1 else data[:, 0]


@pytest.fixture(scope="module")
def transcriber():
    from stt import Transcriber

    return Transcriber(models.stt_dir(), config.SAMPLE_RATE)


def segment(pcm: np.ndarray) -> list[bytes]:
    import webrtcvad

    vad = webrtcvad.Vad(config.VAD_AGGRESSIVENESS)
    seg = Segmenter.from_config()
    silence = np.zeros(16000 * 2, dtype=np.int16)
    stream = np.concatenate([silence, pcm, silence]).tobytes()
    step = config.SAMPLE_RATE * config.FRAME_MS // 1000 * 2
    out = []
    for i in range(0, len(stream) - step + 1, step):
        frame = stream[i : i + step]
        ev, audio = seg.push(frame, vad.is_speech(frame, config.SAMPLE_RATE))
        if ev == "end":
            out.append(audio)
    return out


def words(s: str) -> set[str]:
    return {w.strip(".,!?").lower() for w in s.split()}


def test_pipeline_should_transcribe_spoken_request(transcriber):
    from stt import pcm16_to_float

    utterances = segment(spoken("Please run the unit tests and fix the failing one."))
    assert len(utterances) == 1
    text = transcriber.transcribe(pcm16_to_float(utterances[0]))
    assert {"run", "tests", "fix", "failing"} <= words(text), text


def test_pipeline_should_split_two_requests_separated_by_a_pause(transcriber):
    gap = np.zeros(int(16000 * 1.5), dtype=np.int16)
    pcm = np.concatenate([spoken("Open the auth middleware."), gap, spoken("Then add logging.")])
    utterances = segment(pcm)
    assert len(utterances) == 2


def test_pipeline_should_produce_nothing_for_silence():
    assert segment(np.zeros(16000 * 3, dtype=np.int16)) == []


def test_is_noise_should_flag_fillers_but_keep_short_answers():
    assert is_noise("Uh.")
    assert is_noise("hmm, um")
    assert is_noise("")
    assert not is_noise("Yes.")
    assert not is_noise("no, use the other one")
