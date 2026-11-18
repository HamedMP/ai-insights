import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { headlessLines, noBrowserHere } from "../../src/cli/headless.js";
import { run, type CliDeps } from "../../src/cli/main.js";
import { fakeBuildReport, fakeRenderReport, fakeSource, makeSession, tempHome } from "../store/fixtures.js";

let home: string;
let cleanup: () => Promise<void>;
let out: string;
let err: string;
let opened: string[];

const SSH = { SSH_CONNECTION: "203.0.113.5 50000 198.51.100.7 22", SSH_TTY: "/dev/pts/0" };
const TTY = { isTTY: true, stdin: true, stderr: false, columns: 100 };

function deps(overrides: Partial<CliDeps> = {}, env: NodeJS.ProcessEnv = {}): Partial<CliDeps> {
  return {
    stdout: (text) => void (out += text),
    stderr: (text) => void (err += text),
    env: { AI_INSIGHTS_HOME: home, AI_INSIGHTS_NO_INSTALL_PROMPT: "1", ...env },
    sources: [fakeSource("claude-code", [makeSession({ id: "c1" })])],
    buildReport: fakeBuildReport(),
    renderReport: fakeRenderReport,
    now: () => new Date("2026-11-15T00:00:00Z"),
    timeZone: "UTC",
    openFile: async (path) => void opened.push(path),
    startMcp: async () => {},
    retentionPolicies: async () => new Map(),
    platform: "linux",
    prompt: async () => "yes",
    ...overrides,
  };
}

beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  out = "";
  err = "";
  opened = [];
});
afterEach(async () => cleanup());

describe("is there a browser to open?", () => {
  it("says no over SSH without a forwarded display, and on Linux with no display at all", () => {
    expect(noBrowserHere(SSH, "linux")).toBe(true);
    expect(noBrowserHere(SSH, "darwin")).toBe(true);
    expect(noBrowserHere({}, "linux")).toBe(true);
  });

  it("says yes on a desktop, with a forwarded display, and in WSL", () => {
    expect(noBrowserHere({}, "darwin")).toBe(false);
    expect(noBrowserHere({}, "win32")).toBe(false);
    expect(noBrowserHere({ DISPLAY: ":0" }, "linux")).toBe(false);
    expect(noBrowserHere({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(false);
    expect(noBrowserHere({ ...SSH, DISPLAY: "localhost:10.0" }, "linux")).toBe(false);
    expect(noBrowserHere({ WSL_DISTRO_NAME: "Ubuntu" }, "linux")).toBe(false);
  });
});

describe("the end of a run with no browser", () => {
  it("over SSH: does not ask or open, prints the report path and the three ways to see it from another device", async () => {
    expect(await run([], deps({ terminal: TTY }, SSH))).toBe(0);
    const path = join(home, "reports", "report.html");
    expect(opened).toEqual([]);
    expect(out).not.toContain("Open the report in your browser?");
    expect(out).not.toContain("opening it in your browser now");
    expect(out).toContain("No browser here to open the report. To see it from your own computer:");
    expect(out).toContain("npx ai-insights@latest serve");
    expect(out).toContain(`scp user@host:${path} .`);
    expect(out).toContain("npx ai-insights@latest share");
  });

  it("on a Linux machine with no display, the same, even when AI_INSIGHTS_OPEN=1 would open it", async () => {
    expect(await run([], deps({ terminal: TTY }, { AI_INSIGHTS_OPEN: "1" }))).toBe(0);
    expect(opened).toEqual([]);
    expect(out).toContain("No browser here to open the report.");
  });

  it("with --open still tries, and when the opener fails prints the same next steps instead of pretending", async () => {
    expect(await run(["--open"], deps({ terminal: TTY, openFile: async () => { throw new Error("no xdg-open"); } }, SSH))).toBe(0);
    expect(err).toContain("Could not open a browser here.");
    expect(out).toContain("No browser here to open the report.");
  });

  it("on a desktop where the opener fails, offers the same next steps", async () => {
    expect(await run(["--open"], deps({ platform: "darwin", openFile: async () => { throw new Error("blocked"); } }))).toBe(0);
    expect(out).toContain("No browser here to open the report.");
  });

  it("on a desktop that opens it, prints none of this", async () => {
    expect(await run(["--open"], deps({ platform: "linux" }, { DISPLAY: ":0" }))).toBe(0);
    expect(opened).toHaveLength(1);
    expect(out).not.toContain("No browser here to open the report.");
  });

  it("keeps it to four lines and quotes a path the shell would split", () => {
    const lines = headlessLines("/home/a b/.ai-insights/reports/report.html", "  ");
    expect(lines).toHaveLength(4);
    expect(lines.every((line) => line.startsWith("  "))).toBe(true);
    expect(lines[2]).toContain("scp 'user@host:/home/a b/.ai-insights/reports/report.html' .");
    expect(headlessLines("/srv/it's/report.html")[2]).toContain(`scp 'user@host:/srv/it'\\''s/report.html' .`);
  });
});
