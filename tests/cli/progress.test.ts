import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReport as realBuildReport } from "../../src/analysis/index.js";
import { run, type CliDeps } from "../../src/cli/main.js";
import { answerFor, OPEN_QUESTION } from "../../src/cli/open.js";
import { ProgressLine } from "../../src/cli/progress.js";
import { detectStyle, stripAnsi } from "../../src/cli/terminal.js";
import { scan } from "../../src/store/scan.js";
import { Store } from "../../src/store/store.js";
import { fakeRenderReport, fakeSource, makeSession, tempHome } from "../store/fixtures.js";

let home: string;
let cleanup: () => Promise<void>;
let out: string;
let err: string;
let opened: string[];
let asked: string[];
let exits: number[];

const ESC = "\u001b";
const COLOUR = /\u001b\[[0-9;]*m/u;
const SHOW_CURSOR = `${ESC}[?25h`;
const HIDE_CURSOR = `${ESC}[?25l`;

function sessions(count: number) {
  return Array.from({ length: count }, (_, index) => makeSession({ id: `c${index}`, sourceMtimeMs: Date.parse("2026-11-10T00:00:00Z") - index * 60_000 }));
}

function deps(overrides: Partial<CliDeps> = {}): Partial<CliDeps> {
  return {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    env: { AI_INSIGHTS_HOME: home, TERM: "xterm-256color" },
    sources: [fakeSource("claude-code", sessions(30)), fakeSource("codex", [makeSession({ id: "x1", harness: "codex" })])],
    buildReport: realBuildReport,
    renderReport: fakeRenderReport,
    now: () => new Date("2026-11-15T00:00:00Z"),
    timeZone: "UTC",
    platform: "darwin",
    openFile: async (path) => {
      opened.push(path);
    },
    prompt: async (question) => {
      asked.push(question);
      return "yes";
    },
    onInterrupt: () => () => {},
    exit: (code) => {
      exits.push(code);
    },
    startMcp: async () => {},
    retentionPolicies: async () => new Map(),
    ...overrides,
  };
}

/** Everything a person at a real terminal has: stdout, stderr and stdin all attached. */
const interactive = { terminal: { isTTY: true, columns: 80, stderr: true, stdin: true } };

beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  out = "";
  err = "";
  opened = [];
  asked = [];
  exits = [];
});
afterEach(async () => cleanup());

describe("while it works", () => {
  it("shows the mark and wordmark before reading any history", async () => {
    let seenAtDiscovery = "";
    const source = fakeSource("claude-code", sessions(3));
    const discover = source.discover;
    source.discover = async (options) => {
      seenAtDiscovery = out;
      return discover(options);
    };
    expect(await run([], deps({ ...interactive, sources: [source] }))).toBe(0);
    expect(stripAnsi(seenAtDiscovery)).toContain("by Matrix OS");
    expect(stripAnsi(out).split("by Matrix OS")).toHaveLength(2);
  });

  it("reports each stage on stderr and ends with a check mark and the elapsed time", async () => {
    let tick = 0;
    expect(await run([], deps({ ...interactive, clock: () => (tick += 250) }))).toBe(0);
    const text = stripAnsi(err);
    for (const stage of ["Finding history", "Claude Code 30", "Reading sessions", "Analysing", "your recap", "Writing the report"]) expect(text, stage).toContain(stage);
    expect(text).toMatch(/✓ .*31 sessions.* in \d+(\.\d)?s/u);
    expect(err).toContain(HIDE_CURSOR);
    expect(err.lastIndexOf(SHOW_CURSOR)).toBeGreaterThan(err.lastIndexOf(HIDE_CURSOR));
    expect(stripAnsi(out)).not.toContain("Reading sessions");
  });

  it("writes no progress at all when the output is piped", async () => {
    expect(await run([], deps({ terminal: { isTTY: false, stderr: true, stdin: true } }))).toBe(0);
    expect(err).toBe("");
    expect(out).not.toContain(ESC);
  });

  it("keeps the progress words but drops colour with NO_COLOR", async () => {
    await run([], deps({ ...interactive, env: { AI_INSIGHTS_HOME: home, TERM: "xterm-256color", NO_COLOR: "1" } }));
    expect(err).toContain("Reading sessions");
    expect(err).not.toMatch(COLOUR);
  });

  it("shows no progress on a dumb terminal or in CI", async () => {
    await run([], deps({ ...interactive, env: { AI_INSIGHTS_HOME: home, TERM: "dumb" } }));
    expect(err).toBe("");
    await run([], deps({ ...interactive, env: { AI_INSIGHTS_HOME: home, TERM: "xterm-256color", CI: "true" } }));
    expect(err).toBe("");
  });

  it("clears the line and brings the cursor back on Ctrl-C", async () => {
    let interrupt: (() => void) | null = null;
    const source = fakeSource("claude-code", sessions(3));
    const discover = source.discover;
    source.discover = async (options) => {
      interrupt?.();
      return discover(options);
    };
    await run([], deps({ ...interactive, sources: [source], onInterrupt: (handler) => ((interrupt = handler), () => (interrupt = null)) }));
    expect(exits).toEqual([130]);
    expect(err.endsWith(SHOW_CURSOR) || err.includes(`${SHOW_CURSOR}`)).toBe(true);
    expect(err).toContain(`\r${ESC}[2K`);
  });

  it("brings the cursor back when the analysis fails", async () => {
    const code = await run([], deps({ ...interactive, buildReport: () => { throw new Error("boom"); } }));
    expect(code).toBe(1);
    expect(err.lastIndexOf(SHOW_CURSOR)).toBeGreaterThan(err.lastIndexOf(HIDE_CURSOR));
    expect(stripAnsi(err)).toContain("could not build the report: boom");
  });
});

