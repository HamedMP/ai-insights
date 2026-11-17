import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/analysis/index.js";
import { buildWorkRatios } from "../../src/analysis/ratios.js";
import { WORK_RATIO_KEYS, type Session } from "../../src/schema/types.js";
import { buildActivity } from "../../src/analysis/activity.js";
import { makeClock } from "../../src/analysis/time.js";
import { at, coverage, day, NOW, prompt, request, session, sessionsOverDays, tool } from "./factory.js";

const clock = makeClock("UTC");
const ratios = (sessions: Session[]) => buildWorkRatios(sessions, buildActivity(sessions, clock));

describe("work ratios", () => {
  it("gives every ratio a definition and no value when there is nothing to divide by", () => {
    const empty = ratios([]);
    for (const key of WORK_RATIO_KEYS) {
      expect(empty[key]).toMatchObject({ key, value: null, numerator: 0, denominator: 0 });
      expect(empty[key].definition.length).toBeGreaterThan(20);
    }
    expect(buildReport({ sessions: [], coverage: [coverage("claude-code", 0)], now: NOW, timeZone: "UTC" }).ratios).toBeUndefined();
  });

  it("puts the ratios in the report so later features can read them", () => {
    const report = buildReport({ sessions: sessionsOverDays(3), coverage: [coverage("claude-code", 3)], now: NOW, timeZone: "UTC" });
    expect(Object.keys(report.ratios!).sort()).toEqual([...WORK_RATIO_KEYS].sort());
  });

  it("counts mid-run corrections per session the person drove, leaving agent-driven sessions out", () => {
    const corrected = session({
      startTime: day(0),
      prompts: [prompt("go", day(0, 0)), prompt("stop, other file", day(0, 3), true)],
      toolCalls: [tool("read", { timestamp: day(0, 2.5) })],
      requests: [request({ timestamp: day(0, 2.5) })],
    });
    const driven = session({ startTime: day(1), agentMessageCount: 30, prompts: [prompt("go", day(1, 0)), prompt("x", day(1, 3), true)], toolCalls: [tool("read", { timestamp: day(1, 2.5) })] });
    const r = ratios([corrected, session({ startTime: day(2) }), driven]);
    expect(r.correctionsPerSession).toMatchObject({ numerator: 1, denominator: 2, value: 0.5, unit: "per_session" });
  });

  it("shares of sessions that hit a context reset", () => {
    const base = session().features;
    const r = ratios(sessionsOverDays(4, (i) => ({ features: { ...base, compactions: i === 0 ? 3 : 0 } })));
    expect(r.contextResetShare).toMatchObject({ numerator: 1, denominator: 4, value: 0.25, unit: "share" });
  });

  it("matches the failure rate the report shows, and has no value without tool calls", () => {
    const failing = session({ toolCalls: [tool("read", { error: "file_not_found" }), tool("read"), tool("edit"), tool("edit")] });
    expect(ratios([failing]).toolErrorRate).toMatchObject({ numerator: 1, denominator: 4, value: 0.25 });
    expect(ratios([session({ toolCalls: [] })]).toolErrorRate.value).toBeNull();
  });

  it("credits a plan only when it came before the first edit, over sessions that changed files", () => {
    const base = session().features;
    const planned = session({ toolCalls: [tool("plan", { timestamp: at(1) }), tool("edit", { timestamp: at(2) })] });
    const late = session({ toolCalls: [tool("edit", { timestamp: at(1) }), tool("plan", { timestamp: at(2) })] });
    const mode = session({ features: { ...base, planMode: true } });
    const brief = session({ prompts: [prompt("Read the handoff in docs/next.md and follow it", at(0))] });
    const chat = session({ toolCalls: [tool("read", { timestamp: at(1) })] });
    const r = ratios([planned, late, mode, brief, chat]);
    expect(r.planFirstShare).toMatchObject({ numerator: 3, denominator: 4 });
  });

  it("reads parallel work as agent time over wall-clock time, with no value when nothing ran", () => {
    const together = [session({ startTime: day(0) }), session({ startTime: day(0) })];
    const r = ratios(together);
    expect(r.parallelism.unit).toBe("times");
    expect(r.parallelism.value).toBeGreaterThan(1.5);
    expect(ratios([]).parallelism.value).toBeNull();
  });
});
