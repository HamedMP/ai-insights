#!/usr/bin/env node
// A stand-in for the ai-insights CLI with synthetic numbers, for developing and screenshotting the app
// without anyone's real history:  AI_INSIGHTS_CLI=$PWD/fixtures/fake-cli.mjs pnpm dev
// FAKE_CLI_MODE: ok (default) | slow | fail | old | garbage | empty | hang
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
} else if (command === "report") {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, "<!doctype html><title>AI Insights (fake)</title><h1>Fake report with synthetic data</h1>");
} else {
  process.stderr.write(`fake-cli: unsupported ${command}\n`);
  process.exit(64);
}
