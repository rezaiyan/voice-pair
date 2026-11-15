import { describe, expect, it } from "bun:test";
import { VoiceState } from "../state.ts";

describe("VoiceState", () => {
  it("should speak the final message when a voice turn ends without a speak call", () => {
    const s = new VoiceState();
    s.onTranscript("run the tests");
    expect(s.onTurnEnd("All 12 tests pass.")).toBe("All 12 tests pass.");
  });

  it("should stay quiet when Claude already spoke during the turn", () => {
    const s = new VoiceState();
    s.onTranscript("run the tests");
    s.onSpeak();
    expect(s.onTurnEnd("All 12 tests pass.")).toBeNull();
  });

  it("should reset the spoke flag so the next turn falls back again", () => {
    const s = new VoiceState();
    s.onTranscript("a");
    s.onSpeak();
    s.onTurnEnd("x");
    expect(s.onTurnEnd("second turn")).toBe("second turn");
  });

  it("should stay quiet before any speech has been heard", () => {
    expect(new VoiceState().onTurnEnd("typed answer")).toBeNull();
  });

  it("should leave voice mode when the user types a prompt", () => {
    const s = new VoiceState();
    s.onTranscript("hello");
    s.onUserPrompt("fix the typo in README");
    expect(s.voiceMode).toBe(false);
    expect(s.onTurnEnd("Fixed.")).toBeNull();
  });

  it("should keep voice mode for prompts that came from the channel", () => {
    const s = new VoiceState();
    s.onTranscript("Open the  auth middleware");
    s.onUserPrompt("open the auth middleware");
    s.onUserPrompt('<channel source="voice-pair" kind="speech">hi</channel>');
    expect(s.voiceMode).toBe(true);
  });

  it("should ignore empty final messages", () => {
    const s = new VoiceState();
    s.onTranscript("hi");
    expect(s.onTurnEnd("   ")).toBeNull();
    expect(s.onTurnEnd(undefined)).toBeNull();
  });

  it("should announce permission prompts only in voice mode", () => {
    const s = new VoiceState();
    const ev = {
      notification_type: "permission_prompt",
      message: "Claude needs your permission to use Bash",
    };
    expect(s.onNotification(ev)).toBeNull();
    s.onTranscript("deploy it");
    expect(s.onNotification(ev)).toBe(
      "Claude needs your permission to use Bash. Check the terminal.",
    );
    expect(
      s.onNotification({
        notification_type: "idle_prompt",
        message: "waiting",
      }),
    ).toBeNull();
  });

  it("should not read a typed turn aloud when you spoke while it was running", () => {
    const s = new VoiceState();
    s.onUserPrompt("rename the variable"); // typed: turn starts
    s.onTranscript("also run the tests"); // heard mid-turn, delivered after it
    expect(s.onTurnEnd("Renamed it.")).toBeNull();
    expect(s.voiceMode).toBe(true);
    s.onUserPrompt('<channel source="voice-pair">also run the tests</channel>');
    expect(s.onTurnEnd("All tests pass.")).toBe("All tests pass.");
  });
});
