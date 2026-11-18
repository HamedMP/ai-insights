import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReport } from "../../src/analysis/index.js";
import { periodUsage, type UsageRange } from "../../src/analysis/period-usage.js";
import type { Source } from "../../src/schema/types.js";
import { claudeSource } from "../../src/sources/claude/index.js";
import { readClaudeUsage } from "../../src/sources/claude/usage.js";
import { codexSource } from "../../src/sources/codex/index.js";
import { scan } from "../../src/store/scan.js";
import { Store } from "../../src/store/store.js";
import { usageScan } from "../../src/store/usage-scan.js";
import { assistant, prompt, tempRoot, toolUse, transcript } from "../sources/claude/helpers.js";
import { meta, rec, resetClock, rolloutName, turnContext, Tree, userMessage, uuid } from "../sources/codex/fixtures.js";
import { tempHome } from "./fixtures.js";

// The first numbers the CLI shows come from the usage-only scan, and are later replaced by the full analysis. They
// must be the same numbers: every period's tokens, requests and cost equal what the report computes.

let home: string;
let cleanup: () => Promise<void>;
let tree: Tree;
let claudeRoot: string;
beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  tree = new Tree();
  claudeRoot = tempRoot();
});
afterEach(async () => {
  tree.cleanup();
  await cleanup();
});

const A = "aaaaaaaa-2222-4333-8444-555555555555";
const B = "bbbbbbbb-2222-4333-8444-555555555555";
const C = "cccccccc-2222-4333-8444-555555555555";

function sources(): Source[] {
  return [
    { ...claudeSource, discover: (options) => claudeSource.discover({ ...options, roots: [claudeRoot] }) },
    { ...codexSource, discover: (options) => codexSource.discover({ ...options, roots: [tree.sessions] }) },
  ];
}

function history(): void {
  const withSession = (session: string, record: Record<string, unknown>) => ({ ...record, sessionId: session });
  transcript(
    [
      prompt("2026-10-30T23:50:00.000Z", "start late"),
      assistant("2026-10-30T23:55:00.000Z", "m-a1", [toolUse("t1", "Bash", { command: "ls" })], { usage: { input: 100, output: 50, cacheRead: 1000, cacheWrite: 200 } }),
      assistant("2026-10-31T00:05:00.000Z", "m-a2", [], { usage: { input: 10, output: 5 }, model: "claude-sonnet-4-5" }),
      assistant("2026-10-31T00:06:00.000Z", "m-a3", [], { usage: { input: 10, output: 5 }, model: "unknown-model-x" }),
    ].map((record) => withSession(A, record)),
    { root: claudeRoot, session: A },
  );
  // A second session that holds a response id the first also holds, with other counters: who owns it depends on
  // start times, which the usage-only reading does not read, so it must parse both in full.
  transcript(
    [
      prompt("2026-11-01T09:00:00.000Z", "continue"),
      assistant("2026-11-01T09:00:10.000Z", "m-a2", [], { usage: { input: 999, output: 999 }, model: "claude-sonnet-4-5" }),
      assistant("2026-11-01T09:01:00.000Z", "m-b1", [], { usage: { input: 300, output: 30, speed: "fast" }, model: "claude-opus-4-8" }),
    ].map((record) => withSession(B, record)),
    { root: claudeRoot, session: B },
  );
  transcript([prompt("2026-11-02T09:00:00.000Z", "hi"), assistant("2026-11-02T09:00:10.000Z", "m-c1", [], { usage: { input: 40, output: 4 } })].map((record) => withSession(C, record)), {
    root: claudeRoot,
    session: C,
  });
  resetClock("2026-11-01T12:00:00.000Z");
  tree.write(rolloutName(1), [meta(uuid(1)), turnContext("gpt-5.5"), ...userMessage("build"), rec("token_usage_record", { response_id: "x1", thread_id: uuid(1), usage: { input_tokens: 1000, output_tokens: 100 } })]);
}

const DAY = 86_400_000;
const ranges = (): UsageRange[] => {
  const start = Date.parse("2026-10-30T00:00:00.000Z");
  return [
    { from: 0, to: Number.MAX_SAFE_INTEGER },
    ...Array.from({ length: 5 }, (_, n) => ({ from: start + n * DAY, to: start + (n + 1) * DAY })),
    { from: Date.parse("2026-10-31T00:00:00.000Z"), to: Date.parse("2026-11-01T09:00:30.000Z") },
  ];
};

describe("the usage-only scan", () => {
  it("gives every period the tokens, requests and cost the full analysis gives", async () => {
    history();
    const fast = await usageScan({ sources: sources(), store: new Store(home), readUsage: (_source, file) => (file.harness === "claude-code" ? readClaudeUsage(file) : Promise.resolve(null)) });
    expect(fast.stats.usageOnly).toBeGreaterThan(0);
    // The two sessions that share a response id are parsed in full; the third is read for usage only.
    expect(fast.stats.reparsed).toBe(2);

    const full = await scan({ sources: sources(), store: new Store(join(home, "full")), retentionPolicies: false });
    expect(periodUsage(fast.sessions, ranges())).toEqual(periodUsage(full.sessions, ranges()));

    const report = buildReport({ sessions: full.sessions, facets: [], narrative: null, coverage: full.coverage, timeZone: "UTC", now: new Date("2026-11-03T00:00:00.000Z") });
    const [all, ...days] = periodUsage(fast.sessions, ranges());
    const { daily: _daily, models: _models, cacheHitRate: _rate, pricingVersion: _version, ...totals } = report.usage;
    expect(all!.totals).toEqual(totals);
    for (const [index, day] of ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"].entries()) {
      const { day: _day, ...row } = report.usage.daily.find((entry) => entry.day === day)!;
      expect(days[index]!.totals).toEqual(row);
    }
  });

  it("reuses cached sessions and keeps cached sessions whose transcripts are gone, like the full scan", async () => {
    history();
    const store = new Store(home);
    await scan({ sources: sources(), store, retentionPolicies: false });
    rmSync(join(claudeRoot, "-work-demo", `${C}.jsonl`));
    const fast = await usageScan({ sources: sources(), store: new Store(home), readUsage: (_source, file) => readClaudeUsage(file) });
    expect(fast.stats.cached).toBe(3);
    expect(fast.stats.usageOnly).toBe(0);
    const full = await scan({ sources: sources(), store: new Store(home), retentionPolicies: false });
    expect(full.stats.orphaned).toBe(1);
    expect(periodUsage(fast.sessions, ranges())).toEqual(periodUsage(full.sessions, ranges()));
  });

  it("tells the caller as each agent's history is read", async () => {
    history();
    const seen: Array<[string, number]> = [];
    await usageScan({ sources: sources(), store: new Store(home) }, { onHarness: (harness, list) => seen.push([harness, list.length]) });
    expect(seen.sort()).toEqual([
      ["claude-code", 3],
      ["codex", 1],
    ]);
  });
});
