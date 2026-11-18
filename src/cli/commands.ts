import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { buildReport as realBuildReport } from "../analysis/index.js";
import { packageVersion } from "../mcp/version.js";
import { renderReport as realRenderReport } from "../render/index.js";
import { HARNESSES, isChatHarness, type AnalysisStep, type Coverage, type Harness, type SessionFile, type Source } from "../schema/types.js";
import { sources as realSources } from "../sources/index.js";
import { ensureDir, pathExists, writeFileAtomic } from "../store/fs.js";
import { buildFromScan, describeHeadline, headline, renderFromScan, tokensPhrase, type PipelineProgress } from "../store/pipeline.js";
import { harnessLabel, scan, totalBytes, type ScanOptions, type ScanProgress } from "../store/scan.js";
import { measureRetention, readRetentionPolicies, type RetentionPolicy } from "../store/retention.js";
import { Store, resolveHome } from "../store/store.js";
import type { Parsed } from "./args.js";
import type { CliDeps, LightDeps } from "./main.js";
import { OPEN_QUESTION, openMode, type OpenMode } from "./open.js";
import { ProgressLine } from "./progress.js";
import { compact, day, failureHint, noHistoryText, plural, resultScreen, retentionLine } from "./screen.js";
import type { Style } from "./terminal.js";

// The commands themselves. Loaded by main.ts after the header is drawn, so the imports above cost nothing visible.

function scanOptions(parsed: Parsed): ScanOptions {
  return {
    ...(parsed.since ? { since: parsed.since } : {}),
    ...(parsed.harness ? { harness: parsed.harness } : {}),
    ...(parsed.maxSessions ? { maxSessions: parsed.maxSessions } : {}),
    ...(parsed.refresh ? { refresh: true } : {}),
  };
}

// -- formatting ---------------------------------------------------------------

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

// -- commands -----------------------------------------------------------------

function truthy(value: string | undefined): boolean {
  return value !== undefined && value !== "" && !["0", "false", "no"].includes(value.trim().toLowerCase());
}

/** The in-place status line: only on a terminal that shows the designed screen, with stderr also a terminal, never in CI. */
function progressLine(deps: CliDeps, style: Style): ProgressLine | null {
  if (!style.rich || deps.terminal?.stderr !== true || truthy(deps.env.CI)) return null;
  return new ProgressLine({ write: deps.stderr, clock: deps.clock, style });
}

function describeProgress(event: ScanProgress | PipelineProgress, sources: Source[], style: Style): string {
  const more = style.unicode ? "…" : "...";
  const dot = style.unicode ? "·" : "-";
  switch (event.stage) {
    case "find":
      return `Finding history${more}${event.found.length ? ` ${event.found.map((entry) => `${harnessLabel(entry.harness, sources)} ${entry.files.toLocaleString("en-US")}`).join(` ${dot} `)}` : ""}`;
    case "read":
      return `Reading sessions ${event.done.toLocaleString("en-US")}/${event.total.toLocaleString("en-US")}${event.cached ? ` (${event.cached.toLocaleString("en-US")} from the cache)` : ""}`;
    case "save":
      return `Saving the cache${more}`;
    case "check":
      return `Checking how long your agents keep history${more}`;
    case "analyse":
      return `Analysing ${plural(event.sessions, "session")}${more}${event.step ? ` ${STEP_TEXT[event.step]}` : ""}`;
    case "write":
      return `Writing the report${more}`;
  }
}

const STEP_TEXT: Record<AnalysisStep, string> = { usage: "tokens and cost", activity: "time and activity", findings: "findings", recap: "your recap" };

