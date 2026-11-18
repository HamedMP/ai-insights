import { stat } from "node:fs/promises";
import { join } from "node:path";
import { calendarRange, currentRange, PERIOD_KINDS, splitRange, summarizePeriods, type PeriodKind, type PeriodRange, type PeriodSummary } from "../analysis/periods.js";
import { resolveTimeZone } from "../analysis/time.js";
import { localTimeZone } from "../store/pipeline.js";
import { harnessLabel } from "../store/scan.js";
import type { Store } from "../store/store.js";
import type { Parsed } from "./args.js";
import type { CliDeps } from "./main.js";
import { buildDigest, digestIsFresh, saveDigest } from "./digest.js";
import { quickText, summaryText } from "./quick-screen.js";
import { periodJson, summaryJson } from "./summary-json.js";
import type { Style } from "./terminal.js";
import type { ScanOptions, ScanResult } from "../store/scan.js";

/** Runs a scan the way the CLI does (workers, checkpoints), without measuring retention. */
export type QuickScan = (options: ScanOptions) => Promise<ScanResult>;

const TITLES: Record<PeriodKind, string> = { today: "Today", week: "This week", month: "This month" };
const UNITS: Record<PeriodKind, "day" | "week" | "month"> = { today: "day", week: "week", month: "month" };
/** A tip that did not show up in a short period may in the longer one around it. */
const WIDER: Record<PeriodKind, PeriodKind | null> = { today: "week", week: "month", month: null };

async function lastReport(store: Store): Promise<string | null> {
  const path = join(store.reportsDir, "report.html");
  try {
    return (await stat(path)).isFile() ? path : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

/** `ai-insights today|week|month|summary`: cheap enough to run often. Reads history (and its cache), writes no report. */
export async function commandQuick(parsed: Parsed, deps: CliDeps, store: Store, style: Style, runScan: QuickScan): Promise<number> {
  const now = deps.now();
  const timeZone = resolveTimeZone(deps.timeZone ?? localTimeZone());
  const labels = (harness: Parameters<typeof harnessLabel>[0]) => harnessLabel(harness, deps.sources);
  const summaryMode = parsed.command === "summary";
  const kind = summaryMode ? null : (parsed.command as PeriodKind);

  const main: PeriodRange[] = summaryMode
    ? PERIOD_KINDS.map((period) => currentRange(period, now, timeZone))
    : parsed.sinceText || parsed.until
      ? [calendarRange(parsed.sinceText?.trim(), parsed.until, now, timeZone)]
      : [currentRange(kind!, now, timeZone, parsed.last ?? 1)];
  const wider = kind && !parsed.sinceText && !parsed.until && (parsed.last ?? 1) === 1 && WIDER[kind] ? currentRange(WIDER[kind]!, now, timeZone) : null;
  // Unfiltered views also refresh the saved digest, which covers this month: read that far back.
  const digest = !parsed.harness && !parsed.maxSessions && !parsed.sinceText && !parsed.until && (parsed.last ?? 1) === 1;
  const monthStart = digest ? currentRange("month", now, timeZone).from : Number.POSITIVE_INFINITY;
  const earliest = Math.min(...main.map((range) => range.from), wider?.from ?? Number.POSITIVE_INFINITY, monthStart);
  const result = await runScan({
    ...(earliest > 0 ? { since: new Date(earliest) } : {}),
    ...(parsed.harness ? { harness: parsed.harness } : {}),
    ...(parsed.maxSessions ? { maxSessions: parsed.maxSessions } : {}),
    ...(parsed.refresh ? { refresh: true } : {}),
  });
  const options = { timeZone, now, labels, byProject: parsed.by === "project" };
  const summaries = summarizePeriods(result.sessions, main, options);
  // `summary` has all three periods already; a single view refreshes a digest older than a few minutes.
  if (digest && (summaryMode || !(await digestIsFresh(store.home, now)))) {
    const known = summaryMode ? Object.fromEntries(PERIOD_KINDS.map((period, index) => [period, summaries[index]!])) : { [kind!]: summaries[0]! };
    await saveDigest(store.home, buildDigest(result.sessions, { timeZone, now, labels }, known));
  }
  const reportPath = await lastReport(store);
  const nowMs = now.getTime();

  if (summaryMode) {
    // A quiet today borrows the week's tip, a quiet week the month's: each says which period it is about.
    for (let index = 0; index < summaries.length; index += 1) summaries[index]!.tip ??= summaries.slice(index + 1).find((entry) => entry.tip)?.tip ?? null;
    if (parsed.json) {
      const periods = Object.fromEntries(PERIOD_KINDS.map((period, index) => [period, periodJson(summaries[index]!, timeZone, nowMs)]));
      deps.stdout(`${JSON.stringify(summaryJson({ periods, timeZone, now, reportPath }), null, 2)}\n`);
      return 0;
    }
    deps.stdout(summaryText(PERIOD_KINDS.map((period, index) => ({ title: TITLES[period], summary: summaries[index]! })), { noCost: parsed.noCost, timeZone, reportPath }, style));
    return 0;
  }

  const summary = summaries[0]!;
  if (!summary.tip && wider) summary.tip = summarizePeriods(result.sessions, [wider], options)[0]!.tip;
  const range = main[0]!;
  const many = range.kind === "range" || (parsed.last ?? 1) > 1;
  const series: PeriodSummary[] | undefined = many ? summarizePeriods(result.sessions, splitRange(kind!, range, timeZone), { ...options, byProject: false, noTip: true }) : undefined;

  if (parsed.json) {
    const key = range.kind === "range" ? "range" : kind!;
    const period = periodJson(summary, timeZone, nowMs, { ...(series ? { series } : {}), byProject: parsed.by === "project" });
    deps.stdout(`${JSON.stringify(summaryJson({ periods: { [key]: period }, timeZone, now, reportPath }), null, 2)}\n`);
    return 0;
  }
  const title = range.kind === "range" ? "Your history" : (parsed.last ?? 1) > 1 ? `Last ${parsed.last} ${UNITS[kind!]}s` : TITLES[kind!];
  deps.stdout(
    quickText({ title, summary, ...(series ? { series: { unit: UNITS[kind!], rows: series } } : {}), by: parsed.by ?? "agent", noCost: parsed.noCost, timeZone, now: nowMs, reportPath }, style),
  );
  return 0;
}
