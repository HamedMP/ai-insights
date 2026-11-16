import { describe, expect, it } from "vitest";
import { buildReport, historyDays } from "../../../src/analysis/index.js";
import type { Session, ToolCall } from "../../../src/schema/types.js";
import { coverage, day, prompt, session, sessionsOverDays, shell, tool } from "../factory.js";
import { findings } from "./helpers.js";

const MB = 1_000_000;
const features = session().features;

/** Tool calls every few minutes, so the agent is visibly busy from `from` to `to` minutes into the day. */
function busy(dayIndex: number, from: number, to: number): ToolCall[] {
  const calls: ToolCall[] = [];
  for (let minute = from; minute <= to; minute += 4) calls.push(tool("read", { timestamp: day(dayIndex, minute) }));
  return calls;
}

describe("short_history uses one definition of days of history", () => {
  it("counts calendar days from the oldest session to today, the same number the page can compute", () => {
    const sessions = sessionsOverDays(3);
    const now = new Date(day(20, 600));
    const [finding] = findings("short_history", sessions, { now });
    expect(historyDays(sessions[0]!.startTime, now, "UTC")).toBe(20);
    expect(finding!.metric?.value).toBe(20);
  });

  it("reads the oldest date from coverage when the scan recorded it", () => {
    const sessions = sessionsOverDays(3, (index) => ({ startTime: day(10 + index) }));
    const cov = { ...coverage("claude-code", 3), oldest: day(5) };
    const [finding] = findings("short_history", sessions, { coverage: [cov], now: new Date(day(20)) });
    expect(finding!.metric?.value).toBe(15);
  });

  it("names transcript cleanup as the usual cause, not as a fact", () => {
    const [finding] = findings("short_history", sessionsOverDays(3), { now: new Date(day(10)) });
    expect(finding!.detail).toMatch(/usual cause/i);
    expect(finding!.detail).toMatch(/new machine|fresh install/i);
  });
});

describe("history_disk_usage", () => {
  it("does not cite a session that is still running", () => {
    const finished = session({ startTime: day(0), endTime: day(0, 30) });
    const running = session({ startTime: day(1), endTime: day(1, 55) });
    const now = new Date(day(1, 58));
    const [finding] = findings("history_disk_usage", [finished, running], { coverage: [coverage("claude-code", 2, true, 600 * MB)], now });
    expect(finding).toBeDefined();
    expect(finding!.evidence.map((item) => item.sessionId)).toEqual([finished.id]);
    expect(finding!.suggestion?.url).toBeTruthy();
  });
});

describe("slow_correction", () => {
  it("ignores a step-in after the agent had finished and was waiting", () => {
    const sessions = sessionsOverDays(4, (index) => ({
      requests: [],
      toolCalls: busy(index, 1, 8),
      prompts: [prompt("build the report page", day(index)), prompt("no, use the other layout", day(index, 120), true)],
    }));
    expect(findings("slow_correction", sessions)).toEqual([]);
  });

  it("still flags a late step-in while the agent was busy", () => {
    const sessions = sessionsOverDays(4, (index) => ({
      requests: [],
      toolCalls: busy(index, 1, 40),
      prompts: [prompt("build the report page", day(index)), prompt("no, use the other layout", day(index, 42), true)],
    }));
    expect(findings("slow_correction", sessions)).toHaveLength(1);
  });
});

describe("long_sessions", () => {
  it("leads its evidence with sessions that were long because of work, not ones left open for days", () => {
    const sessions = sessionsOverDays(8, (index) =>
      index === 0
        ? { activeMinutes: 1500, durationMinutes: 7200, userMessageCount: 16 }
        : index < 4
          ? { activeMinutes: 200, durationMinutes: 240, userMessageCount: 40 }
          : {},
    );
    const [finding] = findings("long_sessions", sessions);
    expect(finding!.evidence[0]!.sessionId).not.toBe(sessions[0]!.id);
    expect(finding!.evidence.at(-1)!.sessionId).toBe(sessions[0]!.id);
  });

  it("steps back when the same sessions already back the context-resets finding", () => {
    const sessions = sessionsOverDays(10, (index) =>
      index < 4 ? { activeMinutes: 300, features: { ...features, compactions: 3 } } : {},
    );
    const all = findings("long_sessions", sessions);
    expect(all[0]!.severity).toBe("info");
    expect(all[0]!.detail).toMatch(/context/i);
  });

  it("keeps its severity when long sessions are not the compacted ones", () => {
    const sessions = sessionsOverDays(10, (index) =>
      index < 4 ? { activeMinutes: 300 } : index < 8 ? { features: { ...features, compactions: 3 } } : {},
    );
    expect(findings("long_sessions", sessions)[0]!.severity).not.toBe("info");
  });
});

