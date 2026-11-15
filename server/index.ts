#!/usr/bin/env bun
// voice-pair: a Claude Code channel that turns your speech into messages in the open session
// and speaks Claude's replies back. Start sessions with bin/voice-pair: it registers this server
// for the project, passes the dev-channel flag, and adds the hooks for that one session.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { rejectRequest } from "./auth.ts";
import { instructions, parseDetail, SUMMARY_CHARS } from "./instructions.ts";
import { Sidecar, log, said, type SidecarEvent } from "./sidecar.ts";
import { VoiceState, type HookEvent } from "./state.ts";

const AUDIO_DIR = join(import.meta.dir, "..", "audio");
const PORT = Number(process.env.VOICE_PAIR_PORT ?? 7788);

const state = new VoiceState(parseDetail(process.env.VOICE_PAIR_DETAIL));

const mcp = new Server(
  { name: "voice-pair", version: "0.3.0" },
  {
    capabilities: { experimental: { "claude/channel": {} }, tools: {} },
    instructions: instructions(state.detail),
  },
);

// VOICE_PAIR_SIDECAR replaces the audio process command (space-separated). Used by the tests to run
// a fake sidecar; also handy for trying another Python.
const sidecarCmd = process.env.VOICE_PAIR_SIDECAR?.trim().split(/\s+/);
const sidecar = new Sidecar(AUDIO_DIR, onSidecarEvent, sidecarCmd);

function speak(text: string, summarize = false): boolean {
  return sidecar.send(
    summarize
      ? { cmd: "speak", text, summarize, max_chars: SUMMARY_CHARS[state.detail] }
      : { cmd: "speak", text },
  );
}

async function onSidecarEvent(ev: SidecarEvent): Promise<void> {
  switch (ev.event) {
    case "ready":
      log(
        `audio ready (tts=${ev.tts}, muted=${ev.muted}, barge_in=${ev.barge_in})`,
      );
      break;
    case "transcript":
      log(`heard (${ev.audio_ms}ms audio, stt ${ev.stt_ms}ms): ${said(ev.text)}`);
      state.onTranscript(ev.text);
      await mcp.notification({
        method: "notifications/claude/channel",
        params: { content: ev.text, meta: { kind: "speech" } },
      });
      break;
    case "error":
      log(`audio error: ${ev.message}`);
      break;
    case "dropped":
      if (ev.text) log(`dropped (${ev.reason}): ${said(ev.text)}`);
      break;
  }
}

