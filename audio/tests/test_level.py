import numpy as np

from level import LevelMeter, frame_level


def tone(amplitude: float, n: int = 480) -> bytes:
    t = np.arange(n) / 16_000
    return (np.sin(2 * np.pi * 220 * t) * amplitude * 32767).astype(np.int16).tobytes()


def test_frame_level_should_be_zero_for_silence():
    assert frame_level(b"\x00\x00" * 480) == 0.0


def test_frame_level_should_be_zero_for_an_empty_frame():
    assert frame_level(b"") == 0.0


def test_frame_level_should_grow_with_loudness():
    quiet, mid, loud = frame_level(tone(0.01)), frame_level(tone(0.1)), frame_level(tone(0.8))
    assert 0.0 < quiet < mid < loud <= 1.0


def test_frame_level_should_stay_within_zero_and_one_for_a_clipped_frame():
    assert frame_level(b"\xff\x7f" * 480) == 1.0


def test_meter_should_report_at_most_every_other_frame():
    meter = LevelMeter(every=2, heartbeat=100)
    reports = [meter.push(tone(0.02 * 2**i)) for i in range(6)]  # louder every frame
    assert reports[0::2] == [None] * 3
    assert all(r is not None for r in reports[1::2])


def test_meter_should_skip_reports_that_barely_change_until_the_heartbeat():
    meter = LevelMeter(every=1, heartbeat=5, min_change=0.05)
    frame = tone(0.2)
    reports = [meter.push(frame) for _ in range(6)]
    assert reports[0] is not None
    assert reports[1:5] == [None] * 4
    assert reports[5] is not None


def test_meter_should_report_zero_once_when_reset():
    meter = LevelMeter(every=1)
    assert meter.push(tone(0.5)) is not None
    assert meter.silence() == 0.0
    assert meter.silence() is None


# -- spectrum ---------------------------------------------------------------------------------
from level import Spectrum  # noqa: E402


def sine(freq: float, amplitude: float = 0.3, n: int = 512, sr: int = 16_000) -> np.ndarray:
    return (np.sin(2 * np.pi * freq * np.arange(n) / sr) * amplitude).astype(np.float32)


def test_spectrum_should_give_one_value_per_band_within_zero_and_one():
    bands = Spectrum(16_000, bands=24).bands(sine(1000))
    assert len(bands) == 24
    assert all(0.0 <= b <= 1.0 for b in bands)


def test_spectrum_should_be_flat_zero_for_silence():
    assert Spectrum(16_000, bands=16).bands(np.zeros(512, dtype=np.float32)) == [0.0] * 16


def test_spectrum_should_peak_in_the_band_that_holds_the_tone():
    spec = Spectrum(16_000, bands=24)
    for freq in (150, 1000, 4000):
        bands = spec.bands(sine(freq))
        peak = bands.index(max(bands))
        assert spec.edges[peak] <= freq < spec.edges[peak + 1], (freq, peak)


def test_spectrum_should_keep_far_bands_low_for_a_pure_tone():
    bands = Spectrum(16_000, bands=24).bands(sine(1000))
    peak = bands.index(max(bands))
    assert max(bands[:peak - 4] + bands[peak + 5 :]) < bands[peak] * 0.5


def test_spectrum_should_accept_a_short_window_and_int16_frames():
    spec = Spectrum(16_000, bands=12)
    assert len(spec.bands(sine(500, n=100))) == 12
    assert len(spec.frame(tone(0.3))) == 12


def test_spectrum_should_fit_a_24khz_voice():
    spec = Spectrum(24_000, bands=24)
    bands = spec.bands(sine(2000, sr=24_000))
    assert spec.edges[-1] <= 12_000
    assert max(bands) > 0.5


def test_spectrum_agc_should_lift_a_quiet_voice_but_not_silence():
    fixed, agc = Spectrum(16_000, bands=24), Spectrum(16_000, bands=24, agc=True)
    quiet = sine(1000, amplitude=0.004)
    for _ in range(300):  # let the gain settle
        agc.bands(quiet)
    assert max(agc.bands(quiet)) > max(fixed.bands(quiet)) + 0.3
    assert agc.bands(np.zeros(1024, dtype=np.float32)) == [0.0] * 24
