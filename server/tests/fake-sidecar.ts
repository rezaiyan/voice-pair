// Stand-in for the Python audio sidecar: announces ready (unmuted, like a fresh start), "hears" one
// utterance, and appends every command it receives to $FAKE_LOG as a JSON line.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

const logPath = process.env.FAKE_LOG!;
const out = (o: object) => process.stdout.write(JSON.stringify(o) + "\n");

out({ event: "ready", tts: "fake", muted: false, barge_in: false });
setTimeout(
  () =>
    out({
      event: "transcript",
      text: "run the unit tests",
      stt_ms: 12,
      audio_ms: 1500,
    }),
  300,
);

let buf = "";
for await (const chunk of Bun.stdin.stream()) {
  buf += new TextDecoder().decode(chunk);
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    appendFileSync(logPath, line + "\n");
    const msg = JSON.parse(line);
    if (msg.cmd === "mute" || msg.cmd === "unmute")
      out({ event: "muted", value: msg.cmd === "mute" });
    // FAKE_CRASH_ONCE=<marker file>: die right after the first mute, like a real crash would.
    const marker = process.env.FAKE_CRASH_ONCE;
    if (msg.cmd === "mute" && marker && !existsSync(marker)) {
      writeFileSync(marker, "");
      process.exit(1);
    }
    if (msg.cmd === "shutdown") process.exit(0);
  }
}
