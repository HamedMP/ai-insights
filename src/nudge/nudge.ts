import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The monthly review reminder. An agent's session-start hook runs this on every new session, so it stays tiny:
// Node built-ins only, two small file reads, no network, and it never throws. The plugin ships a copy of this
// file (generated into harness/ai-insights/hooks/ by scripts/generate-harness.mjs), so the hook does not pay for
// npx, which asks the npm registry for the latest version on every start.

export const NUDGE_FILE = "nudge.json";
/** The report every run writes; its age says when the last review was. */
export const REPORT_FILE = join("reports", "report.html");

export const NUDGE_TEXT =
  "AI Insights: your monthly review is due. Run /analyze-ai-usage, or npx ai-insights@latest in a terminal. (Turn this off: npx ai-insights@latest nudge --off)";

export interface NudgeState {
  /** The person turned the reminder off. */
  off: boolean;
  /** The month ("2026-11") the reminder was last shown. */
  shown: string | null;
}

/** Local calendar month, "YYYY-MM". */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export async function readNudgeState(home: string): Promise<NudgeState> {
  try {
    const raw = await readFile(join(home, NUDGE_FILE), "utf8");
    if (raw.length > 10_000) return { off: false, shown: null };
    const value = JSON.parse(raw) as { off?: unknown; shown?: unknown };
    return {
      off: value.off === true,
      shown: typeof value.shown === "string" && /^\d{4}-\d{2}$/.test(value.shown) ? value.shown : null,
    };
  } catch {
    return { off: false, shown: null };
  }
}

export async function writeNudgeState(home: string, state: NudgeState): Promise<boolean> {
  const path = join(home, NUDGE_FILE);
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(temp, path);
    return true;
  } catch {
    return false;
  }
}

async function lastReport(home: string): Promise<Date | null> {
  try {
    return (await stat(join(home, REPORT_FILE))).mtime;
  } catch {
    return null;
  }
}

/**
 * Due once per calendar month: when no report has been written this month and the reminder has not been
 * shown this month. So the first session of a new month asks for the month just ended, a report written this
 * month (by `npx ai-insights@latest` or the skill) quiets it, and it never repeats within the month.
 */
export function isDue(state: NudgeState, report: Date | null, now: Date): boolean {
  if (state.off) return false;
  const month = monthKey(now);
  if (state.shown === month) return false;
  return report === null || monthKey(report) !== month;
}

/**
 * The reminder line when one is due, recording that it was shown; null otherwise. Shown only when the store
 * folder already exists (the person has run AI Insights here) and the record could be written, so a broken
 * store can never make it repeat every session.
 */
export async function takeNudge(home: string, now: Date): Promise<string | null> {
  try {
    const folder = await stat(home).catch(() => null);
    if (!folder?.isDirectory()) return null;
    const [state, report] = await Promise.all([readNudgeState(home), lastReport(home)]);
    if (!isDue(state, report, now)) return null;
    if (!(await writeNudgeState(home, { ...state, shown: monthKey(now) }))) return null;
    return NUDGE_TEXT;
  } catch {
    return null;
  }
}
