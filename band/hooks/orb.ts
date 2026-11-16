// The voice orb, as in the voice-pair video: a solid center disk, a thin outline around it with a
// gap, and a ring of thin radial bars. Laid out on a square grid of 2 x 4 units per cell and drawn
// with solid quarter blocks (4 tiny pixels a cell, no gaps between them), each quarter lit when the
// shape covers enough of it. Colors are the shape's own, never blended toward a guessed background,
// so nothing shows as a box on any theme. While someone
// talks each bar is a real equalizer band (your mic, or Claude's voice); without audio each state
// moves its own way. Coral is Claude, cream is you.

import { resample, toBase64, type Mode } from './wave'

export const ORB_COLS = 18
export const ORB_ROWS = 9
const W = ORB_COLS * 2 // dots across
const H = ORB_ROWS * 4 // dots down
const CX = (W - 1) / 2
const CY = (H - 1) / 2
// A terminal cell is about 2.3 times as tall as it is wide (Terminal.app, SF Mono); the dot grid
// assumes 2, so heights are stretched by this to keep the orb round.
const STRETCH = 2.3 / 2
const R = Math.min(CX, CY * STRETCH) + 0.45 // the orb's outer radius, in dots
const DISK = R * 0.25 // the center disk's radius at rest
const CORE = R * 0.375 // the outline's radius
const BAR_IN = R * 0.525 // where the bars start
const BAR_MAX = R - BAR_IN - 0.6 // the longest a bar can grow past its stub
const BARS = 24
const DEFAULT = 0x01000000
// The quarter-block glyph for each set of lit quarters (top-left 1, top-right 2, bottom-left 4,
// bottom-right 8).
const GLYPH = [0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588]
const SX = 4 // coverage samples across a quarter
const SY = 6 // and down
const LIT = 0.4 // the share of a quarter the shape must cover to light it

type Rgb = [number, number, number]
const rgb = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
const BG = rgb(0x181816) // what a faint bar fades toward
const OUTLINE = rgb(0x45443f)
const CORAL = rgb(0xd97757)
const CORAL_HI = rgb(0xee9b79)
const CREAM = rgb(0xf0eee6)
const BLUE = rgb(0x93c5fd)
const GREEN = rgb(0x4ade80)
const MUTED = rgb(0x6e6d69)

/** The orb's color in each state: Claude coral, you cream. */
const COLOR: Record<Mode, Rgb> = {
  starting: MUTED,
  listening: CREAM,
  hearing: CREAM,
  transcribing: BLUE,
  sent: GREEN,
  thinking: CORAL,
  speaking: CORAL,
  muted: MUTED,
}

const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x)
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const pack = (c: Rgb) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2])

/** What a point belongs to. */
const enum Part {
  None = 0,
  Outline = 1,
  Bar = 2,
  Disk = 3,
}

export class Orb {
  private bars = new Float32Array(BARS) // eased bar lengths, 0..1
  private glow = new Float32Array(BARS) // eased brightness per bar, 0..1
  private amp = 0 // eased loudness
  private mode: Mode | null = null
  private from: Rgb = MUTED // the previous state's color, faded out over FADE_S
  private fade = 1
  private since = 0 // seconds in this state
  private t = 0

  private get color(): Rgb {
    return mix(this.from, COLOR[this.mode ?? 'starting'], this.fade)
  }

