import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/analysis/index.js";
import { coverage, NOW, prompt, session, shell, tool } from "./factory.js";

const build = (sessions: ReturnType<typeof session>[], timeZone = "UTC") =>
  buildReport({ sessions, coverage: [coverage("claude-code", sessions.length)], now: NOW, timeZone });

describe("activity", () => {
  it("adds up the headline numbers across sessions", () => {
    const report = build([session(), session({ startTime: "2026-06-02T09:00:00Z", linesAdded: 10, gitCommits: 2 })]);
    const { activity } = report;
    expect(activity.sessions).toBe(2);
    expect(activity.userMessages).toBe(6);
    expect(activity.linesAdded).toBe(50);
    expect(activity.gitCommits).toBe(3);
    expect(activity.totalActiveMinutes).toBe(50);
    expect(activity.filesModified).toBe(2);
  });

  it("finds the longest run of consecutive active days", () => {
    const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-07", "2026-06-08"];
    const report = build(days.map((d) => session({ startTime: `${d}T09:00:00Z`, prompts: [prompt("x y z", `${d}T09:00:00Z`)], userMessageCount: 1 })));
    expect(report.activity.activeDays).toBe(5);
    expect(report.activity.longestStreakDays).toBe(3);
    expect(report.activity.daily).toHaveLength(8);
    expect(report.activity.daily.at(-1)?.day).toBe("2026-06-08");
  });

  it("places messages in local hours", () => {
    const report = build(
      [session({ startTime: "2026-06-01T15:00:00Z", prompts: [prompt("hello there friend", "2026-06-01T15:30:00Z")], userMessageCount: 1 })],
      "Asia/Tokyo",
    );
    expect(report.activity.hourHistogram).toHaveLength(24);
    expect(report.activity.hourHistogram[0]).toBe(1);
    expect(report.activity.daily[0]?.day).toBe("2026-06-02");
  });

  it("still counts messages the source did not keep the text of", () => {
    const report = build([session({ userMessageCount: 10 })]);
    expect(report.activity.hourHistogram.reduce((a, b) => a + b, 0)).toBe(10);
    expect(report.activity.daily.reduce((a, row) => a + row.userMessages, 0)).toBe(10);
  });

  it("counts tools, categories and error kinds", () => {
    const report = build([session({ toolCalls: [shell("ls"), shell("pnpm test", "command_failed"), tool("read"), tool("read", { error: "file_not_found" })] })]);
    expect(report.activity.tools).toEqual([
      { key: "Bash", count: 2 },
      { key: "Read", count: 2 },
    ]);
    expect(report.activity.toolErrors).toEqual([
      { key: "command_failed", count: 1 },
      { key: "file_not_found", count: 1 },
    ]);
  });

  it("buckets response times and reports the median", () => {
    const report = build([session({ userResponseTimesSec: [5, 20, 45, 120, 600, 3600] })]);
    expect(report.activity.responseTimeBuckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(report.activity.responseTimeBuckets.map((bucket) => bucket.key)).toEqual(["<10s", "10-30s", "30s-1m", "1-5m", "5-15m", ">15m"]);
    expect(report.activity.medianResponseTimeSec).toBe(82.5);
  });

  it("detects sessions running side by side, but not ones that merely follow each other", () => {
    const busy = (id: string, from: string, to: string) => {
      const calls = [];
      for (let ms = Date.parse(from); ms <= Date.parse(to); ms += 5 * 60_000) calls.push(tool("read", { timestamp: new Date(ms).toISOString() }));
      return session({ id, startTime: from, endTime: to, prompts: [], requests: [], toolCalls: calls });
    };
    const a = busy("a", "2026-06-01T09:00:00.000Z", "2026-06-01T09:30:00.000Z");
    const b = busy("b", "2026-06-01T09:05:00.000Z", "2026-06-01T09:15:00.000Z");
    const c = busy("c", "2026-06-01T09:30:00.000Z", "2026-06-01T09:40:00.000Z");
    const report = build([a, b, c]);
    expect(report.activity.parallelSessions).toEqual({ overlapEvents: 1, maxConcurrent: 2, sessionsInvolved: 2 });
  });

  it("reports wall-clock active time as the union of sessions, so parallel work is not double counted", () => {
    const busy = (id: string, from: string, to: string) => {
      const calls = [];
      for (let ms = Date.parse(from); ms <= Date.parse(to); ms += 5 * 60_000) calls.push(tool("read", { timestamp: new Date(ms).toISOString() }));
      return session({ id, startTime: from, endTime: to, activeMinutes: (Date.parse(to) - Date.parse(from)) / 60_000, prompts: [], requests: [], toolCalls: calls });
    };
    const report = build([
      busy("a", "2026-06-01T09:00:00.000Z", "2026-06-01T09:30:00.000Z"),
      busy("b", "2026-06-01T09:05:00.000Z", "2026-06-01T09:15:00.000Z"),
      busy("c", "2026-06-01T09:30:00.000Z", "2026-06-01T09:40:00.000Z"),
    ]);
    expect(report.activity.totalActiveMinutes).toBe(50);
    expect(report.activity.wallClockActiveMinutes).toBe(40);
    expect(report.activity.daily[0]!.activeMinutes).toBe(40);
  });

  it("never reports more than 24 hours of activity in a day", () => {
    const allDay = (id: string) => {
      const calls = [];
      for (let ms = Date.parse("2026-06-01T00:00:00.000Z"); ms <= Date.parse("2026-06-02T00:00:00.000Z"); ms += 5 * 60_000) {
        calls.push(tool("read", { timestamp: new Date(ms).toISOString() }));
      }
      return session({ id, startTime: "2026-06-01T00:00:00.000Z", endTime: "2026-06-02T00:00:00.000Z", activeMinutes: 1440, prompts: [], requests: [], toolCalls: calls });
    };
    const report = build([allDay("a"), allDay("b"), allDay("c")]);
    expect(report.activity.totalActiveMinutes).toBe(4320);
    expect(report.activity.wallClockActiveMinutes).toBe(1440);
    for (const row of report.activity.daily) expect(row.activeMinutes).toBeLessThanOrEqual(1440);
    expect(report.activity.daily.find((row) => row.day === "2026-06-01")?.activeMinutes).toBe(1440);
  });

  it("splits activity that crosses local midnight between both days, but counts the session once, on the day it started", () => {
    const calls = [];
    // 23:30 to 00:30 in Tokyo (UTC+9)
    for (let ms = Date.parse("2026-06-01T14:30:00.000Z"); ms <= Date.parse("2026-06-01T15:30:00.000Z"); ms += 5 * 60_000) {
      calls.push(tool("read", { timestamp: new Date(ms).toISOString() }));
    }
    const report = build(
      [session({ startTime: "2026-06-01T14:30:00.000Z", endTime: "2026-06-01T15:30:00.000Z", prompts: [], requests: [], toolCalls: calls })],
      "Asia/Tokyo",
    );
    expect(report.activity.daily.map((row) => [row.day, row.sessions, row.activeMinutes])).toEqual([
      ["2026-06-01", 1, 30],
      ["2026-06-02", 0, 30],
    ]);
  });

  it("places a resumed session's later messages on their own day, and still counts that day as active", () => {
    const report = build([
      session({
        startTime: "2026-06-01T09:00:00.000Z",
        endTime: "2026-06-03T09:05:00.000Z",
        userMessageCount: 2,
        prompts: [prompt("start the migration work", "2026-06-01T09:00:00.000Z"), prompt("pick it back up please", "2026-06-03T09:05:00.000Z")],
        requests: [],
        toolCalls: [],
      }),
    ]);
    expect(report.activity.daily.find((row) => row.day === "2026-06-03")).toMatchObject({ sessions: 0, userMessages: 1 });
    expect(report.activity.activeDays).toBe(2);
  });

  it("has daily session counts that add up to the real number of sessions, so weekly sums do too", () => {
    const sessions = [0, 1, 2, 3].map((n) =>
      session({ startTime: `2026-06-0${n + 1}T09:00:00.000Z`, endTime: `2026-06-0${n + 4}T09:00:00.000Z`, prompts: [prompt(`resume work item ${n}`, `2026-06-0${n + 4}T09:00:00.000Z`)] }),
    );
    const { daily } = build(sessions).activity;
    expect(daily.reduce((sum, row) => sum + row.sessions, 0)).toBe(4);
  });

  it("does not treat a session resumed the next day as running all night", () => {

    const resumed = session({
      id: "resumed",
      startTime: "2026-06-01T09:00:00Z",
      endTime: "2026-06-02T09:05:00Z",
      prompts: [prompt("start the work now", "2026-06-01T09:00:00Z"), prompt("pick it back up", "2026-06-02T09:05:00Z")],
      requests: [],
      toolCalls: [],
    });
    const night = session({ id: "night", startTime: "2026-06-01T22:00:00Z", endTime: "2026-06-01T22:30:00Z", prompts: [], requests: [], toolCalls: [] });
    expect(build([resumed, night]).activity.parallelSessions.overlapEvents).toBe(0);
  });

  it("counts feature use per session", () => {
    const report = build([
      session({ features: { ...session().features, mcpServers: ["github", "github"], subagents: 2, planMode: true, webSearch: true, compactions: 2 } }),
      session({ features: { ...session().features, mcpServers: ["github"], skills: ["release"] } }),
    ]);
    expect(report.activity.features.mcpServers).toEqual([{ key: "github", count: 2 }]);
    expect(report.activity.features.skills).toEqual([{ key: "release", count: 1 }]);
    expect(report.activity.features.sessionsWithSubagents).toBe(1);
    expect(report.activity.features.sessionsWithPlanMode).toBe(1);
    expect(report.activity.features.sessionsWithWeb).toBe(1);
    expect(report.activity.features.compactions).toBe(2);
  });

  it("produces empty but well-formed activity with no sessions", () => {
    const report = buildReport({ sessions: [], coverage: [], now: NOW, timeZone: "UTC" });
    expect(report.activity.sessions).toBe(0);
    expect(report.activity.daily).toEqual([]);
    expect(report.activity.hourHistogram).toEqual(Array(24).fill(0));
    expect(report.activity.medianResponseTimeSec).toBeNull();
    expect(report.range).toEqual({ from: null, to: null });
    expect(report.findings).toEqual([]);
    expect(report.usage.estimatedUsd).toBeNull();
  });
});
