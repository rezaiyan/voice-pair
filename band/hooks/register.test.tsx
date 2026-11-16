import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cellText, hintCells, titleCells } from './label'
import { Orb, ORB_COLS, ORB_ROWS } from './orb'
import { Equalizer, resample } from './wave'

const props = (over: Partial<{ isWorking: boolean; hasSurvey: boolean }> = {}) => ({
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 11 },
  view: {},
  ...over,
})

const band = (surface: 'terminal' | 'desktop', over = {}) => ({
  plugin: 'voice-pair-band',
  surface,
  component: 'AbovePrompt' as const,
  requestId: 'band',
  props: props(over),
})

/** A stand-in voice-pair server: answers GET /status with `status`, records every request. */
function server(on: On) {
  const s = {
    status: { ready: true, speaking: false, muted: false, phase: 'listening', level: 0.1, heardAt: 0 } as Record<
      string,
      unknown
    >,
    calls: [] as { url: string; method: string; token: string | undefined }[],
  }
  on('http.fetch', (_, e) => {
    s.calls.push({ url: e.url, method: e.init?.method ?? 'GET', token: e.init?.headers?.['x-voice-pair-token'] })
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(s.status) } }
  })
  return s
}

type TestDollar = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]

async function voiceSession($: TestDollar, on: On, band = 'full') {
  mock.env(on, { VOICE_PAIR_PORT: '7799', VOICE_PAIR_TOKEN: 'secret-token', VOICE_PAIR_BAND: band })
  const clock = mock.clock(on)
  const srv = server(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return { clock, srv }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The glyphs of a Raster's cells, as one string. */
export function cellsText(cells: string): string {
  const bytes: number[] = []
  for (let i = 0; i < cells.length; i += 4) {
    const n = [0, 1, 2, 3].map(k => B64.indexOf(cells[i + k] ?? '=')).map(v => (v < 0 ? 0 : v))
    const word = ((n[0] ?? 0) << 18) | ((n[1] ?? 0) << 12) | ((n[2] ?? 0) << 6) | (n[3] ?? 0)
    bytes.push((word >> 16) & 255, (word >> 8) & 255, word & 255)
  }
  let out = ''
  for (let i = 0; i + 12 <= bytes.length; i += 12) {
    const cp = (bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16) | ((bytes[i + 3] ?? 0) << 24)
    out += String.fromCodePoint(cp >>> 0)
  }
  return out
}

type Findable = { findAll: (q: { type: string }) => Promise<{ text: string; key: string | undefined; props: Record<string, unknown> }[]> }

/** Every word on the band: the title and hint Rasters' glyphs, then the Texts. */
const words = async (ui: Findable) => {
  const rasters = (await ui.findAll({ type: 'Raster' })).filter(r => r.key !== 'wave')
  const texts = await ui.findAll({ type: 'Text' })
  return [...rasters.map(r => cellsText(String(r.props.cells)).trim()), ...texts.map(t => t.text)].join(' | ')
}

test('the band follows the voice through an utterance, on terminal and desktop', async ($, on) => {
  const { clock, srv } = await voiceSession($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    srv.status = { ...srv.status, phase: 'listening' }
    await clock.advance(150)
    const ui = await $.ui.mount(band(surface))
    expect(await words(ui)).toMatch(/Listening/)

    srv.status = { ...srv.status, phase: 'hearing', level: 0.8 }
    await clock.advance(150)
    expect(await words(ui)).toMatch(/Hearing you/)

    srv.status = { ...srv.status, phase: 'transcribing' }
    await clock.advance(150)
    expect(await words(ui)).toMatch(/Transcribing/)

    srv.status = { ...srv.status, phase: 'listening', heardAt: Number(srv.status.heardAt) + 1000 }
    await clock.advance(150)
    expect(await words(ui)).toMatch(/Sent to Claude/)

    await clock.advance(2000) // the flash ends
    expect(await words(ui)).toMatch(/Listening/)
    await ui.unmount()
  }
  expect(srv.calls[0]).toMatchObject({ url: 'http://127.0.0.1:7799/status', token: 'secret-token' })
})

test('the band says Claude is working during a turn, and shows what it says out loud', async ($, on) => {
  const { clock, srv } = await voiceSession($, on)
  await clock.advance(150)

  const working = await $.ui.mount(band('terminal', { isWorking: true }))
  expect(await words(working)).toMatch(/Claude is working/)
  await working.unmount()

  await $.tool.call({ tool: 'mcp__voice-pair__speak', text: 'All twelve tests pass.' } as never)
  srv.status = { ...srv.status, phase: 'speaking', speaking: true }
  await clock.advance(150)
  const speaking = await $.ui.mount(band('terminal', { isWorking: true }))
  expect(await words(speaking)).toMatch(/Speaking.*All twelve tests pass/)
  expect(await speaking.find({ type: 'Button', key: 'stop' })).toBeDefined()

  await speaking.press({ key: 'stop' })
  expect(srv.calls.some(c => c.method === 'POST' && c.url.endsWith('/stop'))).toBe(true)
  await speaking.unmount()
})

test('mute and unmute go to the voice-pair server', async ($, on) => {
  const { clock, srv } = await voiceSession($, on)
  await clock.advance(150)
  const ui = await $.ui.mount(band('terminal'))

  await ui.press({ key: 'mute' })
  expect(srv.calls.some(c => c.method === 'POST' && c.url.endsWith('/mute'))).toBe(true)

  srv.status = { ...srv.status, phase: 'muted', muted: true }
  await clock.advance(150)
  expect(await words(ui)).toMatch(/Mic muted/)
  expect(await ui.find({ type: 'Button', key: 'unmute' })).toBeDefined()
  await ui.unmount()
})

test('an older server without a phase still drives the band', async ($, on) => {
  const { clock, srv } = await voiceSession($, on)
  srv.status = { ready: true, speaking: false, muted: true }
  await clock.advance(150)
  const ui = await $.ui.mount(band('terminal'))
  expect(await words(ui)).toMatch(/Mic muted/)
  await ui.unmount()
})

test('a session voice-pair did not start draws no band', async ($, on) => {
  mock.env(on, {})
  mock.clock(on)
  const srv = server(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(band('terminal'))
  expect(await words(ui)).toBe('engine')
  expect(srv.calls).toHaveLength(0)
  await ui.unmount()
})

test('the equalizer fills every cell with a printable glyph, real bands or not', async () => {
  const eq = new Equalizer(20, 4)
  expect(eq.columns).toBe(39)
  for (const mode of ['starting', 'listening', 'hearing', 'transcribing', 'sent', 'thinking', 'speaking', 'muted'] as const) {
    for (const bands of [[], [0.1, 0.9, 0.4, 0.7]]) {
      eq.step(mode, 0.37, bands, 0.6, 0.04)
      expect(eq.cells(mode).length).toBe(Math.ceil((39 * 4 * 12) / 3) * 4) // 12 bytes a cell, base64
      const lines = eq.text()
      expect(lines).toHaveLength(4)
      expect(lines.every(l => l.length === 39)).toBe(true)
    }
  }
})

test('bars follow the real bands, and peak caps hold then fall', async () => {
  const eq = new Equalizer(4, 4)
  for (let i = 0; i < 20; i++) eq.step('hearing', i * 0.04, [1, 1, 0, 0], 1, 0.04)
  const loud = eq.text()
  expect(loud[0]?.[0]).toBe('█') // the first bar reaches the top
  expect(loud[3]?.[6]).toBe(' ') // the last bar stays down
  for (let i = 0; i < 4; i++) eq.step('hearing', 1 + i * 0.04, [0, 0, 0, 0], 0, 0.04)
  expect(eq.text()[0]?.[0]).not.toBe('█') // the bar dropped fast; its cap is still up (in the cells)
})

test('bands are resampled to the bar count', async () => {
  expect(resample([0, 1], 3)).toEqual([0, 0.5, 1])
  expect(resample([], 2)).toEqual([0, 0])
  expect(resample([0.4, 2], 2)).toEqual([0.4, 1])
})

test('the title animates its icon and keeps its words', async () => {
  const a = cellsText(titleCells('thinking', 0, 1, 0))
  const b = cellsText(titleCells('thinking', 0.15, 1, 0))
  expect(a.trim()).toMatch(/^. Claude is working$/)
  expect(a[0]).not.toBe(b[0]) // the spinner turned
  expect(cellsText(titleCells('muted', 3, 1, 0)).trim()).toBe('○ Mic muted')
})

test('a hint types on, and a spoken line shows whole while it is said', async () => {
  const typing = cellsText(hintCells('listening', 'just talk', 0, 0.05, 20, false)).trim()
  expect(typing.length).toBeLessThan('just talk'.length + 1)
  expect(cellsText(hintCells('listening', 'just talk', 0, 2, 20, false)).trim()).toBe('just talk')
  expect(cellsText(hintCells('speaking', '“All good.”', 0, 0, 20, true)).trim()).toBe('“All good.”')
})

test('a long hint is cut to fit with an ellipsis', async () => {
  expect(cellsText(hintCells('speaking', 'x'.repeat(50), 0, 9, 12, true))).toBe(`${'x'.repeat(11)}…`)
})

test('glyphs a cell cannot hold become ?', async () => {
  expect(cellText('ok 👍 日本 é…').join('')).toBe('ok ? ?? é…')
})

test('by default the band is just the orb: no words, no buttons', async ($, on) => {
  const { clock, srv } = await voiceSession($, on, '')
  srv.status = { ...srv.status, phase: 'hearing', bands: [0.2, 0.8, 0.5, 0.3] }
  await clock.advance(400)
  const ui = await $.ui.mount(band('terminal'))
  const rasters = await ui.findAll({ type: 'Raster' })
  expect(rasters.map(r => r.key)).toEqual(['orb'])
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)
  expect(await ui.find({ type: 'Button', key: 'mute' })).toBeUndefined()
  await ui.unmount()
})

test('the orb is round at rest, ripples with the bands, and every state draws something', async () => {
  // Every lit quarter block, as one entry each.
  const QUARTERS: Record<string, number> = { '▘': 1, '▝': 1, '▖': 1, '▗': 1, '▀': 2, '▄': 2, '▌': 2, '▐': 2, '▚': 2, '▞': 2, '▛': 3, '▜': 3, '▙': 3, '▟': 3, '█': 4 }
  const braille = (cells: string) => [...cellsText(cells)].flatMap(c => new Array(QUARTERS[c] ?? 0).fill(1))
  const rest = new Orb()
  rest.step('listening', [], 0, 0.04)
  const still = cellsText(rest.cells())
  expect(still).toHaveLength(ORB_COLS * ORB_ROWS)
  // Round: its widest row is in the middle, wider than its top and bottom rows, which match.
  const widths = Array.from({ length: ORB_ROWS }, (_, r) => [...still.slice(r * ORB_COLS, (r + 1) * ORB_COLS)].filter(c => c !== ' ').length)
  const drawn = widths.map((w, r) => (w ? r : -1)).filter(r => r >= 0)
  const first = widths[drawn[0]!]!
  const last = widths[drawn[drawn.length - 1]!]!
  expect(Math.max(...widths)).toBeGreaterThan(first)
  expect(Math.abs(first - last)).toBeLessThan(3)

  const loud = new Orb()
  for (let i = 0; i < 10; i++) loud.step('hearing', new Array(24).fill(1), 1, 0.04)
  expect(braille(loud.cells()).length).toBeGreaterThan(braille(rest.cells()).length)

  for (const mode of ['starting', 'listening', 'hearing', 'transcribing', 'sent', 'thinking', 'speaking', 'muted'] as const) {
    const o = new Orb()
    o.step(mode, [], 0.5, 0.04)
    expect(braille(o.cells()).length).toBeGreaterThan(0)
  }
})

test('the thinking orb turns', async () => {
  const o = new Orb()
  o.step('thinking', [], 0, 0.04)
  const before = o.cells()
  for (let i = 0; i < 10; i++) o.step('thinking', [], 0, 0.04)
  expect(o.cells()).not.toBe(before)
})
