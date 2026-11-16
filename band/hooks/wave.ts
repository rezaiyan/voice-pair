// The band's equalizer: one bar per frequency band, drawn with block glyphs into a Raster's cells.
// Real bands come from voice-pair (your mic, or Claude's voice while it plays); with none (silence,
// Claude thinking, transcribing) each mode has an animated pattern of its own. Bars ease toward
// their target, and a peak cap rides each bar, holds, then falls.

export type Mode =
  | 'starting'
  | 'listening'
  | 'hearing'
  | 'transcribing'
  | 'sent'
  | 'thinking'
  | 'speaking'
  | 'muted'

type Rgb = [number, number, number]
const rgb = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]

/** Bottom, middle and top color of the bars in each mode. */
export const PALETTE: Record<Mode, [Rgb, Rgb, Rgb]> = {
  starting: [rgb(0x374151), rgb(0x6b7280), rgb(0x9ca3af)],
  listening: [rgb(0x14b8a6), rgb(0x8b5cf6), rgb(0xf472b6)],
  hearing: [rgb(0x2dd4bf), rgb(0xa78bfa), rgb(0xf9a8d4)],
  transcribing: [rgb(0x3b82f6), rgb(0x93c5fd), rgb(0xe0e7ff)],
  sent: [rgb(0x16a34a), rgb(0x4ade80), rgb(0xd9f99d)],
  thinking: [rgb(0xc2410c), rgb(0xd97757), rgb(0xf4b183)],
  speaking: [rgb(0xd97757), rgb(0xf59e0b), rgb(0xfde68a)],
  muted: [rgb(0x374151), rgb(0x4b5563), rgb(0x6b7280)],
}

/** The label color of each mode, as `#rrggbb`. */
export const accent = (mode: Mode): string => {
  const [r, g, b] = PALETTE[mode][mode === 'thinking' || mode === 'speaking' ? 1 : 2]
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

const DEFAULT = 0x01000000 // the terminal's own color
const BLOCKS = [0x20, 0x2581, 0x2582, 0x2583, 0x2584, 0x2585, 0x2586, 0x2587, 0x2588]
const CAP = 0x2594 // ▔, the peak cap

const PEAK_HOLD_S = 0.35
const CROSSFADE_S = 0.35 // how long the colors take to turn from one state to the next
const PEAK_FALL_PER_S = 1.1 // of the full height

const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x)

/** Louder in the middle, so the patterns read as one shape and not a flat block. */
const bell = (i: number, w: number) => 0.35 + 0.65 * Math.exp(-(((i - (w - 1) / 2) / (w * 0.3)) ** 2))

/** Cheap, smooth, deterministic jitter in 0..1. */
const wobble = (i: number, t: number) => (Math.sin(i * 1.7 + t * 9.1) * Math.sin(i * 0.63 - t * 5.3) + 1) / 2

/** A bright spot sweeping left to right, `width` columns wide. */
const sweep = (i: number, t: number, w: number, speed: number, width: number) => {
  const pos = ((t * speed) % (w + 2 * width)) - width
  return Math.exp(-((i - pos) ** 2) / width)
}

/** The animated pattern of a mode with no audio to show: height 0..1 and brightness 0..1. */
export function pattern(mode: Mode, i: number, w: number, t: number, level: number): [number, number] {
  switch (mode) {
    case 'starting':
      return [0.06, 0.3 + 0.7 * sweep(i, t, w, 10, 3)]
    case 'listening':
      return [0.04 + 0.05 * (1 + Math.sin(i * 0.5 - t * 2.2)) / 2, 0.55]
    case 'hearing':
      return [(0.22 + 0.78 * level) * bell(i, w) * (0.5 + 0.5 * wobble(i, t)), 0.9]
    case 'transcribing': {
      const spot = sweep(i, t, w, 22, 3)
      return [0.08 + 0.4 * spot, 0.35 + 0.65 * spot]
    }
    case 'sent':
      return [0.2 + 0.25 * bell(i, w) * (1 + Math.sin(i * 0.9 - t * 12)) / 2, 1]
    case 'thinking': {
      const shimmer = sweep(i, t, w, 14, 5)
      return [0.06 + 0.06 * (1 + Math.sin(i * 0.35 - t * 3)) / 2 + 0.14 * shimmer, 0.45 + 0.55 * shimmer]
    }
    case 'speaking': {
      const syllables = 0.35 + 0.65 * Math.abs(Math.sin(t * 6.1) * Math.sin(t * 2.3 + 0.7))
      return [syllables * bell(i, w) * (0.45 + 0.55 * wobble(i, t * 0.8)), 0.9]
    }
    case 'muted':
      return [1 / 32, 0.5 + 0.5 * sweep(i, t, w, 4, 2)]
  }
}

/** `bands` stretched or squeezed to `n` values, by linear interpolation. */
export function resample(bands: readonly number[], n: number): number[] {
  if (bands.length === n) return bands.map(b => clamp(b))
  if (bands.length === 0) return new Array(n).fill(0)
  if (bands.length === 1) return new Array(n).fill(clamp(bands[0] ?? 0))
  return Array.from({ length: n }, (_, i) => {
    const x = (i / Math.max(1, n - 1)) * (bands.length - 1)
    const lo = Math.floor(x)
    const k = x - lo
    return clamp((bands[lo] ?? 0) * (1 - k) + (bands[Math.min(lo + 1, bands.length - 1)] ?? 0) * k)
  })
}

