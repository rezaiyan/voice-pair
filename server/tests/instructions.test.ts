import { describe, expect, it } from "bun:test";
import { instructions, parseDetail, SUMMARY_CHARS } from "../instructions.ts";

describe("voice instructions", () => {
  it("should default to brief and accept full in any case", () => {
    expect(parseDetail(undefined)).toBe("brief");
    expect(parseDetail("nonsense")).toBe("brief");
    expect(parseDetail(" FULL ")).toBe("full");
  });

  it("should state the starting level and describe both levels", () => {
    const full = instructions("full");
    expect(full).toContain("The session starts in FULL mode.");
    expect(full).toContain("BRIEF mode");
    expect(full).toContain("set_voice_detail");
    expect(instructions("brief")).toContain("The session starts in BRIEF mode.");
  });

  it("should allow longer fallback summaries in full mode", () => {
    expect(SUMMARY_CHARS.full).toBeGreaterThan(SUMMARY_CHARS.brief);
  });
});
