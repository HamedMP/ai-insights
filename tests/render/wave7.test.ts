import { describe, expect, it } from "vitest";
import { formatCacheRate } from "../../src/render/format.js";
import { renderReport } from "../../src/render/index.js";
import { buildStory, delegationRatio, foldTarget, lineText, rankActions } from "../../src/render/story.js";
import type { Finding, Report } from "../../src/schema/types.js";
import { makeDeterministicReport, makeReport } from "./fixtures.js";

function section(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
}

const LONG: Finding = {
  id: "long_sessions",
  kind: "long_sessions",
  severity: "info",
  title: "Some sessions run very long",
  detail: "9 sessions (14%) ran over 2.5 h of agent activity. 9 of them also ran out of context, so this is mostly the same pattern as the context-resets finding; splitting them fixes both.",
  harnesses: ["claude-code"],
  metric: { value: 9, unit: "sessions", label: "very long sessions" },
  evidence: [{ sessionId: "a1b2c3d4-0020", harness: "claude-code", note: "4 h of agent activity" }],
  suggestion: { type: "habit", title: "Split at natural checkpoints", action: "End the session when a piece of work is committed." },
};

function withLong(finding: Finding = LONG): Report {
  const report = makeReport();
  return { ...report, findings: [...report.findings, finding] };
}

describe("the daily series names its hours", () => {
  it("calls the per-day hours what they are: wall-clock time with AI at work", () => {
    const rhythm = section(renderReport(makeDeterministicReport()), "rhythm");
    expect(rhythm).toMatch(/with AI at work<\/title>/);
    expect(rhythm).not.toContain("agent time");
  });
});

describe("one count for patterns, findings and changes", () => {
  it("says what the findings outside the patterns are about", () => {
    const report = makeReport();
    const line = lineText(buildStory(report, "UTC").friction!);
    const others = report.findings.filter((finding) => ["history_disk_usage", "short_history", "unused_feature", "single_harness_only"].includes(finding.kind)).length;
    expect(line).toContain(`The other ${others} findings are about`);
    expect(line).toContain("your history on disk");
  });

  it("says where the ranked changes come from", () => {
    const improve = section(renderReport(makeReport()), "improve");
    expect(improve).toMatch(/Hindsight ranked <em>\d+ changes<\/em>, from the findings above and your agent&#39;s review; start with these three\./);
    const noNarrative = section(renderReport(makeDeterministicReport()), "improve");
    expect(noNarrative).toMatch(/Hindsight ranked <em>\d+ changes?<\/em>, from the findings above[;.]/);
  });
});

describe("a delegation number a reader can redo", () => {
  it("divides the tool calls by the messages typed, and prints both in the caption", () => {
    const report = makeReport();
    const ratio = delegationRatio(report)!;
    const delegation = section(renderReport(report), "delegation");
    const calls = ratio.toolCalls.toLocaleString("en-US");
    const messages = ratio.messages.toLocaleString("en-US");
    expect(delegation).toContain(`${calls} tool calls ÷ ${messages} messages you typed`);
    expect(delegation).toContain(`≈ ${Math.round(ratio.toolCalls / ratio.messages)} tool calls`);
    expect(delegation).not.toContain("agent steps");
  });

  it("does not claim a ratio when either total is missing", () => {
    const report = makeReport();
    expect(delegationRatio({ ...report, activity: { ...report.activity, toolCategories: [] } })).toBeNull();
    expect(delegationRatio({ ...report, activity: { ...report.activity, userMessages: 0 } })).toBeNull();
  });
});

describe("one cache hit rate", () => {
  it("prints the same rate, from one field and one rounding, wherever it appears", () => {
    const report = makeReport();
    report.usage.cacheHitRate = 0.97339;
    const html = renderReport(report);
    expect(formatCacheRate(0.97339)).toBe("97.3%");
    const usage = section(html, "usage");
    expect(usage).toContain("<em>97.3%</em> of their input came from cache");
    expect(usage).toContain("Cache hit rate 97.3%: cache reads ÷ all input, cache writes included.");
    expect(usage).toMatch(/Percentages are shares of all [\d.]+[KMB] tokens\./);
    expect(usage).not.toMatch(/\b97%/);
  });
});

describe("long sessions that are mostly context resets", () => {
  it("folds the long-sessions card under the context-resets card as one line", () => {
    const report = withLong();
    const ranked = rankActions(report);
    const all = [...ranked.top, ...ranked.rest];
    expect(all.some((action) => action.finding?.kind === "long_sessions")).toBe(false);
    const card = all.find((action) => action.finding?.kind === "context_resets")!;
    expect(card.alsoCovers?.map((folded) => folded.note)).toEqual(["Also covers the 9 very long sessions, mostly the same sessions: split at natural checkpoints."]);

    const html = renderReport(report);
    const improve = section(html, "improve");
    expect(improve).toContain('<p class="also-covers">Also covers the 9 very long sessions');
    expect(improve).not.toContain("<b>Split at natural checkpoints</b>");
    expect(improve).toContain(`Hindsight ranked <em>${all.length} changes</em>`);
  });

  it("points the long-sessions finding's own link at the card that now carries it", () => {
    const html = renderReport(withLong());
    const anchor = /<li class="action reveal" id="(action-\d+)">(?:(?!<\/li>)[\s\S])*Context was compacted/.exec(section(html, "improve"))?.[1];
    expect(anchor).toBeDefined();
    const friction = section(html, "friction");
    const longCard = friction.slice(friction.indexOf("Some sessions run very long"));
    expect(longCard.slice(0, longCard.indexOf("</article>"))).toContain(`href="#${anchor}"`);
  });

  it("keeps long sessions as their own card when analysis did not demote them for that reason", () => {
    const report = makeReport();
    expect(foldTarget({ ...LONG, severity: "low" }, report.findings)).toBeNull();
    expect(foldTarget({ ...LONG, detail: "9 sessions ran over 2.5 h." }, report.findings)).toBeNull();
    expect(foldTarget(LONG, report.findings.filter((finding) => finding.kind !== "context_resets"))).toBeNull();
    const ranked = rankActions(withLong({ ...LONG, severity: "low" }));
    expect([...ranked.top, ...ranked.rest].some((action) => action.finding?.kind === "long_sessions")).toBe(true);
  });
});
