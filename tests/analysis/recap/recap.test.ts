import { describe, expect, it } from "vitest";
import { buildReport } from "../../../src/analysis/index.js";
import type { Recap, Session } from "../../../src/schema/types.js";
import { at, coverage, day, facet, NOW, prompt, request, session, shell, tool } from "../factory.js";

function recapOf(sessions: Session[], extra: Partial<Parameters<typeof buildReport>[0]> = {}): Recap {
  const report = buildReport({ sessions, coverage: [coverage("claude-code", sessions.length)], now: NOW, timeZone: "UTC", ...extra });
  expect(report.recap).toBeDefined();
  return report.recap!;
}

describe("recap: when you work", () => {
  it("buckets prompts by local hour and weekday and names the peak, so the rhythm card shows the person's real hours", () => {
    // 2026-06-01 is a Monday; 09:00 UTC is 11:00 in Berlin in June.
    const s = session({ prompts: [prompt("fix the build", at(0)), prompt("run the tests", at(5)), prompt("ok merge", at(24 * 60 + 60))] });
    const recap = recapOf([s], { timeZone: "Europe/Berlin" });
    expect(recap.rhythm!.hours[11]).toBe(2);
    expect(recap.rhythm!.hours[12]).toBe(1);
    expect(recap.rhythm!.peakHour).toBe(11);
    expect(recap.rhythm!.weekdays).toEqual([
      { key: "Mon", count: 2 },
      { key: "Tue", count: 1 },
      { key: "Wed", count: 0 },
      { key: "Thu", count: 0 },
      { key: "Fri", count: 0 },
      { key: "Sat", count: 0 },
      { key: "Sun", count: 0 },
    ]);
    expect(recap.rhythm!.verdict.key).toBe("morning");
  });

  it("calls a person who types late at night and never early a night owl and keeps the latest night minute", () => {
    // BASE is 09:00 UTC: +13 h is 22:00, +17 h 30 min is 02:30.
    const s = session({ prompts: [prompt("fix it", at(13 * 60)), prompt("run it", at(17 * 60 + 30)), prompt("check it", at(15 * 60))] });
    const recap = recapOf([s]);
    expect(recap.rhythm!.verdict).toEqual({ key: "night_owl", label: "Night owl" });
    expect(recap.rhythm!.latestNight).toBe(2 * 60 + 30);
    expect(recap.rhythm!.nightShare).toBe(1);
  });

  it("finds the longest stretch of hours without prompts, across midnight", () => {
    const s = session({ prompts: [prompt("a", at(0)), prompt("b", at(60))] }); // 09:00 and 10:00 UTC
    expect(recapOf([s]).rhythm!.quiet).toEqual({ len: 22, start: 11 });
  });

  it("gives each harness its own peak hour, so day shift and night shift can differ", () => {
    const claude = session({ prompts: [prompt("a", at(12 * 60))] });
    const codex = session({ harness: "codex", prompts: [prompt("b", at(0)), prompt("c", at(1))] });
    const peaks = recapOf([claude, codex]).rhythm!.harnessPeaks;
    expect(peaks.map((peak) => [peak.key, peak.peak, peak.prompts])).toEqual([
      ["codex", 9, 2],
      ["claude-code", 21, 1],
    ]);
  });

  it("leaves the rhythm and persona out when no prompt has a time, instead of claiming a 00:00 peak", () => {
    const s = session({ prompts: [], userMessageCount: 0 });
    const recap = recapOf([s]);
    expect(recap.rhythm).toBeUndefined();
    expect(recap.persona).toBeUndefined();
  });
});

describe("recap: period, calendar and streak", () => {
  it("states the true span of history even when the daily list is capped", () => {
    const sessions = [session({ startTime: day(0) }), session({ startTime: day(450) })];
    const recap = recapOf(sessions, { now: new Date(day(451)) });
    expect(recap.range).toEqual({ from: "2026-06-01", to: "2027-08-25", days: 451 });
    expect(recap.daily.length).toBe(400);
    expect(recap.dailyTruncated).toBe(true);
    expect(recap.daily.at(-1)!.day).toBe("2027-08-25");
  });

  it("finds the longest run of active days and the biggest single day", () => {
    const sessions = [0, 1, 2, 5].map((offset) => session({ startTime: day(offset), prompts: [prompt("fix", day(offset, 1))] }));
    sessions[3]!.prompts.push(prompt("run", day(5, 2)), prompt("check", day(5, 3)));
    const recap = recapOf(sessions);
    expect(recap.streak).toEqual({ days: 3, start: "2026-06-01", end: "2026-06-03" });
    expect(recap.bigDay).toEqual({ day: "2026-06-06", prompts: 3, weekday: "Sat" });
  });
});

