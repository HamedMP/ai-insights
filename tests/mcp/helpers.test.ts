import { describe, expect, it } from "vitest";
import { activityDigest, usageDigest, weekOf } from "../../src/mcp/digest.js";
import { fitTurns } from "../../src/mcp/excerpt.js";
import { spreadOrder, spreadPositions } from "../../src/mcp/select.js";
import type { TranscriptTurn } from "../../src/schema/types.js";
import { fakeBuildReport, makeSession } from "../store/fixtures.js";

describe("weekOf", () => {
  it("buckets days into the week starting Monday", () => {
    expect(weekOf("2026-11-16")).toBe("2026-11-16");
    expect(weekOf("2026-11-22")).toBe("2026-11-16");
    expect(weekOf("2026-11-15")).toBe("2026-11-09");
    expect(weekOf("not a day")).toBeNull();
  });
});

describe("spreadPositions", () => {
  it("visits newest, oldest, then the middle, and covers every position once", () => {
    const order = spreadPositions(20);
    expect(order.slice(0, 3)).toEqual([0, 19, 10]);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, index) => index));
    expect(spreadPositions(1)).toEqual([0]);
    expect(spreadPositions(0)).toEqual([]);
  });
});

describe("spreadOrder", () => {
  it("returns every session exactly once", () => {
    const sessions = [
      ...Array.from({ length: 7 }, (_, index) => makeSession({ id: `c${index}`, startTime: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z` })),
      ...Array.from({ length: 3 }, (_, index) => makeSession({ id: `x${index}`, harness: "codex", startTime: `2026-09-0${index + 1}T00:00:00Z` })),
    ];
    const order = spreadOrder(sessions);
    expect(order).toHaveLength(10);
    expect(new Set(order.map((session) => session.id)).size).toBe(10);
    expect(order.slice(0, 2).map((session) => session.harness).sort()).toEqual(["claude-code", "codex"]);
  });
});

describe("usageDigest", () => {
  it("keeps both rows when two harnesses report the same model name", () => {
    const report = fakeBuildReport()({ sessions: [], coverage: [] });
    const totals = { tokens: 10, input: 1, cachedInput: 1, cacheWrite: 1, output: 1, requests: 1, estimatedUsd: 1, unpriced: 0 };
    report.usage.models = [
      { ...totals, harness: "codex", model: "shared" },
      { ...totals, harness: "cursor", model: "shared" },
    ];
    expect(Object.keys(usageDigest(report.usage).models).sort()).toEqual(["shared (codex)", "shared (cursor)"]);
  });
});

describe("fitTurns", () => {
  const turn = (role: TranscriptTurn["role"], text: string, extra: Partial<TranscriptTurn> = {}): TranscriptTurn => ({ timestamp: "t", role, text, ...extra });

  it("leaves a small excerpt untouched", () => {
    const turns = [turn("user", "hi"), turn("assistant", "hello")];
    expect(fitTurns(turns, 4_000)).toEqual({ turns, omitted: 0 });
  });

  it("thins routine tool turns before touching what the person said", () => {
    const turns = [turn("user", "u".repeat(1_000)), ...Array.from({ length: 40 }, () => turn("tool", "t".repeat(500))), turn("assistant", "done")];
    const fitted = fitTurns(turns, 2_000);
    expect(fitted.turns[0]!.text).toBe("u".repeat(1_000));
    expect(fitted.turns.at(-1)!.text).toBe("done");
    expect(fitted.omitted).toBeGreaterThan(0);
    expect(fitted.turns.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(2_000);
  });
});

describe("activityDigest", () => {
  it("says how many worktrees were folded into a project, and stays a plain count otherwise", () => {
    const activity = fakeBuildReport()({ sessions: [], coverage: [] }).activity;
    activity.projects = [
      { projectPath: "/r/big-repo", sessions: 9, activeMinutes: 90, worktrees: 4 },
      { projectPath: "/r/small", sessions: 2, activeMinutes: 10 },
      { projectPath: "/r/single", sessions: 1, activeMinutes: 5, worktrees: 1 },
    ];
    expect(activityDigest(activity).projects).toEqual({ "r/big-repo": { sessions: 9, worktrees: 4 }, "r/small": 2, "r/single": 1 });
  });
});

describe("fitTurns with many important turns", () => {
  const turn = (role: TranscriptTurn["role"], text: string): TranscriptTurn => ({ timestamp: "t", role, text });

  it("pins the first prompt and samples the others instead of cutting every turn to a sliver", () => {
    const turns = [turn("user", "b".repeat(600)), ...Array.from({ length: 30 }, (_, index) => turn(index % 2 ? "user" : "assistant", "x".repeat(600)))];
    const fitted = fitTurns(turns, 2_400);
    expect(fitted.turns[0]!.text).toBe("b".repeat(600));
    expect(fitted.turns.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(2_400);
    for (const item of fitted.turns.slice(1)) expect(item.text.length).toBeGreaterThanOrEqual(160);
    expect(fitted.omitted).toBeGreaterThan(0);
  });

  it("counts per-turn overhead when asked, so a budget for JSON is not overrun", () => {
    const turns = Array.from({ length: 10 }, () => turn("user", "y".repeat(300)));
    const fitted = fitTurns(turns, 2_000, { overhead: () => 100 });
    expect(fitted.turns.reduce((sum, item) => sum + item.text.length + 100, 0)).toBeLessThanOrEqual(2_000);
  });
});