// ---- tools ---------------------------------------------------------------------------------
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "speak",
      // Load upfront: Claude must be able to talk without a tool-search round trip.
      _meta: { "anthropic/alwaysLoad": true },
      description:
        "Say something out loud to the user (text-to-speech on their machine). Returns immediately; speech plays in the background and calls are queued in order. Plain spoken language, no markdown or code. Length follows the current detail level: 1-3 short sentences in brief mode, 2-5 sentences per call in full mode.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "What to say, as natural spoken language",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "set_voice_detail",
      _meta: { "anthropic/alwaysLoad": true },
      description:
        'Change how much you explain out loud. "brief": short spoken summaries, details stay on screen. "full": explain everything by voice (the user may not look at the screen). Use when the user asks for more or less spoken detail.',
      inputSchema: {
        type: "object",
        properties: { level: { type: "string", enum: ["brief", "full"] } },
        required: ["level"],
      },
    },
    {
      name: "set_listening",
      _meta: { "anthropic/alwaysLoad": true },
      description:
        "Turn the microphone on or off (mute). Use when the user asks you to stop or resume listening.",
      inputSchema: {
        type: "object",
        properties: { listening: { type: "boolean" } },
        required: ["listening"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  if (req.params.name === "speak") {
    const text = String(args.text ?? "").trim();
    if (!text)
      return {
        content: [{ type: "text", text: "nothing to say" }],
        isError: true,
      };
    if (!speak(text))
      return {
        content: [
          { type: "text", text: "audio is not running; speech skipped" },
        ],
        isError: true,
      };
    state.onSpeak();
    return { content: [{ type: "text", text: "speaking" }] };
  }
  if (req.params.name === "set_voice_detail") {
    const level = args.level;
    if (level !== "brief" && level !== "full")
      return {
        content: [{ type: "text", text: 'level must be "brief" or "full"' }],
        isError: true,
      };
    state.detail = level;
    log(`voice detail: ${level}`);
    return {
      content: [
        {
          type: "text",
          text:
            level === "full"
              ? "Full mode on: explain everything by voice from now on."
              : "Brief mode on: keep speech short; details stay on screen.",
        },
      ],
    };
  }
  if (req.params.name === "set_listening") {
    const on = args.listening === true;
    if (!sidecar.send({ cmd: on ? "unmute" : "mute" }))
      return {
        content: [{ type: "text", text: "audio is not running" }],
        isError: true,
      };
    return {
      content: [
        { type: "text", text: on ? "microphone on" : "microphone muted" },
      ],
    };
  }
  throw new Error(`unknown tool: ${req.params.name}`);
});

// ---- local control + hook endpoint ---------------------------------------------------------
// Deliberately has NO route that injects text into the session: only the microphone does that.
async function hookBody(req: Request): Promise<HookEvent> {
  try {
    return (await req.json()) as HookEvent;
  } catch {
    return {};
  }
}

function startHttp(port: number, token: string) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const denied = rejectRequest(req, token);
      if (denied) return denied;
      const path = new URL(req.url).pathname;
      if (req.method === "GET" && path === "/status") {
        return Response.json({
          ready: sidecar.ready,
          speaking: sidecar.speaking,
          muted: sidecar.muted,
          voiceMode: state.voiceMode,
          detail: state.detail,
        });
      }
      if (req.method !== "POST")
        return new Response("not found", { status: 404 });
      switch (path) {
        case "/hook/stop": {
          const ev = await hookBody(req);
          const text = state.onTurnEnd(
            ev.last_assistant_message as string | undefined,
          );
          const spoken = !!text && speak(text, true);
          return new Response(spoken ? "spoken" : "skipped");
        }
        case "/hook/prompt": {
          const ev = await hookBody(req);
          state.onUserPrompt(String(ev.prompt ?? ""));
          return new Response("ok");
        }
        case "/hook/notification": {
          const text = state.onNotification(await hookBody(req));
          const spoken = !!text && speak(text);
          return new Response(spoken ? "spoken" : "skipped");
        }
        case "/mute":
        case "/unmute":
        case "/stop":
          return sidecar.send({ cmd: path.slice(1) as "mute" | "unmute" | "stop" })
            ? new Response("ok")
            : new Response("audio is not running", { status: 503 });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

// ---- main ----------------------------------------------------------------------------------
// bin/voice-pair sets VOICE_PAIR_SESSION to the install folder it belongs to. Only the server from
// that same folder comes alive, so a git checkout and the plugin can both be installed without two
// servers opening the microphone.
const ROOT = realpathSync(join(import.meta.dir, ".."));
const activeRoot = process.env.VOICE_PAIR_SESSION;
const isActive =
  !!activeRoot && existsSync(activeRoot) && realpathSync(activeRoot) === ROOT;

if (import.meta.main && !isActive) {
  // Not started by this install's bin/voice-pair (plain `claude`, or another install's session):
  // stay an inert MCP server (no channel, no tools, no mic) until Claude Code exits.
  const idle = new Server(
    { name: "voice-pair", version: "0.3.0" },
    { capabilities: {} },
  );
  await idle.connect(new StdioServerTransport());
  process.stdin.on("close", () => process.exit(0));
} else if (import.meta.main) {
  await mcp.connect(new StdioServerTransport());
  const token = process.env.VOICE_PAIR_TOKEN ?? "";
  if (!token) {
    log(
      "no VOICE_PAIR_TOKEN (not started by bin/voice-pair?); control port disabled",
    );
  } else {
    try {
      startHttp(PORT, token);
    } catch (e) {
      log(
        `control port ${PORT} unavailable (${e}); hooks fallback disabled. Is another voice-pair session running?`,
      );
    }
  }
  sidecar.start();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await sidecar.stop();
    process.exit(0);
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
