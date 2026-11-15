import { describe, expect, it } from "vitest";
import { commandKey, normalizeCommand } from "../../../src/analysis/findings/commands.js";
import { day, session, sessionsOverDays, shell } from "../factory.js";
import { findings } from "./helpers.js";

describe("repeated_failed_command", () => {
  it("flags a command the agent keeps retrying unchanged", () => {
    const retries = (index: number) => [1, 2, 3, 4].map((minute) => shell("cd /repo && pnpm build 2>&1 | tail -20", "command_failed", day(index, minute)));
    const result = findings("repeated_failed_command", [session({ startTime: day(0), toolCalls: retries(0) }), session({ startTime: day(1), toolCalls: retries(1) })]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("repeated_failed_command:pnpm build");
    expect(result[0]!.metric?.value).toBe(8);
    expect(result[0]!.evidence[0]!.note).toContain("4 times in a row");
    expect(result[0]!.suggestion?.instructionText).toContain("pnpm build");
  });

  it("flags a command that fails in session after session", () => {
    const sessions = sessionsOverDays(4, (index) => ({ toolCalls: [shell("python manage.py migrate", "command_failed", day(index, 1))] }));
    const result = findings("repeated_failed_command", sessions);
    expect(result).toHaveLength(1);
    expect(result[0]!.evidence).toHaveLength(4);
  });

  it("stays quiet when tests fail now and then and are then fixed", () => {
    const sessions = sessionsOverDays(6, (index) => ({
      toolCalls: [shell("pnpm test", "command_failed", day(index, 1)), shell("pnpm test", undefined, day(index, 5)), shell("pnpm test", undefined, day(index, 9))],
    }));
    expect(findings("repeated_failed_command", sessions)).toEqual([]);
  });

  it("stays quiet on one short streak in one session", () => {
    const calls = [1, 2, 3].map((minute) => shell("make", "command_failed", day(0, minute)));
    expect(findings("repeated_failed_command", [session({ toolCalls: calls })])).toEqual([]);
  });

  it("treats the same command written differently as one", () => {
    expect(normalizeCommand("cd /a/b && CI=1 pnpm test 2>&1 | tail -n 50")).toBe("pnpm test");
    expect(normalizeCommand("  pnpm   test ")).toBe("pnpm test");
  });

  it("ignores a throwaway temp script failing in a single session", () => {
    const calls = [1, 2, 3, 4, 5, 6].map((minute) => shell(`timeout 600 node /tmp/scratch-${"9f".repeat(32)}/probe.js`, "command_failed", day(0, minute)));
    expect(findings("repeated_failed_command", [session({ toolCalls: calls })])).toEqual([]);
  });

  it("does not emit a finding a person could not recognise, like `node <temp file>`", () => {
    const sessions = sessionsOverDays(3, (index) => ({
      toolCalls: [1, 2, 3].map((minute) => shell(`node /tmp/run-${index}${minute}/a.js`, "command_failed", day(index, minute))),
    }));
    expect(findings("repeated_failed_command", sessions)).toEqual([]);
  });

  it("keeps placeholders, hashes and temp paths out of what the person reads", () => {
    const sessions = sessionsOverDays(3, (index) => ({
      toolCalls: [1, 2, 3].map((minute) => shell(`gh pr view ${4000 + index * 10 + minute} --json state > /tmp/out-${"ab12".repeat(4)}.json`, "command_failed", day(index, minute))),
    }));
    const [finding] = findings("repeated_failed_command", sessions);
    expect(finding).toBeDefined();
    const shown = [finding!.title, finding!.detail, finding!.suggestion?.instructionText ?? "", ...finding!.evidence.map((item) => item.note)];
    for (const text of shown) {
      expect(text).not.toMatch(/<(?:tmp|hash|id|time|n)>/);
      expect(text).not.toMatch(/\/tmp|[0-9a-f]{12}|40\d\d/);
    }
    expect(finding!.suggestion?.instructionText).toContain("gh pr view");
  });

  it("strips timeout and kill wrappers", () => {
    expect(normalizeCommand("timeout --kill-after=30s 600 pnpm test")).toBe("pnpm test");
    expect(normalizeCommand("timeout -k 10s -s KILL 5m make check")).toBe("make check");
    expect(normalizeCommand("gtimeout --preserve-status 30 pytest -x")).toBe("pytest -x");
    expect(normalizeCommand("nohup nice -n 10 cargo build")).toBe("cargo build");
  });

  it("replaces volatile parts with placeholders", () => {
    const hash = "ab12".repeat(16);
    expect(normalizeCommand(`bash /tmp/run-${hash}/step.sh`)).toBe("bash <tmp>");
    expect(normalizeCommand("node /var/folders/xy/T/job/a.js")).toBe("node <tmp>");
    expect(normalizeCommand("git show 3f2a9c1d8e7b")).toBe("git show <hash>");
    expect(normalizeCommand("curl localhost/api/runs/0b6f2c3e-4d5a-4b7c-8d9e-0f1a2b3c4d5e")).toBe("curl localhost/api/runs/<id>");
    expect(normalizeCommand("grep 2026-11-15T22:38:01.528Z app.log")).toBe("grep <time> app.log");
    expect(normalizeCommand("gh pr view 4821")).toBe("gh pr view <n>");
    expect(normalizeCommand("ls build-1731700000123")).toBe("ls build-<n>");
    expect(normalizeCommand("sleep 5")).toBe("sleep 5");
  });

  it("keys long commands by a readable prefix and a hash, so ids stay short and distinct", () => {
    const long = (tail: string) => `node scripts/a-fairly-long-script-name-for-checks.mjs --mode strict --target ${tail}`;
    expect(commandKey(long("alpha")).length).toBeLessThanOrEqual(50);
    expect(commandKey(long("alpha"))).toBe(commandKey(long("alpha")));
    expect(commandKey(long("alpha"))).not.toBe(commandKey(long("beta")));
    expect(commandKey("pnpm test")).toBe("pnpm test");
  });

  it("groups a failing command across temp dirs into one finding with a short, stable id", () => {
    const run = (hash: string) => `timeout --kill-after=30s 600 pnpm --dir /tmp/hindsight-${hash}/checkout run verify-the-whole-repository-with-every-check --run ${hash.slice(0, 12)}`;
    const make = () =>
      [0, 1, 2].map((index) =>
        session({
          startTime: day(index),
          toolCalls: [1, 2, 3].map((minute) => shell(run(`${index}${minute}`.padEnd(64, "f")), "command_failed", day(index, minute))),
        }),
      );
    const first = findings("repeated_failed_command", make());
    const second = findings("repeated_failed_command", make());
    expect(first).toHaveLength(1);
    expect(first[0]!.id).toBe(second[0]!.id);
    expect(first[0]!.id.length).toBeLessThanOrEqual(80);
    expect(first[0]!.title).not.toMatch(/[0-9a-f]{12}/);
    expect(first[0]!.title).not.toContain("<tmp>");
    expect(first[0]!.title).toContain("pnpm --dir …");
    expect(first[0]!.metric?.value).toBe(9);
  });
});
