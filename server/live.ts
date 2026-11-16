// Live voice state for the session band: what the microphone and the voice are doing right now.
// Fed by the sidecar's events; read through GET /status by the voice-pair mod.

import type { SidecarEvent } from "./sidecar.ts";

export type Phase =
  | "off"
  | "muted"
  | "listening"
  | "hearing"
  | "transcribing"
  | "speaking";

export type Live = {
  phase: Phase;
  /** Mic loudness, 0..1 (log scale); 0 while muted or off. */
  level: number;
  /** When the last transcript was delivered (ms since epoch), 0 before any. */
  heardAt: number;
  /** Equalizer bands 0..1, low to high: the mic's, or Claude's voice while it speaks. [] when none. */
  bands: number[];
};

/** Bands older than this are not shown: the source stopped sending. */
const BANDS_FRESH_MS = 500;
const MAX_BANDS = 64;

type Audio = { ready: boolean; muted: boolean; speaking: boolean };

export class LiveState {
  private hearing = false;
  private transcribing = false;
  private level = 0;
  private heardAt = 0;
  private bands: Record<"mic" | "voice", { values: number[]; at: number }> = {
    mic: { values: [], at: 0 },
    voice: { values: [], at: 0 },
  };

  onEvent(ev: SidecarEvent, now = Date.now()): void {
    switch (ev.event) {
      case "ready":
        this.hearing = this.transcribing = false;
        this.level = 0;
        break;
      case "hearing":
        this.hearing = true;
        this.transcribing = false;
        break;
      case "transcribing":
        this.hearing = false;
        this.transcribing = true;
        break;
      case "transcript":
        this.hearing = this.transcribing = false;
        this.heardAt = now;
        break;
      case "dropped":
        this.hearing = this.transcribing = false;
        break;
      case "bands":
        this.bands[ev.source === "voice" ? "voice" : "mic"] = {
          values: (Array.isArray(ev.values) ? ev.values : [])
            .slice(0, MAX_BANDS)
            .map((v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)),
          at: now,
        };
        break;
      case "level":
        this.level = Number.isFinite(ev.value)
          ? Math.min(1, Math.max(0, ev.value))
          : 0;
        break;
    }
  }

  snapshot(audio: Audio, now = Date.now()): Live {
    const phase: Phase = !audio.ready
      ? "off"
      : audio.speaking
        ? "speaking"
        : audio.muted
          ? "muted"
          : this.transcribing
            ? "transcribing"
            : this.hearing
              ? "hearing"
              : "listening";
    const level = phase === "off" || phase === "muted" ? 0 : this.level;
    const source =
      phase === "speaking" ? this.bands.voice : phase === "off" || phase === "muted" ? null : this.bands.mic;
    const bands = source && now - source.at <= BANDS_FRESH_MS ? source.values : [];
    return { phase, level, heardAt: this.heardAt, bands };
  }
}
