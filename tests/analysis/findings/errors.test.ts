import { describe, expect, it } from "vitest";
import { day, sessionsOverDays, shell, tool } from "../factory.js";
import { findings } from "./helpers.js";

describe("permission_prompt_load", () => {
  it("flags tool calls that keep getting blocked", () => {
    const sessions = sessionsOverDays(4, (index) => ({
      toolCalls: [
        shell("rm -rf dist", "permission_denied", day(index, 1)),
        shell("git push", "user_rejected", day(index, 2)),
        shell("git push", "user_rejected", day(index, 3)),
        tool("read", { timestamp: day(index, 4) }),
      ],
    }));
    const result = findings("permission_prompt_load", sessions);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("permission_prompt_load:claude-code");
    expect(result[0]!.severity).toBe("high");
    expect(result[0]!.suggestion?.url).toMatch(/^https:\/\//);
  });

  it("stays quiet on the odd refusal", () => {
    const sessions = sessionsOverDays(10, (index) => (index === 0 ? { toolCalls: [shell("git push", "user_rejected", day(0, 1))] } : {}));
    expect(findings("permission_prompt_load", sessions)).toEqual([]);
  });

  it("stays quiet when refusals are a tiny share of a lot of work", () => {
    const sessions = sessionsOverDays(4, (index) => ({
      toolCalls: [
        ...[1, 2, 3].map((minute) => shell("git push --force", "permission_denied", day(index, minute))),
        ...Array.from({ length: 400 }, (_, n) => tool("read", { timestamp: day(index, 5 + n / 100) })),
      ],
    }));
    expect(findings("permission_prompt_load", sessions)).toEqual([]);
  });
});

describe("tool_error_hotspot", () => {
  it("flags a tool that fails often and suggests a fix for its main error", () => {
    const sessions = sessionsOverDays(4, (index) => ({
      toolCalls: Array.from({ length: 8 }, (_, n) => tool("edit", { timestamp: day(index, n), ...(n < 3 ? { error: "edit_mismatch" as const } : {}) })),
    }));
    const result = findings("tool_error_hotspot", sessions);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("tool_error_hotspot:Edit");
    expect(result[0]!.metric?.value).toBe(37.5);
    expect(result[0]!.suggestion?.title).toBe("Re-read before editing");
  });

  it("ignores failing shell commands, which are mostly failing programs", () => {
    const sessions = sessionsOverDays(4, (index) => ({ toolCalls: Array.from({ length: 8 }, (_, n) => shell(`node script-${n}.js`, "command_failed", day(index, n))) }));
    expect(findings("tool_error_hotspot", sessions)).toEqual([]);
  });

  it("stays quiet on a normal error rate", () => {
    const sessions = sessionsOverDays(10, (index) => ({
      toolCalls: Array.from({ length: 10 }, (_, n) => tool("read", { timestamp: day(index, n), ...(n === 0 ? { error: "file_not_found" as const } : {}) })),
    }));
    expect(findings("tool_error_hotspot", sessions)).toEqual([]);
  });
});
