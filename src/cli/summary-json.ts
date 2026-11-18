import { isoInZone, type PeriodSummary } from "../analysis/periods.js";
import { isChatHarness } from "../schema/types.js";

/**
 * The `--json` output of `today`, `week`, `month` and `summary`: a contract other tools (a tray app, a status bar
 * script) read. docs/summary-json.md describes it. Adding an optional field keeps `schemaVersion`; renaming,
 * removing or changing the meaning of one is a new version.
 */
export const SUMMARY_SCHEMA_VERSION = 1;

export interface SummaryPeriodJson {
  from: string;
  to: string;
  sessions: number;
  activeMinutes: number;
  prompts: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } | null;
  costUsd: number | null;
  unpricedRequestShare: number;
  /** `measured` is false for chat exports, which record no tokens or cost: show "not measured", not a number. */
  byAgent: Array<{ agent: string; label: string; sessions: number; costUsd: number | null; measured: boolean }>;
  byModel: Array<{ model: string; costUsd: number | null; tokens: number }>;
  tip: { id: string; text: string } | null;
  /** Only with `--by project`. */
  byProject?: Array<{ project: string; sessions: number; activeMinutes: number; costUsd: number | null }>;
  /** Only with `--last n` (n > 1) or `--since`: one row per day, week or month, oldest first. */
  series?: Array<{ from: string; to: string; sessions: number; activeMinutes: number; prompts: number; tokens: number | null; costUsd: number | null }>;
}

export interface SummaryJson {
  schemaVersion: typeof SUMMARY_SCHEMA_VERSION;
  generatedAt: string;
  timezone: string;
  periods: Partial<Record<"today" | "week" | "month" | "range", SummaryPeriodJson>>;
  reportPath: string | null;
}

function end(summary: PeriodSummary, now: number): number {
  // Ranges reaching the present end a millisecond after now so a request made now is inside; show now itself.
  return Math.min(summary.to, now);
}

export function periodJson(summary: PeriodSummary, timeZone: string, now: number, options: { series?: PeriodSummary[]; byProject?: boolean } = {}): SummaryPeriodJson {
  const out: SummaryPeriodJson = {
    from: isoInZone(summary.from, timeZone),
    to: isoInZone(end(summary, now), timeZone),
    sessions: summary.sessions,
    activeMinutes: summary.activeMinutes,
    prompts: summary.prompts,
    tokens: summary.tokens ? { ...summary.tokens } : null,
    costUsd: summary.costUsd,
    unpricedRequestShare: summary.unpricedRequestShare,
    byAgent: summary.byAgent.map((row) => ({ agent: row.agent, label: row.label, sessions: row.sessions, costUsd: row.costUsd, measured: !isChatHarness(row.agent) })),
    byModel: summary.byModel.map((row) => ({ model: row.model, costUsd: row.costUsd, tokens: row.tokens })),
    tip: summary.tip ? { id: summary.tip.id, text: summary.tip.text } : null,
  };
  if (options.byProject && summary.byProject) out.byProject = summary.byProject.map((row) => ({ ...row }));
  if (options.series && options.series.length > 1) {
    out.series = options.series.map((row) => ({
      from: isoInZone(row.from, timeZone),
      to: isoInZone(end(row, now), timeZone),
      sessions: row.sessions,
      activeMinutes: row.activeMinutes,
      prompts: row.prompts,
      tokens: row.tokens ? row.tokens.total : null,
      costUsd: row.costUsd,
    }));
  }
  return out;
}

export function summaryJson(input: { periods: SummaryJson["periods"]; timeZone: string; now: Date; reportPath: string | null }): SummaryJson {
  return { schemaVersion: SUMMARY_SCHEMA_VERSION, generatedAt: input.now.toISOString(), timezone: input.timeZone, periods: input.periods, reportPath: input.reportPath };
}
