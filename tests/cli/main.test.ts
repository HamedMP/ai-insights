import { readdir, readFile } from "node:fs/promises";
import { buildReport as realBuildReport } from "../../src/analysis/index.js";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatBytes } from "../../src/cli/commands.js";
import { run, type CliDeps } from "../../src/cli/main.js";
import type { ServerDeps } from "../../src/mcp/server.js";
import { packageVersion } from "../../src/mcp/version.js";
import { Store } from "../../src/store/store.js";
import type { RetentionPolicy } from "../../src/store/retention.js";
import type { Harness } from "../../src/schema/types.js";
import { fakeBuildReport, fakeRenderReport, fakeSource, makeSession, tempHome, validFacet } from "../store/fixtures.js";

let home: string;
let cleanup: () => Promise<void>;
let out: string;
let err: string;
let opened: string[];
let mcpStarts: ServerDeps[];

function deps(overrides: Partial<CliDeps> = {}): Partial<CliDeps> {
  return {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    env: { AI_INSIGHTS_HOME: home },
    sources: [
      fakeSource("claude-code", [makeSession({ id: "c1", sourceMtimeMs: Date.parse("2026-11-10T00:00:00Z") })]),
      fakeSource("codex", [makeSession({ id: "x1", harness: "codex", sourceMtimeMs: Date.parse("2026-01-01T00:00:00Z") })]),
    ],
    buildReport: fakeBuildReport(),
    renderReport: fakeRenderReport,
    now: () => new Date("2026-11-15T00:00:00Z"),
    timeZone: "UTC",
    openFile: async (path) => {
      opened.push(path);
    },
    startMcp: async (serverDeps) => {
      mcpStarts.push(serverDeps);
    },
    // This machine's own agent settings must not change what the tests see.
    retentionPolicies: async () => new Map(),
    ...overrides,
  };
}

beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  out = "";
  err = "";
  opened = [];
  mcpStarts = [];
});
afterEach(async () => cleanup());

describe("summary wording", () => {
  it("lists three or more harnesses with commas, not a chain of ands", async () => {
    const sources = (["claude-code", "codex", "pi"] as const).map((harness) => fakeSource(harness, [makeSession({ id: `${harness}-1`, harness })]));
    expect(await run([], deps({ sources, buildReport: realBuildReport }))).toBe(0);
    expect(out).toMatch(/across Claude Code, Codex and pi,/);
  });
});

describe("coverage wording", () => {
  it("says skipped usage counters apart from unreadable lines", async () => {
    const sources = [fakeSource("codex", [makeSession({ id: "x1", harness: "codex", issues: 2, skippedUsageRecords: 5 })])];
    expect(await run(["scan"], deps({ sources }))).toBe(0);
    expect(out).toContain("2 unreadable lines, 5 usage counters skipped");
    expect(out).not.toContain("unreadable record");
  });
});

describe("transcripts about to be deleted", () => {
  const policies = async () =>
    new Map([["claude-code" as const, { harness: "claude-code" as const, policy: "deletes" as const, days: 30, source: "default" as const, clock: "modified" as const, basis: "b", desktopDays: null, setting: { name: "cleanupPeriodDays", file: "~/.claude/settings.json", value: null } }]]);
  const now = new Date("2026-11-15T00:00:00Z");
  const aged = (id: string, days: number) => makeSession({ id, sourceMtimeMs: now.getTime() - days * 86_400_000 });

  it("prints one line after the report when Claude Code sessions will be deleted within 7 days", async () => {
    const sources = [fakeSource("claude-code", [aged("a", 25), aged("b", 27), aged("c", 2)])];
    expect(await run([], deps({ sources, buildReport: realBuildReport, retentionPolicies: policies }))).toBe(0);
    expect(out).toContain('2 Claude Code sessions can be deleted within 7 days (from 2026-11-18). AI Insights keeps their stats; to keep the transcripts, add "cleanupPeriodDays": 365 to ~/.claude/settings.json or archive them with `npx packmem archive`.');
  });

  it("says the same in doctor, with how long each harness keeps transcripts", async () => {
    const sources = [fakeSource("claude-code", [aged("a", 25)]), fakeSource("codex", [makeSession({ id: "x", harness: "codex" })])];
    expect(await run(["doctor"], deps({ sources, retentionPolicies: async () => new Map<Harness, RetentionPolicy>([...(await policies()), ["codex", { harness: "codex", policy: "kept", basis: "kept" }]]) }))).toBe(0);
    expect(out).toContain("keeps   transcripts 30 days (the default; cleanupPeriodDays in ~/.claude/settings.json)");
    expect(out).toContain("keeps   transcripts until you delete them");
    expect(out).toContain("1 Claude Code session can be deleted within 7 days");
  });

  it("prints nothing about deletion when nothing is due", async () => {
    expect(await run([], deps({ sources: [fakeSource("claude-code", [aged("c", 2)])], buildReport: realBuildReport, retentionPolicies: policies }))).toBe(0);
    expect(out).not.toContain("can be deleted");
  });
});