const blend = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

/** The gradient color at height `y` (0 bottom, 1 top), dimmed by `light`. */
const shade = (stops: [Rgb, Rgb, Rgb], y: number, light: number): number => {
  const c = y < 0.5 ? blend(stops[0], stops[1], y * 2) : blend(stops[1], stops[2], (y - 0.5) * 2)
  const v = (n: 0 | 1 | 2) => Math.round(clamp(c[n] * light, 0, 255))
  return (v(0) << 16) | (v(1) << 8) | v(2)
}

/** The equalizer for one Raster: `bars` bars one column wide with a column between them, `rows` tall. */
export class Equalizer {
  readonly columns: number
  private heights: Float32Array
  private peaks: Float32Array
  private holds: Float32Array
  private lights: Float32Array
  private mode: Mode | null = null
  private prev: Mode = 'starting'
  private mix = 1

  constructor(readonly bars: number, readonly rows: number) {
    this.columns = bars * 2 - 1
    this.heights = new Float32Array(bars)
    this.peaks = new Float32Array(bars)
    this.holds = new Float32Array(bars)
    this.lights = new Float32Array(bars).fill(1)
  }

  /** Moves every bar one frame toward the audio (`bands`, empty for none) or the mode's pattern. */
  step(mode: Mode, t: number, bands: readonly number[], level: number, dt: number): void {
    if (mode !== this.mode) {
      this.prev = this.mode ?? mode
      this.mode = mode
      this.mix = this.prev === mode ? 1 : 0
    }
    this.mix = Math.min(1, this.mix + dt / CROSSFADE_S)
    const real = bands.length > 0 && mode !== 'muted' && mode !== 'starting'
    const input = real ? resample(bands, this.bars) : null
    for (let i = 0; i < this.bars; i++) {
      const [patternHeight, light] = pattern(mode, i, this.bars, t, clamp(level))
      const target = clamp(input ? (input[i] ?? 0) : patternHeight)
      const h = this.heights[i] ?? 0
      const next = h + (target - h) * (target > h ? 0.7 : 0.28)
      this.heights[i] = next
      this.lights[i] = input ? 1 : light
      const peak = this.peaks[i] ?? 0
      if (next >= peak) {
        this.peaks[i] = next
        this.holds[i] = PEAK_HOLD_S
      } else if ((this.holds[i] ?? 0) > 0) {
        this.holds[i] = (this.holds[i] ?? 0) - dt
      } else {
        this.peaks[i] = Math.max(next, peak - PEAK_FALL_PER_S * dt)
      }
    }
  }

  /** The Raster's `cells` now: base64 of [glyph, fg, bg] u32 triplets, row-major. */
  cells(mode: Mode): string {
    const { columns, rows, bars } = this
    const words = new Uint32Array(columns * rows * 3)
    for (let at = 0; at < words.length; at += 3) {
      words[at] = 0x20
      words[at + 1] = DEFAULT
      words[at + 2] = DEFAULT
    }
    const now = this.mode ?? mode
    const k = this.mix
    const [a, b] = [PALETTE[this.prev], PALETTE[now]]
    const stops: [Rgb, Rgb, Rgb] = [blend(a[0], b[0], k), blend(a[1], b[1], k), blend(a[2], b[2], k)]
    const units = rows * 8
    for (let i = 0; i < bars; i++) {
      const fill = Math.round((this.heights[i] ?? 0) * units)
      const peakRow = Math.min(rows - 1, Math.floor((this.peaks[i] ?? 0) * rows - 1e-6))
      const light = 0.35 + 0.65 * clamp(this.lights[i] ?? 1)
      for (let r = 0; r < rows; r++) {
        const fromBottom = rows - 1 - r
        const cellFill = clamp(fill - fromBottom * 8, 0, 8)
        const at = (r * columns + i * 2) * 3
        if (cellFill > 0) {
          words[at] = BLOCKS[cellFill] ?? 0x20
          words[at + 1] = shade(stops, (fromBottom + cellFill / 8) / rows, light)
        } else if (fromBottom === peakRow && (this.peaks[i] ?? 0) > 0.06) {
          words[at] = CAP
          words[at + 1] = shade(stops, 1, light)
        }
      }
    }
    return toBase64(new Uint8Array(words.buffer))
  }

  /** The same bars as plain text, one string per row, for surfaces without a Raster. */
  text(): string[] {
    const { rows, bars } = this
    const lines: string[] = []
    for (let r = 0; r < rows; r++) {
      const fromBottom = rows - 1 - r
      let line = ''
      for (let i = 0; i < bars; i++) {
        const fill = clamp(Math.round((this.heights[i] ?? 0) * rows * 8) - fromBottom * 8, 0, 8)
        line += String.fromCodePoint(BLOCKS[fill] ?? 0x20) + (i < bars - 1 ? ' ' : '')
      }
      lines.push(line)
    }
    return lines
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64 (Uint8Array.prototype.toBase64 is not everywhere yet). */
export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? B64.charAt(n & 63) : '='
  }
  return out
}
