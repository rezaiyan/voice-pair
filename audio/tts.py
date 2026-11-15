"""Text-to-speech playback with a queue, interruption, and a "speaking" flag the mic loop reads."""

from __future__ import annotations

import os
import queue
import subprocess
import threading
import time
from typing import Callable

import config
import speech_text


class Speaker:
    """Speaks queued text one item at a time on a background thread.

    on_state(speaking: bool) is called when playback starts and when the queue drains.
    """

    def __init__(self, engine: str, on_state: Callable[[bool], None], log: Callable[[str], None]) -> None:
        self._q: queue.Queue[str | None] = queue.Queue()
        self._on_state = on_state
        self._log = log
        self._stop = threading.Event()
        self._say_proc: subprocess.Popen | None = None
        self._speaking = False
        self._kokoro = None
        self.engine = engine
        if engine == "kokoro":
            try:
                self._load_kokoro()
            except Exception as e:  # fall back to `say` rather than going mute
                log(f"kokoro unavailable ({e}); falling back to macOS say")
                self.engine = "say"
        self._thread = threading.Thread(target=self._run, name="tts", daemon=True)
        self._thread.start()

    @property
    def speaking(self) -> bool:
        return self._speaking

    def _load_kokoro(self) -> None:
        import numpy as np
        import sounddevice as sd
        from kokoro_onnx import Kokoro

        self._np, self._sd = np, sd
        self._kokoro = Kokoro(str(config.KOKORO_MODEL), str(config.KOKORO_VOICES))
        self._kokoro.create("ready", voice=config.TTS_VOICE, speed=config.TTS_SPEED)  # warm up

    def say(self, text: str) -> None:
        text = speech_text.clean(text)
        if text:
            self._q.put(text)

    def stop(self) -> None:
        """Interrupt current playback and drop anything queued."""
        try:
            while True:
                self._q.get_nowait()
        except queue.Empty:
            pass
        self._stop.set()
        if self._say_proc and self._say_proc.poll() is None:
            self._say_proc.terminate()
        if self._kokoro is not None:
            self._sd.stop()

    def close(self) -> None:
        self.stop()
        self._q.put(None)

    def _set_speaking(self, value: bool) -> None:
        if value != self._speaking:
            self._speaking = value
            self._on_state(value)

    def _run(self) -> None:
        while True:
            text = self._q.get()
            if text is None:
                return
            self._stop.clear()
            self._set_speaking(True)
            try:
                if self.engine == "kokoro":
                    self._speak_kokoro(text)
                else:
                    self._speak_say(text)
            except Exception as e:
                detail = str(e) if os.environ.get("VOICE_PAIR_LOG_TRANSCRIPTS") == "1" else ""
                self._log(f"tts error: {type(e).__name__} {detail}".rstrip())
            if self._q.empty():
                time.sleep(config.POST_TTS_MUTE_MS / 1000)
                if self._q.empty():
                    self._set_speaking(False)

    def _speak_say(self, text: str) -> None:
        cmd = ["say", "-r", str(int(190 * config.TTS_SPEED))]
        if config.SAY_VOICE:
            cmd += ["-v", config.SAY_VOICE]
        # Text goes in on stdin so a leading "-" can never be read as a flag.
        self._say_proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, text=True)
        self._say_proc.communicate(text)

    def _synth(self, sentence: str):
        return self._kokoro.create(sentence, voice=config.TTS_VOICE, speed=config.TTS_SPEED)

    def _speak_kokoro(self, text: str) -> None:
        # Pipeline: synthesize sentence N+1 while sentence N plays, so there are no gaps
        # and playback starts after the first sentence instead of the whole reply.
        parts = speech_text.sentences(text)
        if not parts:
            return
        pending = self._synth(parts[0])
        for i in range(len(parts)):
            if self._stop.is_set():
                return
            samples, sr = pending
            self._sd.play(samples, sr)
            pending = self._synth(parts[i + 1]) if i + 1 < len(parts) else None
            self._sd.wait()
