import { describe, expect, it } from "vitest";
import { buildStory, chapterTips, lineText, rankActions } from "../../src/render/story.js";
import type { Report } from "../../src/schema/types.js";
import { makeDeterministicReport, makeEmptyReport, makeReport } from "./fixtures.js";

const ZONE = "Europe/Berlin";

function allLines(report: Report): string[] {
  const story = buildStory(report, ZONE);
  return [story.headline, story.subline, story.hours, story.week, story.delegation, story.parallel, story.where, story.tokens, story.friction, story.history]
    .filter((line) => line !== null)
    .map((line) => lineText(line!));
}

describe("story lines on rich data", () => {
  const report = makeReport();
  const story = buildStory(report, ZONE);

  it("leads with the most distinctive fact, backed by its number", () => {
    expect(lineText(story.headline)).toBe("You ran up to 4 agent sessions at the same time.");
  });

  it("speaks to the person in second person and states a number in every line", () => {
    for (const text of allLines(report)) {
      expect(text).toMatch(/\b(You|Your|you|your)\b/);
      expect(text).toMatch(/\d/);
    }
  });

  it("marks the number in each line so the page can emphasise it", () => {
    expect(story.hours!.some((segment) => segment.strong)).toBe(true);
  });

  it("names the busiest hours from the hour histogram", () => {
    expect(lineText(story.hours!)).toMatch(/^You do most of your work between \d\d:00 and \d\d:00: \d+% of your messages land there\.$/);
  });

  it("describes the shape of the week from the daily buckets", () => {
    expect(lineText(story.week!)).toMatch(/^Your busiest day is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), and \d+% of your sessions fall on weekends\.$/);
  });

  it("measures delegation as agent steps per message you send", () => {
    expect(lineText(story.delegation!)).toMatch(
      new RegExp(`^Each message you send gets about 7 agent steps back, and your agents changed [\\d.]+K lines across ${report.activity.sessions} sessions\\.$`),
    );
  });

  it("counts overlap from the parallel-session totals", () => {
    expect(lineText(story.parallel!)).toBe(`You ran up to 4 sessions at once, and 121 of ${report.activity.sessions} sessions overlapped with another.`);
  });

  it("names where the time went using the project folder name, never the full path", () => {
    const where = lineText(story.where!);
    expect(where).toContain("storefront");
    expect(where).not.toContain("/home/");
    expect(where).toMatch(/Claude Code \(\d+%\) and Codex \(\d+%\)/);
  });

  it("states the cache share and the list-price estimate for tokens", () => {
    expect(lineText(story.tokens!)).toMatch(/^Your agents moved [\d.]+[KMB] tokens; \d+% of their input came from cache\. At API list prices that is about \$[\d,]+\.$/);
  });

  it("puts a share on failed tool calls and counts the patterns worth fixing", () => {
    expect(lineText(story.friction!)).toMatch(/^[\d.]+% of your agents' tool calls failed, most often a failed command\. Hindsight found 4 patterns worth fixing\.$/);
  });

  it("gives four headline numbers for the first screen", () => {
    expect(story.numbers.map((number) => number.label)).toEqual(["Hands-on time", "Sessions", "Lines changed", "At API list prices"]);
  });
});

describe("story lines on sparse and single-harness data", () => {
  const report = makeDeterministicReport();
  const story = buildStory(report, ZONE);

  it("still has a headline and a subline", () => {
    expect(lineText(story.headline)).toMatch(/\d/);
    expect(story.subline).not.toBeNull();
  });

  it("does not split sessions between tools when there is only one", () => {
    expect(lineText(story.where!)).toMatch(/^All \d+ sessions ran in Claude Code/);
  });

  it("drops the week line when there are too few days to call it a pattern", () => {
    const short = makeDeterministicReport();
    short.activity.daily = short.activity.daily.slice(-6);
    expect(buildStory(short, ZONE).week).toBeNull();
  });

  it("drops the hours line when there are too few messages to call it a habit", () => {
    const few = makeDeterministicReport();
    few.activity.hourHistogram = few.activity.hourHistogram.map((_, hour) => (hour === 9 ? 3 : 0));
    expect(buildStory(few, ZONE).hours).toBeNull();
  });

  it("says sessions ran one at a time only when the totals show no overlap", () => {
    const solo = makeDeterministicReport();
    solo.activity.parallelSessions = { overlapEvents: 0, maxConcurrent: 1, sessionsInvolved: 0 };
    expect(lineText(buildStory(solo, ZONE).parallel!)).toBe(`You ran your ${solo.activity.sessions} sessions one at a time.`);
  });

  it("leaves the cost out instead of calling unpriced usage free", () => {
    const unpriced = makeDeterministicReport();
    unpriced.usage.estimatedUsd = null;
    const text = lineText(buildStory(unpriced, ZONE).tokens!);
    expect(text).not.toContain("$");
    expect(text).not.toMatch(/free|\$0/);
  });

  it("does not claim a cache share it does not have", () => {
    const noCache = makeDeterministicReport();
    noCache.usage.cacheHitRate = null;
    expect(lineText(buildStory(noCache, ZONE).tokens!)).not.toContain("cache");
  });
});

describe("story lines on empty data", () => {
  const story = buildStory(makeEmptyReport(), ZONE);

  it("says plainly that nothing was found, without numbers it does not have", () => {
    expect(lineText(story.headline)).toBe("Hindsight did not find any coding-agent history on this machine yet.");
    expect(story.numbers).toEqual([]);
  });

  it("has no line for any chapter whose data is missing", () => {
    for (const key of ["subline", "hours", "week", "delegation", "parallel", "where", "tokens", "friction", "history"] as const) {
      expect(story[key]).toBeNull();
    }
  });
});

describe("chapter tips", () => {
  it("attaches each chapter's strongest matching finding, using each finding once", () => {
    const tips = chapterTips(makeReport());
    expect(tips.friction?.id).toBe("repeated_failed_command:pnpm test");
    expect(tips.usage?.id).toBe("cache_miss_cost");
    expect(tips.delegation?.kind).toBe("unused_feature");
    const ids = Object.values(tips).filter(Boolean).map((finding) => finding!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no tips when there are no findings", () => {
    expect(Object.values(chapterTips(makeEmptyReport())).every((tip) => tip === null)).toBe(true);
  });
});

describe("ranked actions", () => {
  it("ranks the top three by severity and actionability, with why and what to do", () => {
    const { top } = rankActions(makeReport());
    expect(top).toHaveLength(3);
    expect(top[0]!.suggestion.title).toBe("Tell the agent how tests run here");
    expect(top[0]!.finding?.severity).toBe("high");
    for (const action of top) expect(action.why.length).toBeGreaterThan(0);
  });

  it("keeps Matrix OS and disk-space suggestions for the closing cards", () => {
    const { top, rest } = rankActions(makeDeterministicReport());
    const titles = [...top, ...rest].map((action) => action.suggestion.title);
    expect(titles).not.toContain("Keep your full history");
    expect(titles).not.toContain("Compress and save disk space");
  });

  it("de-duplicates suggestions with the same title", () => {
    const report = makeReport();
    report.narrative!.suggestions.push({ ...report.findings[0]!.suggestion! });
    const { top, rest } = rankActions(report);
    const titles = [...top, ...rest].map((action) => action.suggestion.title);
    expect(titles.filter((title) => title === "Tell the agent how tests run here")).toHaveLength(1);
  });

  it("returns nothing to rank when there are no suggestions", () => {
    expect(rankActions(makeEmptyReport())).toEqual({ top: [], rest: [] });
  });
});
