import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { foldTarget, rankActions } from "../../src/render/story.js";
import { availability, buildView, CARD_IDS, lanesOf, metricOf, OPTIONAL_CARD_IDS, recapView, recordedSpend, retentionView, settingsSnippet, shortHistoryCoverage, stepsOf } from "../../src/render/view.js";
import type { Coverage, Finding, Recap, RecapLanes, Report, RunSnapshot, Suggestion, UsageSummary } from "../../src/schema/types.js";
import { HOSTILE, makeDeterministicReport, makeEmptyReport, makeHarnessRetention, makeHostileReport, makeReport, makeRetention, makeRetentionFinding } from "./fixtures.js";

const ZONE = "Europe/Berlin";
/** A recap built by the real analysis from the synthetic demo history (scripts/demo-report.mjs). */
const RECAP = JSON.parse(readFileSync(new URL("./recap-fixture.json", import.meta.url), "utf8")) as Recap;
const withRecap = (report: Report = makeReport(), recap: Partial<Recap> = {}): Report => ({ ...report, recap: { ...RECAP, ...recap } });
const all = (view: ReturnType<typeof buildView>) => [...view.actions.top, ...view.actions.rest];

describe("the device id for the share link", () => {
  it("passes the store's random device id to the page and drops anything that is not one", () => {
    expect(buildView(withRecap(), ZONE, { deviceId: "0123456789abcdef0123456789abcdef" }).deviceId).toBe("0123456789abcdef0123456789abcdef");
    expect(buildView(withRecap(), ZONE, { deviceId: "alices-macbook.local" }).deviceId).toBeNull();
    expect(buildView(withRecap(), ZONE).deviceId).toBeNull();
  });
});

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
    expect(Object.keys(base.avail).sort()).toEqual([...CARD_IDS, ...OPTIONAL_CARD_IDS].sort());
    const thin = recapView(withRecap(makeReport(), { rhythm: undefined, persona: undefined, longestSession: undefined, shell: { ...RECAP.shell, testPass: undefined, rmrf: 0, forcePush: 0 }, history: undefined } as never))!;
    const avail = availability(thin);
    expect(avail).toMatchObject({ clock: false, weekday: false, persona: false, summary: false, marathon: false, tests: false, danger: false, history: false, intro: true, outro: true });
  });

  it("makes no cost claim on a card when nothing could be priced", () => {
    const recap = recapView(withRecap(makeReport(), { usage: { ...RECAP.usage, usd: undefined } }))!;
    expect(recap.usage.priced).toBe(false);
    expect(recap.usage.usd).toBeNull();
  });

  it("draws real lanes as shares of the window, and only when they add up to the count on the card", () => {
    const lanes: RecapLanes = {
      windowMinutes: 360, peakAt: 180, atPeak: 2,
      lanes: [
        { harness: "claude-code", start: 0, end: 240, active: [[0, 60], [150, 240]] },
        { harness: "codex", start: 120, end: 360, active: [[120, 200]] },
        { harness: "codex", start: 200, end: 300, active: [[200, 300]] },
      ],
    };
    const view = lanesOf(lanes, 2)!;
    expect(view).toMatchObject({ windowMinutes: 360, peak: 0.5, atPeak: 2 });
    expect(view.rows.map((row) => row.atPeak)).toEqual([true, true, false]);
    expect(view.rows[0]!.active).toEqual([[0, 60 / 360], [150 / 360, 240 / 360]]);
    expect(lanesOf(lanes, 3)).toBeNull();
    expect(lanesOf({ ...lanes, atPeak: 3 }, 3)).toBeNull();
    expect(lanesOf(undefined, 2)).toBeNull();
    expect(recapView(withRecap(makeReport(), { parallel: { max: 2, overlapEvents: 1, subagents: 0, lanes } }))!.parallel.lanes!.atPeak).toBe(2);
  });

  it("passes the newer recap fields through and offers their optional cards only with enough data", () => {
    const recap = recapView(withRecap(makeReport(), {
      thinking: { blocks: 420, totalMs: 7_200_000, longestMs: 95_000, sessions: 40 },
      approvals: { auto: 900, byPerson: 120, denied: 7, autoBlocked: 3, sessions: 50 },
      history: { days: 120, firstDay: "2026-07-20", cachedOnly: 33 },
      longestSession: { ...RECAP.longestSession!, skippedAutomated: 2 },
      voice: { ...RECAP.voice, excludedWrapped: 14 },
    }))!;
    expect(recap.thinking).toEqual({ blocks: 420, sessions: 40, totalMs: 7_200_000, longestMs: 95_000 });
    expect(recap.approvals).toEqual({ auto: 900, byPerson: 120, denied: 7, autoBlocked: 3, guardianReviews: null, sessions: 50 });
    expect(recap.history).toEqual({ days: 120, firstDay: "2026-07-20", cachedOnly: 33 });
    expect(recap.longestSession!.skippedAutomated).toBe(2);
    expect(recap.voice.excludedWrapped).toBe(14);
    expect(recap.avail).toMatchObject({ thinking: true, approvals: true, history: true });
    const codexOnly = recapView(withRecap(makeReport(), { approvals: { denied: 2, guardianReviews: 5, autoBlocked: 1, sessions: 3 }, thinking: { blocks: 3, sessions: 1 } }))!;
    expect(codexOnly.approvals!.auto).toBeNull();
    expect(codexOnly.thinking!.totalMs).toBeNull();
    expect(codexOnly.avail).toMatchObject({ thinking: false, approvals: false });
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
  const NOW = "2026-11-16T12:00:00Z";
  const withRetention = (harnesses: Parameters<typeof makeRetention>[0], finding: Finding | null = makeRetentionFinding()): Report => {
    const report = makeReport({ generatedAt: NOW });
    return { ...report, retention: makeRetention(harnesses), findings: [...report.findings.filter((f) => f.kind !== "short_history"), ...(finding ? [finding] : [])] };
  };

  it("renders nothing until the report carries retention data or the finding", () => {
    expect(retentionView(makeReport(), ZONE)).toBeNull();
    expect(buildView(makeReport(), ZONE).retention).toBeNull();
  });

  it("leads with what can be deleted this week, worded as eligible rather than a promise, and keeps the per-tool table", () => {
    const report = withRetention([
      makeHarnessRetention({ atRisk: { sessions: 2, bytes: 12_000_000, nextDeletion: "2026-11-18T10:00:00Z" }, cachedOnly: 4 }),
      makeHarnessRetention({ harness: "codex", policy: "kept", days: undefined, source: undefined, setting: undefined, clock: undefined, atRisk: undefined, basis: "Codex keeps rollouts until you delete them." }),
    ]);
    const view = retentionView(report, ZONE)!;
    expect(view).toMatchObject({ urgent: true, level: "urgent", title: "2 transcripts can be deleted in the next 7 days." });
    expect(view.sentence).toBe("Claude Code can delete 2 transcripts (12 MB) from Nov 18, 2026, at its next start after that. AI Insights keeps the stats it already read; the full transcripts go unless you keep or archive them.");
    expect(view.sentence).not.toMatch(/will be deleted/);
    expect(view.rows[0]).toMatchObject({ label: "Claude Code", keeps: "deletes after 30 days", source: "its default", setting: "cleanupPeriodDays in ~/.claude/settings.json (not set)", disk: "480 MB", atRisk: "2 transcripts (12 MB) can be deleted from Nov 18, 2026", cacheOnly: 4 });
    expect(view.rows[1]).toMatchObject({ label: "Codex", keeps: "keeps until you delete them", atRisk: null, source: null });
    expect(view.cache).toEqual({ keeps: ["When each session ran, how long, and in which project"], drops: ["The agent's replies"] });
    expect(view.limit).toBe("How far back this goes is limited by retention: Claude Code deletes transcripts after 30 days; AI Insights still has sessions back to Oct 17, 2026.");
  });

  it("words a saved retention title as eligible, not as a promise, wherever the page shows it", () => {
    const report = withRetention([makeHarnessRetention({ atRisk: { sessions: 2, bytes: 0, nextDeletion: "2026-11-18T10:00:00Z" } })]);
    const json = JSON.stringify(buildView(report, ZONE));
    expect(json).not.toContain("will be deleted");
    expect(json).toContain("2 Claude Code sessions can be deleted within 7 days");
  });

  it("says 'the next time it starts' when the eligible date has passed", () => {
    const view = retentionView(withRetention([makeHarnessRetention({ atRisk: { sessions: 1, bytes: 0, nextDeletion: "2026-11-10T10:00:00Z" } })]), ZONE)!;
    expect(view.sentence).toMatch(/^Claude Code can delete 1 transcript the next time it starts\./);
    expect(view.rows[0]!.atRisk).toBe("1 transcript can be deleted the next time Claude Code starts");
  });

  it("names the default, the person's own setting and managed settings truthfully", () => {
    const atDefault = retentionView(withRetention([makeHarnessRetention()], makeRetentionFinding({ severity: "low" })), ZONE)!;
    expect(atDefault).toMatchObject({ urgent: false, level: "default" });
    expect(atDefault.sentence).toMatch(/^Claude Code deletes transcripts 30 days after they last changed, its default\./);
    const own = retentionView(withRetention([makeHarnessRetention({ source: "settings", days: 90, setting: { name: "cleanupPeriodDays", file: "~/.claude/settings.json", value: 90 } })], null), ZONE)!;
    expect(own.level).toBe("settings");
    expect(own.sentence).toMatch(/90 days after they last changed, as set in ~\/\.claude\/settings\.json\./);
    expect(own.rows[0]!.setting).toBe("cleanupPeriodDays in ~/.claude/settings.json: 90");
    const managed = retentionView(withRetention([makeHarnessRetention({ source: "managed", days: 14 })]), ZONE)!;
    expect(managed).toMatchObject({ level: "managed", title: "Your organization sets how long transcripts are kept." });
    expect(managed.rows[0]!.source).toBe("managed by your organization");
    const gemini = retentionView(withRetention([makeHarnessRetention({ harness: "gemini", days: 1.5, clock: "last-updated" })]), ZONE)!;
    expect(gemini.sentence).toMatch(/^Gemini CLI deletes transcripts 1\.5 days after their last update/);
  });

  it("falls back to the finding's own words when history is only short, and reports tools that keep or do not say", () => {
    const short = makeRetentionFinding({ severity: "info", detail: "History on this machine goes back: Codex 12 days." });
    const kept = [makeHarnessRetention({ harness: "codex", policy: "kept", days: undefined, source: undefined, setting: undefined, atRisk: undefined }), makeHarnessRetention({ harness: "cursor", policy: "unknown", days: undefined, source: undefined, setting: undefined, atRisk: undefined, url: undefined })];
    expect(retentionView(withRetention(kept, short), ZONE)).toMatchObject({ level: "short", sentence: "History on this machine goes back: Codex 12 days.", limit: null });
    const none = retentionView(withRetention(kept, null), ZONE)!;
    expect(none).toMatchObject({ level: "kept", sentence: "Codex keeps transcripts until you delete them. Cursor: not documented whether old chats are deleted.", steps: [] });
    expect(none.rows[1]).toMatchObject({ keeps: "not documented", url: null });
  });

  it("says why Desktop and Cowork sessions past the age are kept", () => {
    const view = retentionView(withRetention([makeHarnessRetention({ exempt: { sessions: 3, reason: "Sessions started or last continued in Claude Desktop or Cowork are kept at any age" } })]), ZONE)!;
    expect(view.rows[0]!.exempt).toBe("3 older sessions kept anyway: Sessions started or last continued in Claude Desktop or Cowork are kept at any age.");
  });

  it("offers the three steps, each with its own text to copy and how to undo it", () => {
    const view = retentionView(withRetention([makeHarnessRetention()]), ZONE)!;
    expect(view.steps.map((step) => [step.title, step.copy, step.copyLabel])).toEqual([
      ["Keep Claude Code transcripts longer", '"cleanupPeriodDays": 365', "Line to paste"],
      ["Archive them compactly", "npx packmem archive --dry-run", "Command to run"],
      ["Keep them for good across machines", "matrix chats discover --json", "Command to run"],
    ]);
    expect(view.steps[0]!.undo).toBe("Remove the line to go back to the default of 30 days.");
    expect(stepsOf({ steps: [{ title: "x", action: "y", url: "javascript:alert(1)", instructionText: "Always run the tests." }] })[0]).toMatchObject({ url: null, copy: "Always run the tests.", copyLabel: "Add to CLAUDE.md or AGENTS.md" });
  });

  it("shows the packmem pitch once: the disk card loses its pitch and the closing pair goes when the block has steps", () => {
    const disk: Finding = { id: "history_disk_usage", kind: "history_disk_usage", severity: "info", title: "Agent history takes 1480 MB on disk", detail: "Your agent transcripts take 1480 MB across Claude Code.", harnesses: ["claude-code"], metric: { value: 1480, unit: "MB", label: "agent history on disk" }, evidence: [] };
    const report = withRetention([makeHarnessRetention()]);
    const view = buildView({ ...report, findings: [...report.findings.filter((f) => f.kind !== "history_disk_usage"), disk] }, ZONE);
    expect(view.closing.show).toBe(false);
    expect(view.closing.disk).toMatchObject({ title: "Agent history takes 1480 MB on disk", action: "Your agent transcripts take 1480 MB across Claude Code.", url: null });
    expect(view.retention!.disk).toEqual({ value: "1.5 GB", label: "agent history on disk" });
    const json = JSON.stringify(view);
    expect(json.split("npx packmem archive --dry-run").length - 1).toBe(1);
    expect(all(view).some((a) => a.findingId === "history_retention" || a.findingId === "history_disk_usage")).toBe(false);
    expect(view.findings.some((f) => f.kind === "history_retention")).toBe(false);
    // An older saved report: short_history and a disk card with its own pitch keep the closing pair.
    expect(buildView(makeDeterministicReport(), ZONE).closing.show).toBe(true);
  });
});

