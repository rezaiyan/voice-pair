import { describe, expect, it } from "bun:test";
import { LiveState } from "../live.ts";

const up = { ready: true, muted: false, speaking: false };

describe("LiveState", () => {
  it("should be off until the audio is ready", () => {
    const s = new LiveState();
    expect(s.snapshot({ ...up, ready: false }).phase).toBe("off");
  });

  it("should listen when ready and nothing is going on", () => {
    expect(new LiveState().snapshot(up).phase).toBe("listening");
  });

  it("should move from hearing to transcribing to listening over one utterance", () => {
    const s = new LiveState();
    s.onEvent({ event: "hearing" });
    expect(s.snapshot(up).phase).toBe("hearing");
    s.onEvent({ event: "transcribing" });
    expect(s.snapshot(up).phase).toBe("transcribing");
    s.onEvent({ event: "transcript", text: "hi there", stt_ms: 5, audio_ms: 900 }, 1234);
    expect(s.snapshot(up)).toMatchObject({ phase: "listening", heardAt: 1234 });
  });

  it("should go back to listening when an utterance is dropped", () => {
    const s = new LiveState();
    s.onEvent({ event: "hearing" });
    s.onEvent({ event: "dropped", reason: "too short" });
    expect(s.snapshot(up).phase).toBe("listening");
  });

  it("should put speaking and muted above what the mic is doing", () => {
    const s = new LiveState();
    s.onEvent({ event: "hearing" });
    expect(s.snapshot({ ...up, speaking: true }).phase).toBe("speaking");
    expect(s.snapshot({ ...up, muted: true }).phase).toBe("muted");
  });

  it("should keep the latest mic level, clamped to 0..1", () => {
    const s = new LiveState();
    s.onEvent({ event: "level", value: 0.42 });
    expect(s.snapshot(up).level).toBe(0.42);
    s.onEvent({ event: "level", value: 7 });
    expect(s.snapshot(up).level).toBe(1);
    s.onEvent({ event: "level", value: Number.NaN });
    expect(s.snapshot(up).level).toBe(0);
  });

  it("should report no mic level while muted or off", () => {
    const s = new LiveState();
    s.onEvent({ event: "level", value: 0.5 });
    expect(s.snapshot({ ...up, muted: true }).level).toBe(0);
    expect(s.snapshot({ ...up, ready: false }).level).toBe(0);
  });

  it("should forget a half-heard utterance when the audio restarts", () => {
    const s = new LiveState();
    s.onEvent({ event: "hearing" });
    s.onEvent({ event: "ready", tts: "kokoro", muted: false, barge_in: false });
    expect(s.snapshot(up).phase).toBe("listening");
  });

  it("should show the mic's bands while listening and the voice's while speaking", () => {
    const s = new LiveState();
    s.onEvent({ event: "bands", source: "mic", values: [0.1, 0.5, 0.9] }, 1000);
    s.onEvent({ event: "bands", source: "voice", values: [0.7, 0.2, 0.4] }, 1000);
    expect(s.snapshot(up, 1100).bands).toEqual([0.1, 0.5, 0.9]);
    expect(s.snapshot({ ...up, speaking: true }, 1100).bands).toEqual([0.7, 0.2, 0.4]);
  });

  it("should drop bands that went stale or out of range", () => {
    const s = new LiveState();
    s.onEvent({ event: "bands", source: "mic", values: [2, -1, Number.NaN] }, 1000);
    expect(s.snapshot(up, 1100).bands).toEqual([1, 0, 0]);
    expect(s.snapshot(up, 2000).bands).toEqual([]);
  });

  it("should show no bands while muted or off", () => {
    const s = new LiveState();
    s.onEvent({ event: "bands", source: "mic", values: [0.5] }, 1000);
    expect(s.snapshot({ ...up, muted: true }, 1000).bands).toEqual([]);
    expect(s.snapshot({ ...up, ready: false }, 1000).bands).toEqual([]);
  });
});
