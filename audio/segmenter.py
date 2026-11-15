"""Utterance segmentation: turns a stream of (frame, is_speech) pairs into complete utterances.

Pure logic, no audio I/O, so it can be unit-tested with synthetic frames.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field


@dataclass
class Segmenter:
    frame_ms: int
    start_frames: int  # voiced frames within the onset window needed to open an utterance
    end_silence_ms: int
    min_utterance_ms: int
    max_utterance_ms: int
    preroll_ms: int
    onset_window: int = 10

    _ring: deque = field(init=False)
    _onset: deque = field(init=False)
    _active: bool = field(init=False, default=False)
    _frames: list = field(init=False, default_factory=list)
    _voiced_ms: int = field(init=False, default=0)
    _silence_ms: int = field(init=False, default=0)

    @classmethod
    def from_config(cls) -> "Segmenter":
        import config

        return cls(
            frame_ms=config.FRAME_MS,
            start_frames=config.START_FRAMES,
            end_silence_ms=config.END_SILENCE_MS,
            min_utterance_ms=config.MIN_UTTERANCE_MS,
            max_utterance_ms=config.MAX_UTTERANCE_S * 1000,
            preroll_ms=config.PREROLL_MS,
        )

    def __post_init__(self) -> None:
        self._ring = deque(maxlen=max(1, self.preroll_ms // self.frame_ms))
        self._onset = deque(maxlen=self.onset_window)

    @property
    def active(self) -> bool:
        return self._active

    def reset(self) -> None:
        self._ring.clear()
        self._onset.clear()
        self._active = False
        self._frames = []
        self._voiced_ms = 0
        self._silence_ms = 0

    def push(self, frame: bytes, is_speech: bool) -> tuple[str | None, bytes | None]:
        """Feed one frame. Returns (event, audio):

        ("start", None) when an utterance opens, ("end", pcm) when one closes with enough
        voiced audio, ("drop", None) when one closes too short, else (None, None).
        """
        if not self._active:
            self._ring.append(frame)
            self._onset.append(is_speech)
            if sum(self._onset) >= self.start_frames:
                self._active = True
                self._frames = list(self._ring)
                self._voiced_ms = sum(self._onset) * self.frame_ms
                self._silence_ms = 0
                self._ring.clear()
                self._onset.clear()
                return "start", None
            return None, None

        self._frames.append(frame)
        if is_speech:
            self._voiced_ms += self.frame_ms
            self._silence_ms = 0
        else:
            self._silence_ms += self.frame_ms

        total_ms = len(self._frames) * self.frame_ms
        if self._silence_ms >= self.end_silence_ms or total_ms >= self.max_utterance_ms:
            voiced = self._voiced_ms
            audio = b"".join(self._frames)
            self.reset()
            if voiced < self.min_utterance_ms:
                return "drop", None
            return "end", audio
        return None, None