describe("recorded spend", () => {
  it("shows what the tools recorded beside the estimate, and never calls a recorded $0 free", () => {
    expect(recordedSpend(makeReport().usage)).toBeNull();
    const usage: Pick<UsageSummary, "recorded" | "recordedByHarness"> = {
      recorded: { usd: 3.2, requests: 50, zeroRequests: 30 },
      recordedByHarness: [{ harness: "pi", usd: 3.2, requests: 20, zeroRequests: 0 }, { harness: "opencode", usd: 0, requests: 30, zeroRequests: 30 }],
    };
    const view = recordedSpend(usage)!;
    expect(view.text).toBe("recorded $3.20 (30 requests recorded $0, typical of subscriptions)");
    expect(view.harnesses.map((h) => [h.label, h.text])).toEqual([["Pi", "recorded $3.20"], ["OpenCode", "nothing billed by the harness (30 requests recorded $0, typical of subscriptions)"]]);
    expect(JSON.stringify(view)).not.toMatch(/free/i);
    expect(buildView({ ...makeReport(), usage: { ...makeReport().usage, ...usage } }, ZONE).usage.recorded!.usd).toBe(3.2);
  });
});

describe("coverage footer", () => {
  it("keeps usage counters it did not count apart from unreadable lines", () => {
    const report = makeReport();
    const coverage = report.coverage.map((entry, i) => (i === 0 ? { ...entry, issues: 3, skippedUsageRecords: 12 } : entry));
    expect(buildView({ ...report, coverage }, ZONE).coverage[0]).toMatchObject({ skipped: 3, skippedUsage: 12 });
  });
});

describe("determinism", () => {
  it("builds the same view from the same report", () => {
    expect(JSON.stringify(buildView(withRecap(), ZONE))).toBe(JSON.stringify(buildView(withRecap(), ZONE)));
  });
});
