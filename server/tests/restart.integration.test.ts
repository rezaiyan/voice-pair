// If the audio process crashes and comes back, a mic the user muted must stay muted.
import { expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("should re-mute the microphone after the audio process restarts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "voice-pair-restart-"));
  const fakeLog = join(dir, "commands.jsonl");
  const client = new Client({ name: "test-host", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: "bun",
      args: [join(import.meta.dir, "..", "index.ts")],
      env: {
        ...(process.env as Record<string, string>),
        VOICE_PAIR_SESSION: join(import.meta.dir, "..", ".."),
        VOICE_PAIR_TOKEN: "t",
        VOICE_PAIR_PORT: String(19000 + Math.floor(Math.random() * 900)),
        VOICE_PAIR_SIDECAR: `bun ${join(import.meta.dir, "fake-sidecar.ts")}`,
        VOICE_PAIR_CACHE: dir,
        FAKE_LOG: fakeLog,
        FAKE_CRASH_ONCE: join(dir, "crashed"),
      },
      stderr: "ignore",
    }),
  );
  await client.callTool({ name: "set_listening", arguments: { listening: false } });
  // First mute kills the fake; the server restarts it after ~2s and must mute it again.
  const mutes = () =>
    existsSync(fakeLog)
      ? readFileSync(fakeLog, "utf8").split("\n").filter((l) => l.includes('"mute"')).length
      : 0;
  const end = Date.now() + 8000;
  while (mutes() < 2 && Date.now() < end) await Bun.sleep(50);
  expect(mutes()).toBe(2);
  await client.close();
}, 15000);
