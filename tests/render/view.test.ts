import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { foldTarget, rankActions } from "../../src/render/story.js";
import { availability, buildView, CARD_IDS, metricOf, recapView, retentionView, settingsSnippet, shortHistoryCoverage, stepsOf } from "../../src/render/view.js";
import type { Coverage, Finding, Recap, Report, RunSnapshot, Suggestion } from "../../src/schema/types.js";
import { HOSTILE, makeDeterministicReport, makeEmptyReport, makeHostileReport, makeReport } from "./fixtures.js";

const ZONE = "Europe/Berlin";
/** A recap built by the real analysis from the synthetic demo history (scripts/demo-report.mjs). */
const RECAP = JSON.parse(readFileSync(new URL("./recap-fixture.json", import.meta.url), "utf8")) as Recap;
const withRecap = (report: Report = makeReport(), recap: Partial<Recap> = {}): Report => ({ ...report, recap: { ...RECAP, ...recap } });
const all = (view: ReturnType<typeof buildView>) => [...view.actions.top, ...view.actions.rest];

describe("the share-safe recap", () => {
  it("copies only the fields it knows, so a field the data layer adds never reaches a card by accident", () => {
    const leaky = { ...RECAP, secretPath: "/home/alice/acme", voice: { ...RECAP.voice, lastPrompt: "deploy acme to prod" } } as unknown as Recap;
    const json = JSON.stringify(recapView({ ...makeReport(), recap: leaky }));
    expect(json).not.toContain("alice");
    expect(json).not.toContain("deploy acme");
  });

  it("never carries the analysis' private strings: project paths, prompts, evidence, finding text", () => {
    const report = withRecap(makeHostileReport());
    const recap = JSON.stringify(buildView(report, ZONE).recap);
    for (const value of Object.values(HOSTILE)) expect(recap).not.toContain(value);
    for (const project of report.activity.projects) expect(recap).not.toContain(project.projectPath);
    for (const finding of report.findings) {
      expect(recap).not.toContain(finding.detail);
      for (const evidence of finding.evidence) expect(recap).not.toContain(evidence.note);
    }
  });

  it("words tips per finding kind when the recap has none, never with a finding's own title", () => {
    const report = withRecap(makeReport(), { tips: [] });
    const tips = buildView(report, ZONE).recap!.tips;
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.length).toBeLessThanOrEqual(3);
    for (const tip of tips) expect(report.findings.map((f) => f.title)).not.toContain(tip.title);
  });

  it("offers a card only when its data exists, instead of drawing zeros", () => {
    const base = recapView(withRecap())!;
    expect(Object.keys(base.avail).sort()).toEqual([...CARD_IDS, "history"].sort());
    const thin = recapView(withRecap(makeReport(), { rhythm: undefined, persona: undefined, longestSession: undefined, shell: { ...RECAP.shell, testPass: undefined, rmrf: 0, forcePush: 0 }, history: undefined } as never))!;
    const avail = availability(thin);
    expect(avail).toMatchObject({ clock: false, weekday: false, persona: false, summary: false, marathon: false, tests: false, danger: false, history: false, intro: true, outro: true });
  });

  it("makes no cost claim on a card when nothing could be priced", () => {
    const recap = recapView(withRecap(makeReport(), { usage: { ...RECAP.usage, usd: undefined } }))!;
    expect(recap.usage.priced).toBe(false);
    expect(recap.usage.usd).toBeNull();
  });

  it("keeps the 10,000+ flag for capped tool counts and the full span of long histories", () => {
    const recap = recapView(withRecap(makeReport(), { totals: { ...RECAP.totals, toolCallsCapped: true }, range: { from: "2026-02-03", to: "2026-11-16", days: 287 } }))!;
    expect(recap.totals.toolCallsCapped).toBe(true);
    expect(recap.range.days).toBe(287);
  });
});

