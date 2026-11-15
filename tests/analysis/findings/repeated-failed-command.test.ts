import { describe, expect, it } from "vitest";
import { normalizeCommand } from "../../../src/analysis/findings/commands.js";
import { day, session, sessionsOverDays, shell } from "../factory.js";
import { findings } from "./helpers.js";

describe("repeated_failed_command", () => {
  it("flags a command the agent keeps retrying unchanged", () => {
    const retries = (index: number) => [1, 2, 3, 4].map((minute) => shell("cd /repo && pnpm build 2>&1 | tail -20", "command_failed", day(index, minute)));
    const result = findings("repeated_failed_command", [session({ startTime: day(0), toolCalls: retries(0) }), session({ startTime: day(1), toolCalls: retries(1) })]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("repeated_failed_command:pnpm build");
    expect(result[0]!.metric?.value).toBe(8);
    expect(result[0]!.evidence[0]!.note).toContain("4 times in a row");
    expect(result[0]!.suggestion?.instructionText).toContain("pnpm build");
  });

  it("flags a command that fails in session after session", () => {
    const sessions = sessionsOverDays(4, (index) => ({ toolCalls: [shell("python manage.py migrate", "command_failed", day(index, 1))] }));
    const result = findings("repeated_failed_command", sessions);
    expect(result).toHaveLength(1);
    expect(result[0]!.evidence).toHaveLength(4);
  });

  it("stays quiet when tests fail now and then and are then fixed", () => {
    const sessions = sessionsOverDays(6, (index) => ({
      toolCalls: [shell("pnpm test", "command_failed", day(index, 1)), shell("pnpm test", undefined, day(index, 5)), shell("pnpm test", undefined, day(index, 9))],
    }));
    expect(findings("repeated_failed_command", sessions)).toEqual([]);
  });

  it("stays quiet on one short streak in one session", () => {
    const calls = [1, 2, 3].map((minute) => shell("make", "command_failed", day(0, minute)));
    expect(findings("repeated_failed_command", [session({ toolCalls: calls })])).toEqual([]);
  });

  it("treats the same command written differently as one", () => {
    expect(normalizeCommand("cd /a/b && CI=1 pnpm test 2>&1 | tail -n 50")).toBe("pnpm test");
    expect(normalizeCommand("  pnpm   test ")).toBe("pnpm test");
  });
});
