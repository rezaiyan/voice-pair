from segmenter import Segmenter

FRAME = b"\x00\x00" * 480  # 30 ms of 16 kHz int16


def make(**kw) -> Segmenter:
    args = dict(
        frame_ms=30, start_frames=6, end_silence_ms=300, min_utterance_ms=200, max_utterance_ms=3000, preroll_ms=90
    )
    args.update(kw)
    return Segmenter(**args)


def feed(seg: Segmenter, pattern: str):
    """pattern: 'S' voiced frame, '.' silent frame. Returns non-None events."""
    events = []
    for ch in pattern:
        ev, audio = seg.push(FRAME, ch == "S")
        if ev:
            events.append((ev, audio))
    return events


def test_push_should_open_utterance_after_enough_voiced_frames():
    seg = make()
    events = feed(seg, "SSSSSS")
    assert [e for e, _ in events] == ["start"]
    assert seg.active


def test_push_should_ignore_isolated_clicks():
    seg = make()
    assert feed(seg, "S....S....S....") == []
    assert not seg.active


def test_push_should_close_utterance_after_trailing_silence_with_audio():
    seg = make()
    events = feed(seg, "SSSSSS" + "SSSS" + "." * 10)
    kinds = [e for e, _ in events]
    assert kinds == ["start", "end"]
    audio = events[-1][1]
    # preroll(3) + 4 voiced + 10 silence frames after the onset frame
    assert len(audio) == len(FRAME) * (3 + 4 + 10)
    assert not seg.active


def test_push_should_drop_utterance_with_too_little_voice():
    seg = make(min_utterance_ms=600)
    events = feed(seg, "SSSSSS" + "." * 10)
    assert [e for e, _ in events] == ["start", "drop"]


def test_push_should_cut_utterance_at_max_length():
    seg = make(max_utterance_ms=600)
    events = feed(seg, "S" * 40)
    assert "end" in [e for e, _ in events]


def test_reset_should_abandon_open_utterance():
    seg = make()
    feed(seg, "SSSSSS")
    seg.reset()
    assert not seg.active
    assert feed(seg, "." * 20) == []


def test_from_config_uses_runtime_settings():
    import config

    seg = Segmenter.from_config()
    assert seg.end_silence_ms == config.END_SILENCE_MS
    assert seg.max_utterance_ms == config.MAX_UTTERANCE_S * 1000