describe("truthful degradation", () => {
  it("shows the analysis only, with a note, for a report saved before recaps existed", () => {
    const view = buildView(makeReport(), ZONE);
    expect(view.recap).toBeNull();
    expect(view.notes.recap).toMatch(/saved before recap cards existed/);
    expect(view.hero.sessions).toBeGreaterThan(0);
  });

  it("asks for the agent review instead of showing a win rate when there are no facets or narrative", () => {
    const view = buildView(withRecap(makeDeterministicReport(), { winRate: undefined }), ZONE);
    expect(view.narrative).toBeNull();
    expect(view.recap!.winRate).toBeNull();
    expect(view.notes.review).toMatch(/No agent review yet/);
    expect(view.review.prompt).toContain("analyze-ai-usage");
  });

  it("explains that a first run fills in 'over time' from the next run", () => {
    const view = buildView(withRecap(), ZONE);
    expect(view.runs).toHaveLength(1);
    expect(view.notes.runs).toMatch(/first saved run/);
  });

  it("compares saved runs oldest first, dated by when they ran in the report's zone, with today last", () => {
    const report = withRecap();
    const run = (generatedAt: string, failureRate: number): RunSnapshot => ({ snapshotVersion: 1, id: generatedAt.replace(/[:.]/g, "-"), generatedAt, timeZone: ZONE, versions: { report: 1, recap: 1, pricing: "x" }, window: { from: "2026-10-01", to: "2026-10-30", days: 30 }, metrics: { failureRate } as never, findings: [], suggestionsShown: [], narrative: false });
    const view = buildView(report, ZONE, { runs: [run("2026-10-20T22:00:00.000Z", 0.08), run("2026-10-02T22:00:00.000Z", 0.1), run(report.generatedAt, 0.05)] });
    expect(view.runs.map((r) => r.day)).toEqual(["2026-10-03", "2026-10-21", view.runs[2]!.day]);
    expect(view.runs).toHaveLength(3);
    expect(view.notes.runs).toBe("");
  });

  it("names tools without token counts and never claims a cost for them", () => {
    const report = makeReport();
    const coverage = [...report.coverage, { harness: "cursor", label: "Cursor", found: true, files: 3, sessions: 3, issues: 0, oldest: null, newest: null } as Coverage];
    const view = buildView({ ...report, coverage }, ZONE);
    expect(view.usage.noTokens).toContain("Cursor");
    expect(view.coverage.find((c) => c.harness === "cursor")!.tokens).toBe(false);
  });

  it("shows no cost at all rather than $0 when nothing could be priced", () => {
    const report = makeReport();
    const view = buildView({ ...report, usage: { ...report.usage, estimatedUsd: null } }, ZONE);
    expect(view.usage.usd).toBeNull();
    expect(view.usage.usdText).not.toBe("$0.00");
    expect(view.hero.usd).toBeNull();
  });

  it("states the unpriced share as a share of requests, with the models", () => {
    expect(buildView(makeReport(), ZONE).usage.gap).toMatch(/^\d+% of requests \([\d,]+\) have no known price/);
  });

  it("renders an empty history without inventing anything", () => {
    const view = buildView(makeEmptyReport(), ZONE);
    expect(view.recap).toBeNull();
    expect(view.findings).toEqual([]);
    expect(view.timeline).toBeNull();
    expect(view.hero.lede).toMatch(/No coding-agent sessions/);
  });

  it("covers every harness AI Insights reads, found or not", () => {
    const report = makeReport();
    const six = ["claude-code", "codex", "opencode", "pi", "cursor", "gemini"].map((harness) => report.coverage.find((c) => c.harness === harness) ?? ({ harness, label: "", found: false, files: 0, sessions: 0, issues: 0, oldest: null, newest: null } as Coverage));
    const labels = buildView({ ...report, coverage: six }, ZONE).coverage.map((c) => c.label);
    expect(labels).toEqual(["Claude Code", "Codex", "OpenCode", "Pi", "Cursor", "Gemini CLI"]);
  });
});