describe("permission_prompt_load names the commands that keep getting denied", () => {
  const work = (index: number) => Array.from({ length: 300 }, (_, n) => tool("read", { timestamp: day(index, 10 + n / 50) }));

  it("lists each repeated pattern with counts and sessions and proposes an allowlist entry", () => {
    const sessions: Session[] = sessionsOverDays(5, (index) => ({
      toolCalls: [
        shell(`git push --force-with-lease origin feature-${index}`, "permission_denied", day(index, 1)),
        shell(`gh pr ready ${100 + index}`, "permission_denied", day(index, 2)),
        ...work(index),
      ],
    }));
    const [finding] = findings("permission_prompt_load", sessions);
    expect(finding).toBeDefined();
    expect(finding!.detail).toContain("`git push --force-with-lease` (5 times in 5 sessions)");
    expect(finding!.detail).toContain("`gh pr ready` (5 times in 5 sessions)");
    expect(finding!.suggestion?.type).toBe("feature");
    expect(finding!.suggestion?.action).toContain('"Bash(git push --force-with-lease:*)"');
    expect(finding!.suggestion?.action).toContain('"Bash(gh pr ready:*)"');
  });

  it("never proposes allowing destructive or admin commands", () => {
    const sessions: Session[] = sessionsOverDays(5, (index) => ({
      toolCalls: [
        shell("rm -rf build", "permission_denied", day(index, 1)),
        shell(`gh pr merge ${index} --admin --squash`, "permission_denied", day(index, 2)),
        shell("git push --force origin main", "permission_denied", day(index, 3)),
        shell("git reset --hard origin/main", "permission_denied", day(index, 4)),
        shell(`gh pr ready ${index}`, "permission_denied", day(index, 5)),
        ...work(index),
      ],
    }));
    const [finding] = findings("permission_prompt_load", sessions);
    const action = finding!.suggestion?.action ?? "";
    expect(action).toContain("Bash(gh pr ready:*)");
    for (const unsafe of ["rm", "gh pr merge", "git push --force:", "git reset"]) expect(action).not.toContain(`Bash(${unsafe}`);
  });

  it("does not propose a rule so broad it would also allow force pushes, and names it as left out", () => {
    const sessions: Session[] = sessionsOverDays(5, (index) => ({
      toolCalls: [shell(`git push -u origin feature-${index}`, "permission_denied", day(index, 1)), shell(`gh pr ready ${index}`, "permission_denied", day(index, 2)), ...work(index)],
    }));
    const [finding] = findings("permission_prompt_load", sessions);
    expect(finding!.suggestion?.action).not.toContain("Bash(git push:*)");
    expect(finding!.suggestion?.action).toContain("`git push`");
    expect(finding!.suggestion?.action).toContain("Bash(gh pr ready:*)");
  });

  it("does not mistake a shell loop for a command name", () => {
    const sessions: Session[] = sessionsOverDays(5, (index) => ({
      toolCalls: [shell("for f in a b; do cat $f; done", "permission_denied", day(index, 1)), shell(`gh pr ready ${index}`, "permission_denied", day(index, 2)), ...work(index)],
    }));
    const [finding] = findings("permission_prompt_load", sessions);
    expect(finding!.detail).not.toContain("`for");
  });

  it("stays quiet when the only repeated denials are destructive commands, which are deliberate stops", () => {
    const sessions: Session[] = sessionsOverDays(5, (index) => ({
      toolCalls: [shell("rm -rf build", "permission_denied", day(index, 1)), shell("git push --force", "permission_denied", day(index, 2)), ...work(index)],
    }));
    expect(findings("permission_prompt_load", sessions)).toEqual([]);
  });
});

