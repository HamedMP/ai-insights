#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport as realBuildReport } from "../analysis/index.js";
import { startStdioServer, type ServerDeps } from "../mcp/server.js";
import { packageVersion } from "../mcp/version.js";
import { renderReport as realRenderReport } from "../render/index.js";
import { HARNESSES, type Coverage, type Harness, type Report, type Retention, type SessionFile, type Source } from "../schema/types.js";
import { sources as realSources } from "../sources/index.js";
import { ensureDir, pathExists, writeFileAtomic } from "../store/fs.js";
import { buildFromScan, describeHeadline, headline, renderFromScan, type BuildReportFn, type RenderReportFn } from "../store/pipeline.js";
import { harnessLabel, scan, totalBytes, type ScanOptions } from "../store/scan.js";
import { measureRetention, readRetentionPolicies, type RetentionPolicy } from "../store/retention.js";
import { parseSince, SINCE_HELP } from "../store/since.js";
import { Store, resolveHome } from "../store/store.js";

export interface CliDeps {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  sources: Source[];
  buildReport: BuildReportFn;
  renderReport: RenderReportFn;
  now: () => Date;
  timeZone?: string;
  /** Opens a local file in the default app. Never a URL on the network. */
  openFile: (path: string) => Promise<void>;
  startMcp: (deps: ServerDeps) => Promise<unknown>;
  /** How long each harness keeps transcripts. Default: read from this machine's settings files. */
  retentionPolicies?: () => Promise<Map<Harness, RetentionPolicy>>;
}

class UsageError extends Error {}

const HELP = `ai-insights: look back at how you work with AI coding agents.

Reads your local agent history (Claude Code, Codex, OpenCode, Pi, Cursor, Gemini CLI), writes one HTML report.
Nothing leaves this machine.

Usage
  ai-insights [options]          scan, write the report, print a summary
  ai-insights scan [options]     scan and show what was found
  ai-insights report [options]   write the report (or print JSON with --json)
  ai-insights doctor             show which histories were found and where
  ai-insights mcp                start the MCP server on stdio (for your agent)

Options
  --since <window>     only history from ${SINCE_HELP}
  --harness <name>     only one of: ${HARNESSES.join(", ")}
  --max-sessions <n>   read at most n transcripts, newest first
  --refresh            re-parse every transcript, ignoring the cache
  --json               report: print the report as JSON instead of writing HTML
  --open               open the written report in your browser
  -h, --help           show this help
  -v, --version        show the version

Cache and reports live in ~/.ai-insights (set AI_INSIGHTS_HOME to move them;
an existing ~/.hindsight from before 0.2 keeps being used).
For the qualitative analysis, run the analyze-ai-usage skill in your agent.
`;

interface Parsed {
  command: string;
  since?: Date;
  harness?: Harness;
  maxSessions?: number;
  refresh: boolean;
  json: boolean;
  open: boolean;
  help: boolean;
  version: boolean;
}

const COMMANDS = new Set(["run", "scan", "report", "doctor", "mcp", "help"]);
const VALUE_FLAGS = new Set(["--since", "--harness", "--max-sessions"]);

