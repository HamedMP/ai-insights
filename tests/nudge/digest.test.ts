import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run, type CliDeps } from "../../src/cli/main.js";
import { runNudge } from "../../src/nudge/command.js";
import { DIGEST_FILE, digestLine, readDigest, type Digest } from "../../src/nudge/digest.js";
import { NUDGE_FILE, NUDGE_TEXT, plainText, takeNudge } from "../../src/nudge/nudge.js";
import type { Session } from "../../src/schema/types.js";
import { fakeBuildReport, fakeRenderReport, fakeSource, makeSession, tempHome } from "../store/fixtures.js";

// The session-start line at the cadence the person picked, from the digest their own runs leave behind. The hook
// never reads history: everything here comes from two small files in the store.

let home: string;
let cleanup: () => Promise<void>;
beforeEach(async () => ({ home, cleanup } = await tempHome()));
afterEach(async () => cleanup());

const pad = (n: number) => String(n).padStart(2, "0");
/** A local ISO time with the machine's offset, as the CLI writes it. */
function local(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

const period = (from: Date, to: Date, extra: Partial<Digest["periods"]["week"]> = {}) => ({
  from: local(from),
  to: local(to),
  sessions: 41,
  activeMinutes: 366,
  prompts: 402,
  contextResets: 9,
  tokens: 32_000_000,
  costUsd: 27.9,
  tip: { id: "context_resets" },
  ...extra,
});

/** A digest written on Wednesday 18 November 2026 at 17:00, local time. */
function digest(): Digest {
  return {
    v: 2,
    writtenAt: new Date(2026, 10, 18, 17).toISOString(),
    timezone: "Local",
    periods: {
      today: period(new Date(2026, 10, 18), new Date(2026, 10, 18, 17), { sessions: 5, activeMinutes: 70, contextResets: 0, tip: null }),
      week: period(new Date(2026, 10, 16), new Date(2026, 10, 18, 17)),
      month: period(new Date(2026, 10, 1), new Date(2026, 10, 18, 17), { sessions: 168, activeMinutes: 2890, contextResets: 31 }),
      // The whole periods just ended.
      yesterday: period(new Date(2026, 10, 17), new Date(2026, 10, 18), { sessions: 7, activeMinutes: 200, contextResets: 1, tip: { id: "long_sessions" } }),
      lastWeek: period(new Date(2026, 10, 9), new Date(2026, 10, 16), { sessions: 52, activeMinutes: 1500, contextResets: 12 }),
      lastMonth: period(new Date(2026, 9, 1), new Date(2026, 10, 1), { sessions: 230, activeMinutes: 6000, contextResets: 40 }),
    },
  };
}

const OFF = "Turn this off: npx ai-insights@latest nudge --off";

describe("the digest line", () => {
  it("gives the period's counts and a fixed-wording tip, and says how far a partial period goes", () => {
    // A digest written this week: last week, whole.
    expect(digestLine(digest(), "weekly", new Date(2026, 10, 18, 18), OFF)).toBe(
      `AI Insights: last week 52 sessions, 25 h active, 12 context resets. Sessions ran out of context last week. Try /clear between unrelated tasks, or hand off instead of compacting. Run /analyze-ai-usage for the full review. (${OFF})`,
    );
    // The next Monday: the week just ended, counted to the run on Wednesday.
    expect(digestLine(digest(), "weekly", new Date(2026, 10, 23, 9), OFF)).toMatch(/^AI Insights: last week \(to Wed 18 Nov\) 41 sessions, 6\.1 h active, 9 context resets\. Sessions ran out of context last week\./);
    expect(digestLine(digest(), "daily", new Date(2026, 10, 18, 20), OFF)).toBe(
      `AI Insights: yesterday 7 sessions, 3.3 h active, 1 context reset. Some sessions ran very long yesterday. Split work at natural checkpoints and start fresh. Run /analyze-ai-usage for the full review. (${OFF})`,
    );
    expect(digestLine(digest(), "daily", new Date(2026, 10, 19, 8), OFF)).toMatch(/^AI Insights: yesterday \(to 17:00\) 5 sessions/);
    expect(digestLine(digest(), "monthly", new Date(2026, 11, 1, 9), OFF)).toMatch(/^AI Insights: last month \(to Wed 18 Nov\) 168 sessions, 48 h active, 31 context resets\./);
  });

  it("says nothing from a digest about an older period, which would mislead", () => {
    expect(digestLine(digest(), "weekly", new Date(2026, 10, 30, 9), OFF)).toBeNull();
    expect(digestLine(digest(), "daily", new Date(2026, 10, 21, 9), OFF)).toBeNull();
  });

  it("refuses a damaged digest or one of another version", async () => {
    await writeFile(join(home, DIGEST_FILE), JSON.stringify({ ...digest(), v: 3 }));
    expect(await readDigest(home)).toBeNull();
    // The rolling-window file `schedule` wrote before this version is not an error, just missing.
    await writeFile(join(home, DIGEST_FILE), JSON.stringify({ v: 1, generatedAt: "2026-11-18T10:00:00Z", days: 7, sessions: 3, activeMinutes: 10, prompts: 4, costUsd: null, tipId: null }));
    expect(await readDigest(home)).toBeNull();
    await writeFile(join(home, DIGEST_FILE), JSON.stringify({ ...digest(), periods: { ...digest().periods, week: { ...digest().periods.week, sessions: -1 } } }));
    expect(await readDigest(home)).toBeNull();
    await writeFile(join(home, DIGEST_FILE), "{");
    expect(await readDigest(home)).toBeNull();
    await writeFile(join(home, DIGEST_FILE), JSON.stringify(digest()));
    expect(await readDigest(home)).toEqual(digest());
  });
});

describe("the session-start line at a cadence", () => {
  it("weekly: the digest once per week, from Monday; the plain line when there is no current digest", async () => {
    await runNudge(["--cadence", "weekly"], { stdout: () => {}, stderr: () => {}, env: { AI_INSIGHTS_HOME: home }, now: () => new Date() });
    await writeFile(join(home, DIGEST_FILE), JSON.stringify(digest()));
    expect(await takeNudge(home, new Date(2026, 10, 18, 18))).toMatch(/^AI Insights: last week 52 sessions/);
    expect(await takeNudge(home, new Date(2026, 10, 20, 9))).toBeNull();
    expect(await takeNudge(home, new Date(2026, 10, 23, 9))).toMatch(/^AI Insights: last week \(to Wed 18 Nov\)/);
    expect(await takeNudge(home, new Date(2026, 10, 30, 9))).toBe(plainText("weekly"));
  });

  it("monthly stays the default and keeps its rule, with the digest when one is current", async () => {
    expect(JSON.parse((await readFile(join(home, NUDGE_FILE), "utf8").catch(() => "{}")) || "{}").cadence).toBeUndefined();
    expect(await takeNudge(home, new Date(2026, 10, 18, 9))).toBe(NUDGE_TEXT);
    await writeFile(join(home, DIGEST_FILE), JSON.stringify(digest()));
    expect(await takeNudge(home, new Date(2026, 11, 1, 9))).toMatch(/^AI Insights: last month \(to Wed 18 Nov\) 168 sessions/);
  });

  it("prints only hook JSON with one line as systemMessage, and exits 0 on a bad cadence", async () => {
    let out = "";
    let err = "";
    const deps = { stdout: (text: string) => void (out += text), stderr: (text: string) => void (err += text), env: { AI_INSIGHTS_HOME: home }, now: () => new Date(2026, 10, 18, 18) };
    expect(await runNudge(["--cadence", "hourly"], deps)).toBe(0);
    expect(err).toMatch(/--cadence must be daily, weekly or monthly/);
    out = "";
    await runNudge(["--cadence", "daily"], deps);
    expect(out).toMatch(/first session of each day/);
    await writeFile(join(home, DIGEST_FILE), JSON.stringify(digest()));
    out = "";
    expect(await runNudge(["--format", "hook"], deps)).toBe(0);
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual({ systemMessage: expect.stringMatching(/^AI Insights: yesterday 7 sessions/) });
  });
});

describe("the digest a run leaves in the store", () => {
  const NOW = new Date(2026, 10, 18, 17);
  const session = (id: string, day: number): Session =>
    makeSession({
      id,
      sourceMtimeMs: new Date(2026, 10, day, 10).getTime(),
      startTime: new Date(2026, 10, day, 9).toISOString(),
      endTime: new Date(2026, 10, day, 9, 30).toISOString(),
      projectPath: "/home/someone/secret-project",
      prompts: [{ timestamp: new Date(2026, 10, day, 9).toISOString(), text: "a private prompt" }],
      requests: [{ id: `${id}-r`, timestamp: new Date(2026, 10, day, 9, 10).toISOString(), model: "claude-opus-4-5", usage: { input: 1000, cachedInput: 0, cacheWrite: 0, output: 100 } }],
      features: { mcpServers: [], skills: [], slashCommands: [], subagents: 0, planMode: false, webSearch: false, webFetch: false, compactions: 2 },
    });
  const deps = (sessions: Session[]): Partial<CliDeps> => ({
    stdout: () => {},
    stderr: () => {},
    env: { AI_INSIGHTS_HOME: home },
    sources: [fakeSource("claude-code", sessions)],
    buildReport: fakeBuildReport(),
    renderReport: fakeRenderReport,
    now: () => NOW,
    retentionPolicies: async () => new Map(),
  });

  it("holds counts, cost and a tip kind for today, this week and this month, and nothing else", async () => {
    const october = makeSession({ ...session("d", 1), id: "d", sourceMtimeMs: new Date(2026, 9, 20, 10).getTime(), startTime: new Date(2026, 9, 20, 9).toISOString(), endTime: new Date(2026, 9, 20, 9, 30).toISOString() });
    expect(await run(["today"], deps([session("a", 18), session("b", 17), session("c", 2), october]))).toBe(0);
    const saved = await readDigest(home);
    expect(saved?.periods.today).toMatchObject({ sessions: 1, contextResets: 2, prompts: 1 });
    expect(saved?.periods.month).toMatchObject({ sessions: 3, contextResets: 6 });
    expect(saved?.periods.yesterday).toMatchObject({ sessions: 1, contextResets: 2 });
    expect(saved?.periods.lastWeek).toMatchObject({ sessions: 0 });
    // Last month is read even though `today` itself needs only today.
    expect(saved?.periods.lastMonth).toMatchObject({ sessions: 1, contextResets: 2 });
    const raw = await readFile(join(home, DIGEST_FILE), "utf8");
    expect(raw).not.toMatch(/private prompt|secret-project|\/home\/|claude-opus/);
  });

  it("is written by the scheduled job too, so its notification, the reminder and the statusline agree", async () => {
    const { refreshForSchedule } = await import("../../src/cli/commands.js");
    // The job passes the CLI's full defaults; these tests supply only what a refresh uses.
    const counts = await refreshForSchedule(deps([session("a", 18), session("b", 17), session("c", 10)]) as Parameters<typeof refreshForSchedule>[0], "week");
    const saved = await readDigest(home);
    expect(saved?.v).toBe(2);
    expect(saved?.periods.lastWeek.sessions).toBe(counts.sessions);
  });

  it("is not written from a filtered view, which would not be the whole history", async () => {
    await run(["week", "--harness", "claude-code"], deps([session("a", 18)]));
    expect(await readDigest(home)).toBeNull();
  });
});
