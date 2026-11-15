from pathlib import Path

import pytest

import models


def test_verify_accepts_matching_sha256(tmp_path: Path):
    f = tmp_path / "m.bin"
    f.write_bytes(b"voice")
    models.verify(f, models.sha256(f))


def test_verify_rejects_tampered_file(tmp_path: Path):
    f = tmp_path / "m.bin"
    f.write_bytes(b"voice")
    good = models.sha256(f)
    f.write_bytes(b"voicE")
    with pytest.raises(models.IntegrityError, match="does not match"):
        models.verify(f, good)


def test_default_stt_model_is_pinned_to_a_commit():
    assert models.stt_revision() == models.DEFAULT_STT_REVISION
    assert len(models.DEFAULT_STT_REVISION) == 40


def test_every_pinned_download_has_a_sha256():
    for _url, digest in models.KOKORO_FILES.values():
        assert len(digest) == 64
    assert set(models.STT_SHA256) == set(models.STT_FILES)


def test_installed_models_match_pins():
    """Only meaningful after `voice-pair setup`; skipped on a fresh machine (e.g. CI)."""
    present = [p for p in models.KOKORO_FILES if p.exists()]
    if not present:
        pytest.skip("models not downloaded")
    for path in present:
        models.verify(path, models.KOKORO_FILES[path][1])
