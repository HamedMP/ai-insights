import { spawnSync } from "node:child_process";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { NUDGE_FILE, NUDGE_TEXT, isDue, takeNudge } from "../../src/nudge/nudge.js";
import { tempHome } from "../store/fixtures.js";

let home: string;
let cleanup: () => Promise<void>;
beforeEach(async () => ({ home, cleanup } = await tempHome()));
afterEach(async () => cleanup());

async function reportAt(date: Date) {
  await mkdir(join(home, "reports"), { recursive: true });
  const path = join(home, "reports", "report.html");
  await writeFile(path, "<html></html>");
  await utimes(path, date, date);
}

describe("when a review is due", () => {
  const now = new Date(2026, 11, 2, 9); // 2 December, local time

  it("is due in a new month when the last report was in an earlier one, or there is none", () => {
    expect(isDue({ off: false, shown: null }, new Date(2026, 10, 28), now)).toBe(true);
    expect(isDue({ off: false, shown: null }, null, now)).toBe(true);
  });

  it("is quiet when a report was written this month, it was already shown, or it is turned off", () => {
    expect(isDue({ off: false, shown: null }, new Date(2026, 11, 1), now)).toBe(false);
    expect(isDue({ off: false, shown: "2026-12" }, null, now)).toBe(false);
    expect(isDue({ off: true, shown: null }, null, now)).toBe(false);
  });

  it("shows the line once per month, then stays quiet for the rest of it", async () => {
    await reportAt(new Date(2026, 10, 20));
    expect(await takeNudge(home, now)).toBe(NUDGE_TEXT);
    expect(await takeNudge(home, new Date(2026, 11, 20))).toBeNull();
    expect(await takeNudge(home, new Date(2027, 0, 3))).toBe(NUDGE_TEXT);
  });

  it("says nothing on a machine where AI Insights never ran", async () => {
    expect(await takeNudge(join(home, "missing"), now)).toBeNull();
  });

  it("never repeats every session when its record cannot be saved", async () => {
    await mkdir(join(home, NUDGE_FILE), { recursive: true }); // a folder where the file should be: writes fail
    expect(await takeNudge(home, now)).toBeNull();
  });
});

describe("ai-insights nudge", () => {
  let out: string;
  const deps = (now: Date) => ({ stdout: (text: string) => void (out += text), stderr: (text: string) => void (out += text), env: { AI_INSIGHTS_HOME: home }, now: () => now });
  beforeEach(() => {
    out = "";
  });

  it("prints at most one line and always exits 0", async () => {
    expect(await run(["nudge"], deps(new Date(2026, 11, 2)))).toBe(0);
    expect(out).toBe(`${NUDGE_TEXT}\n`);
    out = "";
    expect(await run(["nudge"], deps(new Date(2026, 11, 3)))).toBe(0);
    expect(out).toBe("");
  });

  it("hook format puts the line in systemMessage, which agents show the person but keep out of the model's context", async () => {
    await run(["nudge", "--format", "hook"], deps(new Date(2026, 11, 2)));
    expect(JSON.parse(out)).toEqual({ systemMessage: NUDGE_TEXT });
  });

  it("--off silences it and --on brings it back", async () => {
    await run(["nudge", "--off"], deps(new Date(2026, 11, 2)));
    expect(JSON.parse(await readFile(join(home, NUDGE_FILE), "utf8"))).toMatchObject({ off: true });
    out = "";
    await run(["nudge"], deps(new Date(2026, 11, 2)));
    expect(out).toBe("");
    await run(["nudge", "--on"], deps(new Date(2026, 11, 2)));
    out = "";
    await run(["nudge"], deps(new Date(2026, 11, 2)));
    expect(out).toBe(`${NUDGE_TEXT}\n`);
  });

  it("tells the person how to turn it off in the line itself", () => {
    expect(NUDGE_TEXT).toContain("npx ai-insights nudge --off");
  });
});

describe("the plugin's hook script", () => {
  const script = join(import.meta.dirname, "../../harness/ai-insights/hooks/nudge.mjs");

  it("runs with Node alone, fast, and prints the hook JSON once", () => {
    const started = performance.now();
    const first = spawnSync(process.execPath, [script, "--format", "hook"], { env: { AI_INSIGHTS_HOME: home }, encoding: "utf8" });
    const elapsed = performance.now() - started;
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toEqual({ systemMessage: NUDGE_TEXT });
    expect(elapsed).toBeLessThan(1_000);
    const second = spawnSync(process.execPath, [script, "--format", "hook"], { env: { AI_INSIGHTS_HOME: home }, encoding: "utf8" });
    expect(second.stdout).toBe("");
  });

  it("is registered for new sessions only, in the file both Claude Code and Codex read", async () => {
    const hooks = JSON.parse(await readFile(join(import.meta.dirname, "../../harness/ai-insights/hooks/hooks.json"), "utf8"));
    expect(hooks.hooks.SessionStart).toEqual([
      { matcher: "startup", hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/nudge.mjs" --format hook ; exit 0', timeout: 5 }] },
    ]);
  });

  it.runIf(process.platform !== "win32")("ends cleanly and silently when node is not on the hook's PATH, so no hook error shows", async () => {
    const hooks = JSON.parse(await readFile(join(import.meta.dirname, "../../harness/ai-insights/hooks/hooks.json"), "utf8"));
    const command: string = hooks.hooks.SessionStart[0].hooks[0].command;
    const root = join(import.meta.dirname, "../../harness/ai-insights");
    const missing = spawnSync("/bin/sh", ["-c", command], { env: { PATH: join(home, "empty-bin"), CLAUDE_PLUGIN_ROOT: root, AI_INSIGHTS_HOME: home }, encoding: "utf8" });
    expect(missing.status).toBe(0);
    expect(missing.stdout).toBe("");
    const present = spawnSync("/bin/sh", ["-c", command], { env: { PATH: dirname(process.execPath), CLAUDE_PLUGIN_ROOT: root, AI_INSIGHTS_HOME: home }, encoding: "utf8" });
    expect(present.status).toBe(0);
    expect(JSON.parse(present.stdout)).toEqual({ systemMessage: NUDGE_TEXT });
  });
});
