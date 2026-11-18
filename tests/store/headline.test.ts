import { describe, expect, it } from "vitest";
import { describeHeadline } from "../../src/store/pipeline.js";
import { fakeBuildReport, makeSession } from "./fixtures.js";

const sessions = [makeSession({ id: "a", activeMinutes: 4_800 }), makeSession({ id: "b", activeMinutes: 2_400 })];

function report(options: Parameters<typeof fakeBuildReport>[1]) {
  return fakeBuildReport([], options)({ sessions, coverage: [] });
}

describe("describeHeadline", () => {
  it("uses wall-clock time for active hours and labels the summed figure agent-hours", () => {
    const headline = describeHeadline(report({ wallClockActiveMinutes: 5_400 }));
    expect(headline.activeHours).toBe(90);
    expect(headline.agentHours).toBe(120);
    expect(headline.time).toBe("90 active hours (120 agent-hours across parallel sessions)");
  });

  it("falls back to agent-hours alone when the analysis has no wall-clock figure", () => {
    const headline = describeHeadline(report({}));
    expect(headline.activeHours).toBeNull();
    expect(headline.time).toBe("120 agent-hours");
  });

  it("says how much of the usage could not be priced next to the cost", () => {
    const headline = describeHeadline(report({ estimatedUsd: 1_633.4, requests: 1_000, unpriced: 130 }));
    expect(headline.cost).toBe("about $1,633 for the requests we can price; 13% unpriced");
    expect(headline.unpricedShare).toBeCloseTo(0.13);
    expect(headline.unpricedModels).toEqual(["model-0", "model-1"]);
  });

  it("does not round a small unpriced share down to zero", () => {
    expect(describeHeadline(report({ estimatedUsd: 50, requests: 1_000, unpriced: 2 })).cost).toBe(
      "about $50.00 for the requests we can price; <1% unpriced",
    );
  });

  it("says next to the cost that Codex spend with no recorded speed tier is priced at Standard", () => {
    const base = report({ estimatedUsd: 100, requests: 10, unpriced: 0 });
    const withUntiered = { ...base, usage: { ...base.usage, untiered: [{ harness: "codex" as const, requests: 4, estimatedUsd: 40, atFastUsd: 80 }] } };
    expect(describeHeadline(withUntiered).cost).toBe("about $100 at API list prices; Codex $40.00 has no recorded speed tier and is priced at Standard (about $80.00 on Fast)");
  });

  it("states a plain list-price estimate when everything was priced", () => {
    expect(describeHeadline(report({ estimatedUsd: 0.42, requests: 10, unpriced: 0 })).cost).toBe("about $0.42 at API list prices");
  });

  it("never shows a dollar figure when nothing could be priced", () => {
    const headline = describeHeadline(report({ estimatedUsd: null, requests: 10, unpriced: 10 }));
    expect(headline.cost).toBe("cost unknown: none of the requests could be priced");
    expect(headline.cost).not.toContain("$");
  });
});
