import { describe, expect, it } from "vitest";
import { buildModel, describeNext, describeNudge, formatCost, formatCount, formatDuration, nudgeFor, pickTip, relativeTime } from "../ui/src/model.ts";
import type { Period, Summary, ViewState } from "../ui/src/types.ts";

const NOW = Date.UTC(2026, 10, 18, 15, 45);

function period(key: Period["key"], over: Partial<Period> = {}): Period {
  return { key, from: null, to: null, sessions: 0, activeMinutes: 0, prompts: 0, tokensTotal: null, costUsd: 0, unpricedShare: 0, byAgent: [], tip: null, ...over };
}

function summary(over: Partial<Summary> = {}): Summary {
  return {
    schemaVersion: 1,
    newerSchema: false,
    generatedAt: null,
    timezone: null,
    periods: [
      period("today", { sessions: 7, activeMinutes: 138, costUsd: 4.2, tip: { id: "t", text: "Today tip" } }),
      period("week", {
        sessions: 41,
        activeMinutes: 366,
        costUsd: 27.9,
        tip: { id: "w", text: "Week tip" },
        byAgent: [
          { agent: "claude-code", label: "Claude Code", sessions: 29, costUsd: 22.1, measured: true },
          { agent: "claude-chat", label: "Claude (chat export)", sessions: 1, costUsd: null, measured: false },
        ],
      }),
      period("month", { sessions: 168, activeMinutes: 2890, costUsd: 118.4 }),
    ],
    reportPath: null,
    ...over,
  };
}

function state(over: Partial<ViewState["snapshot"]> = {}, settings: Partial<ViewState["settings"]> = {}): ViewState {
  return {
    snapshot: { summary: summary(), problem: null, fetchedAt: NOW - 3 * 60_000, refreshing: false, cliLocation: "/usr/local/bin/ai-insights", ...over },
    settings: { hideCost: false, refreshMinutes: 30, cliPath: null, nudge: { cadence: "off", hour: 16, minute: 0, weekday: 5 }, onboarded: true, ...settings },
    platform: "macos",
    launchAtLogin: false,
    nextNudgeAt: null,
  };
}

describe("numbers a person reads at a glance", () => {
  it("formats counts, active time and cost compactly", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(null)).toBe("–");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(366)).toBe("6.1 h");
    expect(formatDuration(2890)).toBe("48.2 h");
    expect(formatDuration(9000)).toBe("150 h");
    expect(formatDuration(null)).toBe("–");
    expect(formatCost(4.2)).toBe("$4.20");
    expect(formatCost(118.4)).toBe("$118");
    expect(formatCost(1180)).toBe("$1,180");
    expect(formatCost(null)).toBe("–");
  });

  it("says how fresh the numbers are", () => {
    expect(relativeTime(null, NOW)).toBe("Not updated yet");
    expect(relativeTime(NOW - 20_000, NOW)).toBe("Updated just now");
    expect(relativeTime(NOW - 3 * 60_000, NOW)).toBe("Updated 3 min ago");
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe("Updated 2 h ago");
    expect(relativeTime(NOW - 30 * 3_600_000, NOW)).toBe("Updated yesterday");
  });
});

