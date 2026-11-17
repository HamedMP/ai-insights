import { describe, expect, it } from "vitest";
import { buildReport } from "../../../src/analysis/index.js";
import { TITLE_RULES, titlesOf } from "../../../src/analysis/recap/titles.js";
import { WORK_RATIO_KEYS, type WorkRatio, type WorkRatioKey, type WorkRatios } from "../../../src/schema/types.js";
import { coverage, NOW, sessionsOverDays, session } from "../factory.js";

function ratios(values: Partial<Record<WorkRatioKey, [number | null, number]>>): WorkRatios {
  const out = {} as WorkRatios;
  for (const key of WORK_RATIO_KEYS) {
    const [value, denominator] = values[key] ?? [null, 0];
    out[key] = { key, label: key, definition: "d", value, numerator: 0, denominator, unit: "share", counts: { numerator: "a", denominator: "b" } } satisfies WorkRatio;
  }
  return out;
}

describe("earned titles", () => {
  it("earns a title from a ratio and shows the rule with the number that earned it", () => {
    expect(titlesOf(ratios({ correctionsPerSession: [0.05, 40] }))).toEqual([
      { key: "clear_briefer", title: "The Clear Briefer", ratio: "correctionsPerSession", value: 0.05, rule: "0.05 mid-run corrections per session (0.10 or fewer earns it)" },
    ]);
  });

  it("earns nothing from too few sessions, so luck in four sessions is not a title", () => {
    expect(titlesOf(ratios({ correctionsPerSession: [0, 4], planFirstShare: [1, 9], toolErrorRate: [0, 150] }))).toEqual([]);
  });

  it("earns nothing in the unremarkable middle, and never from a missing value", () => {
    expect(titlesOf(ratios({ correctionsPerSession: [0.5, 40], planFirstShare: [0.3, 40], parallelism: [1.5, 40], contextResetShare: [0.15, 40], toolErrorRate: [0.08, 900] }))).toEqual([]);
    expect(titlesOf(ratios({ correctionsPerSession: [null, 40] }))).toEqual([]);
  });

  it("shows at most three, one per ratio, in a fixed order", () => {
    const earned = titlesOf(ratios({ correctionsPerSession: [2, 40], planFirstShare: [0.7, 40], parallelism: [3, 40], contextResetShare: [0, 40], toolErrorRate: [0.01, 900] }));
    expect(earned.map((t) => t.key)).toEqual(["hands_on_pilot", "architect", "conductor"]);
  });

  it("uses fixed wording only, none of it unkind", () => {
    for (const rule of TITLE_RULES) {
      expect(rule.title).toMatch(/^The [A-Z][A-Za-z-]+(?: [A-Z][a-z]+)*$/);
      expect(rule.title.toLowerCase()).not.toMatch(/bad|worst|slow|lazy|noob|sloppy/);
    }
  });

  it("puts earned titles on the recap persona, from the report's own ratios", () => {
    const base = session().features;
    const sessions = sessionsOverDays(12, () => ({ features: { ...base, planMode: true } }));
    const report = buildReport({ sessions, coverage: [coverage("claude-code", 12)], now: NOW, timeZone: "UTC" });
    expect(report.recap!.persona!.earned!.map((t) => t.title)).toContain("The Architect");
    // Same sessions, same titles: nothing depends on order or time of day.
    const again = buildReport({ sessions: [...sessions].reverse(), coverage: [coverage("claude-code", 12)], now: NOW, timeZone: "UTC" });
    expect(again.recap!.persona!.earned).toEqual(report.recap!.persona!.earned);
  });

  it("leaves `earned` off when nothing was earned", () => {
    const report = buildReport({ sessions: sessionsOverDays(3), coverage: [coverage("claude-code", 3)], now: NOW, timeZone: "UTC" });
    expect(report.recap!.persona!.earned).toBeUndefined();
  });
});