function seconds(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

async function commandRun(parsed: Parsed, deps: CliDeps, store: Store, style: Style): Promise<number> {
  const progress = progressLine(deps, style);
  let stopListening = () => {};
  if (progress) {
    progress.start();
    stopListening = deps.onInterrupt(() => {
      progress.stop();
      deps.exit(130);
    });
  }
  // The last per-agent counts, for the closing line.
  let found: Array<{ harness: Harness; files: number }> = [];
  const onProgress = progress
    ? (event: ScanProgress | PipelineProgress) => {
        if (event.stage === "find") found = [...event.found].sort((a, b) => b.files - a.files);
        // A new stage, a finished search or a new analysis step is drawn at once; counts within a stage are throttled.
        const key = event.stage === "find" ? `find:${event.pending === 0}` : event.stage === "analyse" ? `analyse:${event.step ?? ""}` : event.stage;
        progress.update(describeProgress(event, deps.sources, style), key);
      }
    : undefined;
  let outcome: Awaited<ReturnType<typeof renderFromScan>>;
  try {
    const result = await scan(scanDeps(deps, store), { ...scanOptions(parsed), ...(onProgress ? { onProgress } : {}) });
    if (result.sessions.length === 0) {
      progress?.stop();
      const filters = [...(parsed.sinceText ? [`--since ${parsed.sinceText}`] : []), ...(parsed.harness ? [`--harness ${parsed.harness}`] : [])];
      deps.stderr(noHistoryText(filters));
      return 1;
    }
    outcome = await renderFromScan({ ...pipelineDeps(deps, store), ...(onProgress ? { onProgress } : {}) }, result);
    const agents = found.length > 1 ? ` (${found.map((entry) => `${harnessLabel(entry.harness, deps.sources)} ${entry.files.toLocaleString("en-US")}`).join(style.unicode ? " · " : ", ")})` : "";
    progress?.done(`${plural(result.sessions.length, "session")}${agents} read and analysed in ${seconds(progress.elapsedMs())}`);
  } finally {
    // Errors and early returns too: the line is cleared and the cursor comes back before anything else prints.
    progress?.stop();
    stopListening();
  }
  const mode = openMode({ flag: parsed.open, env: deps.env, stdoutTTY: deps.terminal?.isTTY === true, stdinTTY: deps.terminal?.stdin === true, platform: deps.platform });
  deps.stdout(
    resultScreen(
      { report: outcome.report, htmlPath: outcome.htmlPath, version: packageVersion(), now: deps.now(), open: mode, reviewed: outcome.facetCount > 0 || outcome.hasNarrative },
      style,
    ),
  );
  const delivered = await deliver(mode, outcome.htmlPath, deps, style);
  if (delivered !== 0) return delivered;
  const { installDeps, offerInstall } = await import("./install-command.js");
  const offered = await offerInstall({ ...installDeps(deps, store.home), disabled: parsed.noInstallPrompt, indent: style.rich ? "  " : "" });
  return offered ?? 0;
}

/** Opens the report now, after asking, or not at all. A failed opener costs one line, never the run. */
async function deliver(mode: OpenMode, path: string, deps: CliDeps, style: Style): Promise<number> {
  if (mode === "manual") return 0;
  const indent = style.rich ? "  " : "";
  if (mode === "ask") {
    deps.stdout(`${indent}${OPEN_QUESTION} `);
    const answer = await deps.prompt(OPEN_QUESTION);
    if (answer === "cancel") {
      deps.stdout("\n");
      return 130;
    }
    deps.stdout(answer === "yes" ? "yes\n" : "no\n");
    if (answer === "no") return 0;
  }
  await openReport(path, deps, indent);
  return 0;
}

async function openReport(path: string, deps: CliDeps, indent = ""): Promise<void> {
  try {
    await deps.openFile(path);
  } catch (error) {
    deps.stderr(`${indent}Could not open a browser here; open the report path above yourself.\n`);
    if (deps.env.AI_INSIGHTS_DEBUG) deps.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
  }
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
    `${plural(numbers.sessions, "session")}, ${plural(numbers.userPrompts, "prompt")}, ${numbers.agentHours} agent-hours, ${tokensPhrase(numbers.tokens, numbers.unmeasuredSessions, numbers.sessions, compact)}.`,
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
  if (parsed.open === "open") await openReport(outcome.htmlPath, deps);
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
    if (isChatHarness(harness) && files.length === 0) lines.push(`  import  not imported: run \`npx ai-insights@latest import ${harness === "chatgpt" ? "openai" : "claude"} <path>\` with your ${harness === "chatgpt" ? "ChatGPT" : "Claude"} data export`);
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

/** Fills in the heavy defaults a test did not supply. The MCP SDK loads only for `mcp`. */
function complete(deps: LightDeps): CliDeps {
  return {
    ...deps,
    sources: deps.sources ?? realSources,
    buildReport: deps.buildReport ?? realBuildReport,
    renderReport: deps.renderReport ?? realRenderReport,
    startMcp: deps.startMcp ?? (async (serverDeps) => (await import("../mcp/server.js")).startStdioServer(serverDeps)),
  };
}

/** Runs a parsed command. main.ts has handled help, version and usage errors, and drawn the header if there is one. */
export async function execute(parsed: Parsed, light: LightDeps, style: Style): Promise<number> {
  const deps = complete(light);
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
        return await commandRun(parsed, deps, store, style);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    deps.stderr(`ai-insights: ${parsed.command === "run" ? "could not build the report" : `${parsed.command} failed`}: ${detail}\n`);
    if (deps.env.AI_INSIGHTS_DEBUG && error instanceof Error && error.stack) deps.stderr(`${error.stack}\n`);
    else deps.stderr(failureHint());
    return 1;
  }
}
