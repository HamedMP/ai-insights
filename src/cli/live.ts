import { currentRange, PERIOD_KINDS, type PeriodKind } from "../analysis/periods.js";
import { periodUsage, type UsageRange } from "../analysis/period-usage.js";
import { resolveTimeZone } from "../analysis/time.js";
import { isChatHarness, type Harness } from "../schema/types.js";
import { usageReader } from "../store/parse-file.js";
import type { ParsePool } from "../store/parse-pool.js";
import { localTimeZone, formatUsd } from "../store/pipeline.js";
import { harnessLabel } from "../store/scan.js";
import type { Store } from "../store/store.js";
import { usageScan, type UsageScanResult, type UsageSession } from "../store/usage-scan.js";
import type { Parsed } from "./args.js";
import type { CliDeps } from "./main.js";
import { pad, painter, type Style } from "./terminal.js";

/**
 * The first numbers of a run, shown while the full scan and analysis are still going: each agent's sessions and
 * this month's cost as soon as that agent's history is read, then today, this week and this month. They come from
 * the usage-only scan, whose totals equal the report's (tests/store/usage-scan.test.ts). Lines are only ever added
 * above the status line, never redrawn, so nothing is left half-written; piped, they are plain lines.
 */

const TITLES: Record<PeriodKind, string> = { today: "Today", week: "This week", month: "This month" };

export interface LiveOptions {
  parsed: Parsed;
  deps: CliDeps;
  store: Store;
  style: Style;
  pool: ParsePool | null;
  /** Writes lines to stdout without breaking the status line. */
  print: (text: string) => void;
  builtIn: boolean;
}

function costWord(usd: number | null, requests: number, measured: boolean): string {
  if (!measured) return "not measured";
  if (usd === null) return requests > 0 ? "unpriced" : "$0.00";
  return formatUsd(usd);
}

function inRange(entry: UsageSession, range: UsageRange): boolean {
  if (entry.session) {
    const start = Date.parse(entry.session.startTime);
    const end = Date.parse(entry.session.endTime);
    return start < range.to && end >= range.from;
  }
  return entry.requests.some((request) => {
    const at = Date.parse(request.timestamp);
    return at >= range.from && at < range.to;
  });
}

/** One agent's month so far, or null when it was not active this month. */
export function agentLine(harness: Harness, sessions: UsageSession[], month: UsageRange, label: string, style: Style): string | null {
  const paint = painter(style);
  const measured = !isChatHarness(harness);
  const active = sessions.filter((entry) => inRange(entry, month)).length;
  if (active === 0) return null;
  const [usage] = periodUsage(sessions, [month]);
  const cost = costWord(usage!.totals.estimatedUsd, usage!.totals.requests, measured);
  const count = `${active.toLocaleString("en-US")} session${active === 1 ? "" : "s"}`;
  const spend = cost === "not measured" ? "cost not measured" : cost;
  if (!style.rich) return `${label} this month: ${count}, ${spend}`;
  const mark = style.unicode ? "✓" : "+";
  return `  ${paint("accent", mark, true)} ${pad(paint("strong", label), 13)} ${paint("muted", "this month")}  ${pad(count, 13)} ${cost === "not measured" ? paint("muted", spend) : paint("accent", spend, true)}`;
}

export function periodLine(result: UsageScanResult, ranges: UsageRange[], style: Style): string {
  const paint = painter(style);
  const usage = periodUsage(result.sessions, ranges);
  const anyMeasured = result.sessions.some((entry) => !isChatHarness(entry.harness));
  const parts = PERIOD_KINDS.map((kind, index) => {
    const totals = usage[index]!.totals;
    const sessions = result.sessions.filter((entry) => inRange(entry, ranges[index]!)).length;
    return { title: TITLES[kind], cost: costWord(totals.estimatedUsd, totals.requests, anyMeasured), sessions };
  });
  const unpriced = usage.some((period) => period.totals.unpriced > 0);
  const note = `at API list prices${unpriced ? ", priced requests only" : ""}`;
  if (!style.rich) return `So far: ${parts.map((part) => `${part.title.toLowerCase()} ${part.cost} (${part.sessions} sessions)`).join(", ")}; ${note}.`;
  const dot = paint("muted", style.unicode ? " · " : " - ");
  const glyph = paint("brand", style.unicode ? "✦" : "*", true);
  const body = parts.map((part) => `${paint("muted", part.title)} ${paint("accent", part.cost, true)}`).join(dot);
  return `  ${glyph} ${body}\n    ${paint("muted", `${parts.map((part) => `${part.sessions} session${part.sessions === 1 ? "" : "s"}`).join(" · ")} ${style.unicode ? "·" : "-"} ${note}`)}`;
}

/**
 * Runs the usage-only scan and prints as it goes. Never throws: a failure here costs only the early numbers, and
 * the full run carries on as before. Returns what the scan parsed in full, for the full scan to reuse.
 */
export async function liveInsights(options: LiveOptions): Promise<UsageScanResult["parsed"] | undefined> {
  const { parsed, deps, store, style, pool } = options;
  try {
    const now = deps.now();
    const timeZone = resolveTimeZone(deps.timeZone ?? localTimeZone());
    const ranges = PERIOD_KINDS.map((kind) => currentRange(kind, now, timeZone));
    const month = ranges[2]!;
    const { fileParser } = await import("../store/parse-file.js");
    const result = await usageScan(
      {
        sources: deps.sources,
        store,
        ...(options.builtIn ? { parse: fileParser({ pool, home: store.home }), readUsage: usageReader(pool) } : {}),
        ...(pool ? { concurrency: pool.workers + 2 } : {}),
      },
      {
        since: new Date(month.from),
        ...(parsed.harness ? { harness: parsed.harness } : {}),
        ...(parsed.maxSessions ? { maxSessions: parsed.maxSessions } : {}),
        onHarness: (harness, sessions) => {
          const line = agentLine(harness, sessions, month, harnessLabel(harness, deps.sources), style);
          if (line) options.print(`${line}\n`);
        },
      },
    );
    if (result.sessions.some((entry) => inRange(entry, month))) options.print(`${periodLine(result, ranges, style)}\n${style.rich ? "\n" : ""}`);
    return result.parsed;
  } catch {
    // The early numbers are a bonus: the run still reads, analyses and reports as it always has.
    return undefined;
  }
}
