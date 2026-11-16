/** What the voice-pair server reports, as the band shows it. */
export type Phase =
  | 'unreachable'
  | 'off'
  | 'muted'
  | 'listening'
  | 'hearing'
  | 'transcribing'
  | 'speaking'

export type Live = {
  phase: Phase
  muted: boolean
  /** When the last transcript was sent to Claude (ms since epoch), 0 before any. */
  heardAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'voice-pair-band': {
      live: Live
      /** What Claude last asked to say out loud (the speak tool's text). */
      saying: string
      /** True for a moment after a transcript was sent. */
      sent: boolean
    }
  }
}
