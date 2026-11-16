import { describe, expect, it } from "vitest";
import { renderReport } from "../../src/render/index.js";
import { buildStory, lineText, rankActions, specificity } from "../../src/render/story.js";
import { buildTimeline, spanTimeline, spanText } from "../../src/render/timeline.js";
import { shortHistoryCoverage } from "../../src/render/chapters/advice.js";
import type { Coverage, Finding, Report, SessionSpan, Suggestion } from "../../src/schema/types.js";
import { makeDeterministicReport, makeReport } from "./fixtures.js";

function section(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
}

function withSuggestions(suggestions: Suggestion[], report: Report = makeReport()): Report {
  return { ...report, narrative: { ...report.narrative!, suggestions } };
}

const HANDOVER: Suggestion = {
  type: "instructions",
  title: "Write a handover before the context runs out",
  action: "Add this to CLAUDE.md so long sessions end in a handover file.",
  instructionText: "When this session has been compacted once, stop at the next commit and write HANDOFF.md with the goal, what is done and the next step.",
  findingId: "context_resets",
};

describe("one card per idea in What to improve", () => {
  it("folds a narrative suggestion into the finding it names, keeping the finding's title and number", () => {
    const report = withSuggestions([HANDOVER]);
    const ranked = rankActions(report);
    const all = [...ranked.top, ...ranked.rest];
    const cards = all.filter((action) => action.finding?.id === "context_resets" || action.suggestion.title === HANDOVER.title);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.suggestion.title).toBe("Split long tasks into planned sessions");
    expect(cards[0]!.instructionText).toBe(HANDOVER.instructionText);
    expect(cards[0]!.agreed).toBe(true);

    const improve = section(renderReport(report), "improve");
    expect(improve).not.toContain(HANDOVER.title);
    expect(improve).toContain("Split long tasks into planned sessions");
    expect(improve).toContain("<b>88</b><span>compactions</span>");
    expect(improve).toContain("stop at the next commit and write HANDOFF.md");
    expect(improve).toContain("Your agent's review suggested this too");
  });

  it("counts cards after merging, so the headline matches the list", () => {
    const report = withSuggestions([HANDOVER, { type: "habit", title: "A separate idea", action: "Something else entirely." }]);
    const ranked = rankActions(report);
    const total = ranked.top.length + ranked.rest.length;
    const improve = section(renderReport(report), "improve");
    expect(improve).toContain(`AI Insights ranked <em>${total} changes</em>`);
    expect(improve.match(/<li class="(?:action )?reveal" id="action-\d+"/g)).toHaveLength(total);
  });

  it("uses the narrative's action when it is the more specific one, and the finding's otherwise", () => {
    const specific = { type: "habit" as const, title: "Hand off", action: "Stop at 2 compactions and write `HANDOFF.md` from `git log -5`.", findingId: "context_resets" };
    const vague = { type: "habit" as const, title: "Hand off", action: "Try to hand off more.", findingId: "context_resets" };
    const pick = (suggestion: Suggestion) => [...rankActions(withSuggestions([suggestion])).top, ...rankActions(withSuggestions([suggestion])).rest].find((action) => action.finding?.id === "context_resets")!;
    expect(pick(specific).action).toBe(specific.action);
    expect(pick(vague).action).toBe("Write a short plan file first and start each step in a fresh session that reads it.");
    expect(specificity("Add `\"Bash(gh pr ready:*)\"` to .claude/settings.json")).toBeGreaterThan(specificity("Allow the commands you keep approving."));
  });

  it("does not guess: without a findingId, a differently titled suggestion stays its own card", () => {
    const lookalike = { ...HANDOVER, findingId: undefined } as Suggestion;
    const all = (() => {
      const ranked = rankActions(withSuggestions([lookalike]));
      return [...ranked.top, ...ranked.rest];
    })();
    expect(all.some((action) => action.suggestion.title === HANDOVER.title && action.finding === null)).toBe(true);
    expect(all.some((action) => action.finding?.id === "context_resets")).toBe(true);
  });

  it("merges exact repeats of type and title even without a findingId", () => {
    const repeat: Suggestion = { type: "habit", title: "split long tasks into planned sessions ", action: "Same idea, said again." };
    const ranked = rankActions(withSuggestions([repeat]));
    expect([...ranked.top, ...ranked.rest].filter((action) => action.suggestion.title.trim().toLowerCase() === "split long tasks into planned sessions")).toHaveLength(1);
    const otherType: Suggestion = { ...repeat, type: "instructions" };
    const ranked2 = rankActions(withSuggestions([otherType]));
    expect([...ranked2.top, ...ranked2.rest].filter((action) => action.suggestion.title.trim().toLowerCase() === "split long tasks into planned sessions")).toHaveLength(2);
  });

  it("lends a finding without its own suggestion its title and number", () => {
    const report = makeReport();
    const bare: Finding = { ...report.findings.find((finding) => finding.id === "context_resets")!, id: "bare", suggestion: undefined as never };
    const ranked = rankActions(withSuggestions([{ ...HANDOVER, findingId: "bare" }], { ...report, findings: [...report.findings, bare] }));
    const card = [...ranked.top, ...ranked.rest].find((action) => action.suggestion.title === HANDOVER.title)!;
    expect(card.finding?.id).toBe("bare");
    expect(card.why).toBe(bare.title);
  });

  it("keeps a suggestion that names an unknown finding as its own card", () => {
    const ranked = rankActions(withSuggestions([{ ...HANDOVER, findingId: "no-such-finding" }]));
    expect([...ranked.top, ...ranked.rest].some((action) => action.suggestion.title === HANDOVER.title && action.finding === null)).toBe(true);
  });
});

