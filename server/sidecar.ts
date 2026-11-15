// Spawns and supervises the Python audio sidecar; JSON lines over stdin/stdout.

import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Subprocess } from "bun";

export type SidecarEvent =
  | { event: "ready"; tts: string; muted: boolean; barge_in: boolean }
  | { event: "hearing" }
  | { event: "transcript"; text: string; stt_ms: number; audio_ms: number }
  | { event: "dropped"; reason: string; text?: string }
  | { event: "speaking"; value: boolean }
  | { event: "muted"; value: boolean }
  | { event: "error"; message: string; fatal?: boolean };

export type SidecarCommand =
  | { cmd: "speak"; text: string; summarize?: boolean }
  | { cmd: "stop" }
  | { cmd: "mute" }
  | { cmd: "unmute" }
  | { cmd: "shutdown" };

const LOG_FILE = join(
  process.env.VOICE_PAIR_CACHE ?? join(homedir(), ".cache", "voice-pair"),
  "voice-pair.log",
);

// What you say is private: transcripts are written to the log only when explicitly asked for.
const LOG_TRANSCRIPTS = process.env.VOICE_PAIR_LOG_TRANSCRIPTS === "1";
const LOG_MAX_BYTES = 1 << 20; // then rotate to voice-pair.log.1 (one old file kept)
let logChecked = false;

/** The spoken text itself, or a placeholder unless VOICE_PAIR_LOG_TRANSCRIPTS=1. */
export function said(text: string): string {
  return LOG_TRANSCRIPTS ? text : `[${text.length} chars]`;
}

export function log(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}\n`;
  process.stderr.write(`[voice-pair] ${msg}\n`);
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true, mode: 0o700 });
    try {
      if (statSync(LOG_FILE).size > LOG_MAX_BYTES)
        renameSync(LOG_FILE, `${LOG_FILE}.1`);
    } catch {}
    if (!logChecked) {
      // A log left by an earlier run may be readable by others: tighten it once per process.
      logChecked = true;
      try {
        chmodSync(LOG_FILE, 0o600);
      } catch {}
    }
    appendFileSync(LOG_FILE, line, { mode: 0o600 });
  } catch {}
}

export class Sidecar {
  ready = false;
  speaking = false;
  muted = false;
  /** What the user asked for; re-applied when a restarted sidecar comes up with a different state. */
  private wantMuted = process.env.VOICE_PAIR_START_MUTED === "1";
  private proc: Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private restarts = 0;
  private stopping = false;

  constructor(
    private readonly audioDir: string,
    private readonly onEvent: (ev: SidecarEvent) => void | Promise<void>,
    private readonly argv: string[] = [
      join(audioDir, ".venv", "bin", "python"),
      "sidecar.py",
    ],
  ) {}

  start(): void {
    this.ready = false;
    const proc = Bun.spawn(this.argv, {
      cwd: this.audioDir,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    this.proc = proc;
    log(`sidecar started pid=${proc.pid}`);
    void this.pump(proc.stdout, (line) => this.handleLine(line));
    void this.pump(proc.stderr, (line) => log(`audio: ${line}`));
    void proc.exited.then((code) => {
      this.ready = false;
      this.speaking = false;
      if (this.stopping) return;
      log(`sidecar exited code=${code}`);
      if (this.restarts < 3) {
        this.restarts++;
        setTimeout(() => this.start(), 2000);
      } else {
        log("sidecar keeps failing; giving up (see log)");
      }
    });
  }

  send(cmd: SidecarCommand): boolean {
    if (cmd.cmd === "mute" || cmd.cmd === "unmute")
      this.wantMuted = cmd.cmd === "mute";
    if (!this.proc || this.proc.exitCode !== null) return false;
    this.proc.stdin.write(JSON.stringify(cmd) + "\n");
    this.proc.stdin.flush();
    return true;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (!this.proc) return;
    this.send({ cmd: "shutdown" });
    this.proc.stdin.end();
    const timer = setTimeout(() => this.proc?.kill(), 3000);
    await this.proc.exited;
    clearTimeout(timer);
  }

  private handleLine(line: string): void {
    let ev: SidecarEvent;
    try {
      ev = JSON.parse(line);
    } catch {
      log(`audio (non-json): ${line}`);
      return;
    }
    if (ev.event === "ready") {
      this.ready = true;
      this.restarts = 0;
      this.muted = ev.muted;
      if (ev.muted !== this.wantMuted)
        this.send({ cmd: this.wantMuted ? "mute" : "unmute" });
    } else if (ev.event === "speaking") this.speaking = ev.value;
    else if (ev.event === "muted") this.muted = ev.value;
    Promise.resolve()
      .then(() => this.onEvent(ev))
      .catch((e) => log(`event handler failed (${ev.event}): ${e}`));
  }

  private async pump(
    stream: ReadableStream<Uint8Array>,
    onLine: (l: string) => void,
  ): Promise<void> {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of stream) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) onLine(line);
      }
    }
  }
}
