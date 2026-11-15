import { describe, expect, it } from "vitest";
import { day, sessionsOverDays, shell, tool } from "../factory.js";
import { findings } from "./helpers.js";

const untested = (index: number) => ({
  linesAdded: 120,
  linesRemoved: 30,
  toolCalls: [
    tool("edit", { timestamp: day(index, 1) }),
    tool("edit", { timestamp: day(index, 2) }),
    tool("edit", { timestamp: day(index, 3) }),
    shell("git commit -am wip", undefined, day(index, 4)),
  ],
});

describe("no_tests_before_done", () => {
  it("flags committed code changes with no check run, naming the check this project already uses", () => {
    const sessions = sessionsOverDays(6, (index) =>
      index < 4 ? untested(index) : { toolCalls: [shell("pnpm vitest run", undefined, day(index, 1)), shell("git commit -m ok", undefined, day(index, 2))] },
    );
    const result = findings("no_tests_before_done", sessions);
    expect(result).toHaveLength(1);
    expect(result[0]!.metric?.value).toBe(4);
    expect(result[0]!.suggestion?.instructionText).toContain("`pnpm vitest run`");
    expect(result[0]!.evidence[0]!.note).toContain("+120/-30");
  });

  it("stays quiet when the agent ran the tests before committing", () => {
    const sessions = sessionsOverDays(6, (index) => ({ ...untested(index), toolCalls: [...untested(index).toolCalls, shell("cargo test", undefined, day(index, 3))] }));
    expect(findings("no_tests_before_done", sessions)).toEqual([]);
  });

  it("stays quiet when only docs changed", () => {
    const sessions = sessionsOverDays(6, (index) => ({ ...untested(index), filesModified: ["/synthetic/project/README.md"] }));
    expect(findings("no_tests_before_done", sessions)).toEqual([]);
  });
});
