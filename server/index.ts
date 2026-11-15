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
import { Sidecar, log, said, type SidecarEvent } from "./sidecar.ts";
import { VoiceState, type HookEvent } from "./state.ts";

const AUDIO_DIR = join(import.meta.dir, "..", "audio");
const PORT = Number(process.env.VOICE_PAIR_PORT ?? 7788);

const INSTRUCTIONS = `You are pair programming with the user by voice. They talk; you hear them through this channel.

Inbound: <channel source="voice-pair" kind="speech"> carries a live transcript of the user speaking. Treat it exactly like a message they typed. It comes from local speech recognition, so technical words may be misheard ("middle way" = middleware, "jason" = JSON); infer the intended term from the codebase. If a transcript is ambiguous in a way that matters, ask a short spoken question instead of guessing.

Outbound: the user is listening, maybe not looking at the screen. Use the speak tool to talk to them:
- Before starting work that takes more than a few seconds, speak a one-line acknowledgment of what you're about to do.
- At real milestones (found the cause, tests failing/passing, need a decision), speak one short sentence.
- At the end of a turn, speak a brief summary of the outcome, and the question if you need an answer.
- A quick answer or small request gets exactly one speak call: the answer itself. Don't narrate that you spoke.
Spoken text must sound like a colleague talking: 1-3 short sentences, plain words, no markdown, no code, no full file paths or long identifiers (say "the auth middleware", not a path). Never read out diffs, tables or command output. Keep all detail (code, diffs, paths, lists) in your normal chat text as usual; speech is the summary, chat is the record.
If the user asks you to stop listening or mute, call set_listening with listening=false. Don't call speak for turns that came from typed input unless the user asked you to talk.`;

const state = new VoiceState();

const mcp = new Server(
  { name: "voice-pair", version: "0.2.0" },
  {
    capabilities: { experimental: { "claude/channel": {} }, tools: {} },
    instructions: INSTRUCTIONS,
  },
);

// VOICE_PAIR_SIDECAR replaces the audio process command (space-separated). Used by the tests to run
// a fake sidecar; also handy for trying another Python.
const sidecarCmd = process.env.VOICE_PAIR_SIDECAR?.trim().split(/\s+/);
const sidecar = new Sidecar(AUDIO_DIR, onSidecarEvent, sidecarCmd);

function speak(text: string, summarize = false): boolean {
  return sidecar.send({ cmd: "speak", text, summarize });
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
        "Say something out loud to the user (text-to-speech on their machine). Returns immediately; speech plays in the background. Use 1-3 short plain sentences, no markdown or code.",
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
    { name: "voice-pair", version: "0.2.0" },
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