describe("ai-insights (no command)", () => {
  it("scans, writes the report and prints its path with a three-line summary", async () => {
    expect(await run([], deps())).toBe(0);
    const reportPath = join(home, "reports", "report.html");
    expect(out).toContain(`Report: ${reportPath}`);
    const summary = out.split("\n\n")[0]!.split("\n");
    expect(summary).toHaveLength(3);
    expect(summary[0]).toContain("2 sessions across Claude Code and Codex");
    expect(summary[1]).toContain("$0.42 at API list prices");
    expect(summary[2]).toContain("Top finding:");
    expect(await readFile(reportPath, "utf8")).toContain("<!doctype html>");
    expect(out).toContain("analyze-ai-usage skill");
  });

  it("calls summed session time agent-hours and uses wall-clock hours when the analysis has them", async () => {
    await run([], deps());
    expect(out.split("\n")[1]).toMatch(/^0\.8 agent-hours on 1 day;/);
    out = "";
    await run([], deps({ buildReport: fakeBuildReport([], { wallClockActiveMinutes: 30 }) }));
    expect(out.split("\n")[1]).toMatch(/^0\.5 active hours \(0\.8 agent-hours across parallel sessions\) on 1 day;/);
  });

  it("says how much usage could not be priced next to the cost", async () => {
    await run([], deps({ buildReport: fakeBuildReport([], { estimatedUsd: 1_633, requests: 100, unpriced: 13 }) }));
    expect(out.split("\n")[1]).toContain("about $1,633 for the requests we can price; 13% unpriced.");
    out = "";
    await run([], deps({ buildReport: fakeBuildReport([], { estimatedUsd: null, requests: 5, unpriced: 5 }) }));
    expect(out.split("\n")[1]).toContain("cost unknown: none of the requests could be priced");
    expect(out.split("\n")[1]).not.toContain("$");
  });

  it("opens the report only when asked", async () => {
    await run([], deps());
    expect(opened).toEqual([]);
    await run(["--open"], deps());
    expect(opened).toEqual([join(home, "reports", "report.html")]);
  });

  it("drops the skill tip once facets have been saved", async () => {
    await new Store(home).saveFacet(validFacet("c1"));
    await run([], deps());
    expect(out).not.toContain("analyze-ai-usage skill");
  });

  it("says where to look when no history exists", async () => {
    expect(await run([], deps({ sources: [fakeSource("claude-code", [])] }))).toBe(1);
    expect(err).toContain("ai-insights doctor");
  });

  it("reports a failing analysis as a one-line error, not a stack trace", async () => {
    const code = await run([], deps({ buildReport: () => { throw new Error("buildReport is not implemented yet"); } }));
    expect(code).toBe(1);
    expect(err).toContain("could not build the report: buildReport is not implemented yet");
    expect(err).not.toContain("    at ");
  });
});