function parseArgs(argv: string[], now: Date): Parsed {
  const parsed: Parsed = { command: "run", refresh: false, json: false, open: false, help: false, version: false };
  let commandSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    if (!raw.startsWith("-")) {
      if (commandSeen || !COMMANDS.has(raw)) throw new UsageError(`unknown command "${raw}"`);
      parsed.command = raw === "help" ? "run" : raw;
      parsed.help ||= raw === "help";
      commandSeen = true;
      continue;
    }
    const eq = raw.indexOf("=");
    const flag = eq > 0 ? raw.slice(0, eq) : raw;
    let value: string | undefined = eq > 0 ? raw.slice(eq + 1) : undefined;
    if (VALUE_FLAGS.has(flag) && value === undefined) {
      value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a value`);
      index += 1;
    } else if (!VALUE_FLAGS.has(flag) && value !== undefined) {
      throw new UsageError(`${flag} does not take a value`);
    }
    switch (flag) {
      case "--since": {
        const since = parseSince(value!, now);
        if (!since) throw new UsageError(`--since must be ${SINCE_HELP}`);
        parsed.since = since;
        break;
      }
      case "--harness":
        if (!(HARNESSES as readonly string[]).includes(value!)) throw new UsageError(`--harness must be one of: ${HARNESSES.join(", ")}`);
        parsed.harness = value as Harness;
        break;
      case "--max-sessions": {
        const count = Number(value);
        if (!Number.isInteger(count) || count < 1) throw new UsageError("--max-sessions must be a positive whole number");
        parsed.maxSessions = count;
        break;
      }
      case "--refresh":
        parsed.refresh = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--open":
        parsed.open = true;
        break;
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "-v":
      case "--version":
        parsed.version = true;
        break;
      default:
        throw new UsageError(`unknown option "${flag}"`);
    }
  }
  return parsed;
}

function scanOptions(parsed: Parsed): ScanOptions {
  return {
    ...(parsed.since ? { since: parsed.since } : {}),
    ...(parsed.harness ? { harness: parsed.harness } : {}),
    ...(parsed.maxSessions ? { maxSessions: parsed.maxSessions } : {}),
    ...(parsed.refresh ? { refresh: true } : {}),
  };
}

// -- formatting ---------------------------------------------------------------

function compact(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e4) return `${Math.round(value / 1e3)}k`;
  return value.toLocaleString("en-US");
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Binary units, one decimal from KB up: "512 B", "3.4 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${units[unit]}`;
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "?";
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;
}

function coverageLines(coverage: Coverage[]): string[] {
  const width = Math.max(...coverage.map((entry) => entry.label.length));
  return coverage.map((entry) => {
    const label = entry.label.padEnd(width);
    if (!entry.found) return `  ${label}  not found`;
    if (entry.sessions === 0) return `  ${label}  found, no sessions in this window`;
    const issues = entry.issues > 0 ? `, ${plural(entry.issues, "unreadable line")}` : "";
    const skipped = entry.skippedUsageRecords ? `, ${plural(entry.skippedUsageRecords, "usage counter")} skipped` : "";
    const size = entry.bytes ? `  ${formatBytes(entry.bytes)}` : "";
    return `  ${label}  ${plural(entry.sessions, "session").padEnd(14)} ${day(entry.oldest)} to ${day(entry.newest)}${size}${issues}${skipped}`;
  });
}

/**
 * One line when transcripts are about to be deleted, naming the change that keeps them; null otherwise.
 * "12 Claude Code sessions will be deleted within 7 days (from 2026-11-18). ..."
 */
export function retentionLine(retention: Retention | undefined, now: Date): string | null {
  if (!retention || retention.atRisk.sessions <= 0) return null;
  const due = retention.harnesses.filter((entry) => (entry.atRisk?.sessions ?? 0) > 0).sort((a, b) => b.atRisk!.sessions - a.atRisk!.sessions);
  const counts = due.map((entry) => `${entry.atRisk!.sessions.toLocaleString("en-US")} ${harnessLabel(entry.harness)}`).join(" and ");
  const noun = retention.atRisk.sessions === 1 ? "session" : "sessions";
  const next = retention.atRisk.nextDeletion ? Date.parse(retention.atRisk.nextDeletion) : Number.NaN;
  const when = Number.isFinite(next) ? (next <= now.getTime() ? " (some at the agent's next start)" : ` (from ${day(new Date(next).toISOString())})`) : "";
  const lead = due[0]!;
  const file = lead.setting?.file;
  const fix =
    lead.source === "managed"
      ? "ask an admin (managed settings set this) or "
      : lead.harness === "claude-code" && file
        ? `add "cleanupPeriodDays": 365 to ${file} or `
        : lead.harness === "gemini" && file
          ? `set general.sessionRetention.maxAge to "365d" in ${file} or `
          : "";
  return `${counts} ${noun} will be deleted within ${plural(retention.windowDays, "day")}${when}. AI Insights keeps their stats; to keep the transcripts, ${fix}archive them with \`npx packmem archive\`.`;
}

/** Three lines a person can read at a glance: what was covered, how much, and the top finding. */
export function summaryLines(report: Report): string[] {
  const found = report.coverage.filter((entry) => entry.sessions > 0).map((entry) => entry.label);
  const activity = report.activity;
  const numbers = describeHeadline(report);
  const rank = { high: 0, medium: 1, low: 2, info: 3 } as const;
  const top = [...report.findings].sort((a, b) => rank[a.severity] - rank[b.severity])[0];
  return [
    `${plural(activity.sessions, "session")} across ${found.length > 0 ? found.join(" and ") : "no harness"}, ${day(report.range.from)} to ${day(report.range.to)}.`,
    `${numbers.time} on ${plural(activity.activeDays, "day")}; ${compact(report.usage.tokens)} tokens, ${numbers.cost}.`,
    top ? `Top finding: ${top.title}` : "No findings yet: more history makes for better tips.",
  ];
}

// -- commands -----------------------------------------------------------------

async function commandRun(parsed: Parsed, deps: CliDeps, store: Store): Promise<number> {
  const result = await scan(scanDeps(deps, store), scanOptions(parsed));
  if (result.sessions.length === 0) {
    deps.stderr("No agent sessions found. Run `ai-insights doctor` to see where AI Insights looked.\n");
    return 1;
  }
  const outcome = await renderFromScan(pipelineDeps(deps, store), result);
  deps.stdout(`${summaryLines(outcome.report).join("\n")}\n\nReport: ${outcome.htmlPath}\n`);
  const keep = retentionLine(outcome.report.retention, deps.now());
  if (keep) deps.stdout(`${keep}\n`);
  if (outcome.facetCount === 0 && !outcome.hasNarrative) {
    deps.stdout("Tip: run the analyze-ai-usage skill in your agent to add what went well and what got in the way.\n");
  }
  if (parsed.open) await deps.openFile(outcome.htmlPath);
  return 0;
}

async function commandScan(parsed: Parsed, deps: CliDeps, store: Store): Promise<number> {
  const result = await scan(scanDeps(deps, store), scanOptions(parsed));
  const numbers = headline(result.sessions);
  let analysed: string | null = null;
  if (result.sessions.length > 0) {
    try {
      const { report } = await buildFromScan(pipelineDeps(deps, store), result);
      const described = describeHeadline(report);
      // Without wall-clock time the line above already gives the agent-hours; only the cost is new.
      analysed = described.activeHours === null ? `${capitalise(described.cost)}.` : `${described.time}; ${described.cost}.`;
    } catch {
      analysed = null;
    }
  }
  const lines = [
    "History found",
    ...coverageLines(result.coverage),
    "",
    `${plural(numbers.sessions, "session")}, ${plural(numbers.userPrompts, "prompt")}, ${numbers.agentHours} agent-hours, ${compact(numbers.tokens)} tokens.`,
    ...(analysed ? [analysed] : []),
    `Parsed ${result.stats.parsed}, reused ${result.stats.cached} from cache${result.stats.failed ? `, ${result.stats.failed} unreadable` : ""}.`,
  ];
  deps.stdout(`${lines.join("\n")}\n`);
  return 0;
}

async function commandReport(parsed: Parsed, deps: CliDeps, store: Store): Promise<number> {
  const result = await scan(scanDeps(deps, store), scanOptions(parsed));
  if (parsed.json) {
    const { report } = await buildFromScan(pipelineDeps(deps, store), result);
    deps.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  const outcome = await renderFromScan(pipelineDeps(deps, store), result);
  deps.stdout(`${outcome.htmlPath}\n`);
  if (parsed.open) await deps.openFile(outcome.htmlPath);
  return 0;
}

async function countEntries(dir: string): Promise<number> {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

async function commandDoctor(deps: CliDeps, store: Store): Promise<number> {
  const lines: string[] = [`ai-insights ${packageVersion()} on Node ${process.versions.node}`, ""];
  const policies = await (deps.retentionPolicies ?? readRetentionPolicies)().catch(() => new Map<Harness, RetentionPolicy>());
  const found = new Map<Harness, SessionFile[]>();
  for (const harness of HARNESSES) {
    const source = deps.sources.find((candidate) => candidate.harness === harness);
    const label = harnessLabel(harness, deps.sources);
    if (!source) {
      lines.push(`${label}: not supported yet`);
      continue;
    }
    let roots: string[] = [];
    try {
      roots = source.defaultRoots();
    } catch {
      roots = [];
    }
    let files: Awaited<ReturnType<Source["discover"]>> = [];
    let failed = false;
    try {
      files = await source.discover({ maxFiles: 50_000 });
    } catch {
      failed = true;
    }
    const newest = files.reduce((max, file) => Math.max(max, file.mtimeMs), 0);
    const oldest = files.reduce((min, file) => Math.min(min, file.mtimeMs), Infinity);
    const status = failed
      ? "could not list transcripts"
      : files.length === 0
        ? "no history found"
        : `${plural(files.length, "transcript")} (${formatBytes(totalBytes(files))}), ${new Date(oldest).toISOString().slice(0, 10)} to ${new Date(newest).toISOString().slice(0, 10)}`;
    lines.push(`${label}: ${status}`);
    found.set(harness, files);
    const policy = policies.get(harness);
    if (policy && files.length) lines.push(`  keeps   ${keepsText(policy)}`);
    const note = source.diagnose ? await source.diagnose().catch(() => null) : null;
    if (note) lines.push(`  note    ${note}`);
    for (const root of roots) lines.push(`  ${(await pathExists(root)) ? "found  " : "missing"} ${root}`);
    if (roots.length === 0) lines.push("  (no default location on this machine)");
  }

  const retention = await measureRetention({ now: deps.now(), policies, files: found, sessionsByPath: new Map(), cachedOnly: new Map() }).catch(() => undefined);
  const keep = retentionLine(retention, deps.now());
  if (keep) lines.push("", keep);

  lines.push("", `Store: ${store.home}`);
  let writable = true;
  try {
    await ensureDir(store.home);
    const probe = join(store.home, `.doctor-${process.pid}`);
    await writeFileAtomic(probe, "ok");
    await rm(probe, { force: true });
  } catch {
    writable = false;
  }
  lines.push(`  ${writable ? "writable" : "NOT writable: set AI_INSIGHTS_HOME to a folder you own"}`);
  let cached = 0;
  for (const harness of HARNESSES) cached += await countEntries(join(store.home, "sessions", harness));
  let facets = 0;
  for (const harness of HARNESSES) facets += await countEntries(join(store.home, "facets", harness));
  const narrative = await store.readNarrative();
  lines.push(`  ${plural(cached, "cached session")}, ${plural(facets, "saved facet")}, narrative ${narrative ? "saved" : "not saved yet"}`);
  const reportPath = join(store.reportsDir, "report.html");
  const report = await stat(reportPath).catch(() => null);
  lines.push(`  last report: ${report ? `${reportPath} (${report.mtime.toISOString().slice(0, 16).replace("T", " ")})` : "none yet"}`);
  deps.stdout(`${lines.join("\n")}\n`);
  return 0;
}

function keepsText(policy: RetentionPolicy): string {
  if (policy.policy === "kept") return "transcripts until you delete them";
  if (policy.policy === "unknown" || policy.days === undefined) return "unknown how long transcripts are kept";
  const where = policy.setting ? `${policy.setting.name} in ${policy.setting.file}` : "its settings";
  return `transcripts ${plural(policy.days, "day")} (${policy.source === "default" ? `the default; ${where}` : policy.source === "managed" ? "managed settings" : where})`;
}

function scanDeps(deps: CliDeps, store: Store) {
  return { sources: deps.sources, store, now: deps.now, ...(deps.retentionPolicies ? { retentionPolicies: deps.retentionPolicies } : {}) };
}

function pipelineDeps(deps: CliDeps, store: Store) {
  return {
    store,
    buildReport: deps.buildReport,
    renderReport: deps.renderReport,
    now: deps.now,
    ...(deps.timeZone ? { timeZone: deps.timeZone } : {}),
  };
}

function openWithSystem(path: string): Promise<void> {
  const [command, args] =
    process.platform === "darwin" ? ["open", [path]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", path]] : ["xdg-open", [path]];
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
      child.on("error", () => resolve());
      child.unref();
      resolve();
    } catch {
      resolve();
    }
  });
}

export function defaultDeps(): CliDeps {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    sources: realSources,
    buildReport: realBuildReport,
    renderReport: realRenderReport,
    now: () => new Date(),
    openFile: openWithSystem,
    startMcp: startStdioServer,
  };
}

