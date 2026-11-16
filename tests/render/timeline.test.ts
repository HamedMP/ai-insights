import { describe, expect, it } from "vitest";
import { renderReport } from "../../src/render/index.js";
import { buildTimeline, MAX_LANES, MAX_LIST_ROWS, MAX_SPANS, peakConcurrency, spanTimeline, timelineSummary } from "../../src/render/timeline.js";
import type { SessionSpan } from "../../src/schema/types.js";
import { HOSTILE, makeDeterministicReport, makeReport, makeSpans, makeYearReport } from "./fixtures.js";

const ZONE = "Europe/Berlin";

function span(id: string, start: string, end: string, extra: Partial<SessionSpan> = {}): SessionSpan {
  return { sessionId: id, harness: "claude-code", project: "/home/dev/code/app", start, end, activeMinutes: 10, ...extra };
}

/** One section's markup; sections never nest. */
function section(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
}

/** A morning in one city, in UTC: three sessions overlap from 10:30 to 11:00 UTC. */
const MORNING = [
  span("a", "2026-11-12T09:00:00Z", "2026-11-12T11:00:00Z"),
  span("b", "2026-11-12T10:00:00Z", "2026-11-12T12:00:00Z", { harness: "codex" }),
  span("c", "2026-11-12T10:30:00Z", "2026-11-12T11:30:00Z", { agentDriven: true }),
  span("d", "2026-11-12T12:00:00Z", "2026-11-12T13:00:00Z"),
];

