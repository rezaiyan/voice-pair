"""Local speech-to-text with Parakeet TDT on MLX (Apple Silicon)."""

from __future__ import annotations

import threading
from pathlib import Path

import numpy as np


class Transcriber:
    def __init__(self, model_dir: Path, sample_rate: int) -> None:
        """model_dir: local folder with config.json + model.safetensors (see models.stt_dir)."""
        import mlx.core as mx
        from parakeet_mlx import from_pretrained
        from parakeet_mlx.audio import get_logmel

        self._mx = mx
        self._get_logmel = get_logmel
        self._model = from_pretrained(str(model_dir))
        self._lock = threading.Lock()
        if self._model.preprocessor_config.sample_rate != sample_rate:
            raise ValueError(
                f"model expects {self._model.preprocessor_config.sample_rate} Hz, mic gives {sample_rate} Hz"
            )
        # First call compiles kernels; do it now so the first real utterance is fast.
        self.transcribe(np.zeros(sample_rate // 2, dtype=np.float32))

    def transcribe(self, audio: np.ndarray) -> str:
        """audio: mono float32 in [-1, 1] at the model's sample rate."""
        mx = self._mx
        with self._lock:
            # Same as parakeet's own load_audio: float32 into the mel frontend (bf16 breaks its STFT view).
            x = mx.array(audio.astype(np.float32))
            mel = self._get_logmel(x, self._model.preprocessor_config)
            result = self._model.generate(mel)[0]
        return result.text.strip()


def pcm16_to_float(pcm: bytes) -> np.ndarray:
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
