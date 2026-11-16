import { describe, expect, it } from "vitest";
import { buildStory, chapterTips, lineText, rankActions } from "../../src/render/story.js";
import type { Report } from "../../src/schema/types.js";
import { makeDeterministicReport, makeEmptyReport, makeReport, makeRetentionFinding } from "./fixtures.js";

const ZONE = "Europe/Berlin";

function allLines(report: Report): string[] {
  const story = buildStory(report, ZONE);
  return [story.headline, story.subline, story.hours, story.week, story.delegation, story.parallel, story.where, story.tokens, story.cost, story.friction, story.history]
    .filter((line) => line !== null)
    .map((line) => lineText(line!));
}

describe("story lines on rich data", () => {
  const report = makeReport();
  const story = buildStory(report, ZONE);

  it("leads with agent time against the person's own time when parallel work multiplies it", () => {
    expect(lineText(story.headline)).toMatch(/^Your agents put in [\d.,]+ h of work in [\d.,]+ h of yours\.$/);
  });

  it("speaks to the person in second person and states a number in every line", () => {
    for (const text of allLines(report).filter((line) => !line.startsWith("At API list prices"))) {
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
    expect(lineText(story.week!)).toMatch(/^Your busiest day is (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), and \d+% of your sessions start on weekends\.$/);
  });

  it("measures delegation as tool calls per message you typed, from two totals the page shows", () => {
    const calls = report.activity.toolCategories.reduce((sum, entry) => sum + entry.count, 0);
    const perMessage = Math.round(calls / report.activity.userMessages);
    expect(lineText(story.delegation!)).toMatch(
      new RegExp(`^Each message you send sets off about ${perMessage} tool calls, and your agents changed [\\d.]+K lines across ${report.activity.sessions} sessions\\.$`),
    );
  });

  it("contrasts agent-hours with wall-clock hours when both are known", () => {
    expect(lineText(story.parallel!)).toMatch(/^Running up to 8 sessions at once, your agents logged 2\.8× the hours you did: [\d.,]+ h of agent time in [\d.,]+ h\.$/);
  });

  it("names where the time went using the project folder name, never the full path", () => {
    const where = lineText(story.where!);
    expect(where).toContain("storefront");
    expect(where).not.toContain("/home/");
    expect(where).toMatch(/Claude Code \(\d+%\) and Codex \(\d+%\)/);
  });

  it("states the token volume with its cache share", () => {
    expect(lineText(story.tokens!)).toMatch(/^Your agents moved [\d.]+[KMB] tokens; \d+\.\d% of their input came from cache\.$/);
  });

  it("prices only the share of requests it can price, and says the rest has no known price", () => {
    expect(lineText(story.cost!)).toMatch(/^At API list prices, the \d+% of requests with a known price come to about \$[\d,]+; the rest use models with no known price\.$/);
  });

  it("puts a share on failed tool calls and counts the patterns worth fixing", () => {
    expect(lineText(story.friction!)).toMatch(/^[\d.]+% of your agents' tool calls failed, most often a failed command\. AI Insights found 4 patterns worth fixing; each is below\. The other \d+ findings are about [a-z ,]+\.$/);
  });

  it("never shows a bare cost when requests are unpriced: it names the share and the models", () => {
    const cost = story.numbers[3]!;
    expect(cost.value).toMatch(/^≈ \$[\d,]+$/);
    expect(cost.label).toMatch(/^For the \d+% of requests with a known price$/);
    expect(cost.note).toMatch(/^\d+% of requests unpriced: local-experimental-model$/);
  });

  it("gives four headline numbers, with person hours first and agent-hours as the caveat", () => {
    expect(story.numbers.map((number) => number.label).slice(0, 3)).toEqual(["Hours with AI at work", "Sessions", "Lines changed"]);
    expect(story.numbers[0]!.note).toMatch(/agent-hours across sessions$/);
  });
});

describe("story lines on sparse and single-harness data", () => {
  const report = makeDeterministicReport();
  const story = buildStory(report, ZONE);

  it("still has a headline and a subline", () => {
    expect(lineText(story.headline)).toBe("You ran up to 4 agent sessions at the same time.");
    expect(story.subline).not.toBeNull();
  });

  it("labels summed time as agent-hours when wall-clock time was not measured", () => {
    expect(story.numbers[0]!.label).toBe("Agent-hours");
  });

  it("falls back to agent time over active days when nothing else is striking", () => {
    const quiet = makeDeterministicReport();
    quiet.activity.parallelSessions = { overlapEvents: 0, maxConcurrent: 1, sessionsInvolved: 0 };
    quiet.activity.toolCategories = [{ key: "edit", count: quiet.activity.userMessages * 2 }];
    expect(lineText(buildStory(quiet, ZONE).headline)).toMatch(/^Your agents logged [\d.,]+ h of work over \d+ days\.$/);
  });

  it("counts overlap from the parallel totals when wall-clock time is missing", () => {
    const sessions = makeDeterministicReport().activity.sessions;
    // The fixture claims more sessions involved than exist; the line caps it at the total.
    expect(lineText(story.parallel!)).toBe(`You ran up to 4 sessions at once, and ${sessions} of ${sessions} sessions overlapped with another.`);
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
    const story = buildStory(unpriced, ZONE);
    expect(story.cost).toBeNull();
    expect(lineText(story.tokens!)).not.toMatch(/free|\$/);
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
    expect(lineText(story.headline)).toBe("AI Insights did not find any coding-agent history on this machine yet.");
    expect(story.numbers).toEqual([]);
  });

  it("has no line for any chapter whose data is missing", () => {
    for (const key of ["subline", "hours", "week", "delegation", "parallel", "where", "tokens", "cost", "friction", "history"] as const) {
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

  it("keeps 'Keep your history' out of the ranked list: it has its own block, so it is not offered twice", () => {
    const report = makeReport();
    const { top, rest } = rankActions({ ...report, findings: [makeRetentionFinding({ severity: "high" }), ...report.findings] });
    expect([...top, ...rest].map((action) => action.suggestion.title)).not.toContain("Keep your history");
    expect(allLines({ ...report, findings: [makeRetentionFinding(), ...report.findings] }).join(" ")).not.toContain("will be deleted");
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
