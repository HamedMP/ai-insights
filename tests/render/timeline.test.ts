import { describe, expect, it } from "vitest";
import { buildView } from "../../src/render/view.js";
import { buildTimeline, busiestDays, MAX_LANES, MAX_SPANS, peakConcurrency, timelineSummary } from "../../src/render/timeline.js";
import type { SessionSpan } from "../../src/schema/types.js";
import { makeDeterministicReport, makeReport, makeSpans, makeYearReport } from "./fixtures.js";

const ZONE = "Europe/Berlin";

function span(id: string, start: string, end: string, extra: Partial<SessionSpan> = {}): SessionSpan {
  return { sessionId: id, harness: "claude-code", project: "/home/dev/code/app", start, end, activeMinutes: 10, ...extra };
}

/** A morning in one city, in UTC: three sessions overlap from 10:30 to 11:00 UTC. */
const MORNING = [
  span("a", "2026-11-12T09:00:00Z", "2026-11-12T11:00:00Z"),
  span("b", "2026-11-12T10:00:00Z", "2026-11-12T12:00:00Z", { harness: "codex" }),
  span("c", "2026-11-12T10:30:00Z", "2026-11-12T11:30:00Z", { agentDriven: true }),
  span("d", "2026-11-12T12:00:00Z", "2026-11-12T13:00:00Z"),
];

describe("session timeline layout", () => {
  it("draws the whole range when it is short enough to read, one lane per session open at once", () => {
    const timeline = buildTimeline(MORNING, ZONE)!;
    expect(timeline.window.kind).toBe("all");
    expect(timeline.lanes).toBe(3);
    expect(timeline.bars).toHaveLength(4);
    expect(timeline.peak.count).toBe(3);
    // 10:30 UTC is 11:30 in Berlin.
    expect(timeline.peak.label).toBe("11:30");
  });

  it("never draws two bars on top of each other in the same lane", () => {
    const timeline = buildTimeline(makeSpans(), ZONE)!;
    for (const bar of timeline.bars) {
      for (const other of timeline.bars) {
        if (bar === other || bar.lane !== other.lane) continue;
        expect(bar.x + bar.width <= other.x + 1e-9 || other.x + other.width <= bar.x + 1e-9).toBe(true);
      }
    }
  });

  it("reuses a lane when one session ends exactly as the next starts", () => {
    expect(peakConcurrency([{ start: 0, end: 10 }, { start: 10, end: 20 }]).count).toBe(1);
    const timeline = buildTimeline([...MORNING, span("e", "2026-11-12T13:00:00Z", "2026-11-12T13:30:00Z")], ZONE)!;
    expect(timeline.bars.find((bar) => bar.sessionId === "e")!.lane).toBe(timeline.bars.find((bar) => bar.sessionId === "d")!.lane);
  });

  it("zooms to the busiest day when a long history would be unreadable", () => {
    const timeline = buildTimeline(makeSpans(), ZONE)!;
    expect(timeline.window.kind).toBe("busiest");
    expect(timeline.window.label).toBe("Nov 12");
    expect(timeline.inWindow).toBeLessThan(timeline.total);
    expect(timelineSummary(timeline, ZONE)).toContain("Nov 12, the day with the most sessions open at once");
  });

  it("offers the busiest days to step through, oldest first, and opens on the one with the most at once", () => {
    const spans = [...makeSpans(), ...makeSpans({ busyDay: "2026-11-08", busy: 4, seed: 9 }).map((entry) => ({ ...entry, sessionId: `b-${entry.sessionId}` }))];
    const { days, busiest } = busiestDays(spans, ZONE);
    expect(days.length).toBeGreaterThan(1);
    expect(days.length).toBeLessThanOrEqual(8);
    expect(days.every((day) => day.peak.count >= 2)).toBe(true);
    expect(days.map((day) => day.window.start)).toEqual([...days.map((day) => day.window.start)].sort((a, b) => a - b));
    expect(days[busiest]!.peak.count).toBe(Math.max(...days.map((day) => day.peak.count)));
    expect(days[busiest]!.window.label).toBe("Nov 12");
  });

  it("explains why more sessions were open than working when the report's count of active sessions is lower", () => {
    const timeline = buildTimeline(MORNING, ZONE)!;
    expect(timelineSummary(timeline, ZONE, timeline.peak.count)).not.toContain("actively working");
    expect(timelineSummary(timeline, ZONE)).not.toContain("actively working");
    expect(timelineSummary(timeline, ZONE, 1)).toContain("at most 1 session was actively working");
  });

  it("colours by harness in the order the report ranks them and counts agent-driven sessions", () => {
    const timeline = buildTimeline(MORNING, ZONE, ["codex", "claude-code"])!;
    expect(timeline.harnesses).toEqual(["codex", "claude-code"]);
    expect(timeline.agentDriven).toBe(1);
  });

  it("gives screen readers the same story as the picture", () => {
    const summary = timelineSummary(buildTimeline(MORNING, ZONE)!, ZONE);
    expect(summary).toContain("4 sessions drawn in 3 lanes");
    expect(summary).toContain("At most 3 were open at once, at 11:30.");
    expect(summary).toContain("1 session was driven by another agent.");
  });

  it("labels the time axis in the report's zone", () => {
    expect(buildTimeline(MORNING, ZONE)!.ticks.map((tick) => tick.label)).toContain("12:00");
    expect(buildTimeline(MORNING, "Asia/Kolkata")!.peak.label).toBe("16:00");
  });

  it("has nothing to draw without spans, or when no two overlap, so the page says so in words", () => {
    expect(buildTimeline(undefined, ZONE)).toBeNull();
    expect(buildTimeline([], ZONE)).toBeNull();
    const apart = [span("a", "2026-11-12T09:00:00Z", "2026-11-12T10:00:00Z"), span("b", "2026-11-12T10:00:00Z", "2026-11-12T11:00:00Z")];
    expect(buildTimeline(apart, ZONE)).toBeNull();
    expect(buildView(makeDeterministicReport(), ZONE).timeline).toBeNull();
  });

  it("skips malformed spans instead of failing", () => {
    const junk = [null, 7, "x", { start: "nope", end: "2026-11-12T10:00:00Z" }, span("back", "2026-11-12T12:00:00Z", "2026-11-12T11:00:00Z"), ...MORNING] as unknown;
    expect(buildTimeline(junk, ZONE)!.total).toBe(4);
    expect(buildTimeline({ not: "an array" }, ZONE)).toBeNull();
  });
});

