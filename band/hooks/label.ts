// The band's words, drawn into one-row Rasters so they animate at the frame rate like the bars:
// an animated icon per state, a light sweeping across the title, a fade-in on every state change,
// a typewriter for hints, and karaoke for what Claude is saying (the spoken part lights up).

import { accent, toBase64, type Mode } from './wave'

/** The title Raster's width: the longest title plus its icon and a space. */
export const TITLE_COLS = 20

export const TITLE: Record<Mode, string> = {
  starting: 'voice-pair',
  listening: 'Listening',
  hearing: 'Hearing you',
  transcribing: 'Transcribing',
  sent: 'Sent to Claude',
  thinking: 'Claude is working',
  speaking: 'Speaking',
  muted: 'Mic muted',
}

export const HINT: Record<Mode, string> = {
  starting: 'loading speech models…',
  listening: 'just talk · pause to send',
  hearing: 'pause when you are done',
  transcribing: 'turning your words into a message',
  sent: '',
  thinking: 'talk anytime, it waits for the turn to end',
  speaking: 'reading the reply out loud',
  muted: 'press u, or type “unmute”',
}

/** Icon frames per state, and how many frames a second they turn. */
const ICONS: Record<Mode, [string, number]> = {
  starting: ['◌◍●◍', 4],
  listening: ['●', 0],
  hearing: ['●', 0],
  transcribing: ['◐◓◑◒', 8],
  sent: ['✓', 0],
  thinking: ['✶✷✸✹✺✹✸✷', 10],
  speaking: ['◉', 0],
  muted: ['○', 0],
}

const DEFAULT = 0x01000000
const HINT_GREY = [0x9c, 0xa3, 0xaf] as const
const FADE_S = 0.3
const TYPE_CHARS_PER_S = 60
/** Kokoro at speed 1.0 says about this many characters a second. */
export const SPEECH_CHARS_PER_S = 15

const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x)
const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** A color dimmed by `light` (0..1) after mixing `white` (0..1) of white into it. */
const pack = ([r, g, b]: readonly number[], light: number, white = 0): number => {
  const v = (c: number) => Math.min(255, Math.round((c + (255 - c) * clamp(white)) * clamp(light)))
  return (v(r ?? 0) << 16) | (v(g ?? 0) << 8) | v(b ?? 0)
}

/** Characters a Raster cell can hold for sure: one column wide, in the BMP. Others become `?`. */
export function cellText(text: string): string[] {
  const out: string[] = []
  for (const ch of text.replace(/\s+/g, ' ')) {
    const cp = ch.codePointAt(0) ?? 0x3f
    const ok =
      (cp >= 0x20 && cp <= 0x7e) ||
      (cp >= 0xa0 && cp <= 0x24f) ||
      (cp >= 0x2010 && cp <= 0x205e) ||
      '●○◉◌◍◐◑◒◓✓✶✷✸✹✺▌·'.includes(ch)
    out.push(ok ? ch : '?')
  }
  return out
}

const row = (glyphs: string[], colors: number[], cols: number): string => {
  const words = new Uint32Array(cols * 3)
  for (let i = 0; i < cols; i++) {
    words[i * 3] = (glyphs[i] ?? ' ').codePointAt(0) ?? 0x20
    words[i * 3 + 1] = colors[i] ?? DEFAULT
    words[i * 3 + 2] = DEFAULT
  }
  return toBase64(new Uint8Array(words.buffer))
}

/** The title row: icon + title, faded in `since` seconds after the state began, light sweeping across. */
export function titleCells(mode: Mode, t: number, since: number, level: number): string {
  const [frames, fps] = ICONS[mode]
  const icons = [...frames]
  const icon = icons[fps ? Math.floor(t * fps) % icons.length : 0] ?? '●'
  const glyphs = [icon, ' ', ...cellText(TITLE[mode])].slice(0, TITLE_COLS)
  const base = hexRgb(accent(mode))
  const fade = clamp(since / FADE_S)
  const calm = mode === 'muted' || mode === 'starting'
  const pulse =
    mode === 'listening'
      ? 0.65 + 0.35 * (1 + Math.sin(t * 2.4)) / 2
      : mode === 'hearing'
        ? 0.6 + 0.4 * clamp(level)
        : mode === 'speaking'
          ? 0.7 + 0.3 * Math.abs(Math.sin(t * 6.1))
          : 1
  const span = glyphs.length + 6
  const pos = ((t * 14) % (span + 8)) - 4
  const colors = glyphs.map((_, i) => {
    if (i === 0) return pack(base, fade * pulse)
    const shine = calm ? 0 : Math.exp(-((i - pos) ** 2) / 4) * 0.55
    return pack(base, fade * (calm ? 0.75 : 0.92), shine)
  })
  return row(glyphs, colors, TITLE_COLS)
}

/**
 * The hint row, `cols` wide. A plain hint types on `since` seconds after it appeared; a spoken
 * line (`spoken: true`) shows whole and dim, its first `since * SPEECH_CHARS_PER_S` characters lit.
 */
export function hintCells(mode: Mode, text: string, t: number, since: number, cols: number, spoken: boolean): string {
  let glyphs = cellText(text)
  if (glyphs.length > cols) glyphs = [...glyphs.slice(0, cols - 1), '…']
  const lit = hexRgb(accent(mode))
  const colors: number[] = []
  if (spoken) {
    const said = since * SPEECH_CHARS_PER_S
    glyphs.forEach((_, i) => {
      const k = clamp(said - i, 0, 1) // the character being said fades up
      colors.push(k > 0 ? pack(lit, 0.55 + 0.45 * k, 0.15 * k) : pack(HINT_GREY, 0.6))
    })
  } else {
    const shown = Math.floor(since * TYPE_CHARS_PER_S)
    if (shown < glyphs.length) {
      glyphs = glyphs.slice(0, shown)
      if (Math.floor(t * 4) % 2 === 0) glyphs.push('▌') // the cursor blinks while typing
    }
    glyphs.forEach((_, i) => colors.push(pack(i === shown ? lit : HINT_GREY, 0.85)))
  }
  return row(glyphs, colors, cols)
}
