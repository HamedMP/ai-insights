import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/analysis/index.js";
import type { Session } from "../../src/schema/types.js";
import { at, coverage, day, NOW, prompt, session, sessionsOverDays, task, tool } from "./factory.js";
import { findings } from "./findings/helpers.js";

const build = (sessions: Session[]) =>
  buildReport({ sessions, coverage: [coverage("claude-code", sessions.length)], now: NOW, timeZone: "UTC" });

const ROOT = "/synthetic/repo";

describe("projects grouped by repository", () => {
  it("folds worktrees of one repository into a single row and counts them", () => {
    const report = build([
      session({ projectPath: ROOT, projectRoot: ROOT }),
      session({ projectPath: "/synthetic/wt/a", projectRoot: ROOT, startTime: at(60) }),
      session({ projectPath: "/synthetic/wt/b", projectRoot: ROOT, startTime: at(120) }),
      session({ projectPath: "/synthetic/wt/b", projectRoot: ROOT, startTime: at(180) }),
    ]);
    expect(report.activity.projects).toEqual([{ projectPath: ROOT, sessions: 4, activeMinutes: 100, worktrees: 3 }]);
  });

  it("leaves out the worktree count when a row has one folder", () => {
    const report = build([session({ projectPath: ROOT, projectRoot: ROOT }), session({ projectPath: ROOT, startTime: at(60) })]);
    expect(report.activity.projects).toEqual([{ projectPath: ROOT, sessions: 2, activeMinutes: 50 }]);
  });

  it("falls back to the folder when the root is unknown", () => {
    const report = build([
      session({ projectPath: "/synthetic/one", projectRoot: null }),
      session({ projectPath: "/synthetic/two", startTime: at(60), activeMinutes: 40 }),
      session({ projectPath: null, startTime: at(120) }),
    ]);
    expect(report.activity.projects.map((row) => row.projectPath)).toEqual(["/synthetic/two", "/synthetic/one"]);
    expect(report.activity.projects.every((row) => row.worktrees === undefined)).toBe(true);
  });

  it("treats a rule repeated across worktrees of one repository as one project", () => {
    const variants = ["Always use pnpm, never npm.", "always use pnpm never npm", "Please always use pnpm and never npm!", "always use pnpm, never npm please"];
    const sessions = sessionsOverDays(4, (index) => ({
      projectPath: `/synthetic/wt/${index}`,
      projectRoot: ROOT,
      prompts: [prompt(task(), day(index)), prompt(variants[index]!, day(index, 2))],
    }));
    const [finding] = findings("repeated_instruction", sessions);
    expect(finding?.detail).toContain("one project");
  });
});

describe("session spans", () => {
  it("lists every timed session oldest first with its project and active time", () => {
    const report = build([
      session({ id: "late", startTime: at(120), projectPath: "/synthetic/wt/a", projectRoot: ROOT }),
      session({ id: "early", startTime: at(0), projectPath: "/synthetic/plain" }),
      session({ id: "none", startTime: at(60), projectPath: null }),
    ]);
    const ms = (minutes: number) => Date.parse(at(minutes));
    // The factory session works 0-13 min, idles 12 min, then works 25-30 min.
    expect(report.activity.sessionSpans).toEqual([
      { sessionId: "early", harness: "claude-code", project: "/synthetic/plain", start: at(0), end: at(30), activeMinutes: 25, active: [[ms(0), ms(13)], [ms(25), ms(30)]] },
      { sessionId: "none", harness: "claude-code", project: null, start: at(60), end: at(90), activeMinutes: 25, active: [[ms(60), ms(73)], [ms(85), ms(90)]] },
      { sessionId: "late", harness: "claude-code", project: ROOT, start: at(120), end: at(150), activeMinutes: 25, active: [[ms(120), ms(133)], [ms(145), ms(150)]] },
    ]);
  });

  it("gives each span its active stretches, split at idle gaps, so a timeline can draw when a session really worked", () => {
    const resumed = session({
      id: "resumed",
      startTime: at(0),
      endTime: at(300),
      prompts: [prompt("fix", at(0)), prompt("again", at(290))],
      requests: [],
      toolCalls: [tool("read", { timestamp: at(5) }), tool("read", { timestamp: at(300) })],
    });
    const span = build([resumed]).activity.sessionSpans![0]!;
    expect(span.active).toEqual([
      [Date.parse(at(0)), Date.parse(at(5))],
      [Date.parse(at(290)), Date.parse(at(300))],
    ]);
  });

  it("marks sessions another agent drove", () => {
    const report = build([session({ id: "driven", agentMessageCount: 9, userMessageCount: 1 }), session({ id: "typed", startTime: at(60) })]);
    const spans = report.activity.sessionSpans ?? [];
    expect(spans.find((span) => span.sessionId === "driven")?.agentDriven).toBe(true);
    expect(spans.find((span) => span.sessionId === "typed")?.agentDriven).toBeUndefined();
  });

  it("skips sessions without a usable start or end", () => {
    const report = build([
      session({ id: "ok" }),
      { ...session({ id: "no-start" }), startTime: "" },
      session({ id: "no-end", startTime: at(60), endTime: "not a time" }),
      session({ id: "backwards", startTime: at(200), endTime: at(100) }),
    ]);
    expect((report.activity.sessionSpans ?? []).map((span) => span.sessionId)).toEqual(["ok"]);
  });

  it("keeps only the newest 400, still oldest first", () => {
    const sessions = Array.from({ length: 450 }, (_, index) => session({ id: `s${String(index).padStart(3, "0")}`, startTime: at(index * 60) }));
    const spans = build(sessions.reverse()).activity.sessionSpans ?? [];
    expect(spans).toHaveLength(400);
    expect(spans[0]!.sessionId).toBe("s050");
    expect(spans.at(-1)!.sessionId).toBe("s449");
    expect(spans.every((span, index) => index === 0 || span.start >= spans[index - 1]!.start)).toBe(true);
  });

  it("orders sessions that start together the same way every time", () => {
    const a = session({ id: "b-second", harness: "codex" });
    const b = session({ id: "a-first", harness: "claude-code" });
    expect(build([a, b]).activity.sessionSpans).toEqual(build([b, a]).activity.sessionSpans);
  });
});
