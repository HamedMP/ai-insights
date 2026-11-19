#!/usr/bin/env node
// A stand-in for the ai-insights CLI with synthetic numbers, for developing and screenshotting the app
// without anyone's real history:  AI_INSIGHTS_CLI=$PWD/fixtures/fake-cli.mjs pnpm dev
// FAKE_CLI_MODE: ok (default) | slow | fail | old | garbage | empty | hang
// FAKE_CLI_SCHEDULE=on: `schedule status --json` reports an active weekly `ai-insights schedule`
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mode = process.env.FAKE_CLI_MODE ?? "ok";
const [command, ...rest] = process.argv.slice(2);
const reportDir = join(tmpdir(), "ai-insights-desktop-fake");
const reportPath = join(reportDir, "report.html");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (mode === "hang") await wait(10 * 60_000);
if (mode === "slow") await wait(4000);
if (mode === "old") {
  // What a CLI from before `summary` existed does: a usage error, exit code 2.
  process.stderr.write(`ai-insights: unknown command "${command}"\n`);
  process.exit(2);
}
if (mode === "fail") {
  process.stderr.write("fake failure\n");
  process.exit(1);
}

if (command === "summary" && rest.includes("--json")) {
  if (mode === "garbage") {
    process.stdout.write("this is not json\n");
    process.exit(0);
  }
  const summary = JSON.parse(readFileSync(new URL("./summary.json", import.meta.url), "utf8"));
  summary.generatedAt = new Date().toISOString();
  summary.reportPath = existsSync(reportPath) ? reportPath : null;
  if (mode === "empty") {
    for (const p of Object.values(summary.periods)) Object.assign(p, { sessions: 0, activeMinutes: 0, prompts: 0, costUsd: 0, byAgent: [], tip: null });
  }
  process.stdout.write(JSON.stringify(summary));
} else if (command === "schedule" && rest[0] === "status" && rest.includes("--json")) {
  const on = process.env.FAKE_CLI_SCHEDULE === "on";
  process.stdout.write(
    JSON.stringify({ schemaVersion: 1, active: on, system: on ? "launchd" : null, cadence: on ? "weekly" : null, hour: on ? 9 : null, minute: on ? 0 : null, weekday: on ? 1 : null, when: on ? "every Monday at 09:00" : null, nextRun: null, lastRun: null }) + "\n",
  );
} else if (command === "report") {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, "<!doctype html><title>AI Insights (fake)</title><h1>Fake report with synthetic data</h1>");
} else {
  process.stderr.write(`fake-cli: unsupported ${command}\n`);
  process.exit(64);
}