describe("the long-term card", () => {
  it("dates a one-harness short history from that harness's own oldest session", () => {
    const report = makeReport();
    const coverage = report.coverage.map((entry) =>
      entry.harness === "claude-code" ? { ...entry, oldest: "2026-11-10T20:00:00Z", historyDays: 6 } : entry.harness === "codex" ? { ...entry, oldest: "2026-10-18T16:00:00Z" } : entry,
    );
    const short = makeDeterministicReport().findings.find((finding) => finding.kind === "short_history")!;
    const findings = [...report.findings, { ...short, harnesses: ["claude-code" as const], metric: { value: 6, unit: "days", label: "days of Claude Code history" } }];
    const closing = section(renderReport({ ...report, coverage, findings }), "closing");
    expect(closing).toContain("days of Claude Code history, back to Nov 10, 2026");
    expect(closing).not.toContain("Oct 18");
  });

  it("finds that harness by its days when the finding lists several harnesses", () => {
    const coverage = [
      { harness: "claude-code", label: "Claude Code", found: true, sessions: 40, oldest: "2026-11-10T20:00:00Z", newest: "2026-11-16T00:00:00Z", historyDays: 6 },
      { harness: "codex", label: "Codex", found: true, sessions: 23, oldest: "2026-10-18T16:00:00Z", newest: "2026-11-12T19:00:00Z", historyDays: 29 },
    ] as Coverage[];
    const finding = { harnesses: ["claude-code", "codex"], metric: { value: 6, unit: "days", label: "days of Claude Code history" }, evidence: [] } as unknown as Finding;
    expect(shortHistoryCoverage(coverage, finding)?.harness).toBe("claude-code");
    const unmatched = { ...finding, metric: { value: 3, unit: "days", label: "days" }, evidence: [{ sessionId: "x", harness: "codex", note: "" }] } as Finding;
    expect(shortHistoryCoverage(coverage, unmatched)?.harness).toBe("codex");
    expect(shortHistoryCoverage(coverage, { ...unmatched, evidence: [] })).toBeNull();
  });
});

describe("the patterns count", () => {
  it("says the patterns are the ones shown below", () => {
    const report = makeReport();
    const line = lineText(buildStory(report, "UTC").friction!);
    const cards = section(renderReport(report), "friction").match(/<article class="finding /g)?.length ?? 0;
    expect(line).toContain(`AI Insights found ${cards} patterns worth fixing; each is below.`);
  });
});

describe("timeline sessions that run past midnight", () => {
  const ZONE = "Europe/Berlin";
  const spans: SessionSpan[] = [
    { sessionId: "a", harness: "claude-code", project: null, start: "2026-11-14T20:14:00Z", end: "2026-11-15T18:58:00Z", activeMinutes: 90 },
    { sessionId: "b", harness: "claude-code", project: null, start: "2026-11-15T09:00:00Z", end: "2026-11-15T10:00:00Z", activeMinutes: 40 },
  ];

  it("puts dates on a bar that crosses midnight and only a start date on one that does not", () => {
    expect(spanText(Date.parse(spans[0]!.start), Date.parse(spans[0]!.end), ZONE)).toBe("Nov 14 21:14 to Nov 15 19:58");
    expect(spanText(Date.parse(spans[1]!.start), Date.parse(spans[1]!.end), ZONE)).toBe("Nov 15 10:00 to 11:00");
    const markup = String(spanTimeline(buildTimeline(spans, ZONE)!, ZONE, 2));
    expect(markup).toContain("<title>Claude Code · No project · Nov 14 21:14 to Nov 15 19:58</title>");
  });

  it("dates the busiest moment when the window covers more than one day", () => {
    const timeline = buildTimeline(spans, ZONE)!;
    expect(timeline.peak.label).toBe("Nov 15 10:00");
  });
});

describe("finding metrics", () => {
  it("keeps a rate unit beside the label instead of passing a rate off as a count", () => {
    const report = makeReport();
    const finding: Finding = {
      ...report.findings[0]!,
      id: "permission_prompt_load:claude-code",
      kind: "permission_prompt_load",
      severity: "high",
      metric: { value: 0.2, unit: "per 100 calls", label: "blocked tool calls" },
      suggestion: { type: "feature", title: "Allow the commands you keep approving", action: "Allow them." },
    };
    const html = renderReport({ ...report, findings: [finding, ...report.findings] });
    expect(html).toContain("<b>0.2</b><span>blocked tool calls per 100 calls</span>");
  });

  it("shows a plain count with exactly the label it was given", () => {
    const report = makeReport();
    const finding: Finding = {
      ...report.findings[0]!,
      id: "permission_prompt_load:claude-code",
      kind: "permission_prompt_load",
      severity: "high",
      metric: { value: 29, unit: "calls", label: "tool calls blocked" },
      suggestion: { type: "feature", title: "Allow the commands you keep approving", action: "Allow them." },
    };
    const html = renderReport({ ...report, findings: [finding, ...report.findings] });
    expect(html).toContain("<b>29</b><span>tool calls blocked</span>");
  });
});
