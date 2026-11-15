#!/usr/bin/env bun
// Hook shim: forwards the hook's stdin JSON to the running voice-pair server.
// Usage (from hook settings): bun forward.ts stop|prompt|notification
// Always exits 0 quickly and silently, so it can never block or break the session.

const event = process.argv[2];
const port = process.env.VOICE_PAIR_PORT ?? "7788";
const token = process.env.VOICE_PAIR_TOKEN ?? "";
if (token && event && ["stop", "prompt", "notification"].includes(event)) {
  try {
    const body = await Bun.stdin.text();
    await fetch(`http://127.0.0.1:${port}/hook/${event}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-voice-pair-token": token,
      },
      body,
      signal: AbortSignal.timeout(1500),
    });
  } catch {}
}
process.exit(0);