describe("findings and what to change", () => {
  it("lists findings with up to five pieces of evidence each and a count of the rest", () => {
    const report = makeReport();
    const finding = { ...report.findings[0]!, evidence: Array.from({ length: 8 }, (_, i) => ({ sessionId: `s${i}`, harness: "claude-code" as const, note: `note ${i}` })) };
    const view = buildView({ ...report, findings: [finding, ...report.findings.slice(1)] }, ZONE);
    const shown = view.findings.find((f) => f.id === finding.id)!;
    expect(shown.evidence).toHaveLength(5);
    expect(shown.moreEvidence).toBe(3);
  });

  it("links each finding to the ranked change that fixes it, and back", () => {
    const view = buildView(makeReport(), ZONE);
    for (const action of all(view).filter((a) => a.finding)) {
      const finding = view.findings.find((f) => f.anchor === action.finding)!;
      expect(finding).toBeDefined();
      expect(finding.action).toBe(action.anchor);
    }
  });

  it("leads with three changes and keeps the rest behind 'more'", () => {
    const view = buildView(makeReport(), ZONE);
    expect(view.actions.top.length).toBeLessThanOrEqual(3);
    expect(view.actions.top.map((a) => a.anchor)).toEqual(view.actions.top.map((_, i) => `action-${i + 1}`));
  });

  it("never links a non-http(s) suggestion URL", () => {
    const view = buildView(makeHostileReport(), ZONE);
    for (const action of all(view)) if (action.url) expect(action.url).toMatch(/^https?:\/\//);
  });
});

describe("one card per idea", () => {
  const HANDOVER: Suggestion = { type: "instructions", title: "Write a handover before the context runs out", action: "Add this to CLAUDE.md.", instructionText: "When this session has been compacted once, stop at the next commit and write HANDOFF.md.", findingId: "context_resets" };
  const withSuggestions = (suggestions: Suggestion[], report: Report = makeReport()): Report => ({ ...report, narrative: { ...report.narrative!, suggestions } });

  it("folds a narrative suggestion into the finding it names, keeping the finding's title and number", () => {
    const view = buildView(withSuggestions([HANDOVER]), ZONE);
    const cards = all(view).filter((a) => a.findingId === "context_resets" || a.title === HANDOVER.title);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.title).toBe("Split long tasks into planned sessions");
    expect(cards[0]!.instructionText).toBe(HANDOVER.instructionText);
    expect(cards[0]!.agreed).toBe(true);
    expect(cards[0]!.metric).toEqual({ value: "88", label: "compactions" });
  });

  it("does not guess: without a findingId, a differently titled suggestion stays its own card", () => {
    const view = buildView(withSuggestions([{ ...HANDOVER, findingId: undefined } as Suggestion]), ZONE);
    expect(all(view).some((a) => a.title === HANDOVER.title && a.finding === null)).toBe(true);
  });

  it("folds the long-sessions card under the context-resets card as one line, and points its finding there", () => {
    const LONG: Finding = { id: "long_sessions", kind: "long_sessions", severity: "info", title: "Some sessions run very long", detail: "9 sessions ran over 2.5 h. 9 of them also ran out of context, so this is mostly the same pattern as the context-resets finding.", harnesses: ["claude-code"], metric: { value: 9, unit: "sessions", label: "very long sessions" }, evidence: [], suggestion: { type: "habit", title: "Split at natural checkpoints", action: "End the session when a piece of work is committed." } };
    const report = makeReport();
    const longReport = { ...report, findings: [...report.findings, LONG] };
    expect(foldTarget(LONG, longReport.findings)?.kind).toBe("context_resets");
    const view = buildView(longReport, ZONE);
    const card = all(view).find((a) => a.findingId === "context_resets")!;
    expect(card.also).toEqual(["Also covers the 9 very long sessions, mostly the same sessions: split at natural checkpoints."]);
    expect(all(view).some((a) => a.title === "Split at natural checkpoints")).toBe(false);
    const ranked = rankActions(longReport);
    expect([...ranked.top, ...ranked.rest].length).toBe(all(view).length);
  });
});

describe("settings and allow rules", () => {
  const PERMISSIONS: Finding = {
    id: "permission_prompt_load:claude-code", kind: "permission_prompt_load", severity: "high", title: "Claude Code keeps asking about the same commands", detail: "Blocked repeatedly: `pnpm test`.", harnesses: ["claude-code"],
    metric: { value: 0.4, unit: "per 100 calls", label: "blocked tool calls" }, evidence: [],
    suggestion: { type: "feature", title: "Allow the commands you keep approving", action: 'Add `"permissions": {"allow": ["Bash(pnpm test:*)", "Bash(pnpm lint:*)"]}` to `.claude/settings.json`.', url: "https://docs.example/settings" },
  };

  it("turns an inline settings fragment into formatted JSON to copy, named after its file", () => {
    const snippet = settingsSnippet(PERMISSIONS.suggestion!.action)!;
    expect(snippet.file).toBe(".claude/settings.json");
    expect(JSON.parse(snippet.text)).toEqual({ permissions: { allow: ["Bash(pnpm test:*)", "Bash(pnpm lint:*)"] } });
    expect(settingsSnippet("Run `git status` first.")).toBeNull();
    expect(settingsSnippet('Add `{"broken": ` somewhere')).toBeNull();
  });

  it("gives the allow-rule card its copy block, its file and its docs link", () => {
    const report = makeReport();
    const card = all(buildView({ ...report, findings: [PERMISSIONS, ...report.findings] }, ZONE)).find((a) => a.findingId === PERMISSIONS.id)!;
    expect(card.snippet?.file).toBe(".claude/settings.json");
    expect(card.url).toBe("https://docs.example/settings");
    expect(card.urlLabel).toBe("docs.example/settings");
    expect(card.metric).toEqual({ value: "0.4", label: "blocked tool calls per 100 calls" });
  });

  it("prefers the finding's own instruction text over a settings fragment", () => {
    const report = makeReport();
    const finding = { ...PERMISSIONS, suggestion: { ...PERMISSIONS.suggestion!, instructionText: "Run /permissions and allow pnpm test." } };
    const card = all(buildView({ ...report, findings: [finding, ...report.findings] }, ZONE)).find((a) => a.findingId === finding.id)!;
    expect(card.instructionText).toBe("Run /permissions and allow pnpm test.");
    expect(card.snippet).toBeNull();
  });
});