describe("recap: how you talk", () => {
  it("counts only vocabulary words, openers and manners from prompts the person typed", () => {
    const s = session({
      prompts: [
        prompt("can you fix the login bug please", at(0)),
        prompt("can you run the tests?", at(5)),
        prompt("thanks, merge it", at(10)),
        prompt("yes", at(15)),
      ],
    });
    const voice = recapOf([s]).voice;
    expect(voice.prompts).toBe(4);
    // Six vocabulary words once each: the top five, ties alphabetical. "can", "you", "the" and "it" are not words to show.
    expect(voice.words.map((word) => word.key)).toEqual(["bug", "fix", "login", "merge", "run"]);
    expect(voice.openers[0]).toEqual({ key: "can you", count: 2 });
    expect(voice.polite).toEqual({ please: 1, thanks: 1, sorry: 0 });
    expect(voice.questionShare).toBe(0.5);
    expect(voice.oneWord).toBe(1);
    expect(voice.wordsTyped).toBe(7 + 5 + 3 + 1);
  });

  it("leaves script-filled templates and slash commands out of the voice but in the totals", () => {
    const s = session({
      prompts: [prompt("<task_brief>merge merge merge</task_brief>", at(0)), prompt("/model", at(1)), prompt("fix it", at(2))],
    });
    const recap = recapOf([s]);
    expect(recap.voice.prompts).toBe(1);
    expect(recap.voice.excludedWrapped).toBe(1);
    expect(recap.voice.words).toEqual([{ key: "fix", count: 1 }]);
    expect(recap.totals.prompts).toBe(3);
    expect(recap.rhythm!.hours.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("leaves sessions another agent drove out of the voice stats", () => {
    const driven = session({ agentMessageCount: 9, userMessageCount: 1, prompts: [prompt("merge everything", at(0))] });
    const own = session({ prompts: [prompt("fix it", at(1))] });
    const voice = recapOf([driven, own]).voice;
    expect(voice.excludedAgentSessions).toBe(1);
    expect(voice.words).toEqual([{ key: "fix", count: 1 }]);
  });

  it("finds the shortest prompt that set off the most tool calls, as a word count only", () => {
    const calls = Array.from({ length: 30 }, (_, n) => tool("read", { timestamp: at(2 + n / 100) }));
    const s = session({
      prompts: [prompt("please carefully look through the whole repository for problems", at(0)), prompt("go on then", at(2)), prompt("next", at(10))],
      toolCalls: [tool("read", { timestamp: at(1) }), ...calls, tool("read", { timestamp: at(11) })],
    });
    expect(recapOf([s]).voice.leverage).toEqual({ words: 3, toolCalls: 30 });
  });
});

describe("recap: commands and the agent's shell work", () => {
  it("counts slash commands per invocation and folds custom ones into one label", () => {
    const s = session({
      prompts: [prompt("/model", at(0)), prompt("/model opus", at(1)), prompt("/my-private-flow", at(2)), prompt("fix it", at(3))],
    });
    const recap = recapOf([s]);
    expect(recap.slash).toEqual([
      { key: "/model", count: 2 },
      { key: "a custom one", count: 1 },
    ]);
    expect(recap.slashTotal).toBe(3);
  });

  it("prefers the parser's per-invocation counts, which include commands that left no prompt", () => {
    const s = session({ prompts: [prompt("/clear", at(0))] });
    s.features.slashCommandCounts = { "/clear": 1, "/compact": 4 };
    expect(recapOf([s]).slash).toEqual([
      { key: "/compact", count: 4 },
      { key: "/clear", count: 1 },
    ]);
  });

  it("names public programs, calls everything else your own CLI, and finds the agent's nemesis", () => {
    const s = session({
      toolCalls: [
        shell("cd /tmp && python3 x.py", "command_failed"),
        shell("python3 y.py"),
        shell("FOO=1 ./scripts/acme-deploy --prod", "command_failed"),
        shell("timeout 30 pnpm test"),
        shell("pnpm vitest run", "command_failed"),
        shell("rm -rf dist"),
        shell("git push --force origin main"),
        shell("sleep 5"),
        tool("other", { name: "clock.sleep" }),
      ],
    });
    const recap = recapOf([s]);
    expect(recap.shell.programs).toEqual([
      { key: "pnpm", count: 2 },
      { key: "python3", count: 2 },
      { key: "git", count: 1 },
      { key: "rm", count: 1 },
      { key: "sleep", count: 1 },
    ]);
    expect(recap.shell.calls).toBe(8);
    expect(recap.shell.tests).toBe(2);
    expect(recap.shell.testPass).toBe(0.5);
    expect(recap.shell.rmrf).toBe(1);
    expect(recap.shell.forcePush).toBe(1);
    expect(recap.shell.sleeps).toBe(2);
    expect(recap.failures.nemesis).toEqual([
      { key: "pnpm", count: 1, runs: 2 },
      { key: "python3", count: 1, runs: 2 },
      { key: "your own CLI", count: 1, runs: 1 },
    ]);
    expect(recap.failures.total).toBe(3);
    expect(recap.failures.categories).toEqual([{ key: "command_failed", label: "Commands exited non-zero", count: 3 }]);
  });

  it("leaves the test pass rate out when no tests ran, rather than reporting 0%", () => {
    const s = session({ toolCalls: [shell("ls")] });
    expect(recapOf([s]).shell.testPass).toBeUndefined();
  });

  it("names only public connectors and skills", () => {
    const s = session({
      toolCalls: [tool("skill", { skill: "pdf" }), tool("skill", { skill: "acme-internal-release" }), tool("skill", { skill: "pdf" })],
    });
    s.features.mcpServers = ["github", "acme-crm"];
    const recap = recapOf([s]);
    expect(recap.skills).toEqual([
      { key: "pdf", count: 2 },
      { key: "a custom one", count: 1 },
    ]);
    expect(recap.connectors).toEqual([
      { key: "a custom one", count: 1 },
      { key: "github", count: 1 },
    ]);
  });
});

describe("recap: sessions, models and money", () => {
  it("flags a longest session whose tool calls hit the source cap, so the card can say 10,000+", () => {
    const s = session({ harness: "codex", activeMinutes: 900, toolCallsDropped: 12 });
    const recap = recapOf([s, session({ activeMinutes: 10 })]);
    expect(recap.longestSession).toMatchObject({ activeMinutes: 900, harness: "codex", toolCallsCapped: true });
    expect(recap.totals.toolCallsCapped).toBe(true);
  });

  it("keeps public model names, calls the rest another model, and leaves the auto-reviewer out", () => {
    const s = session({
      harness: "codex",
      requests: [
        request({ model: "claude-opus-4-6" }),
        request({ model: "claude-opus-4-6" }),
        request({ model: "gpt-5.1-codex" }),
        request({ model: "acme-private-finetune-v3" }),
        request({ model: "codex-auto-review" }),
      ],
    });
    const recap = recapOf([s]);
    expect(recap.models.map((model) => [model.key, model.requests])).toEqual([
      ["Claude Opus 4.6", 2],
      ["Another model", 1],
      ["GPT-5.1 Codex", 1],
    ]);
    expect(recap.usage.requests).toBe(4);
    expect(recap.models[0]!.share).toBe(0.5);
  });

  it("leaves cost out when nothing could be priced, never reporting $0", () => {
    const s = session({ requests: [request({ model: "acme-private-finetune-v3" })] });
    const recap = recapOf([s]);
    expect(recap.usage.usd).toBeUndefined();
    expect(recap.usage.usdPerCommit).toBeUndefined();
  });

  it("adds up thinking, approvals and reply times only from sessions that recorded them", () => {
    const a = session({ thinking: { blocks: 3, totalMs: 9000, longestMs: 6000 }, approvals: { auto: 10, byPerson: 2, denied: 1 }, userResponseTimesSec: [30, 90, 20 * 3600] });
    const b = session({ harness: "codex", thinking: { blocks: 5, totalMs: null, longestMs: null }, approvals: { guardianReviews: 4 }, userResponseTimesSec: [10] });
    const c = session({ userResponseTimesSec: [] });
    const recap = recapOf([a, b, c]);
    expect(recap.thinking).toEqual({ blocks: 8, totalMs: 9000, longestMs: 6000, sessions: 2 });
    expect(recap.approvals).toEqual({ auto: 10, byPerson: 2, denied: 1, guardianReviews: 4, sessions: 2 });
    expect(recap.replies).toEqual({ count: 3, medianSec: 30, fastShare: 2 / 3, longestSec: 90 });
  });

  it("leaves thinking and approvals out when no session recorded them", () => {
    const recap = recapOf([session()]);
    expect(recap.thinking).toBeUndefined();
    expect(recap.approvals).toBeUndefined();
  });
});

describe("recap: persona, outcomes and tips", () => {
  it("derives a persona from the numbers alone, without facets", () => {
    const recap = recapOf([session(), session({ startTime: day(1) })]);
    expect(recap.winRate).toBeUndefined();
    expect(recap.persona!.role).toBe("Shipper");
    expect(recap.persona!.reason).toBe("100% of your sessions ended in a commit.");
    // Every prompt is at 09:00, early enough to be a dawn person.
    expect(recap.persona!.title).toBe("The Dawn Shipper");
  });

  it("adds the win-rate clause only when facets exist", () => {
    const one = session({ id: "s-one" });
    const two = session({ id: "s-two", startTime: day(1) });
    const recap = recapOf([one, two], { facets: [facet("s-one"), facet("s-two", { outcome: "not_achieved" })] });
    expect(recap.winRate).toBe(0.5);
    expect(recap.facetSessions).toBe(2);
    expect(recap.persona!.reason).toBe("100% of your sessions ended in a commit, and 50% of sessions hit their goal.");
  });

  it("calls someone running many agents at once an orchestrator", () => {
    const sessions = Array.from({ length: 5 }, () => session({ startTime: at(0), gitCommits: 0, toolCalls: [tool("read", { timestamp: at(1) }), tool("read", { timestamp: at(20) })] }));
    expect(recapOf(sessions).persona!.role).toBe("Orchestrator");
  });

  it("shows up to three tips with fixed titles only, one per title", () => {
    const sessions = Array.from({ length: 12 }, (_, index) =>
      session({ startTime: day(index), features: { ...session().features, compactions: 6 }, toolCalls: [shell("pnpm lint", "command_failed", day(index, 1)), shell("pnpm lint", "command_failed", day(index, 2)), shell("pnpm lint", "command_failed", day(index, 3))] }),
    );
    const report = buildReport({ sessions, coverage: [coverage("claude-code", 12)], now: NOW, timeZone: "UTC" });
    const tips = report.recap!.tips;
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.length).toBeLessThanOrEqual(3);
    expect(new Set(tips.map((tip) => tip.title)).size).toBe(tips.length);
    for (const tip of tips) {
      const finding = report.findings.find((candidate) => candidate.kind === tip.kind && candidate.suggestion?.title === tip.title);
      expect(finding).toBeDefined();
    }
  });
});

describe("recap: determinism and absence", () => {
  it("is the same for the same input", () => {
    const sessions = [session({ id: "x1" }), session({ id: "x2", startTime: day(2) })];
    expect(JSON.stringify(recapOf(sessions))).toBe(JSON.stringify(recapOf(sessions)));
  });

  it("is absent from a report with no sessions", () => {
    const report = buildReport({ sessions: [], coverage: [], now: NOW, timeZone: "UTC" });
    expect(report.recap).toBeUndefined();
  });

  it("counts interruptions and steering", () => {
    const s = session({ prompts: [prompt("fix", at(0)), prompt("no, stop", at(1), true)] });
    expect(recapOf([s]).interrupted).toBe(1);
  });
});
