// voice-pair band: a live row above the prompt while a voice-pair session runs.
// A real-time equalizer (the frequency bands of your mic while you talk, of Claude's voice while it
// speaks), what the voice is doing right now, and Mute / Stop buttons. Quiet in every session
// voice-pair didn't start.
//
// The state comes from voice-pair's local control port (GET /status), which bin/voice-pair opens
// and hands to Claude Code as VOICE_PAIR_PORT and VOICE_PAIR_TOKEN.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Live, Phase } from '../types'
import { HINT, hintCells, TITLE, TITLE_COLS, titleCells } from './label'
import { Orb, ORB_COLS, ORB_ROWS } from './orb'
import { accent, Equalizer, type Mode } from './wave'

const ROWS = 4
const POLL_MS = 40
const FRAME_MS = 40
const SENT_MS = 1600
const SAYING_CHARS = 140

const liveAtom = atom({ plugin: 'voice-pair-band', key: 'live' } as const, {
  phase: 'off',
  muted: false,
  heardAt: 0,
} as Live)
const sayingAtom = atom({ plugin: 'voice-pair-band', key: 'saying' } as const, '')
const sentAtom = atom({ plugin: 'voice-pair-band', key: 'sent' } as const, false)

type Conn = { port: string; token: string }

/** The band's mode: what the voice is doing, with Claude's own work in between. */
export function modeOf(live: Live, sent: boolean, working: boolean): Mode {
  switch (live.phase) {
    case 'unreachable':
    case 'off':
      return 'starting'
    case 'speaking':
    case 'hearing':
    case 'transcribing':
      return live.phase
  }
  if (sent) return 'sent'
  if (working) return 'thinking'
  return live.phase === 'muted' ? 'muted' : 'listening'
}

const ICON: Record<Mode, string> = {
  starting: '◌',
  listening: '●',
  hearing: '●',
  transcribing: '◍',
  sent: '✓',
  thinking: '✻',
  speaking: '◉',
  muted: '○',
}

/** The hint line: what Claude is saying while it speaks, else the state's own hint. */
function hintFor(mode: Mode, live: Live, saying: string): { text: string; spoken: boolean } {
  if (mode === 'speaking' && saying) return { text: `“${saying}”`, spoken: true }
  if (mode === 'thinking' && live.muted) return { text: 'mic muted · press u to unmute', spoken: false }
  if (live.phase === 'unreachable') return { text: 'not responding · is the session still running?', spoken: false }
  return { text: HINT[mode], spoken: false }
}

/** Older servers report no `phase`: work it out from the flags they do send. */
function phaseOf(s: Record<string, unknown>): Phase {
  if (typeof s.phase === 'string') return s.phase as Phase
  if (!s.ready) return 'off'
  return s.speaking ? 'speaking' : s.muted ? 'muted' : 'listening'
}

const sameLive = (a: Live, b: Live) => a.phase === b.phase && a.muted === b.muted && a.heardAt === b.heardAt

/** Module state: starts over on a hot reload, which also cancels the old timers. */
const S = {
  conn: null as Conn | null,
  live: { phase: 'off', muted: false, heardAt: 0 } as Live,
  sent: false,
  working: false,
  collapsed: false,
  level: 0,
  shownLevel: 0,
  bands: [] as number[],
  fails: 0,
  inFlight: false,
  polled: false,
  bandId: null as string | null,
  wave: null as Equalizer | null,
  orb: new Orb(),
  /** VOICE_PAIR_BAND=full: the whole band (equalizer, words, buttons); else just the orb. */
  full: false,
  frameNo: 0,
  saying: '',
  hintCols: 40,
  /** The state and hint on screen, and the frame each began on: their animations start there. */
  modeNow: null as Mode | null,
  modeSince: 0,
  hintNow: '',
  hintSince: 0,
}

const seconds = (frames: number) => frames * (FRAME_MS / 1000)