describe("finding numbers", () => {
  it("keeps a rate unit beside its label, prints sizes in decimal units and money as money", () => {
    expect(metricOf({ metric: { value: 0.2, unit: "per 100 calls", label: "blocked tool calls" } })).toEqual({ value: "0.2", label: "blocked tool calls per 100 calls" });
    expect(metricOf({ metric: { value: 29, unit: "calls", label: "tool calls blocked" } })).toEqual({ value: "29", label: "tool calls blocked" });
    expect(metricOf({ metric: { value: 2.4, unit: "GB", label: "history on disk" } })!.value).toBe("2.4 GB");
    expect(metricOf({ metric: { value: 12.5, unit: "usd", label: "cache misses" } })!.value).toBe("$12.50");
    expect(metricOf({ metric: { value: Number.NaN, unit: "x", label: "y" } })).toBeNull();
  });
});

describe("the closing cards", () => {
  it("keeps the disk-space card with its size, title, action and link", () => {
    const report = makeDeterministicReport();
    const disk = report.findings.find((f) => f.kind === "history_disk_usage");
    const view = buildView(report, ZONE);
    if (!disk) return expect(view.closing.disk).toBeNull();
    expect(view.closing.disk!.title).toBe(disk.suggestion?.title ?? "Compress and save disk space");
    expect(view.closing.disk!.metric).toEqual(metricOf(disk));
    expect(view.findings.some((f) => f.kind === "history_disk_usage")).toBe(false);
    expect(all(view).some((a) => a.findingId === disk.id)).toBe(false);
  });

  it("dates a one-harness short history from that harness's own oldest session", () => {
    const coverage = [
      { harness: "claude-code", label: "Claude Code", found: true, sessions: 40, oldest: "2026-11-10T20:00:00Z", newest: "2026-11-16T00:00:00Z", historyDays: 6 },
      { harness: "codex", label: "Codex", found: true, sessions: 23, oldest: "2026-10-18T16:00:00Z", newest: "2026-11-12T19:00:00Z", historyDays: 29 },
    ] as Coverage[];
    const finding = { harnesses: ["claude-code", "codex"], metric: { value: 6, unit: "days", label: "days of Claude Code history" }, evidence: [] } as unknown as Finding;
    expect(shortHistoryCoverage(coverage, finding)?.harness).toBe("claude-code");
    const report = makeReport();
    const short = { ...finding, id: "short_history", kind: "short_history", severity: "info", title: "Short", detail: "", harnesses: ["claude-code"] } as Finding;
    const view = buildView({ ...report, coverage, findings: [...report.findings, short] }, ZONE);
    expect(view.closing.matrix).toMatchObject({ metric: { value: "6", label: "days of Claude Code history" }, since: "Nov 10, 2026", url: "https://matrix-os.com" });
  });
});

describe("keeping history", () => {
  it("renders nothing until the report carries retention data", () => {
    expect(retentionView(makeReport(), ZONE)).toBeNull();
    expect(buildView(makeReport(), ZONE).retention).toBeNull();
  });

  it("leads with what will be deleted this week, and says the stats survive but the transcripts do not", () => {
    const report = { ...makeReport(), generatedAt: "2026-11-16T12:00:00Z", retention: [{ harness: "claude-code", keepDays: 30, oldest: "2026-10-17T10:00:00Z", atRisk: { sessions: 4, mb: 120 }, nextDeletion: "2026-11-18T10:00:00Z", cacheOnly: 12 }] } as unknown as Report;
    const view = retentionView(report, ZONE)!;
    expect(view.urgent).toBe(true);
    expect(view.sentence).toBe("Claude Code will delete 4 sessions (120 MB) by Nov 18, 2026. The numbers stay in AI Insights; the full transcripts do not, unless you keep them.");
    expect(view.rows[0]).toMatchObject({ label: "Claude Code", kept: "kept 30 days", cacheOnly: 12 });
    expect(view.limit).toContain("Claude Code kept 30 days");
  });

  it("renders any finding's steps as separate actions, each with its own text to copy", () => {
    const steps = stepsOf({ steps: [{ title: "Keep transcripts longer", action: "Raise the cleanup period.", instructionText: '{ "cleanupPeriodDays": 365 }', file: "~/.claude/settings.json", undo: "Remove the line." }, { title: "Archive them", url: "javascript:alert(1)" }, { nope: true }] });
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ copy: '{ "cleanupPeriodDays": 365 }', copyLabel: "Add to ~/.claude/settings.json", undo: "Remove the line." });
    expect(steps[1]!.url).toBeNull();
  });
});

describe("determinism", () => {
  it("builds the same view from the same report", () => {
    expect(JSON.stringify(buildView(withRecap(), ZONE))).toBe(JSON.stringify(buildView(withRecap(), ZONE)));
  });
});