/** The whole CLI as a function, so tests can drive it. Returns the exit code. */
export async function run(argv: string[], overrides: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = { ...defaultDeps(), ...overrides };
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv, deps.now());
  } catch (error) {
    if (error instanceof UsageError) {
      deps.stderr(`ai-insights: ${error.message}\nRun \`ai-insights --help\` for usage.\n`);
      return 2;
    }
    throw error;
  }
  if (parsed.help) {
    deps.stdout(HELP);
    return 0;
  }
  if (parsed.version) {
    deps.stdout(`${packageVersion()}\n`);
    return 0;
  }
  if (parsed.json && parsed.command !== "report") {
    deps.stderr("ai-insights: --json only works with `ai-insights report`\n");
    return 2;
  }

  const store = new Store(resolveHome(deps.env));
  try {
    switch (parsed.command) {
      case "mcp":
        // stdout carries protocol frames from here on; nothing else may write to it.
        await deps.startMcp({ ...pipelineDeps(deps, store), sources: deps.sources });
        return 0;
      case "scan":
        return await commandScan(parsed, deps, store);
      case "report":
        return await commandReport(parsed, deps, store);
      case "doctor":
        return await commandDoctor(deps, store);
      default:
        return await commandRun(parsed, deps, store);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    deps.stderr(`ai-insights: ${parsed.command === "run" ? "could not build the report" : `${parsed.command} failed`}: ${detail}\n`);
    if (deps.env.AI_INSIGHTS_DEBUG && error instanceof Error && error.stack) deps.stderr(`${error.stack}\n`);
    return 1;
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  if (process.argv[2] === "mcp") {
    // A stray console.log anywhere would corrupt the protocol stream on stdout.
    console.log = console.error;
    console.info = console.error;
    console.debug = console.error;
  }
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`ai-insights: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
