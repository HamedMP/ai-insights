import { readdir, readFile } from "node:fs/promises";
import { buildReport as realBuildReport } from "../../src/analysis/index.js";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatBytes, run, type CliDeps } from "../../src/cli/main.js";
import type { ServerDeps } from "../../src/mcp/server.js";
import { packageVersion } from "../../src/mcp/version.js";
import { Store } from "../../src/store/store.js";
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
