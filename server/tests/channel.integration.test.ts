// Runs the real channel server over stdio with the MCP client SDK and a fake audio sidecar,
// then drives it the way Claude Code and the hook shim would.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const PORT = String(17000 + Math.floor(Math.random() * 2000));
const TOKEN = "test-token-" + Math.random().toString(36).slice(2);
const auth = { "x-voice-pair-token": TOKEN };
const dir = mkdtempSync(join(tmpdir(), "voice-pair-test-"));
const fakeLog = join(dir, "commands.jsonl");

let client: Client;
const channelEvents: { content: string; meta?: Record<string, string> }[] = [];

const commands = () =>
  existsSync(fakeLog)
    ? readFileSync(fakeLog, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

async function until<T>(
  get: () => T | undefined | false,
  what: string,
  ms = 5000,
): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = get();
    if (v) return v;
    await Bun.sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const post = (path: string, body: object = {}) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  }).then((r) => r.text());

const status = () =>
  fetch(`http://127.0.0.1:${PORT}/status`, { headers: auth }).then((r) =>
    r.json(),
  );

const hookShim = async (event: string, payload: object) => {
  const p = Bun.spawn(["bun", join(ROOT, "hooks", "forward.ts"), event], {
    stdin: new Blob([JSON.stringify(payload)]),
    env: { ...process.env, VOICE_PAIR_PORT: PORT, VOICE_PAIR_TOKEN: TOKEN },
  });
  return p.exited;
};

beforeAll(async () => {
  client = new Client({ name: "test-host", version: "0" });
  client.fallbackNotificationHandler = async (n) => {
    if (n.method === "notifications/claude/channel")
      channelEvents.push(n.params as any);
  };
  await client.connect(
    new StdioClientTransport({
      command: "bun",
      args: [join(ROOT, "server", "index.ts")],
      env: {
        ...(process.env as Record<string, string>),
        VOICE_PAIR_PORT: PORT,
        VOICE_PAIR_SESSION: join(import.meta.dir, "..", ".."),
        VOICE_PAIR_TOKEN: TOKEN,
        VOICE_PAIR_SIDECAR: `bun ${join(import.meta.dir, "fake-sidecar.ts")}`,
        VOICE_PAIR_CACHE: dir,
        FAKE_LOG: fakeLog,
      },
      stderr: "ignore",
    }),
  );
});

afterAll(async () => {
  await client?.close();
});

describe("voice-pair channel server", () => {
  it("should declare itself a channel with instructions", () => {
    expect(
      client.getServerCapabilities()?.experimental?.["claude/channel"],
    ).toEqual({});
    expect(client.getInstructions()).toContain("speak tool");
  });

  it("should push heard speech into the session as a channel event", async () => {
    const ev = await until(() => channelEvents[0], "channel event");
    expect(ev.content).toBe("run the unit tests");
    expect(ev.meta).toEqual({ kind: "speech" });
  });

  it("should keep what you said out of the log, and the log private", async () => {
    await until(() => channelEvents[0], "channel event");
    const logFile = join(dir, "voice-pair.log");
    const text = await until(
      () => existsSync(logFile) && readFileSync(logFile, "utf8").includes("heard (") && readFileSync(logFile, "utf8"),
      "log line",
    );
    expect(text).not.toContain("run the unit tests");
    expect(text).toContain("[18 chars]");
    expect(statSync(logFile).mode & 0o777).toBe(0o600);
  });

  it("should expose speak and set_listening tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["set_listening", "speak"]);
  });

  it("should mark its tools to load upfront (not deferred behind tool search)", async () => {
    const { tools } = await client.listTools();
    for (const t of tools) expect(t._meta?.["anthropic/alwaysLoad"]).toBe(true);
  });

  it("should forward speak calls to the audio process", async () => {
    const res = await client.callTool({
      name: "speak",
      arguments: { text: "Running the tests now." },
    });
    expect(res.isError).toBeFalsy();
    await until(
      () =>
        commands().find(
          (c) => c.cmd === "speak" && c.text === "Running the tests now.",
        ),
      "speak cmd",
    );
  });

  it("should not read the final message when Claude already spoke this turn", async () => {
    expect(
      await post("/hook/stop", { last_assistant_message: "Done, all pass." }),
    ).toBe("skipped");
  });

  it("should read a summary when a voice turn ends silently", async () => {
    expect(
      await post("/hook/stop", { last_assistant_message: "Two tests failed." }),
    ).toBe("spoken");
    const cmd = await until(
      () => commands().find((c) => c.text === "Two tests failed."),
      "fallback speak",
    );
    expect(cmd.summarize).toBe(true);
  });

  it("should deliver Stop hook payloads through the hook shim", async () => {
    expect(
      await hookShim("stop", { last_assistant_message: "Shim path works." }),
    ).toBe(0);
    await until(
      () => commands().find((c) => c.text === "Shim path works."),
      "shim speak",
    );
  });

  it("should go quiet after the user types", async () => {
    await post("/hook/prompt", { prompt: "rename the variable" });
    expect(
      await post("/hook/stop", { last_assistant_message: "Renamed." }),
    ).toBe("skipped");
    expect(await status()).toMatchObject({ ready: true, voiceMode: false });
  });

  it("should mute the microphone via set_listening", async () => {
    await client.callTool({
      name: "set_listening",
      arguments: { listening: false },
    });
    await until(() => commands().find((c) => c.cmd === "mute"), "mute cmd");
    // The fake sidecar answers with a "muted" event; the server's status must reflect it.
    let muted = false;
    const end = Date.now() + 3000;
    while (!muted && Date.now() < end) {
      const s = await status();
      muted = (s as { muted?: boolean }).muted === true;
      if (!muted) await Bun.sleep(20);
    }
    expect(muted).toBe(true);
  });

  it("should refuse control requests without the session token", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/unmute`, { method: "POST" });
    expect(res.status).toBe(401);
    const wrong = await fetch(`http://127.0.0.1:${PORT}/status`, {
      headers: { "x-voice-pair-token": "nope" },
    });
    expect(wrong.status).toBe(401);
  });

  it("should refuse requests from a web page even with the token", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/hook/stop`, {
      method: "POST",
      headers: { ...auth, origin: "https://evil.example" },
      body: JSON.stringify({ last_assistant_message: "pwned" }),
    });
    expect(res.status).toBe(403);
    await Bun.sleep(200);
    expect(commands().find((c) => c.text === "pwned")).toBeUndefined();
  });

  it("should exit cleanly without a hook shim server (no throw, exit 0)", async () => {
    const p = Bun.spawn(["bun", join(ROOT, "hooks", "forward.ts"), "stop"], {
      stdin: new Blob(["{}"]),
      env: { ...process.env, VOICE_PAIR_PORT: "1" },
    });
    expect(await p.exited).toBe(0);
  });
});