  /** Moves the orb one frame toward the audio (`bands`, empty for none). */
  step(mode: Mode, bands: readonly number[], level: number, dt: number): void {
    if (mode !== this.mode) {
      this.from = this.mode ? this.color : COLOR[mode]
      this.mode = mode
      this.fade = 0
      this.since = 0
    }
    this.fade = Math.min(1, this.fade + dt / 0.35)
    this.since += dt
    this.t += dt
    const t = this.t
    const real = bands.length > 0 && (mode === 'hearing' || mode === 'speaking' || mode === 'listening')
    const input = real ? resample(bands, BARS / 2 + 1) : null
    let sum = 0
    for (let i = 0; i < BARS; i++) {
      // Low bands at the bottom, high at the top, the same on both sides (bar 0 points down).
      const k = i <= BARS / 2 ? i : BARS - i
      const breathe = 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(t * 2.2))
      const turn = ((i / BARS - t * 0.8) % 1 + 1) % 1 // a light running round the ring
      let target = breathe
      let light = 0.45
      if (input) {
        const band = input[k] ?? 0
        target = Math.max(breathe, band * (0.6 + 0.4 * Math.abs(Math.sin(t * 9 + i * 2.4))))
        light = 0.45 + 0.55 * clamp(band * 1.4)
      } else if (mode === 'hearing') {
        target = 0.12 + 0.75 * clamp(level) * (0.45 + 0.55 * Math.abs(Math.sin(t * 9 + i * 2.4)))
        light = 0.8
      } else if (mode === 'thinking') {
        const head = turn < 0.22 ? 1 - turn / 0.22 : 0
        target = 0.1 + 0.4 * head
        light = 0.3 + 0.7 * head
      } else if (mode === 'transcribing') {
        const head = Math.max(0, Math.sin((i / BARS) * Math.PI * 6 - t * 14))
        target = 0.1 + 0.3 * head
        light = 0.35 + 0.65 * head
      } else if (mode === 'sent') {
        target = 0.9 * Math.max(0, 1 - this.since * 1.1)
        light = 1
      } else if (mode === 'starting') {
        target = i / BARS < (this.since * 0.8) % 1 ? 0.12 : 0
        light = 0.5
      } else if (mode === 'muted') {
        target = 0.05
        light = 0.5
      }
      const b = this.bars[i] ?? 0
      this.bars[i] = b + (target - b) * (target > b ? 0.6 : 0.22)
      const g = this.glow[i] ?? 0
      this.glow[i] = g + (light - g) * 0.4
      sum += this.bars[i] ?? 0
    }
    const loud = input || mode === 'hearing' ? clamp(Math.max(level, (sum / BARS) * 1.8)) : 0
    this.amp += (loud - this.amp) * (loud > this.amp ? 0.5 : 0.2)
  }

  private part(mode: Mode, x: number, y: number): [Part, number] {
    const dx = x - CX
    const dy = (y - CY) * STRETCH
    const d = Math.hypot(dx, dy)
    const disk =
      mode === 'muted' ? 0 : DISK * (0.85 + 0.35 * this.amp + (mode === 'thinking' ? 0.08 * Math.sin(this.t * 3) : 0))
    if (d <= disk) return [Part.Disk, 1]
    if (Math.abs(d - CORE) <= 0.65) return [Part.Outline, 1]
    if (d >= BAR_IN - 0.4) {
      const a = (Math.atan2(dx, dy) + Math.PI * 2) % (Math.PI * 2) // 0 straight down
      const pos = (a / (Math.PI * 2)) * BARS
      const i = Math.round(pos) % BARS
      const off = Math.abs(pos - Math.round(pos)) * ((2 * Math.PI * d) / BARS) // dots off the bar's line
      const len = BAR_IN + 0.6 + (this.bars[i] ?? 0) * BAR_MAX
      if (off <= 0.6 && d <= len) return [Part.Bar, i]
    }
    return [Part.None, 0]
  }

  /** The color of what lies at (x, y), in dot units, or null for nothing. */
  private colorAt(mode: Mode, color: Rgb, x: number, y: number): Rgb | null {
    const [part, v] = this.part(mode, x, y)
    if (part === Part.Disk) return mode === 'speaking' ? mix(color, CORAL_HI, 0.35 * this.amp) : color
    if (part === Part.Bar) return mix(BG, color, 0.35 + 0.65 * (this.glow[v] ?? 0.5))
    if (part === Part.Outline) return OUTLINE
    return null
  }

  /**
   * The Raster's `cells` now. Each cell is 2 x 2 quarters, each lit when the shape covers LIT of it
   * (sampled SX x SY times) and colored by what covers most of it. A cell shows its lit quarters
   * in the color most of them have; only when all four are lit in two colors (the disk against the
   * outline, say) does the second color fill the rest, as the cell's background.
   */
  cells(): string {
    const mode = this.mode ?? 'starting'
    const color = this.color
    const words = new Uint32Array(ORB_COLS * ORB_ROWS * 3)
    const quad: (Rgb | null)[] = [null, null, null, null]
    for (let row = 0; row < ORB_ROWS; row++) {
      for (let col = 0; col < ORB_COLS; col++) {
        // Quarter q: bit 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right.
        for (let q = 0; q < 4; q++) {
          const qx = q & 1
          const qy = q >> 1
          const tally = new Map<number, { c: Rgb; n: number }>()
          let hits = 0
          for (let i = 0; i < SX; i++) {
            for (let j = 0; j < SY; j++) {
              const x = col * 2 + qx - 0.5 + (i + 0.5) / SX
              const y = row * 4 + qy * 2 - 0.5 + ((j + 0.5) / SY) * 2
              const c = this.colorAt(mode, color, x, y)
              if (!c) continue
              hits++
              const key = pack(c)
              const e = tally.get(key)
              if (e) e.n++
              else tally.set(key, { c, n: 1 })
            }
          }
          let top: { c: Rgb; n: number } | null = null
          for (const e of tally.values()) if (!top || e.n > top.n) top = e
          quad[q] = hits / (SX * SY) >= LIT && top ? top.c : null
        }
        const at = (row * ORB_COLS + col) * 3
        words[at + 2] = DEFAULT
        const lit = [0, 1, 2, 3].filter(q => quad[q])
        if (!lit.length) {
          words[at] = 0x20
          words[at + 1] = DEFAULT
          continue
        }
        // The color most lit quarters have is the foreground.
        const counts = new Map<number, number>()
        for (const q of lit) counts.set(pack(quad[q]!), (counts.get(pack(quad[q]!)) ?? 0) + 1)
        let fg = 0
        let most = -1
        for (const [c, n] of counts) if (n > most) [fg, most] = [c, n]
        const other = [...counts.keys()].find(c => c !== fg)
        if (lit.length === 4 && other !== undefined) {
          // Two colors fill the cell: quarters of the foreground color drawn, the rest background.
          const mask = [0, 1, 2, 3].filter(q => pack(quad[q]!) === fg).reduce((m, q) => m | (1 << q), 0)
          words[at] = GLYPH[mask] ?? 0x2588
          words[at + 1] = fg
          words[at + 2] = other
        } else {
          words[at] = GLYPH[lit.reduce((m, q) => m | (1 << q), 0)] ?? 0x2588
          words[at + 1] = fg
        }
      }
    }
    return toBase64(new Uint8Array(words.buffer))
  }
}
