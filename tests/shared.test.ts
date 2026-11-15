import { describe, expect, it } from "vitest";
import { activeMinutes, clean, languageForPath, redact } from "../src/sources/shared.js";

describe("shared source helpers", () => {
  it("redacts credentials a person may have pasted into a prompt", () => {
    const text = redact("export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwx and Bearer abcdefghijklmnopqrstuvwxyz");
    expect(text).not.toContain("ghp_");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("caps prompt length after redaction", () => {
    expect(clean("a".repeat(50), 10)).toHaveLength(10);
  });

  it("names languages from file paths", () => {
    expect(languageForPath("/repo/src/a.tsx")).toBe("TypeScript");
    expect(languageForPath("/repo/Makefile")).toBeNull();
  });

  it("does not count idle gaps as active time", () => {
    const minutes = activeMinutes(["2026-01-01T10:00:00Z", "2026-01-01T10:05:00Z", "2026-01-01T12:00:00Z", "2026-01-01T12:02:00Z"]);
    expect(minutes).toBe(7);
  });
});
