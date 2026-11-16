"""Microphone loudness for the live voice band: one number per frame, 0 (silence) to 1 (loud)."""

from __future__ import annotations

import math

import numpy as np

FLOOR_DB = -60.0  # quieter than this reads as 0
RANGE_DB = 50.0  # FLOOR_DB + RANGE_DB (-10 dBFS) reads as 1


def frame_level(frame: bytes) -> float:
    """RMS loudness of an int16 frame on a log scale, rounded to 0.001."""
    if len(frame) < 2:
        return 0.0
    a = np.frombuffer(frame[: len(frame) // 2 * 2], dtype=np.int16).astype(np.float32)
    rms = float(np.sqrt(np.mean(a * a))) / 32768.0
    if rms <= 1e-6:
        return 0.0
    db = 20.0 * math.log10(rms)
    return round(min(1.0, max(0.0, (db - FLOOR_DB) / RANGE_DB)), 3)


class LevelMeter:
    """Decides which frame levels are worth reporting, so the mic doesn't flood stdout.

    Reports at most every `every` frames, skips a level within `min_change` of the last report,
    and still reports at least every `heartbeat` frames.
    """

    def __init__(self, every: int = 2, heartbeat: int = 33, min_change: float = 0.02) -> None:
        self.every = every
        self.heartbeat = heartbeat
        self.min_change = min_change
        self._n = 0
        self._since = heartbeat  # report the first level right away
        self._last: float | None = None

    def push(self, frame: bytes) -> float | None:
        self._n += 1
        self._since += 1
        if self._n % self.every:
            return None
        value = frame_level(frame)
        changed = self._last is None or abs(value - self._last) >= self.min_change
        if not changed and self._since < self.heartbeat:
            return None
        self._last = value
        self._since = 0
        return value

    def silence(self) -> float | None:
        """0.0 the first time the mic stops being heard (muted, Claude speaking), then None."""
        if self._last == 0.0:
            return None
        self._last = 0.0
        self._since = 0
        return 0.0


class Spectrum:
    """Equalizer bands of an audio window: log-spaced from ~90 Hz up, each 0 (quiet) to 1 (loud).

    `bands(samples)` reads float samples (-1..1); `frame(pcm16)` feeds int16 mic frames into a
    rolling window of the last `n` samples, so a 30 ms frame still gets a 64 ms view.
    """

    FLOOR_DB = -2.0  # band magnitude (dB re one unit of a Hann-windowed FFT) that reads as 0
    RANGE_DB = 42.0  # FLOOR_DB + RANGE_DB reads as 1
    TILT_DB = 12.0  # lift for the top band: speech has less energy up there than down low

    AGC_MIN_TOP_DB = 22.0  # auto gain lifts a quiet mic by at most TOP - this (18 dB)
    AGC_FALL_DB = 0.12  # how fast the auto gain recovers after a loud moment, per window (~4 dB/s)

    def __init__(
        self,
        sample_rate: int,
        bands: int = 24,
        n: int = 1024,
        fmin: float = 90.0,
        fmax: float = 7600.0,
        agc: bool = False,
    ) -> None:
        self.n = n
        self.agc = agc
        self._top = self.FLOOR_DB + self.RANGE_DB  # the dB that reads as 1; moves only with agc
        self.count = bands
        top = min(fmax, sample_rate / 2 * 0.95)
        self.edges = np.geomspace(fmin, top, bands + 1)
        freqs = np.fft.rfftfreq(n, 1 / sample_rate)
        self._bins: list[np.ndarray] = []
        for lo, hi in zip(self.edges[:-1], self.edges[1:]):
            idx = np.nonzero((freqs >= lo) & (freqs < hi))[0]
            if idx.size == 0:  # a band narrower than one bin: take the bin nearest its middle
                idx = np.array([int(np.argmin(np.abs(freqs - math.sqrt(lo * hi))))])
            self._bins.append(idx)
        self._window = np.hanning(n).astype(np.float32)
        self._tilt = np.linspace(0.0, self.TILT_DB, bands)
        self._ring = np.zeros(n, dtype=np.float32)

    def bands(self, samples: np.ndarray) -> list[float]:
        x = np.zeros(self.n, dtype=np.float32)
        tail = np.asarray(samples, dtype=np.float32)[-self.n :]
        x[self.n - tail.size :] = tail
        mag = np.abs(np.fft.rfft(x * self._window))
        peaks = np.array([mag[idx].max() for idx in self._bins], dtype=np.float64)
        db = np.where(peaks > 1e-6, 20.0 * np.log10(np.maximum(peaks, 1e-6)) + self._tilt, -np.inf)
        if self.agc:
            # Follow the loudest band down slowly, so a quiet mic still fills the bars; never lift
            # more than the cap, so a silent room stays flat.
            fixed_top = self.FLOOR_DB + self.RANGE_DB
            self._top = max(float(db.max()), self._top - self.AGC_FALL_DB, self.AGC_MIN_TOP_DB)
            self._top = min(self._top, max(fixed_top, float(db.max())))
        floor = self._top - self.RANGE_DB
        vals = np.clip((db - floor) / self.RANGE_DB, 0.0, 1.0)
        return [round(float(v), 2) for v in vals]

    def frame(self, pcm16: bytes) -> list[float]:
        new = np.frombuffer(pcm16[: len(pcm16) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768.0
        new = new[-self.n :]
        self._ring = np.concatenate([self._ring[new.size :], new])
        return self.bands(self._ring)
