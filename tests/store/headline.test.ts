import { describe, expect, it } from "vitest";
import { describeHeadline, foldProjectsByRoot } from "../../src/store/pipeline.js";
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

  it("states a plain list-price estimate when everything was priced", () => {
    expect(describeHeadline(report({ estimatedUsd: 0.42, requests: 10, unpriced: 0 })).cost).toBe("about $0.42 at API list prices");
  });

  it("never shows a dollar figure when nothing could be priced", () => {
    const headline = describeHeadline(report({ estimatedUsd: null, requests: 10, unpriced: 10 }));
    expect(headline.cost).toBe("cost unknown: none of the requests could be priced");
    expect(headline.cost).not.toContain("$");
  });
});

describe("foldProjectsByRoot", () => {
  const row = (projectPath: string, sessions: number, activeMinutes: number, worktrees?: number) => ({
    projectPath,
    sessions,
    activeMinutes,
    ...(worktrees === undefined ? {} : { worktrees }),
  });

  it("merges project rows from worktrees of one repository into its root and counts the folders", () => {
    const sessions = [
      makeSession({ id: "a", projectPath: "/r/app", projectRoot: "/r/app" }),
      makeSession({ id: "b", projectPath: "/r/app-wt/one", projectRoot: "/r/app" }),
      makeSession({ id: "c", projectPath: "/r/app-wt/two", projectRoot: "/r/app" }),
      makeSession({ id: "d", projectPath: "/r/other" }),
    ];
    const folded = foldProjectsByRoot([row("/r/app-wt/one", 5, 50), row("/r/other", 4, 90), row("/r/app", 2, 20), row("/r/app-wt/two", 1, 10)], sessions);
    expect(folded).toEqual([row("/r/other", 4, 90), row("/r/app", 8, 80, 3)]);
  });

  it("leaves rows already grouped by root alone, keeping their worktree counts", () => {
    const sessions = [makeSession({ id: "a", projectPath: "/r/app-wt/one", projectRoot: "/r/app" })];
    const rows = [row("/r/app", 3, 30, 2), row("/r/x", 1, 5)];
    expect(foldProjectsByRoot(rows, sessions)).toEqual(rows);
  });
});
