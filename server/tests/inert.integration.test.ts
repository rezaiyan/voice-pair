// A project with voice-pair registered must behave normally when Claude Code is started
// without the launcher: the server connects but offers no channel, no tools, and spawns no audio.
import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("voice-pair outside a voice session", () => {
  it("should be inert without VOICE_PAIR_SESSION", async () => {
    const dir = mkdtempSync(join(tmpdir(), "voice-pair-inert-"));
    const marker = join(dir, "sidecar-ran");
    const env = { ...(process.env as Record<string, string>) };
    delete env.VOICE_PAIR_SESSION;
    const client = new Client({ name: "test-host", version: "0" });
    await client.connect(
      new StdioClientTransport({
        command: "bun",
        args: [join(import.meta.dir, "..", "index.ts")],
        env: {
          ...env,
          VOICE_PAIR_SIDECAR: `touch ${marker}`,
          VOICE_PAIR_PORT: "1",
        },
        stderr: "ignore",
      }),
    );
    expect(client.getServerCapabilities()?.experimental).toBeUndefined();
    expect(client.getServerCapabilities()?.tools).toBeUndefined();
    await Bun.sleep(300);
    expect(existsSync(marker)).toBe(false);
    await client.close();
  });
});

describe("voice-pair with two installs", () => {
  it("should stay inert when the session belongs to another install", async () => {
    const env = { ...(process.env as Record<string, string>) };
    const dir = mkdtempSync(join(tmpdir(), "voice-pair-other-"));
    const marker = join(dir, "sidecar-ran");
    const client = new Client({ name: "test-host", version: "0" });
    await client.connect(
      new StdioClientTransport({
        command: "bun",
        args: [join(import.meta.dir, "..", "index.ts")],
        env: {
          ...env,
          VOICE_PAIR_SESSION: dir, // some other voice-pair folder
          VOICE_PAIR_SIDECAR: `touch ${marker}`,
          VOICE_PAIR_PORT: "1",
        },
        stderr: "ignore",
      }),
    );
    expect(client.getServerCapabilities()?.experimental).toBeUndefined();
    await Bun.sleep(300);
    expect(existsSync(marker)).toBe(false);
    await client.close();
  });
});