describe("session timeline: capped", () => {
  it("considers at most the newest 400 spans even when handed more", () => {
    const many = Array.from({ length: 600 }, (_, index) => {
      const start = Date.parse("2026-11-01T00:00:00Z") + index * 20 * 60_000;
      return span(`s${index}`, new Date(start).toISOString(), new Date(start + 30 * 60_000).toISOString());
    });
    const timeline = buildTimeline(many, ZONE)!;
    expect(timeline.total).toBe(MAX_SPANS);
    expect(timeline.bars.some((bar) => bar.sessionId === "s0")).toBe(false);
  });

  it("draws at most 24 lanes and says how many sessions it left out", () => {
    const crowd = Array.from({ length: 30 }, (_, index) => span(`c${index}`, `2026-11-12T10:${String(index).padStart(2, "0")}:00Z`, "2026-11-12T12:00:00Z"));
    const timeline = buildTimeline(crowd, ZONE)!;
    expect(timeline.lanes).toBe(MAX_LANES);
    expect(timeline.hidden).toBe(6);
    expect(timeline.peak.count).toBe(30);
    expect(timelineSummary(timeline, ZONE)).toContain("6 sessions beyond 24 lanes are not drawn");
  });

  it("tells the page when the timeline covers only the newest sessions", () => {
    const view = buildView(makeYearReport(), ZONE);
    expect(view.timeline!.total).toBe(400);
    expect(view.timeline!.sessions).toBeGreaterThan(400);
  });

  it("shows project folders without the home directory in timeline tooltips", () => {
    const view = buildView(makeReport(), ZONE);
    const projects = view.timeline!.days.flatMap((day) => day.bars.map((bar) => bar.project));
    expect(projects.length).toBeGreaterThan(0);
    for (const project of projects) expect(project).not.toMatch(/^\/(home|Users)\//);
  });
});

describe("projects with worktrees", () => {
  it("names the worktree count quietly beside a project folded from several folders", () => {
    const rows = buildView(makeReport(), ZONE).activity.projects;
    expect(rows.some((row) => row.note === "4 worktrees")).toBe(true);
    expect(rows.some((row) => row.note === "1 worktree")).toBe(false);
  });

  it("keeps the project's own folder name readable when the path is long", () => {
    const report = makeReport();
    const projects = [{ projectPath: "/home/dev/projects/clients/acme/matrix-os", sessions: 30, activeMinutes: 900, worktrees: 9 }];
    const [row] = buildView({ ...report, activity: { ...report.activity, projects } }, ZONE).activity.projects;
    expect(row).toMatchObject({ label: "matrix-os", title: "~/projects/clients/acme/matrix-os", note: "9 worktrees" });
  });
});