describe("Coverage.historyDays", () => {
  const build = (sessions: Session[], cov: ReturnType<typeof coverage>[], now: Date) =>
    buildReport({ sessions, coverage: cov, now, timeZone: "UTC" });

  it("fills each harness's days of history, the same number the short-history finding states", () => {
    const sessions = [...sessionsOverDays(2, (index) => ({ startTime: day(14 + index) })), ...sessionsOverDays(2, (index) => ({ harness: "codex", startTime: day(index) }))];
    const now = new Date(day(20));
    const report = build(sessions, [coverage("claude-code", 2), coverage("codex", 2)], now);
    expect(report.coverage.map((entry) => [entry.harness, entry.historyDays])).toEqual([["claude-code", 6], ["codex", 20]]);
    const finding = report.findings.find((item) => item.kind === "short_history");
    expect(finding!.metric?.value).toBe(6);
    expect(finding!.detail).toContain("Codex 20 days");
  });

  it("uses the scan's oldest date when it reaches further back than the sessions", () => {
    const report = build(sessionsOverDays(2, (index) => ({ startTime: day(10 + index) })), [{ ...coverage("claude-code", 2), oldest: day(4) }], new Date(day(20)));
    expect(report.coverage[0]!.historyDays).toBe(16);
  });

  it("leaves it out for a harness with no history found, and does not change the caller's coverage", () => {
    const input = [coverage("claude-code", 2), coverage("cursor", 0, false)];
    const report = build(sessionsOverDays(2), input, new Date(day(20)));
    expect(report.coverage[1]).not.toHaveProperty("historyDays");
    expect(input[0]).not.toHaveProperty("historyDays");
  });
});

describe("wave 6", () => {
  const work = (index: number) => Array.from({ length: 300 }, (_, n) => tool("read", { timestamp: day(index, 10 + n / 50) }));

  it("reports permission blocks as a plain count, with the rate in words", () => {
    const sessions: Session[] = sessionsOverDays(5, (index) => ({
      toolCalls: [shell(`gh pr ready ${index}`, "permission_denied", day(index, 1)), ...work(index)],
    }));
    const [finding] = findings("permission_prompt_load", sessions);
    expect(finding!.metric).toEqual({ value: 5, unit: "blocked calls", label: "tool calls blocked or refused" });
    expect(finding!.detail).toMatch(/per 100 tool calls/);
  });

  it("does not let a command blocked only a few times carry a suggestion on its own", () => {
    const sessions: Session[] = sessionsOverDays(4, (index) => ({
      toolCalls: [shell(`gh pr ready ${index}`, "permission_denied", day(index, 1)), ...work(index)],
    }));
    expect(findings("permission_prompt_load", sessions)).toEqual([]);
  });

  it("only proposes allow rules for commands blocked about five times or more, even when the overall rate fires", () => {
    const sessions: Session[] = sessionsOverDays(4, (index) => ({
      toolCalls: [
        shell(`gh pr ready ${index}`, "permission_denied", day(index, 1)),
        ...[2, 3].map((minute) => shell("rm -rf build", "permission_denied", day(index, minute))),
        tool("read", { timestamp: day(index, 5) }),
      ],
    }));
    const [finding] = findings("permission_prompt_load", sessions);
    expect(finding).toBeDefined();
    expect(finding!.suggestion?.action).not.toContain("Bash(");
  });

  it("names each harness's own oldest date in the short-history text", () => {
    const sessions = [...sessionsOverDays(2, (index) => ({ startTime: day(20 + index) })), ...sessionsOverDays(2, (index) => ({ harness: "codex", startTime: day(index) }))];
    const [finding] = findings("short_history", sessions, { now: new Date(day(26)) });
    expect(finding!.detail).toContain("Claude Code 6 days (since 2026-06-21)");
    expect(finding!.detail).toContain("Codex 26 days (since 2026-06-01)");
    expect(finding!.suggestion?.action).toContain("2026-06-21");
    expect(finding!.suggestion?.action).not.toContain("2026-06-01");
    const notes = finding!.evidence.map((item) => [item.harness, item.note]);
    expect(notes).toEqual([
      ["claude-code", expect.stringContaining("2026-06-21")],
      ["codex", expect.stringContaining("2026-06-01")],
    ]);
  });

  it("words long-session time as agent activity", () => {
    const sessions = sessionsOverDays(8, (index) => (index < 3 ? { activeMinutes: 200 } : {}));
    const [finding] = findings("long_sessions", sessions);
    expect(finding!.evidence.every((item) => item.note.includes("of agent activity"))).toBe(true);
  });
});