describe("ai-insights scan", () => {
  it("lists every harness, found or not, with totals", async () => {
    expect(await run(["scan"], deps())).toBe(0);
    expect(out).toMatch(/Claude Code\s+1 session/);
    expect(out).toMatch(/Codex\s+1 session/);
    expect(out).toMatch(/Cursor\s+not found/);
    expect(out).toContain("2 sessions, 6 prompts, 0.8 agent-hours");
    expect(out).not.toMatch(/\d active hours/);
  });

  it("adds wall-clock time and an honest cost when the analysis runs", async () => {
    await run(["scan"], deps({ buildReport: fakeBuildReport([], { wallClockActiveMinutes: 30, estimatedUsd: 10, requests: 4, unpriced: 1 }) }));
    expect(out).toContain("0.5 active hours (0.8 agent-hours across parallel sessions); about $10.00 for the requests we can price; 25% unpriced.");
  });

  it("still lists coverage when the analysis fails", async () => {
    expect(await run(["scan"], deps({ buildReport: () => { throw new Error("nope"); } }))).toBe(0);
    expect(out).toMatch(/Claude Code\s+1 session/);
  });

  it("shows how much history each harness holds on disk as a human size", async () => {
    const big = fakeSource("claude-code", [makeSession({ id: "c1" })]);
    const original = big.discover;
    big.discover = async (options) => (await original(options)).map((file) => ({ ...file, sizeBytes: 3 * 1024 * 1024 }));
    await run(["scan"], deps({ sources: [big] }));
    expect(out).toMatch(/Claude Code\s+1 session .*3\.0 MB/);
  });

  it("applies --since and says history exists outside the window", async () => {
    await run(["scan", "--since", "30d"], deps());
    expect(out).toMatch(/Codex\s+found, no sessions in this window/);
    expect(out).toMatch(/Claude Code\s+1 session/);
  });

  it("reuses the cache on a second run", async () => {
    await run(["scan"], deps());
    out = "";
    await run(["scan"], deps());
    expect(out).toContain("Parsed 0, reused 2 from cache");
  });
});

describe("ai-insights report", () => {
  it("prints the report JSON with --json and writes no HTML", async () => {
    expect(await run(["report", "--json", "--harness", "codex"], deps())).toBe(0);
    const report = JSON.parse(out);
    expect(report.version).toBe(1);
    expect(report.activity.sessions).toBe(1);
    await expect(readFile(join(home, "reports", "report.html"))).rejects.toThrow();
  });

  it("includes the shareable recap in --json and records no run, since nothing was rendered", async () => {
    expect(await run(["report", "--json"], deps({ buildReport: realBuildReport }))).toBe(0);
    const report = JSON.parse(out);
    expect(report.recap.totals.sessions).toBe(2);
    await expect(readdir(join(home, "snapshots"))).rejects.toThrow();
  });

  it("saves a run snapshot when it writes the HTML", async () => {
    expect(await run(["report"], deps({ buildReport: realBuildReport }))).toBe(0);
    expect(await readdir(join(home, "snapshots"))).toEqual(["2026-11-15T00-00-00-000Z.json"]);
  });

  it("writes the HTML and prints only the path, so it can be piped", async () => {
    expect(await run(["report", "--since=90d"], deps())).toBe(0);
    expect(out.trim()).toBe(join(home, "reports", "report.html"));
  });
});

describe("ai-insights mcp", () => {
  it("starts the server without writing anything to stdout", async () => {
    expect(await run(["mcp"], deps())).toBe(0);
    expect(mcpStarts).toHaveLength(1);
    expect(mcpStarts[0]!.store.home).toBe(home);
    expect(out).toBe("");
  });
});

describe("ai-insights doctor", () => {
  it("shows each harness, where it looked, and the store", async () => {
    expect(await run(["doctor"], deps())).toBe(0);
    expect(out).toContain("Claude Code: 1 transcript (100 B)");
    expect(out).toContain("missing /fake/claude-code");
    expect(out).toContain("Cursor: not supported yet");
    expect(out).toContain(`Store: ${home}`);
    expect(out).toContain("writable");
  });
});

describe("formatBytes", () => {
  it("reads like a file manager would show it", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(296 * 1024 * 1024)).toBe("296.0 MB");
    expect(formatBytes(3 * 1024 ** 4)).toBe("3.0 TB");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("flags", () => {
  it("prints help and version", async () => {
    expect(await run(["--help"], deps())).toBe(0);
    expect(out).toContain("ai-insights doctor");
    out = "";
    expect(await run(["-v"], deps())).toBe(0);
    expect(out.trim()).toBe(packageVersion());
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it.each([
    [["frobnicate"], "unknown command"],
    [["--nope"], "unknown option"],
    [["--since", "yesterday"], "--since must be"],
    [["--harness", "vim"], "--harness must be one of"],
    [["--since"], "needs a value"],
    [["scan", "--json"], "--json only works"],
  ])("rejects %j with a usable message", async (argv, message) => {
    expect(await run(argv, deps())).toBe(2);
    expect(err).toContain(message);
    expect(out).toBe("");
  });
});
