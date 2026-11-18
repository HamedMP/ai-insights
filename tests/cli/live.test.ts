import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReport as realBuildReport } from "../../src/analysis/index.js";
import { run, type CliDeps } from "../../src/cli/main.js";
import { stripAnsi } from "../../src/cli/terminal.js";
import type { Session } from "../../src/schema/types.js";
import { fakeRenderReport, fakeSource, makeSession, tempHome } from "../store/fixtures.js";

// The default run shows this month's numbers while the full scan and analysis are still going, then the same
// result screen as before.

let homes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of homes) await cleanup();
  homes = [];
});
async function home(): Promise<string> {
  const made = await tempHome();
  homes.push(made.cleanup);
  return made.home;
}

const NOW = new Date("2026-11-18T15:00:00.000Z");
function recent(id: string, harness: Session["harness"], day: string, input: number): Session {
  return makeSession({
    id,
    harness,
    sourceMtimeMs: Date.parse(`${day}T12:00:00.000Z`),
    startTime: `${day}T09:00:00.000Z`,
    endTime: `${day}T09:20:00.000Z`,
    prompts: [{ timestamp: `${day}T09:00:00.000Z`, text: "synthetic" }],
    requests: harness === "claude-chat" ? [] : [{ id: `${id}-r`, timestamp: `${day}T09:10:00.000Z`, model: harness === "codex" ? "gpt-5.5" : "claude-opus-4-5", usage: { input, cachedInput: 0, cacheWrite: 0, output: 100 } }],
  });
}
const history = () => [
  recent("a", "claude-code", "2026-11-18", 100_000),
  recent("b", "claude-code", "2026-11-17", 200_000),
  recent("c", "claude-code", "2026-11-02", 300_000),
  recent("x", "codex", "2026-11-18", 50_000),
  recent("chat", "claude-chat", "2026-11-16", 0),
  makeSession({ id: "old", sourceMtimeMs: Date.parse("2026-10-02T12:00:00.000Z") }),
];

interface Log {
  out: string;
  err: string;
  /** stdout and stderr in the order they were written, as one terminal shows them. */
  both: Array<["out" | "err", string]>;
}

function deps(homeDir: string, log: Log, overrides: Partial<CliDeps> = {}): Partial<CliDeps> {
  const sessions = history();
  return {
    stdout: (text) => {
      log.out += text;
      log.both.push(["out", text]);
    },
    stderr: (text) => {
      log.err += text;
      log.both.push(["err", text]);
    },
    env: { AI_INSIGHTS_HOME: homeDir, TERM: "xterm-256color" },
    sources: [
      fakeSource("claude-code", sessions.filter((s) => s.harness === "claude-code")),
      fakeSource("codex", sessions.filter((s) => s.harness === "codex")),
      fakeSource("claude-chat", sessions.filter((s) => s.harness === "claude-chat"), { label: "Claude chat" }),
    ],
    buildReport: realBuildReport,
    renderReport: fakeRenderReport,
    now: () => NOW,
    timeZone: "UTC",
    platform: "darwin",
    openFile: async () => {},
    prompt: async () => "no",
    onInterrupt: () => () => {},
    exit: () => {},
    startMcp: async () => {},
    retentionPolicies: async () => new Map(),
    ...overrides,
  };
}

const interactive = { terminal: { isTTY: true, columns: 80, stderr: true, stdin: true } } satisfies Partial<CliDeps>;
const newLog = (): Log => ({ out: "", err: "", both: [] });

describe("the first numbers of a run", () => {
  it("show each agent's month and today, this week and this month before the full result", async () => {
    const log = newLog();
    expect(await run(["--no-install-prompt"], deps(await home(), log, interactive))).toBe(0);
    const text = stripAnsi(log.out);
    const periods = text.indexOf("Today $");
    expect(text).toMatch(/Claude Code\s+this month\s+3 sessions\s+\$/);
    expect(text).toMatch(/Codex\s+this month\s+1 session\s+\$/);
    expect(text).toMatch(/Claude chat\s+this month\s+1 session\s+cost not measured/);
    expect(periods).toBeGreaterThan(-1);
    expect(text).toMatch(/2 sessions · 4 sessions · 5 sessions · at API list prices/);
    // The result screen comes after the first numbers.
    expect(text.indexOf("What to do next")).toBeGreaterThan(periods);
  });

  it("agree with the quick view's month to the cent", async () => {
    const log = newLog();
    await run(["--no-install-prompt"], deps(await home(), log, interactive));
    const quick = newLog();
    await run(["month", "--json"], deps(await home(), quick));
    const month = JSON.parse(quick.out).periods.month;
    const shown = /This month \$([\d,.]+)/.exec(stripAnsi(log.out))![1]!;
    expect(shown).toBe(month.costUsd.toFixed(2));
  });

  it("never break the status line: each one is printed after the line is cleared, and the line is drawn again after", async () => {
    const log = newLog();
    await run(["--no-install-prompt"], deps(await home(), log, interactive));
    const started = log.both.findIndex(([stream, text]) => stream === "err" && text.includes("\u001b[?25l"));
    const firstScreen = log.both.findIndex(([stream, text]) => stream === "out" && text.includes("What to do next"));
    expect(started).toBeGreaterThan(-1);
    log.both.slice(0, firstScreen).forEach(([stream, text], index) => {
      // The header is drawn before the status line starts.
      if (stream !== "out" || index < started) return;
      expect(log.both[index - 1]).toEqual(["err", "\r\u001b[2K"]);
      expect(text.endsWith("\n")).toBe(true);
    });
  });

  it("leave the result screen exactly as it was without them", async () => {
    const withLive = newLog();
    const a = await home();
    await run(["--no-install-prompt"], deps(a, withLive, interactive));
    const without = newLog();
    const b = await home();
    await run(["--no-install-prompt"], deps(b, without, { ...interactive, env: { AI_INSIGHTS_HOME: b, TERM: "xterm-256color", AI_INSIGHTS_LIVE: "0" } }));
    // Link ids hash the report's path, which differs between the two stores.
    const stdout = (log: Log, dir: string) => log.both.filter(([stream]) => stream === "out").map(([, text]) => text).join("").split(dir).join("<home>").replace(/id=[0-9a-f]+;/g, "id=;");
    const result = (text: string) => text.slice(text.indexOf("╭"));
    const live = stdout(withLive, a);
    const plain = stdout(without, b);
    expect(result(live)).toBe(result(plain));
    expect(stripAnsi(live)).toContain("Today $");
    expect(stripAnsi(plain)).not.toContain("Today $");
  });

  it("go to stderr as plain lines when piped, leaving stdout as it was", async () => {
    const piped = newLog();
    const a = await home();
    await run(["--no-install-prompt"], deps(a, piped, { terminal: { isTTY: false, stderr: false, stdin: false } }));
    expect(piped.err).toMatch(/^Claude Code this month: 3 sessions, \$/m);
    expect(piped.err).toMatch(/^So far: today \$[\d.]+ \(2 sessions\), this week/m);
    expect(piped.err).not.toContain("\u001b");
    const quiet = newLog();
    const b = await home();
    await run(["--no-install-prompt"], deps(b, quiet, { terminal: { isTTY: false, stderr: false, stdin: false }, env: { AI_INSIGHTS_HOME: b, AI_INSIGHTS_LIVE: "0" } }));
    expect(piped.out.split(a).join("<home>")).toBe(quiet.out.split(b).join("<home>"));
  });
});