describe("the popover model", () => {
  it("leads with the week's tip, then shows today, week and month", () => {
    const model = buildModel(state(), NOW);
    expect(model.tip).toEqual({ text: "Week tip", scope: "Tip for this week" });
    expect(model.columns.map((c) => [c.label, c.sessions, c.active, c.cost])).toEqual([
      ["Today", "7", "2.3 h", "$4.20"],
      ["This week", "41", "6.1 h", "$27.90"],
      ["This month", "168", "48.2 h", "$118"],
    ]);
    expect(model.updated).toBe("Updated 3 min ago");
  });

  it("falls back to another period's tip when the week has none", () => {
    const s = summary();
    s.periods[1] = period("week", { sessions: 3 });
    expect(pickTip(s)?.text).toBe("Today tip");
  });

  it("shows chat exports as not measured, never as zero, even with cost hidden", () => {
    for (const hideCost of [false, true]) {
      const chat = buildModel(state({}, { hideCost }), NOW).agents.find((a) => a.label.startsWith("Claude (chat"));
      expect(chat?.cost).toBe("not measured");
    }
  });

  it("hides every cost figure when the person turns cost off", () => {
    const model = buildModel(state({}, { hideCost: true }), NOW);
    expect(model.showCost).toBe(false);
    expect(model.costNote).toBeNull();
    expect(model.agents.find((a) => a.measured)?.cost).toBe("");
  });

  it("warns when a noticeable share of requests had no known price", () => {
    const s = summary();
    s.periods[2] = period("month", { sessions: 1, unpricedShare: 0.11 });
    expect(buildModel(state({ summary: s }), NOW).costNote).toContain("11%");
    expect(buildModel(state(), NOW).costNote).toBe("Estimated from public API prices, not your bill.");
  });

  it("explains how to install the CLI when it is missing and disables the report button", () => {
    const model = buildModel(state({ summary: null, problem: "cliMissing" }), NOW);
    expect(model.notice?.command).toBe("npm i -g ai-insights");
    expect(model.canOpenReport).toBe(false);
    expect(model.loading).toBe(false);
  });

  it("asks for a CLI update when the installed one predates the summary command", () => {
    const model = buildModel(state({ summary: null, problem: "cliTooOld" }), NOW);
    expect(model.notice?.command).toBe("npm i -g ai-insights@latest");
    expect(model.canOpenReport).toBe(false);
  });

  it("keeps the last numbers on screen when a later refresh fails", () => {
    const model = buildModel(state({ problem: "timeout" }), NOW);
    expect(model.notice?.title).toMatch(/too long/);
    expect(model.columns[1]?.sessions).toBe("41");
  });

  it("shows a quiet loading state before the first answer, and an empty state with no sessions", () => {
    expect(buildModel(state({ summary: null, fetchedAt: null, refreshing: true }), NOW).loading).toBe(true);
    const empty = summary({ periods: [period("today"), period("week"), period("month")] });
    const model = buildModel(state({ summary: empty }), NOW);
    expect(model.empty).toBe(true);
    expect(model.tip).toBeNull();
  });

  it("shows a dash, not zero, for a period the CLI left out", () => {
    const s = summary();
    s.periods[0] = null;
    expect(buildModel(state({ summary: s }), NOW).columns[0]).toMatchObject({ sessions: "–", active: "–", cost: "–" });
  });

  it("notes when the CLI speaks a newer contract than the app", () => {
    expect(buildModel(state({ summary: summary({ newerSchema: true }) }), NOW).footnote).toMatch(/newer/);
  });
});

describe("nudges", () => {
  const nudge = { cadence: "off" as const, hour: 16, minute: 0, weekday: 5 };

  it("asks about nudges until the first-run question is answered", () => {
    expect(buildModel(state({}, { nudge, onboarded: false }), NOW).askAboutNudges).toBe(true);
    expect(buildModel(state({}, { nudge, onboarded: true }), NOW).askAboutNudges).toBe(false);
  });

  it("gives each cadence a sensible default time when picked", () => {
    expect(nudgeFor("daily", nudge)).toMatchObject({ cadence: "daily", hour: 18, minute: 0 });
    expect(nudgeFor("weekly", { ...nudge, weekday: 2 })).toMatchObject({ cadence: "weekly", hour: 16, weekday: 5 });
    expect(nudgeFor("monthly", nudge)).toMatchObject({ cadence: "monthly", hour: 16 });
    expect(nudgeFor("off", { ...nudge, cadence: "weekly" }).cadence).toBe("off");
  });

  it("describes the schedule and the next nudge in plain words, in the app's local time", () => {
    expect(describeNudge({ cadence: "weekly", hour: 16, minute: 0, weekday: 5 })).toBe("Every Friday at 16:00, about this week");
    expect(describeNudge({ cadence: "daily", hour: 9, minute: 5, weekday: 1 })).toBe("Every day at 09:05, about today");
    expect(describeNudge({ cadence: "monthly", hour: 16, minute: 0, weekday: 1 })).toMatch(/last day/);
    expect(describeNext("2026-11-20T16:00:00+02:00")).toBe("Next: Friday 20 Nov, 16:00");
    expect(describeNext("2026-11-30T23:30:00-08:00")).toBe("Next: Monday 30 Nov, 23:30");
    expect(describeNext(null)).toBeNull();
    expect(describeNext("garbage")).toBeNull();
  });
});
