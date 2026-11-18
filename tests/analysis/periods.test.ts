import { describe, expect, it } from "vitest";
import { calendarRange, currentRange, isoInZone, splitRange, summarizePeriods, tipFrom } from "../../src/analysis/periods.js";
import { periodUsage } from "../../src/analysis/period-usage.js";
import type { Finding, Session } from "../../src/schema/types.js";
import { makeSession } from "../store/fixtures.js";

const labels = (harness: string) => ({ "claude-code": "Claude Code", codex: "Codex", "claude-chat": "Claude chat" })[harness] ?? harness;
const iso = (ms: number, zone: string) => isoInZone(ms, zone);

describe("period boundaries in the person's time zone", () => {
  const now = new Date("2026-11-18T15:42:00.000Z");
  it("today starts at local midnight, the week on Monday and the month on the 1st", () => {
    expect(iso(currentRange("today", now, "Europe/Helsinki").from, "Europe/Helsinki")).toBe("2026-11-18T00:00:00+02:00");
    expect(iso(currentRange("week", now, "Europe/Helsinki").from, "Europe/Helsinki")).toBe("2026-11-16T00:00:00+02:00");
    expect(iso(currentRange("month", now, "Europe/Helsinki").from, "Europe/Helsinki")).toBe("2026-11-01T00:00:00+02:00");
    expect(iso(currentRange("today", now, "America/Los_Angeles").from, "America/Los_Angeles")).toBe("2026-11-18T00:00:00-08:00");
  });

  it("goes back whole periods for --last, across a daylight-saving change", () => {
    // Europe/Berlin left summer time on 2026-10-25.
    const range = currentRange("today", new Date("2026-10-26T10:00:00.000Z"), "Europe/Berlin", 3);
    expect(iso(range.from, "Europe/Berlin")).toBe("2026-10-24T00:00:00+02:00");
    const days = splitRange("today", range, "Europe/Berlin");
    expect(days.map((day) => iso(day.from, "Europe/Berlin"))).toEqual(["2026-10-24T00:00:00+02:00", "2026-10-25T00:00:00+02:00", "2026-10-26T00:00:00+01:00"]);
    // The day the clocks went back had 25 hours.
    expect(days[1]!.to - days[1]!.from).toBe(25 * 3_600_000);
    expect(iso(currentRange("month", new Date("2026-03-03T00:00:00Z"), "UTC", 3).from, "UTC")).toBe("2026-01-01T00:00:00+00:00");
    expect(iso(currentRange("week", new Date("2026-11-18T12:00:00Z"), "UTC", 2).from, "UTC")).toBe("2026-11-09T00:00:00+00:00");
  });

  it("takes --since and --until as whole local days, both included", () => {
    const range = calendarRange("2026-11-01", "2026-11-10", now, "Europe/Helsinki");
    expect(iso(range.from, "Europe/Helsinki")).toBe("2026-11-01T00:00:00+02:00");
    expect(iso(range.to, "Europe/Helsinki")).toBe("2026-11-11T00:00:00+02:00");
    expect(calendarRange("2026-11-15", undefined, now, "UTC").to).toBe(now.getTime() + 1);
  });
});

function session(id: string, overrides: Partial<Session> = {}): Session {
  return makeSession({ id, startTime: "2026-11-18T08:00:00.000Z", endTime: "2026-11-18T09:00:00.000Z", prompts: [], toolCalls: [], requests: [], ...overrides });
}
const request = (id: string, timestamp: string, model = "claude-opus-4-5", input = 1000) => ({ id, timestamp, model, usage: { input, cachedInput: 0, cacheWrite: 0, output: 100 } });

