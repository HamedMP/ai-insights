import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/analysis/index.js";
import { renderReport } from "../../src/render/index.js";
import { availability, buildView, ratioText, recapView } from "../../src/render/view.js";
import type { Report } from "../../src/schema/types.js";
import { coverage, day, facet, NOW, prompt, session, sessionsOverDays, tool } from "../analysis/factory.js";
import { makeReport } from "./fixtures.js";

const ZONE = "UTC";

/** A history with real friction: context resets, a permission wall and a rule typed again and again. */
function troubled(): Report {
  const base = session().features;
  const sessions = sessionsOverDays(14, (i) => ({
    features: { ...base, compactions: i < 5 ? 3 : 0, planMode: i % 2 === 0 },
    ...(i >= 5 && i < 8 ? { toolCalls: [tool("shell", { command: "rm -rf dist", error: "permission_denied", timestamp: day(i, 1) }), tool("shell", { command: "rm -rf dist", error: "permission_denied", timestamp: day(i, 2) }), tool("edit", { timestamp: day(i, 3) })] } : {}),
    ...(i >= 8 && i < 12 ? { prompts: [prompt("never touch the generated folder please", day(i, 1))] } : {}),
  }));
  return buildReport({ sessions, coverage: [coverage("claude-code", sessions.length)], now: NOW, timeZone: ZONE });
}

describe("why sessions go wrong, on the page", () => {
  it("carries each cause with its counts, evidence and a link to the matching finding and its fix", () => {
    const view = buildView(troubled(), ZONE);
    const ran = view.causes!.causes.find((c) => c.key === "context_ran_out")!;
    expect(ran).toMatchObject({ label: "Context ran out", sessions: 5, of: 14 });
    expect(ran.evidence.length).toBeGreaterThan(0);
    expect(ran.evidence[0]!.when).toBeTruthy();
    const finding = view.findings.find((f) => f.id === "context_resets")!;
    expect(ran.finding).toBe(finding.anchor);
    expect(ran.action).toBe(finding.action);
  });

  it("is absent from reports saved before it existed, and from histories too small to call", () => {
    expect(buildView(makeReport(), ZONE).causes).toBeNull();
    const small = buildReport({ sessions: sessionsOverDays(4), coverage: [coverage("claude-code", 4)], now: NOW, timeZone: ZONE });
    expect(buildView(small, ZONE).causes).toBeNull();
  });

  it("says when the agent review was not used, so the reader knows more causes exist", () => {
    expect(buildView(troubled(), ZONE).causes!.usedReview).toBe(false);
    const sessions = sessionsOverDays(12);
    const judged = buildReport({ sessions, facets: sessions.map((s) => facet(s.id, { frictions: { misunderstood_request: 1 } })), coverage: [coverage("claude-code", 12)], now: NOW, timeZone: ZONE });
    const view = buildView(judged, ZONE);
    expect(view.causes!.usedReview).toBe(true);
    expect(view.causes!.causes.map((c) => c.key)).toContain("unclear_request");
  });

  it("puts the section's text in the page as data, never as markup", () => {
    const html = renderReport(troubled());
    expect(html).toContain("Context ran out");
    expect(html).toContain("Sessions running at once");
  });
});

describe("work ratios, on the page", () => {
  it("lists the five ratios with readable values, definitions and the counts behind them", () => {
    const ratios = buildView(troubled(), ZONE).ratios!;
    expect(ratios.map((r) => r.key)).toEqual(["correctionsPerSession", "contextResetShare", "toolErrorRate", "planFirstShare", "parallelism"]);
    const reset = ratios.find((r) => r.key === "contextResetShare")!;
    expect(reset).toMatchObject({ text: "36%", numerator: 5, denominator: 14 });
    for (const r of ratios) expect(r.definition.length).toBeGreaterThan(20);
  });

  it("writes n/a, not 0 or NaN, when a ratio has nothing to divide by", () => {
    expect(ratioText(null, "share")).toBe("n/a");
    expect(ratioText(Number.NaN, "times")).toBe("n/a");
    expect(ratioText(0.004, "share")).toBe("<1%");
    expect(ratioText(0, "share")).toBe("0%");
    expect(ratioText(1.75, "times")).toBe("1.8×");
    expect(ratioText(0.25, "per_session")).toBe("0.25");
  });

  it("is absent from older reports", () => {
    expect(buildView(makeReport(), ZONE).ratios).toBeNull();
  });
});

describe("earned titles, on the recap", () => {
  it("offers the titles card only when a title was earned, with the rule that earned it", () => {
    const report = troubled();
    const recap = recapView(report)!;
    expect(recap.persona!.earned.map((t) => t.title)).toContain("The Deep Diver");
    expect(recap.persona!.earned.every((t) => t.rule.includes("earns it"))).toBe(true);
    expect(availability(recap).titles).toBe(true);
    const none = recapView(buildReport({ sessions: sessionsOverDays(3), coverage: [coverage("claude-code", 3)], now: NOW, timeZone: ZONE }))!;
    expect(none.persona!.earned).toEqual([]);
    expect(availability(none).titles).toBe(false);
  });
});