/** Notes the frame a new state or hint began on; returns how long each has been up, in seconds. */
function since(mode: Mode, hint: string): { mode: number; hint: number } {
  if (mode !== S.modeNow) {
    S.modeNow = mode
    S.modeSince = S.frameNo
  }
  if (hint !== S.hintNow) {
    S.hintNow = hint
    S.hintSince = S.frameNo
  }
  return { mode: seconds(S.frameNo - S.modeSince), hint: seconds(S.frameNo - S.hintSince) }
}

async function control($: EngineInterface, path: string): Promise<void> {
  const conn = S.conn
  if (!conn) return
  await $.http
    .fetch(`http://127.0.0.1:${conn.port}/${path}`, {
      method: 'POST',
      headers: { 'x-voice-pair-token': conn.token },
    })
    .catch(() => undefined)
  await poll($)
}

async function endSent($: EngineInterface): Promise<void> {
  S.sent = false
  await update($, sentAtom, () => false)
}

async function poll($: EngineInterface): Promise<void> {
  const conn = S.conn
  if (!conn || S.inFlight) return
  S.inFlight = true
  let next: Live
  try {
    const res = await $.http.fetch(`http://127.0.0.1:${conn.port}/status`, {
      headers: { 'x-voice-pair-token': conn.token },
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const s = JSON.parse(res.text) as Record<string, unknown>
    S.fails = 0
    S.level = typeof s.level === 'number' ? s.level : 0
    S.bands = Array.isArray(s.bands) ? s.bands.filter((b): b is number => typeof b === 'number') : []
    next = { phase: phaseOf(s), muted: s.muted === true, heardAt: Number(s.heardAt) || 0 }
  } catch {
    S.inFlight = false
    if (++S.fails < 10) return // a slow moment; keep showing what we had
    S.level = 0
    S.bands = []
    next = { ...S.live, phase: 'unreachable' }
  }
  S.inFlight = false
  const primed = S.polled // the first answer only sets the scene: no flash for an old transcript
  S.polled = true
  if (sameLive(S.live, next)) return
  const before = S.live
  S.live = next
  await update($, liveAtom, () => next)
  if (primed && next.heardAt > before.heardAt) {
    S.sent = true
    await update($, sentAtom, () => true)
    $.clock.after(SENT_MS, () => endSent($))
  }
  if (before.phase === 'speaking' && next.phase !== 'speaking') {
    S.saying = ''
    await update($, sayingAtom, () => '')
  }
}

async function tick($: EngineInterface): Promise<void> {
  S.frameNo++
  const { conn, bandId, wave } = S
  if (!conn || !bandId || S.collapsed) return
  S.shownLevel += (S.level - S.shownLevel) * (S.level > S.shownLevel ? 0.5 : 0.2)
  const mode = modeOf(S.live, S.sent, S.working)
  const t = seconds(S.frameNo)
  if (!S.full) {
    S.orb.step(mode, S.bands, S.shownLevel, FRAME_MS / 1000)
    await $.ui.blit({ requestId: bandId, key: 'orb', cells: S.orb.cells() }).catch(() => undefined)
    return
  }
  if (!wave) return
  wave.step(mode, t, S.bands, S.shownLevel, FRAME_MS / 1000)
  const hint = hintFor(mode, S.live, S.saying)
  const up = since(mode, hint.text)
  const blit = (key: string, cells: string) => $.ui.blit({ requestId: bandId, key, cells }).catch(() => undefined)
  await Promise.all([
    blit('wave', wave.cells(mode)),
    blit('title', titleCells(mode, t, up.mode, S.shownLevel)),
    blit('hint', hintCells(mode, hint.text, t, up.hint, S.hintCols, hint.spoken)),
  ])
}

async function noteSpeech($: EngineInterface, text: string): Promise<void> {
  const clean = text.replace(/\s+/g, ' ').trim()
  S.saying = clean.length > SAYING_CHARS ? `${clean.slice(0, SAYING_CHARS - 1)}…` : clean
  await update($, sayingAtom, () => S.saying)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const port = await $.env.get('VOICE_PAIR_PORT')
    const token = await $.env.get('VOICE_PAIR_TOKEN')
    if (!port || !token) return result // not a voice-pair session: stay out of the way
    S.conn = { port, token }
    S.full = (await $.env.get('VOICE_PAIR_BAND')) === 'full'
    $.ui.invalidate('ui.render') // the band may have been drawn (as nothing) before this ran
    $.clock.every(POLL_MS, () => poll($))
    $.clock.every(FRAME_MS, () => tick($))
    return result
  })

  // Remember what Claude asked to say, to show it while it plays.
  on('tool.call', async ($, e, next) => {
    const text = (e as { text?: unknown }).text
    if (S.conn && /voice-pair__speak$/.test(e.tool) && typeof text === 'string') await noteSpeech($, text)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!S.conn || e.props.hasSurvey) return next(e)
    const shown = await read($, liveAtom)
    const saying = await read($, sayingAtom)
    const isSent = await read($, sentAtom)
    S.working = e.props.isWorking
    S.collapsed = e.props.isCollapsed
    S.bandId = e.requestId

    const mode = modeOf(shown, isSent, S.working)

    if (!S.full) {
      // Just the orb, in the band's right-hand corner, above the prompt.
      if (e.surface !== 'terminal') {
        const { Box, Text } = $.ui.resolve(e)
        return (
          <Box flexDirection="row" justifyContent="flex-end">
            <Text color={accent(mode)}>●</Text>
          </Box>
        )
      }
      const { Box, Raster } = $.ui.resolve(e)
      return (
        <Box flexDirection="row" justifyContent="flex-end">
          <Raster key="orb" columns={ORB_COLS} rows={ORB_ROWS} cells={S.orb.cells()} />
        </Box>
      )
    }
    const bars = Math.max(10, Math.min(24, Math.floor((e.props.bodyColumns * 0.42) / 2)))
    if (!S.wave || S.wave.bars !== bars) S.wave = new Equalizer(bars, ROWS)
    const wave = S.wave

    const color = accent(mode)
    const hint = hintFor(mode, shown, saying)
    const t = seconds(S.frameNo)
    const up = since(mode, hint.text)
    // Room for the hint: the band less the bars, the gaps and the buttons.
    S.hintCols = Math.max(12, e.props.bodyColumns - wave.columns - 4 - 20)

    const { Box, Text, Button } = $.ui.resolve(e)
    let eq
    let words
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      eq = <Raster key="wave" columns={wave.columns} rows={ROWS} cells={wave.cells(mode)} />
      words = (
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Raster key="title" columns={TITLE_COLS} rows={1} cells={titleCells(mode, t, up.mode, S.shownLevel)} />
          <Raster key="hint" columns={S.hintCols} rows={1} cells={hintCells(mode, hint.text, t, up.hint, S.hintCols, hint.spoken)} />
        </Box>
      )
    } else {
      eq = (
        <Box flexDirection="column">
          {wave.text().map(line => (
            <Text color={color}>{line}</Text>
          ))}
        </Box>
      )
      words = (
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text color={color} bold wrap="truncate">
            {ICON[mode]} {TITLE[mode]}
          </Text>
          <Text dimColor wrap="truncate">
            {hint.text || ' '}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" gap={2} alignItems="center">
        {eq}
        {words}
        <Box flexDirection="row" gap={1}>
          {mode === 'speaking' && <Button key="stop" hotkey="s" label="Stop" onPress={() => control($, 'stop')} />}
          {shown.muted ? (
            <Button key="unmute" hotkey="u" label="Unmute" onPress={() => control($, 'unmute')} />
          ) : (
            <Button key="mute" hotkey="m" label="Mute" onPress={() => control($, 'mute')} />
          )}
        </Box>
      </Box>
    )
  })
}