describe("the numbers for a period", () => {
  const now = new Date("2026-11-18T12:00:00.000Z");
  const today = currentRange("today", now, "UTC");
  const options = { timeZone: "UTC", now, labels };

  it("counts sessions active in the period, wall-clock active time inside it, and prompts sent in it", () => {
    const sessions = [
      // Ran yesterday and resumed this morning: it counts today, but only today's minutes and prompts do.
      session("a", {
        startTime: "2026-11-17T22:00:00.000Z",
        endTime: "2026-11-18T08:20:00.000Z",
        prompts: [
          { timestamp: "2026-11-17T22:00:00.000Z", text: "x" },
          { timestamp: "2026-11-17T22:05:00.000Z", text: "x" },
          { timestamp: "2026-11-18T08:00:00.000Z", text: "x" },
        ],
        requests: [request("r1", "2026-11-17T22:06:00.000Z"), request("r2", "2026-11-18T08:10:00.000Z"), request("r3", "2026-11-18T08:20:00.000Z")],
      }),
      // In parallel with the first for ten minutes: wall-clock time counts once.
      session("b", { startTime: "2026-11-18T08:10:00.000Z", endTime: "2026-11-18T08:30:00.000Z", prompts: [{ timestamp: "2026-11-18T08:10:00.000Z", text: "y" }], requests: [request("r4", "2026-11-18T08:20:00.000Z", "gpt-5.5")] }),
      session("old", { startTime: "2026-11-10T08:00:00.000Z", endTime: "2026-11-10T09:00:00.000Z" }),
    ];
    const [summary] = summarizePeriods(sessions, [today], options);
    expect(summary!.sessions).toBe(2);
    expect(summary!.prompts).toBe(2);
    // 08:00 to 08:30, the two sessions overlapping from 08:10 to 08:20.
    expect(summary!.activeMinutes).toBe(30);
    const [usage] = periodUsage(sessions, [today]);
    expect(summary!.tokens).toEqual({ input: usage!.totals.input, output: usage!.totals.output, cacheRead: 0, cacheWrite: 0, total: usage!.totals.tokens });
    expect(summary!.tokens!.total).toBe(3 * 1100);
    expect(summary!.costUsd).toBeCloseTo(usage!.totals.estimatedUsd!, 2);
    expect(summary!.byModel.map((row) => row.model).sort()).toEqual(["claude-opus-4-5", "gpt-5.5"]);
  });

  it("never shows 0 or an estimate for chat exports: their tokens and cost are not measured", () => {
    const chat = session("chat", { harness: "claude-chat", requests: [] });
    const [only] = summarizePeriods([chat], [today], options);
    expect(only!.tokens).toBeNull();
    expect(only!.costUsd).toBeNull();
    expect(only!.byAgent).toEqual([{ agent: "claude-chat", label: "Claude chat", sessions: 1, costUsd: null }]);
    const [mixed] = summarizePeriods([chat, session("code", { requests: [request("q", "2026-11-18T08:30:00.000Z")] })], [today], options);
    expect(mixed!.tokens!.total).toBe(1100);
    expect(mixed!.byAgent.find((row) => row.agent === "claude-chat")!.costUsd).toBeNull();
  });

  it("says unpriced rather than guessing a price for an unknown model", () => {
    const [summary] = summarizePeriods([session("u", { requests: [request("z", "2026-11-18T08:30:00.000Z", "mystery-model")] })], [today], options);
    expect(summary!.costUsd).toBeNull();
    expect(summary!.unpricedRequestShare).toBe(1);
  });

  it("an empty day costs $0.00 and has no tip", () => {
    const [summary] = summarizePeriods([], [today], options);
    expect(summary).toMatchObject({ sessions: 0, costUsd: 0, tokens: { total: 0 }, tip: null });
  });

  it("lists projects by folder name only when asked", () => {
    const sessions = [session("p", { projectPath: "/home/someone/work/alpha", requests: [request("p1", "2026-11-18T08:30:00.000Z")] })];
    expect(summarizePeriods(sessions, [today], options)[0]!.byProject).toBeUndefined();
    expect(summarizePeriods(sessions, [today], { ...options, byProject: true })[0]!.byProject).toEqual([{ project: "alpha", sessions: 1, activeMinutes: expect.any(Number), costUsd: expect.any(Number) }]);
  });
});

describe("the tip", () => {
  const finding = (kind: Finding["kind"], title: string, suggestion = "Tell the agent how this command should be run"): Finding => ({
    id: `${kind}:x`,
    kind,
    severity: "medium",
    title,
    detail: "",
    harnesses: ["claude-code"],
    evidence: [{ sessionId: "s", harness: "claude-code", note: "n" }],
    suggestion: { type: "habit", title: suggestion, action: "a" },
  });

  it("is fixed wording: never the command, path or prompt a finding quotes", () => {
    const tip = tipFrom([finding("repeated_failed_command", "`pnpm test --filter secret-project` keeps failing")], { kind: "week" });
    expect(tip).toEqual({ id: "repeated_failed_command", text: "A command kept failing this week. Tell the agent how this command should be run." });
    expect(tipFrom([finding("repeated_instruction", 'You keep telling the agent: "use the staging db"', "Write it down once")], { kind: "today" })!.text).not.toContain("staging");
  });

  it("skips notices about history and coverage, which are not coaching", () => {
    expect(tipFrom([finding("history_retention", "Keep Claude Code transcripts longer", "Archive them compactly")], { kind: "today" })).toBeNull();
  });

  it("comes from the period's own sessions", () => {
    const compacted = (id: string) => session(id, { features: { mcpServers: [], skills: [], slashCommands: [], subagents: 0, planMode: false, webSearch: false, webFetch: false, compactions: 2 } });
    const now = new Date("2026-11-18T12:00:00.000Z");
    const [summary] = summarizePeriods([compacted("a"), compacted("b"), compacted("c")], [currentRange("today", now, "UTC")], { timeZone: "UTC", now, labels });
    expect(summary!.tip?.id).toBe("context_resets");
    expect(summary!.tip?.text).toMatch(/^Sessions ran out of context today\. /);
  });
});
