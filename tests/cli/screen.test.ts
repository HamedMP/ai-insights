import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReport as realBuildReport } from "../../src/analysis/index.js";
import { run, type CliDeps } from "../../src/cli/main.js";
import { RABBIT_ASCII, RABBIT_UNICODE } from "../../src/cli/header.js";
import { detectStyle, fileUrl, hyperlink, stripAnsi, visibleWidth, wrapSegments } from "../../src/cli/terminal.js";
import type { BuildReportInput } from "../../src/schema/types.js";
import type { Recap, Report } from "../../src/schema/types.js";
import { fakeRenderReport, fakeSource, makeSession, tempHome } from "../store/fixtures.js";

let home: string;
let cleanup: () => Promise<void>;
let out: string;
let err: string;

const ESC = "\u001b";
const now = new Date("2026-11-15T00:00:00Z");

/** A fake report with a persona and a long finding, so every part of the result screen has something to show. */
function richReport(input: BuildReportInput): Report {
  const report = realBuildReport(input);
  const recap = {
    ...report.recap!,
    persona: {
      title: "The Night Orchestrator",
      time: "Night",
      role: "Orchestrator",
      reason: "Most of your prompts came after 22:00 and you often ran several agents at once.",
      earned: [{ key: "clear", title: "The Clear Briefer", ratio: "correctionsPerSession", value: 0.05, rule: "0.05 mid-run corrections per session (under 0.1 earns it)" }],
    },
  } as Recap;
  return {
    ...report,
    recap,
    usage: { ...report.usage, estimatedUsd: 2_194, unpriced: 0 },
    findings: [
      {
        id: "repeated_failed_command:x",
        kind: "repeated_failed_command",
        severity: "high",
        title: "mcp__claude-in-chrome__tabs_context_mcp fails 55% of the time, which costs you a retry on most browser tasks",
        detail: "d",
        harnesses: ["claude-code"],
        evidence: [],
      },
    ] as Report["findings"],
    retention: {
      windowDays: 7,
      atRisk: { sessions: 1, nextDeletion: "2026-11-18T00:00:00Z" },
      harnesses: [{ harness: "claude-code", source: "default", atRisk: { sessions: 1 }, setting: { name: "cleanupPeriodDays", file: "~/.claude/settings.json" } }],
    } as unknown as Report["retention"],
  };
}

function deps(overrides: Partial<CliDeps> = {}): Partial<CliDeps> {
  return {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    env: { AI_INSIGHTS_HOME: home },
    sources: [fakeSource("claude-code", [makeSession({ id: "c1" })]), fakeSource("codex", [makeSession({ id: "x1", harness: "codex" })])],
    buildReport: richReport,
    renderReport: fakeRenderReport,
    now: () => now,
    timeZone: "UTC",
    openFile: async () => {},
    startMcp: async () => {},
    retentionPolicies: async () => new Map(),
    ...overrides,
  };
}

const tty = (columns = 80, env: NodeJS.ProcessEnv = {}) => ({ terminal: { isTTY: true, columns }, env: { AI_INSIGHTS_HOME: home, TERM: "xterm-256color", ...env } });

beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  out = "";
  err = "";
});
afterEach(async () => cleanup());

describe("piped or in CI: stable plain text", () => {
  it("prints no escape codes when stdout is not a terminal, with the report path and numbered next steps", async () => {
    expect(await run([], deps())).toBe(0);
    expect(out).not.toContain(ESC);
    expect(out).toContain(`Report: ${join(home, "reports", "report.html")}`);
    expect(out).toMatch(/^Next steps$/mu);
    expect(out).toMatch(/^ {2}1\. Open the report/mu);
  });

  it("prints the same text twice in a row, so scripts and docs can rely on it", async () => {
    await run([], deps());
    const first = out;
    out = "";
    await run([], deps());
    expect(out).toBe(first);
  });

  it("keeps the retention notice on one line a script can grep", async () => {
    await run([], deps());
    expect(out).toContain('1 Claude Code session can be deleted within 7 days (from 2026-11-18). AI Insights keeps their stats; to keep the transcripts, add "cleanupPeriodDays": 365 to ~/.claude/settings.json or archive them with `npx packmem archive`.');
  });
});

