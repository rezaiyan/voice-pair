"""Where the speech models come from, pinned to exact versions and checked by SHA-256.

Kokoro (TTS) files come from a kokoro-onnx GitHub release; Parakeet (STT) from one fixed
Hugging Face revision. `voice-pair setup` downloads and verifies them; at runtime they load
from the local cache only (no network).
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import config

KOKORO_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
KOKORO_FILES = {
    config.KOKORO_MODEL: (
        f"{KOKORO_RELEASE}/kokoro-v1.0.onnx",
        "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    ),
    config.KOKORO_VOICES: (
        f"{KOKORO_RELEASE}/voices-v1.0.bin",
        "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    ),
}

DEFAULT_STT_MODEL = "mlx-community/parakeet-tdt-0.6b-v3"
DEFAULT_STT_REVISION = "ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15"
STT_FILES = ["config.json", "model.safetensors"]
STT_SHA256 = {
    "config.json": "f320f1292511f34ec47f513755fe20fd01dbfc09a925d42730e66059a6e1ef4c",
    "model.safetensors": "05e01c7f396c298cf7d23f61da7b504adeab698f0aaeafd9c82d198625464592",
}


class IntegrityError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def verify(path: Path, expected: str) -> None:
    got = sha256(path)
    if got != expected:
        raise IntegrityError(f"{path.name}: SHA-256 {got} does not match the pinned {expected}")


def stt_revision() -> str:
    if config.STT_REVISION:
        return config.STT_REVISION
    return DEFAULT_STT_REVISION if config.STT_MODEL == DEFAULT_STT_MODEL else "main"


def stt_dir(download: bool = False) -> Path:
    """Local folder holding the STT model files. download=False never touches the network."""
    if not download:
        # Read by huggingface_hub at import time; also covers parakeet's own hub lookups.
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
    from huggingface_hub import snapshot_download
    from huggingface_hub.errors import LocalEntryNotFoundError

    try:
        path = Path(
            snapshot_download(
                config.STT_MODEL,
                revision=stt_revision(),
                allow_patterns=STT_FILES,
                local_files_only=not download,
            )
        )
    except LocalEntryNotFoundError:
        raise RuntimeError(
            f"speech model {config.STT_MODEL}@{stt_revision()[:12]} is not downloaded; run: voice-pair setup"
        ) from None
    if download and config.STT_MODEL == DEFAULT_STT_MODEL and stt_revision() == DEFAULT_STT_REVISION:
        try:
            for name, expected in STT_SHA256.items():
                verify(path / name, expected)
        except IntegrityError:
            # Delete the cached files themselves (the snapshot only holds links to them) and the
            # snapshot, so nothing can load them and the next setup downloads fresh copies.
            import shutil

            for name in STT_FILES:
                (path / name).resolve().unlink(missing_ok=True)
            shutil.rmtree(path, ignore_errors=True)
            raise
    return path