describe("session timeline: spans present", () => {
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

  it("zooms to the busiest day when a long history would be unreadable, and says so", () => {
    const timeline = buildTimeline(makeSpans(), ZONE)!;
    expect(timeline.window.kind).toBe("busiest");
    expect(timeline.window.label).toBe("Nov 12");
    expect(timeline.inWindow).toBeLessThan(timeline.total);
    const markup = String(spanTimeline(timeline, ZONE, 40));
    expect(markup).toContain(`Showing Nov 12, the day with the most sessions open at once · ${timeline.inWindow} of ${timeline.total} sessions`);
  });

  it("marks the busiest moment with its count", () => {
    const timeline = buildTimeline(makeSpans(), ZONE)!;
    const markup = String(spanTimeline(timeline, ZONE, 40));
    expect(timeline.peak.count).toBeGreaterThanOrEqual(7);
    expect(markup).toContain(`<b>${timeline.peak.count}</b> open · ${timeline.peak.label}`);
    expect(markup).toContain('class="tl-peak"');
  });

  it("explains why more sessions were open than working when the report's count of active sessions is lower", () => {
    const report = makeReport();
    const timeline = buildTimeline(report.activity.sessionSpans, ZONE)!;
    const working = timeline.peak.count - 2;
    const html = renderReport({ ...report, activity: { ...report.activity, parallelSessions: { ...report.activity.parallelSessions, maxConcurrent: working } } });
    const parallel = section(html, "parallel");
    const sentence = `A bar runs from a session's first to last message, idle time included; at most ${working} sessions were actively working at the same moment.`;
    expect(parallel).toContain(`<b>${timeline.peak.count}</b> open · `);
    expect(parallel).toContain(`<span class="tl-idle">${sentence.replace(/'/g, "&#39;")}</span>`);
    expect(parallel).toContain(`aria-label="`);
    expect(parallel).toMatch(new RegExp(`aria-label="[^"]*actively working at the same moment`));
    expect(parallel).toContain(`<dt>Most working at once</dt><dd>${working}</dd>`);
  });

  it("leaves out the idle-time sentence when open and working counts agree", () => {
    const timeline = buildTimeline(MORNING, ZONE)!;
    expect(String(spanTimeline(timeline, ZONE, 4, timeline.peak.count))).not.toContain("tl-idle");
    expect(String(spanTimeline(timeline, ZONE, 4))).not.toContain("tl-idle");
    expect(String(spanTimeline(timeline, ZONE, 4, 1))).toContain("at most 1 session was actively working");
  });

  it("colours by harness in the order the report ranks them and sets agent-driven sessions apart", () => {
    const timeline = buildTimeline(MORNING, ZONE, ["codex", "claude-code"])!;
    expect(timeline.harnesses).toEqual(["codex", "claude-code"]);
    const markup = String(spanTimeline(timeline, ZONE, 4));
    expect(markup).toMatch(/<rect class="hz0"[^>]*><title>Codex/);
    expect(markup).toMatch(/<rect class="hz1 ad"/);
    expect(markup).toContain("Driven by another agent");
  });

  it("gives screen readers and text-only readers the same story", () => {
    const timeline = buildTimeline(MORNING, ZONE)!;
    const summary = timelineSummary(timeline, ZONE);
    expect(summary).toContain("4 sessions drawn in 3 lanes");
    expect(summary).toContain("At most 3 were open at once, at 11:30.");
    expect(summary).toContain("1 session was driven by another agent.");
    const markup = String(spanTimeline(timeline, ZONE, 4));
    expect(markup).toContain(`role="img" aria-label="${summary}"`);
    expect(markup).toContain("<summary class=\"micro\">The sessions as a table</summary>");
    expect(markup.match(/<tr><td>/g)).toHaveLength(4);
  });

  it("stretches to the panel width with lanes at a fixed pixel height, so it reads on a phone", () => {
    const markup = String(spanTimeline(buildTimeline(MORNING, ZONE)!, ZONE, 4));
    expect(markup).toMatch(/<svg viewBox="0 0 1000 \d+" preserveAspectRatio="none" style="height:\d+px"/);
    expect(markup).not.toMatch(/<svg[^>]*\swidth="/);
  });

  it("labels the time axis in the report's zone", () => {
    const berlin = buildTimeline(MORNING, ZONE)!;
    const kolkata = buildTimeline(MORNING, "Asia/Kolkata")!;
    expect(berlin.ticks.map((tick) => tick.label)).toContain("12:00");
    expect(kolkata.peak.label).toBe("16:00");
  });

  it("draws the real timeline in the parallel chapter of a report that has spans", () => {
    const html = renderReport(makeReport());
    const parallel = section(html, "parallel");
    expect(parallel).toContain('data-chart="timeline"');
    expect(parallel).not.toContain('data-chart="parallel"');
    expect(parallel).toContain("the busiest day");
    expect(parallel).toContain("Sessions that overlapped");
  });

  it("still tells the story from spans alone when the aggregate overlap counts are missing", () => {
    const report = makeReport();
    const html = renderReport({ ...report, activity: { ...report.activity, parallelSessions: undefined as never } });
    expect(section(html, "parallel")).toMatch(/At the busiest moment, <em>\d+ of your sessions<\/em> were open at the same time/);
  });
});

describe("session timeline: spans absent", () => {
  it("keeps the aggregate visual when there are no spans", () => {
    expect(buildTimeline(undefined, ZONE)).toBeNull();
    expect(buildTimeline([], ZONE)).toBeNull();
    const html = renderReport(makeDeterministicReport());
    expect(section(html, "parallel")).toContain('data-chart="parallel"');
    expect(section(html, "parallel")).not.toContain('data-chart="timeline"');
  });

  it("keeps the aggregate visual when no two spans overlap", () => {
    const apart = [span("a", "2026-11-12T09:00:00Z", "2026-11-12T10:00:00Z"), span("b", "2026-11-12T10:00:00Z", "2026-11-12T11:00:00Z")];
    expect(buildTimeline(apart, ZONE)).toBeNull();
    const report = makeReport();
    const html = renderReport({ ...report, activity: { ...report.activity, sessionSpans: apart } });
    expect(section(html, "parallel")).toContain('data-chart="parallel"');
  });

  it("skips malformed spans instead of failing", () => {
    const junk = [null, 7, "x", { start: "nope", end: "2026-11-12T10:00:00Z" }, span("back", "2026-11-12T12:00:00Z", "2026-11-12T11:00:00Z"), ...MORNING] as unknown;
    const timeline = buildTimeline(junk, ZONE)!;
    expect(timeline.total).toBe(4);
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

  it("draws at most 24 lanes and counts the rest in the caption", () => {
    const crowd = Array.from({ length: 30 }, (_, index) => span(`c${index}`, `2026-11-12T10:${String(index).padStart(2, "0")}:00Z`, "2026-11-12T12:00:00Z"));
    const timeline = buildTimeline(crowd, ZONE)!;
    expect(timeline.lanes).toBe(MAX_LANES);
    expect(timeline.hidden).toBe(6);
    expect(timeline.peak.count).toBe(30);
    expect(String(spanTimeline(timeline, ZONE, 30))).toContain("6 more sessions beyond 24 lanes not drawn");
  });

  it("caps the text table and says how many more the timeline holds", () => {
    const crowd = Array.from({ length: 80 }, (_, index) => {
      const start = Date.parse("2026-11-12T08:00:00Z") + index * 6 * 60_000;
      return span(`r${index}`, new Date(start).toISOString(), new Date(start + 15 * 60_000).toISOString());
    });
    const markup = String(spanTimeline(buildTimeline(crowd, ZONE)!, ZONE, 80));
    expect(markup.match(/<tr><td>/g)).toHaveLength(MAX_LIST_ROWS);
    expect(markup).toContain("+ 20 more in the timeline");
  });

  it("says the timeline covers only the newest sessions when the history holds more", () => {
    const html = renderReport(makeYearReport());
    expect(section(html, "parallel")).toContain("drawn from the newest 400 sessions");
    expect(Buffer.byteLength(html)).toBeLessThan(1_000_000);
  });

  it("escapes hostile project names and ids", () => {
    const hostile = MORNING.map((entry) => ({ ...entry, project: `/home/dev/${HOSTILE.script}`, sessionId: HOSTILE.img }));
    const markup = String(spanTimeline(buildTimeline(hostile, ZONE)!, ZONE, 4));
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;script&gt;");
  });
});

describe("projects with worktrees", () => {
  it("names the worktree count quietly beside a project folded from several folders", () => {
    const coverage = section(renderReport(makeReport()), "coverage");
    expect(coverage).toContain('<span class="px-note">· 4 worktrees</span>');
    expect(coverage).not.toContain("1 worktree");
  });

  it("keeps the project's own folder name readable when the path is long", () => {
    const report = makeReport();
    const projects = [{ projectPath: "/home/dev/projects/clients/acme/matrix-os", sessions: 30, activeMinutes: 900, worktrees: 9 }];
    const coverage = section(renderReport({ ...report, activity: { ...report.activity, projects } }), "coverage");
    expect(coverage).toContain('title="~/projects/clients/acme/matrix-os · 9 worktrees"');
    expect(coverage).toContain('<span class="px-name">…/matrix-os</span><span class="px-note">· 9 worktrees</span>');
  });
});

describe("first screen at load", () => {
  it("starts every entrance animation from visible content, so a screenshot at load is never blank", () => {
    const html = renderReport(makeReport());
    const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    const keyframes = [...css.matchAll(/@keyframes\s+[\w-]+\{from\{([^}]*)\}/g)].map((match) => match[1]!);
    expect(keyframes.length).toBeGreaterThan(0);
    for (const from of keyframes) expect(from).not.toMatch(/opacity:\s*0(?![.\d])|visibility:\s*hidden/);
  });
});