describe("on a terminal: the designed result screen", () => {
  it("uses no escape codes at all with NO_COLOR, links included", async () => {
    expect(await run([], deps(tty(80, { NO_COLOR: "1" })))).toBe(0);
    expect(out).not.toContain(ESC);
    expect(out).toContain("What to do next");
  });

  it("colours the screen and links the report path, with the full path still readable", async () => {
    expect(await run([], deps(tty(100)))).toBe(0);
    const reportPath = join(home, "reports", "report.html");
    expect(out).toContain(`${ESC}]8;`);
    expect(out).toContain(fileUrl(reportPath));
    expect(stripAnsi(out)).toContain(reportPath);
    expect(out).toContain(`${ESC}[`);
  });

  it("links the website so it can be clicked", async () => {
    await run([], deps(tty()));
    expect(out).toContain(`${ESC}]8;id=`);
    expect(out).toMatch(/\]8;id=[0-9a-f]+;https:\/\/ai-insights\.app\//u);
  });

  it("shows the persona, the earned titles, the numbers and the top finding", async () => {
    await run([], deps(tty()));
    const text = stripAnsi(out);
    expect(text).toContain("The Night Orchestrator");
    expect(text).toContain("The Clear Briefer");
    expect(text).toMatch(/ 2 [^\n]*\n[^\n]* sessions /u);
    expect(text).toContain("$2,194");
    expect(text).toContain("tabs_context_mcp");
  });

  it("walks through every next step with the report's own button labels", async () => {
    await run([], deps(tty()));
    const text = stripAnsi(out).replace(/\s+/gu, " ");
    for (const phrase of [
      "report path above",
      "--open",
      "Play your recap",
      "Make a video",
      "Join the leaderboard",
      "Publish to the leaderboard",
      "ai-insights.app/u/<handle>",
      "#MyAIInsights",
      "analyze-ai-usage",
    ]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("says the report is being opened when --open was passed", async () => {
    await run(["--open"], deps(tty()));
    expect(stripAnsi(out)).toContain("opening it in your browser now");
  });

  it.each([80, 60, 40])("never runs past a %i-column terminal", async (columns) => {
    await run([], deps(tty(columns)));
    const lines = out.split("\n");
    for (const line of lines) expect(visibleWidth(line), stripAnsi(line)).toBeLessThanOrEqual(columns);
  });

  it("fits on one 80x45 screen, mascot included", async () => {
    await run([], deps(tty(80)));
    expect(out.trimEnd().split("\n").length).toBeLessThanOrEqual(45);
  });

  it("draws the Matrix OS rabbit mascot in its own green, and the ASCII one where boxes cannot be drawn", async () => {
    await run([], deps(tty(80)));
    for (const row of RABBIT_UNICODE) expect(stripAnsi(out)).toContain(row.trim());
    expect(out).toContain("\u001b[38;5;150m");
    out = "";
    await run([], deps(tty(80, { TERM: "linux" })));
    for (const row of RABBIT_ASCII) expect(stripAnsi(out)).toContain(row.trim());
  });

  it("points to Matrix OS with the report's own wording and link, and promises nothing more", async () => {
    await run([], deps(tty(80)));
    const text = stripAnsi(out);
    expect(text).toContain("Keep your history with Matrix OS");
    expect(text).toContain("matrix-os.com");
    expect(out).toMatch(/\]8;id=[0-9a-f]+;https:\/\/matrix-os\.com/u);
    expect(text).not.toMatch(/backs? up|sync|upload/iu);
  });

  it("falls back to plain ASCII on terminals that cannot draw boxes", async () => {
    await run([], deps(tty(80, { TERM: "linux" })));
    expect(stripAnsi(out)).toMatch(/^[\x20-\x7e\n]*$/u);
  });

  it("drops to plain text on a dumb terminal", async () => {
    await run([], deps(tty(80, { TERM: "dumb" })));
    expect(out).not.toContain(ESC);
    expect(out).toMatch(/^Next steps$/mu);
  });

  it("honours FORCE_COLOR when piped, for screen recordings", async () => {
    await run([], deps({ env: { AI_INSIGHTS_HOME: home, FORCE_COLOR: "1" } }));
    expect(out).toContain(`${ESC}[`);
    expect(stripAnsi(out)).toContain("What to do next");
  });
});

describe("when nothing was found", () => {
  it("says what happened and what to try, on stderr", async () => {
    expect(await run([], deps({ sources: [fakeSource("claude-code", [])] }))).toBe(1);
    expect(err).toContain("No agent sessions found. Run `ai-insights doctor` to see where AI Insights looked.");
    expect(err).toContain("https://ai-insights.app/docs/troubleshooting");
    expect(out).toBe("");
  });

  it("points at the filters when --since or --harness may have hidden everything", async () => {
    expect(await run(["--since", "7d", "--harness", "codex"], deps({ sources: [fakeSource("codex", [])] }))).toBe(1);
    expect(err).toContain("--since 7d");
    expect(err).toContain("--harness codex");
  });
});

describe("report links", () => {
  it("percent-encodes spaces and non-ASCII in the file URL", () => {
    expect(fileUrl("/tmp/my reports/résumé 報告/report.html")).toBe("file:///tmp/my%20reports/r%C3%A9sum%C3%A9%20%E5%A0%B1%E5%91%8A/report.html");
  });

  it("never lets a control character end the link early", () => {
    const link = hyperlink(fileUrl("/tmp/a\u0007b\u001bc/report.html"), "x");
    expect(link.match(/\u0007/gu)).toBeNull();
    expect(link.split(`${ESC}]8;`)).toHaveLength(3);
  });

  it("splits a link too long for the line and keeps it one link", () => {
    const style = { ...detectStyle({}, { isTTY: true, columns: 40 }), color: 3 as const, hyperlinks: true };
    const path = `/home/someone/a very long folder name/${"deep/".repeat(8)}report.html`;
    const lines = wrapSegments([{ text: path, url: fileUrl(path) }], 40, style, "  ");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    expect(lines.map((line) => stripAnsi(line).trim()).join("")).toBe(path);
    const ids = new Set(lines.map((line) => /\]8;id=([0-9a-f]+);/u.exec(line)?.[1]));
    expect(ids.size).toBe(1);
  });
});

describe("terminal detection", () => {
  it("turns colour off for NO_COLOR, on for FORCE_COLOR, and keeps piped output plain", () => {
    expect(detectStyle({ NO_COLOR: "1", TERM: "xterm" }, { isTTY: true }).color).toBe(0);
    expect(detectStyle({ NO_COLOR: "", TERM: "xterm" }, { isTTY: true }).color).toBe(1);
    expect(detectStyle({ FORCE_COLOR: "3" }, { isTTY: false }).color).toBe(3);
    expect(detectStyle({ FORCE_COLOR: "0", TERM: "xterm-256color" }, { isTTY: true }).color).toBe(0);
    expect(detectStyle({}, { isTTY: false })).toMatchObject({ rich: false, color: 0, hyperlinks: false });
  });

  it("caps the layout width and keeps a floor for tiny windows", () => {
    expect(detectStyle({}, { isTTY: true, columns: 200 }).width).toBe(80);
    expect(detectStyle({}, { isTTY: true, columns: 10 }).width).toBe(20);
  });

  it("lets FORCE_HYPERLINK=0 turn links off where a terminal mangles them", () => {
    expect(detectStyle({ TERM: "xterm-256color", FORCE_HYPERLINK: "0" }, { isTTY: true }).hyperlinks).toBe(false);
  });
});
