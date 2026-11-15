// Conversation state: decides when a finished turn should be read aloud.
//
// "Voice mode" is on while your last delivered input was speech and off once you type. In voice mode,
// a turn that ended without Claude calling the speak tool gets a spoken summary of its final
// message (from the Stop hook), so a voice question never ends in silence.

import type { Detail } from "./instructions.ts";

export type HookEvent = Record<string, unknown>;

export class VoiceState {
  constructor(public detail: Detail = "brief") {}

  voiceMode = false;
  spokeInTurn = false;
  private recent: string[] = [];
  /** A turn is running (prompt submitted, Stop not yet seen). */
  private busy = false;
  /** Speech heard during a turn: Claude Code delivers it when that turn ends. */
  private pendingSpeech = false;

  onTranscript(text: string): void {
    this.recent.push(normalize(text));
    if (this.recent.length > 20) this.recent.shift();
    if (this.busy) this.pendingSpeech = true;
    else this.voiceMode = true;
  }

  onSpeak(): void {
    this.spokeInTurn = true;
  }

  /** UserPromptSubmit: typing switches voice mode off; prompts that came from the channel don't. */
  onUserPrompt(prompt: string): void {
    this.busy = true;
    if (prompt.includes("<channel") || this.recent.includes(normalize(prompt))) {
      this.voiceMode = true;
      this.pendingSpeech = false;
    } else {
      this.voiceMode = false;
    }
  }

  /** Stop: returns text to speak as a fallback, or null. Always closes the turn. */
  onTurnEnd(lastAssistantMessage: string | undefined): string | null {
    const speak =
      this.voiceMode && !this.spokeInTurn && !!lastAssistantMessage?.trim();
    this.spokeInTurn = false;
    this.busy = false;
    if (this.pendingSpeech) {
      this.voiceMode = true; // the queued speech is delivered next
      this.pendingSpeech = false;
    }
    return speak ? lastAssistantMessage!.trim() : null;
  }

  /** Notification: say permission prompts out loud while in voice mode (you may not be looking). */
  onNotification(ev: HookEvent): string | null {
    if (!this.voiceMode) return null;
    if (ev.notification_type !== "permission_prompt") return null;
    const msg =
      typeof ev.message === "string" && ev.message.trim()
        ? ev.message.trim()
        : "Claude needs your permission";
    return `${msg}. Check the terminal.`;
  }
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
