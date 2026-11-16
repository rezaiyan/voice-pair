"""voice-pair audio sidecar.

Spawned by the channel server. Talks JSON lines:
  stdin  <- {"cmd": "speak", "text": str, "summarize": bool, "max_chars": int} | {"cmd": "stop"|"mute"|"unmute"|"shutdown"}
  stdout -> {"event": "ready"|"hearing"|"transcribing"|"transcript"|"dropped"|"speaking"|"muted"|"level"|"error", ...}
  ("level" is the mic loudness 0..1, a few times a second; "bands" the equalizer bands 0..1 of the
   mic ("source": "mic", every frame) or of Claude's voice while it plays ("source": "voice"),
   both for the live voice band.)
Diagnostics go to stderr.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time

import config
import models
import speech_text
from level import LevelMeter, Spectrum
from segmenter import Segmenter

FILLERS = {"uh", "um", "hm", "hmm", "mm", "mhm", "ah", "er", "oh", "huh"}
CUE_SOUND = "/System/Library/Sounds/Tink.aiff"

_out_lock = threading.Lock()


def emit(event: str, **fields) -> None:
    line = json.dumps({"event": event, **fields})
    with _out_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def log(msg: str) -> None:
    sys.stderr.write(f"[voice-pair audio] {msg}\n")
    sys.stderr.flush()


def is_noise(text: str) -> bool:
    words = [w.strip(".,!?").lower() for w in text.split()]
    words = [w for w in words if w]
    return not words or all(w in FILLERS for w in words)


class Sidecar:
    def __init__(self) -> None:
        import sounddevice as sd
        import webrtcvad

        from stt import Transcriber
        from tts import Speaker

        self._sd = sd
        self.muted = os.environ.get("VOICE_PAIR_START_MUTED") == "1"
        self.barge_in = os.environ.get("VOICE_PAIR_BARGE_IN") == "1"
        self.cues = os.environ.get("VOICE_PAIR_CUES", "1") == "1"
        self._frames: queue.Queue[bytes] = queue.Queue(maxsize=2000)
        self._utterances: queue.Queue[tuple[bytes, float] | None] = queue.Queue()
        self._running = threading.Event()
        self._running.set()

        t0 = time.monotonic()
        self.vad = webrtcvad.Vad(config.VAD_AGGRESSIVENESS)
        self.seg = Segmenter.from_config()
        self.meter = LevelMeter()
        self.mic_bands = Spectrum(config.SAMPLE_RATE, agc=True)
        self._mic_quiet = True  # the mic's bands were last sent as all zero
        self.stt = Transcriber(models.stt_dir(), config.SAMPLE_RATE)
        self.speaker = Speaker(config.TTS_ENGINE, on_state=self._on_speaking, log=log)
        log(f"models loaded in {time.monotonic() - t0:.1f}s (tts={self.speaker.engine})")

    # -- speaking state -------------------------------------------------------------------------
    def _on_speaking(self, value: bool) -> None:
        # No seg.reset() here: only the VAD thread touches the segmenter (_handle_frame resets it
        # while muted or speaking).
        emit("speaking", value=value)

    def _cue(self) -> None:
        if self.cues and os.path.exists(CUE_SOUND):
            subprocess.Popen(["afplay", CUE_SOUND], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # -- mic -> VAD -> segmenter ----------------------------------------------------------------
    def _mic_callback(self, indata, frames, time_info, status) -> None:
        if status:
            log(f"mic status: {status}")
        try:
            self._frames.put_nowait(bytes(indata))
        except queue.Full:
            pass

    def _vad_loop(self) -> None:
        frame_bytes = config.SAMPLE_RATE * config.FRAME_MS // 1000 * 2
        buf = b""
        while self._running.is_set():
            try:
                buf += self._frames.get(timeout=0.2)
            except queue.Empty:
                continue
            while len(buf) >= frame_bytes:
                frame, buf = buf[:frame_bytes], buf[frame_bytes:]
                self._handle_frame(frame)

    def _handle_frame(self, frame: bytes) -> None:
        if self.muted or (self.speaker.speaking and not self.barge_in):
            if self.seg.active:
                self.seg.reset()
            if (quiet := self.meter.silence()) is not None:
                emit("level", value=quiet)
            if not self._mic_quiet:
                self._mic_quiet = True
                emit("bands", source="mic", values=[0.0] * self.mic_bands.count)
            return
        if (level := self.meter.push(frame)) is not None:
            emit("level", value=level)
        bands = self.mic_bands.frame(frame)
        if any(bands) or not self._mic_quiet:
            emit("bands", source="mic", values=bands)
        self._mic_quiet = not any(bands)
        event, audio = self.seg.push(frame, self.vad.is_speech(frame, config.SAMPLE_RATE))
        if event == "start":
            if self.speaker.speaking and self.barge_in:
                self.speaker.stop()
            emit("hearing")
        elif event == "drop":
            emit("dropped", reason="too short")
        elif event == "end":
            emit("transcribing")
            self._utterances.put((audio, time.monotonic()))

    # -- utterance -> text ----------------------------------------------------------------------
    def _stt_loop(self) -> None:
        from stt import pcm16_to_float

        while True:
            item = self._utterances.get()
            if item is None:
                return
            pcm, ended_at = item
            try:
                text = self.stt.transcribe(pcm16_to_float(pcm))
            except Exception as e:
                emit("error", message=f"stt failed: {e}")
                continue
            ms = int((time.monotonic() - ended_at) * 1000)
            if is_noise(text):
                emit("dropped", reason="noise", text=text)
                continue
            self._cue()
            emit("transcript", text=text, stt_ms=ms, audio_ms=len(pcm) // 32)

    # -- Claude's voice -> equalizer bands --------------------------------------------------------
    def _voice_bands_loop(self) -> None:
        """While Kokoro plays, send the bands of the audio at the playback position, every 30 ms."""
        spectra: dict[int, Spectrum] = {}
        was_playing = False
        while self._running.is_set():
            time.sleep(config.FRAME_MS / 1000)
            playing = self.speaker.now_playing
            if playing is None:
                if was_playing:
                    was_playing = False
                    emit("bands", source="voice", values=[0.0] * self.mic_bands.count)
                continue
            samples, sr, started = playing
            spec = spectra.setdefault(sr, Spectrum(sr))
            pos = int((time.monotonic() - started) * sr)
            if 0 < pos <= len(samples):
                was_playing = True
                emit("bands", source="voice", values=spec.bands(samples[max(0, pos - spec.n) : pos]))

    # -- commands from the channel server -------------------------------------------------------
    def handle(self, msg: dict) -> bool:
        cmd = msg.get("cmd")
        if cmd == "speak":
            text = str(msg.get("text", ""))
            if msg.get("summarize"):
                text = speech_text.summary(text, max_chars=int(msg.get("max_chars") or 280))
            if text.strip():
                self.speaker.say(text)
        elif cmd == "stop":
            self.speaker.stop()
        elif cmd in ("mute", "unmute"):
            self.muted = cmd == "mute"
            emit("muted", value=self.muted)
        elif cmd == "shutdown":
            return False
        else:
            emit("error", message=f"unknown cmd: {cmd}")
        return True

    def run(self) -> None:
        threading.Thread(target=self._vad_loop, name="vad", daemon=True).start()
        threading.Thread(target=self._stt_loop, name="stt", daemon=True).start()
        threading.Thread(target=self._voice_bands_loop, name="voice-bands", daemon=True).start()
        blocksize = config.SAMPLE_RATE * config.FRAME_MS // 1000
        with self._sd.RawInputStream(
            samplerate=config.SAMPLE_RATE, channels=1, dtype="int16", blocksize=blocksize, callback=self._mic_callback
        ):
            emit("ready", tts=self.speaker.engine, muted=self.muted, barge_in=self.barge_in)
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    emit("error", message="bad json on stdin")
                    continue
                if not self.handle(msg):
                    break
        self._running.clear()
        self._utterances.put(None)
        self.speaker.close()


def main() -> int:
    try:
        Sidecar().run()
    except Exception as e:
        emit("error", message=f"fatal: {e}", fatal=True)
        log(f"fatal: {e!r}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