describe("the progress line", () => {
  it("redraws at most about ten times a second however many updates arrive", () => {
    const writes: string[] = [];
    let now = 0;
    const style = detectStyle({ TERM: "xterm-256color" }, { isTTY: true, columns: 80 });
    const line = new ProgressLine({ write: (text) => writes.push(text), clock: () => now, style, timers: false });
    line.start();
    for (let index = 0; index < 1000; index += 1) line.update(`Reading sessions ${index}/1000`);
    now = 50;
    for (let index = 0; index < 1000; index += 1) line.update(`Reading sessions ${index}/1000`);
    now = 120;
    line.update("Reading sessions 1000/1000");
    expect(writes.filter((text) => text.includes("Reading")).length).toBeLessThanOrEqual(2);
    line.stop();
  });

  it("never lets a progress callback break the scan", async () => {
    const store = new Store(home);
    const result = await scan(
      { sources: [fakeSource("claude-code", sessions(5))], store, retentionPolicies: false },
      { onProgress: () => { throw new Error("display gone"); } },
    );
    expect(result.sessions).toHaveLength(5);
  });
});

describe("opening the report", () => {
  it("asks on an interactive terminal, and Enter (yes) opens it", async () => {
    expect(await run([], deps(interactive))).toBe(0);
    expect(asked).toEqual([OPEN_QUESTION]);
    expect(opened).toHaveLength(1);
    expect(stripAnsi(out)).toContain("Open the report in your browser? [Y/n]");
  });

  it("maps keys the way the prompt says: Enter and y open, n declines, Ctrl-C cancels", () => {
    expect(answerFor("\r")).toBe("yes");
    expect(answerFor("\n")).toBe("yes");
    expect(answerFor("Y")).toBe("yes");
    expect(answerFor("n")).toBe("no");
    expect(answerFor("N")).toBe("no");
    expect(answerFor("\u0003")).toBe("cancel");
    expect(answerFor("\u0004")).toBe("no");
    expect(answerFor("x")).toBeNull();
  });

  it("does not open when the person answers no", async () => {
    await run([], deps({ ...interactive, prompt: async () => "no" }));
    expect(opened).toEqual([]);
  });

  it("exits cleanly with 130 on Ctrl-C at the question, leaving the cursor on a fresh line", async () => {
    expect(await run([], deps({ ...interactive, prompt: async () => "cancel" }))).toBe(130);
    expect(opened).toEqual([]);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("never asks or opens with --no-open", async () => {
    await run(["--no-open"], deps(interactive));
    expect(asked).toEqual([]);
    expect(opened).toEqual([]);
    expect(stripAnsi(out)).toContain("--open");
  });

  it("opens without asking with --open", async () => {
    await run(["--open"], deps(interactive));
    expect(asked).toEqual([]);
    expect(opened).toHaveLength(1);
  });

  it("takes the default from AI_INSIGHTS_OPEN", async () => {
    await run([], deps({ ...interactive, env: { AI_INSIGHTS_HOME: home, TERM: "xterm-256color", AI_INSIGHTS_OPEN: "0" } }));
    expect(asked).toEqual([]);
    expect(opened).toEqual([]);
    await run([], deps({ ...interactive, env: { AI_INSIGHTS_HOME: home, TERM: "xterm-256color", AI_INSIGHTS_OPEN: "1" } }));
    expect(asked).toEqual([]);
    expect(opened).toHaveLength(1);
  });

  it.each([
    ["stdin is not a terminal", { terminal: { isTTY: true, columns: 80, stderr: true, stdin: false } }, {}],
    ["stdout is not a terminal", { terminal: { isTTY: false, stderr: true, stdin: true } }, {}],
    ["it runs in CI", interactive, { CI: "1" }],
    ["it runs over SSH without a display", { ...interactive, platform: "linux" as const }, { SSH_CONNECTION: "10.0.0.1 1 10.0.0.2 22" }],
  ])("never asks when %s", async (_, extra, env) => {
    await run([], deps({ ...extra, env: { AI_INSIGHTS_HOME: home, TERM: "xterm-256color", ...env } }));
    expect(asked).toEqual([]);
    expect(opened).toEqual([]);
  });

  it("still asks over SSH when a display is forwarded", async () => {
    await run([], deps({ ...interactive, platform: "linux", env: { AI_INSIGHTS_HOME: home, TERM: "xterm-256color", SSH_CONNECTION: "x", DISPLAY: "localhost:10.0" } }));
    expect(asked).toHaveLength(1);
  });

  it.each([["scan"], ["doctor"], ["report"], ["mcp"]])("never asks for `ai-insights %s`", async (command) => {
    await run([command], deps(interactive));
    expect(asked).toEqual([]);
    expect(opened).toEqual([]);
  });

  it("says so in one line when the browser cannot be opened, and keeps the path", async () => {
    expect(await run([], deps({ ...interactive, openFile: async () => { throw new Error("spawn xdg-open ENOENT"); } }))).toBe(0);
    const text = stripAnsi(out + err);
    expect(text).toContain("Could not open a browser");
    expect(text).toContain("report.html");
    expect(text).not.toContain("ENOENT");
  });

  it("tells the person they can press Enter below when it is going to ask", async () => {
    await run([], deps(interactive));
    expect(stripAnsi(out).replace(/\s+/gu, " ")).toContain("press Enter below");
  });
});
