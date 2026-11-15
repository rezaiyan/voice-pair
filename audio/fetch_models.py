"""Download and verify the local speech models voice-pair needs (run by `voice-pair setup`).

- Kokoro TTS (onnx + voices) from the kokoro-onnx GitHub release -> ~/.cache/voice-pair/
- Parakeet STT at a pinned Hugging Face revision -> the Hugging Face cache

Every file is checked against the SHA-256 pinned in models.py; a mismatch is deleted and setup fails.

Usage: uv run python fetch_models.py
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

import config
import models


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"downloading {url}\n  -> {dest}", flush=True)
    with urllib.request.urlopen(url, timeout=60) as resp, open(tmp, "wb") as out:
        total = int(resp.headers.get("Content-Length", 0))
        done = 0
        while chunk := resp.read(1 << 20):
            out.write(chunk)
            done += len(chunk)
            if total:
                print(f"\r  {done * 100 // total:3d}% of {total >> 20} MB", end="", flush=True)
    print()
    tmp.rename(dest)


def main() -> int:
    try:
        for dest, (url, expected) in models.KOKORO_FILES.items():
            if not (dest.exists() and dest.stat().st_size > 0):
                _download(url, dest)
            try:
                models.verify(dest, expected)
            except models.IntegrityError:
                dest.unlink(missing_ok=True)
                raise
            print(f"ok   {dest.name} (sha256 verified)")

        print(f"fetching STT model {config.STT_MODEL}@{models.stt_revision()[:12]} ...", flush=True)
        path = models.stt_dir(download=True)
        print(f"ok   {config.STT_MODEL} -> {path}")
    except models.IntegrityError as e:
        print(f"\nvoice-pair: model check FAILED: {e}\nThe file was not used. Re-run setup; if it fails again, "
              "the download source changed — please open an issue.", file=sys.stderr)
        return 1
    print("all models ready")
    return 0


if __name__ == "__main__":
    sys.exit(main())
