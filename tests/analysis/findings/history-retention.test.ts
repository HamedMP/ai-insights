import { describe, expect, it } from "vitest";
import { buildReport } from "../../../src/analysis/index.js";
import type { HarnessRetention, Retention } from "../../../src/schema/types.js";
import { coverage, day, sessionsOverDays } from "../factory.js";
import { findings } from "./helpers.js";

const LATER = new Date(day(120));

function claude(overrides: Partial<HarnessRetention> = {}): HarnessRetention {
  return {
    harness: "claude-code",
    policy: "deletes",
    days: 30,
    source: "default",
    setting: { name: "cleanupPeriodDays", file: "~/.claude/settings.json", value: null },
    clock: "modified",
    basis: "Claude Code deletes a transcript 30 days after it last changed.",
    transcripts: 3,
    bytes: 3_000,
    oldestOnDisk: day(0),
    cachedOnly: 0,
    coversFrom: day(0),
    atRisk: { sessions: 0, bytes: 0, nextDeletion: null },
    ...overrides,
  };
}

function retention(entries: HarnessRetention[]): Retention {
  const atRisk = { sessions: 0, bytes: 0, nextDeletion: null as string | null };
  for (const entry of entries) {
    atRisk.sessions += entry.atRisk?.sessions ?? 0;
    atRisk.bytes += entry.atRisk?.bytes ?? 0;
    atRisk.nextDeletion ??= entry.atRisk?.nextDeletion ?? null;
  }
  return { windowDays: 7, harnesses: entries, atRisk, cachedOnly: entries.reduce((sum, entry) => sum + entry.cachedOnly, 0), coversFrom: day(0), cache: { keeps: ["numbers"], drops: ["replies"] } };
}

describe("history_retention", () => {
  const sessions = sessionsOverDays(3);

  it("is the most urgent when transcripts are about to be deleted, and cites the sessions that go first", () => {
    const due = [{ sessionId: sessions[0]!.id, eligibleAt: day(121) }];
    const [finding] = findings("history_retention", sessions, {
      now: LATER,
      retention: retention([claude({ atRisk: { sessions: 2, bytes: 2_000, nextDeletion: day(121) }, due })]),
    });
    expect(finding!.severity).toBe("medium");
    expect(finding!.title).toBe("2 Claude Code sessions will be deleted within 7 days");
    expect(finding!.metric).toEqual({ value: 2, unit: "sessions", label: "sessions due for deletion within 7 days" });
    expect(finding!.evidence[0]).toMatchObject({ sessionId: sessions[0]!.id, harness: "claude-code" });
    const [longer, archive, matrix] = finding!.suggestion!.steps!;
    expect(longer).toMatchObject({ title: "Keep Claude Code transcripts longer", command: '"cleanupPeriodDays": 365', undo: "Remove the line to go back to the default of 30 days." });
    expect(longer!.action).toContain("~/.claude/settings.json");
    expect(archive!.command).toBe("npx packmem archive --dry-run");
    expect(matrix!.action).toContain("matrix chats import");
    expect(matrix!.action).not.toMatch(/memory|sync|forever/i);
  });

  it("is a lower-urgency nudge when the setting is at its default and nothing is due this week", () => {
    const [finding] = findings("history_retention", sessions, { now: LATER, retention: retention([claude()]) });
    expect(finding!.severity).toBe("low");
    expect(finding!.title).toBe("Claude Code deletes transcripts after 30 days");
  });

  it("offers the undo for a value the person already set", () => {
    const entry = claude({ source: "settings", days: 14, setting: { name: "cleanupPeriodDays", file: "~/.claude/settings.json", value: 14 }, atRisk: { sessions: 1, bytes: 1, nextDeletion: day(122) } });
    const [finding] = findings("history_retention", sessions, { now: LATER, retention: retention([entry]) });
    expect(finding!.suggestion!.steps![0]!.undo).toBe("Set it back to 14.");
  });

  it("says nothing when the setting was raised, nothing is due and history is long", () => {
    const entry = claude({ source: "settings", days: 365, setting: { name: "cleanupPeriodDays", file: "~/.claude/settings.json", value: 365 } });
    expect(findings("history_retention", sessions, { now: LATER, retention: retention([entry]) })).toEqual([]);
  });

  it("does not offer a settings line an organization's managed settings would override", () => {
    const entry = claude({ source: "managed", days: 7, setting: { name: "cleanupPeriodDays", file: "/etc/claude-code/managed-settings.json", value: 7 }, atRisk: { sessions: 1, bytes: 1, nextDeletion: day(121) } });
    const [finding] = findings("history_retention", sessions, { now: LATER, retention: retention([entry]) });
    expect(finding!.suggestion!.steps![0]!.command).toBeUndefined();
    expect(finding!.suggestion!.steps![0]!.action).toMatch(/administrator/);
  });
});

describe("retention in the report and the recap", () => {
  it("passes the measured retention through and gives the recap a share-safe history card", () => {
    const sessions = sessionsOverDays(3);
    const measured = retention([claude({ cachedOnly: 4 })]);
    const report = buildReport({ sessions, coverage: [coverage("claude-code", 3)], now: new Date(day(20)), timeZone: "UTC", retention: measured });
    expect(report.retention).toBe(measured);
    expect(report.recap!.history).toEqual({ days: 20, firstDay: "2026-06-01", cachedOnly: 4 });
  });

  it("leaves both out when the scan did not measure retention", () => {
    const report = buildReport({ sessions: sessionsOverDays(3), coverage: [coverage("claude-code", 3)], now: new Date(day(20)), timeZone: "UTC" });
    expect(report.retention).toBeUndefined();
    expect(report.recap!.history).toBeUndefined();
  });
});
