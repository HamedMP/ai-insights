import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/analysis/index.js";
import { FINDING_KINDS, type Narrative } from "../../src/schema/types.js";
import { DETECTORS } from "../../src/analysis/findings/index.js";
import { coverage, day, facet, NOW, session, sessionsOverDays, shell } from "./factory.js";

describe("buildReport", () => {
  it("gives the same report for the same input, whatever the input order", () => {
    const sessions = sessionsOverDays(12, (index) => ({
      toolCalls: [shell("pnpm lint", "command_failed", day(index, 1)), shell("pnpm lint", "command_failed", day(index, 2))],
    }));
    const input = { coverage: [coverage("claude-code", 12), coverage("codex", 0)], now: NOW, timeZone: "UTC" };
    const forward = buildReport({ ...input, sessions });
    const backward = buildReport({ ...input, sessions: [...sessions].reverse() });
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });

  it("has a detector for every finding kind", () => {
    expect(Object.keys(DETECTORS).sort()).toEqual([...FINDING_KINDS].sort());
  });

  it("reports the time zone it used, falling back to UTC for a bad one", () => {
    const report = buildReport({ sessions: [], coverage: [], now: NOW, timeZone: "Not/AZone" });
    expect(report.timeZone).toBe("UTC");
    expect(report.generatedAt).toBe(NOW.toISOString());
  });

  it("covers the whole span of the sessions", () => {
    const report = buildReport({ sessions: sessionsOverDays(3), coverage: [], now: NOW, timeZone: "UTC" });
    expect(report.range.from).toBe(day(0));
    expect(report.range.to).toBe(new Date(Date.parse(day(2)) + 30 * 60_000).toISOString());
  });

  it("ignores a session handed over twice", () => {
    const one = session({ id: "dup" });
    const report = buildReport({ sessions: [one, { ...one }], coverage: [], now: NOW, timeZone: "UTC" });
    expect(report.activity.sessions).toBe(1);
  });

  it("aggregates facets for the report's sessions only, and is null without any", () => {
    const sessions = [session({ id: "s1" }), session({ id: "s2" })];
    const base = { sessions, coverage: [], now: NOW, timeZone: "UTC" };
    expect(buildReport(base).facets).toBeNull();
    const report = buildReport({
      ...base,
      facets: [
        facet("s1", { frictions: { buggy_code: 2 }, goalCategories: ["feature", "tests"] }),
        facet("s2", { outcome: "partially_achieved", frictions: { buggy_code: 1, wrong_approach: 1 }, primarySuccess: null }),
        facet("not-in-report", { outcome: "not_achieved" }),
      ],
    });
    expect(report.facets?.sessionsWithFacets).toBe(2);
    expect(report.facets?.frictions).toEqual([
      { key: "buggy_code", count: 3 },
      { key: "wrong_approach", count: 1 },
    ]);
    expect(report.facets?.outcomes).toEqual([
      { key: "fully_achieved", count: 1 },
      { key: "partially_achieved", count: 1 },
    ]);
    expect(report.facets?.goalCategories).toEqual([
      { key: "feature", count: 2 },
      { key: "tests", count: 1 },
    ]);
    expect(report.facets?.successes).toEqual([{ key: "correct_code_edits", count: 1 }]);
  });

  it("passes the saved narrative through", () => {
    const narrative: Narrative = { headline: "h", workAreas: [], interactionStyle: "", wins: [], frictions: [], suggestions: [], horizon: [] };
    expect(buildReport({ sessions: [], coverage: [], narrative, now: NOW }).narrative).toBe(narrative);
  });

  it("sorts findings by severity, then by metric", () => {
    const sessions = sessionsOverDays(10, (index) => ({
      features: { ...session().features, compactions: index < 4 ? 4 : 0 },
    }));
    const report = buildReport({ sessions, coverage: [coverage("claude-code", 10), coverage("codex", 0)], now: NOW, timeZone: "UTC" });
    const ranks = { high: 3, medium: 2, low: 1, info: 0 };
    const order = report.findings.map((finding) => ranks[finding.severity]);
    expect(order).toEqual([...order].sort((a, b) => b - a));
    expect(report.findings.length).toBeGreaterThan(1);
  });

  it("keeps a healthy month of work free of problem findings", () => {
    const sessions = sessionsOverDays(40, (index) => ({ harness: index % 2 ? "codex" : "claude-code" }));
    const report = buildReport({ sessions, coverage: [coverage("claude-code", 20), coverage("codex", 20)], now: new Date(day(41)), timeZone: "UTC" });
    expect(report.findings).toEqual([]);
  });

  it("gives every finding evidence, and a suggestion with something to do", () => {
    const sessions = sessionsOverDays(12, (index) => ({
      toolCalls: [1, 2, 3].map((minute) => shell("npm run lint", "command_failed", day(index, minute))),
      features: { ...session().features, compactions: 3 },
    }));
    const report = buildReport({ sessions, coverage: [coverage("claude-code", 12), coverage("codex", 0)], now: NOW, timeZone: "UTC" });
    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.evidence.length).toBeLessThanOrEqual(5);
      for (const item of finding.evidence) expect(item.note).not.toContain("\n");
      expect(finding.suggestion?.action.length).toBeGreaterThan(10);
    }
  });
});
