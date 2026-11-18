// What the popover shows, as plain data: every wording and number decision lives here, so it is tested
// without a window or a DOM. view.ts only turns this into elements.

import type { AgentRow, Period, PeriodKey, Problem, Summary, ViewState } from "./types.js";

export const PERIOD_LABELS: Record<PeriodKey, string> = { today: "Today", week: "This week", month: "This month" };
const ORDER: PeriodKey[] = ["today", "week", "month"];
/** Above this share of unpriced requests the cost gets a visible caveat. */
const UNPRICED_NOTE_AT = 0.05;

const DASH = "–";

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  return Math.round(n).toLocaleString("en-US");
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return DASH;
  if (minutes < 1) return "0 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return hours < 100 ? `${hours.toFixed(1)} h` : `${Math.round(hours).toLocaleString("en-US")} h`;
}

export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return DASH;
  if (usd >= 1000) return `$${Math.round(usd).toLocaleString("en-US")}`;
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  return `$${usd.toFixed(2)}`;
}

export function relativeTime(thenMs: number | null, nowMs: number): string {
  if (thenMs === null) return "Not updated yet";
  const minutes = Math.floor((nowMs - thenMs) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Updated yesterday" : `Updated ${days} days ago`;
}

function period(summary: Summary | null, key: PeriodKey): Period | null {
  return summary?.periods.find((p) => p?.key === key) ?? null;
}

/** One tip, preferring the week's (the most useful cadence), then today's, then the month's. */
export function pickTip(summary: Summary | null): { text: string; scope: string } | null {
  for (const key of ["week", "today", "month"] as const) {
    const tip = period(summary, key)?.tip;
    if (tip?.text) return { text: tip.text, scope: key === "week" ? "Tip for this week" : key === "today" ? "Tip for today" : "Tip for this month" };
  }
  return null;
}

export interface Column {
  label: string;
  sessions: string;
  active: string;
  cost: string;
}

export interface AgentLine {
  label: string;
  sessions: string;
  cost: string;
  measured: boolean;
}

export interface Notice {
  tone: "info" | "warn";
  title: string;
  body: string;
  /** A command the person can copy, shown in monospace. */
  command?: string;
}

export interface Model {
  updated: string;
  refreshing: boolean;
  tip: { text: string; scope: string } | null;
  empty: boolean;
  columns: Column[];
  showCost: boolean;
  costNote: string | null;
  agentsTitle: string;
  agents: AgentLine[];
  notice: Notice | null;
  /** True before the first answer arrives: the popover shows a quiet placeholder, not dashes. */
  loading: boolean;
  canOpenReport: boolean;
  /** Set by the page while the report is being written or opened. */
  openingReport: boolean;
  footnote: string | null;
}

const PROBLEMS: Record<Problem, Notice> = {
  cliMissing: {
    tone: "info",
    title: "Install the AI Insights CLI",
    body: "This app reads your history through the ai-insights command. Install it once, then press Refresh. Installed somewhere unusual? Set its path in Settings.",
    command: "npm i -g ai-insights",
  },
  timeout: {
    tone: "warn",
    title: "Reading your history took too long",
    body: "A large history can take a while the first time. The app tries again at the next refresh.",
  },
  failed: {
    tone: "warn",
    title: "AI Insights stopped with an error",
    body: "Run this in a terminal to see why:",
    command: "ai-insights summary",
  },
  badOutput: {
    tone: "warn",
    title: "The CLI answered in a way this app does not understand",
    body: "Your AI Insights CLI may be older or newer than this app. Updating it usually fixes this:",
    command: "npm i -g ai-insights@latest",
  },
  reportFailed: {
    tone: "warn",
    title: "Could not open the report",
    body: "Running AI Insights in a terminal writes the report and opens it:",
    command: "ai-insights",
  },
};

export function problemNotice(problem: Problem): Notice {
  return PROBLEMS[problem];
}

function agentLines(p: Period | null, showCost: boolean): AgentLine[] {
  if (!p) return [];
  return p.byAgent.map((row: AgentRow) => ({
    label: row.label,
    sessions: row.sessions === null ? DASH : `${formatCount(row.sessions)} ${row.sessions === 1 ? "session" : "sessions"}`,
    cost: !row.measured ? "not measured" : showCost ? formatCost(row.costUsd) : "",
    measured: row.measured,
  }));
}

function costNote(summary: Summary | null): string | null {
  const shares = ORDER.map((key) => period(summary, key)?.unpricedShare ?? 0);
  const worst = Math.max(...shares);
  if (worst >= UNPRICED_NOTE_AT) {
    return `Estimated from public API prices. Up to ${Math.round(worst * 100)}% of requests use models without a known price and are left out.`;
  }
  return "Estimated from public API prices, not your bill.";
}

export function buildModel(state: ViewState, nowMs: number): Model {
  const { snapshot, settings } = state;
  const summary = snapshot.summary;
  const showCost = !settings.hideCost;
  const week = period(summary, "week");
  const anySessions = ORDER.some((key) => (period(summary, key)?.sessions ?? 0) > 0);
  const empty = summary !== null && !anySessions;
  const notice = snapshot.problem ? problemNotice(snapshot.problem) : null;
  return {
    updated: snapshot.refreshing ? "Updating…" : relativeTime(snapshot.fetchedAt, nowMs),
    refreshing: snapshot.refreshing,
    tip: empty ? null : pickTip(summary),
    empty,
    columns: ORDER.map((key) => {
      const p = period(summary, key);
      return {
        label: PERIOD_LABELS[key],
        sessions: formatCount(p?.sessions),
        active: formatDuration(p?.activeMinutes),
        cost: formatCost(p?.costUsd),
      };
    }),
    showCost,
    costNote: showCost && summary ? costNote(summary) : null,
    agentsTitle: "This week by agent",
    agents: agentLines(week, showCost),
    notice,
    loading: summary === null && snapshot.problem === null,
    canOpenReport: snapshot.problem !== "cliMissing",
    openingReport: false,
    footnote: summary?.newerSchema ? "Your CLI is newer than this app. Some numbers may be missing until the app is updated." : null,
  };
}
