import { pathToFileURL } from "node:url";
import type { BuildReportInput, Report, Session } from "../schema/types.js";
import type { ScanResult } from "./scan.js";
import { sessionKey, type SavedReport, type Store } from "./store.js";

export type BuildReportFn = (input: BuildReportInput) => Report;
export type RenderReportFn = (report: Report) => string;

export interface PipelineDeps {
  store: Store;
  buildReport: BuildReportFn;
  renderReport: RenderReportFn;
  now?: () => Date;
  timeZone?: string;
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Every prompt was a slash command (`/mcp`, `/insights`): nothing the person asked the agent to do. */
export function isSlashCommandOnly(session: Session): boolean {
  return session.prompts.length > 0 && session.prompts.every((prompt) => prompt.text.trimStart().startsWith("/"));
}

/** Default floor of prompts for a session to be worth a facet. */
export const MIN_FACET_PROMPTS = 2;

/**
 * Messages that asked the agent for something: the person's prompts plus those another agent sent. A worker an
 * orchestrator drives may hold one typed prompt and many briefs; it is still a session worth judging.
 */
export function promptCount(session: Session): number {
  return session.userMessageCount + Math.max(0, session.agentMessageCount ?? 0);
}

/**
 * Whether a facet for this session belongs in the aggregates: the same rule the default facet listing applies.
 * Sessions with almost no prompts, or only slash commands, are not judged today; facets saved for them
 * earlier stay on disk but do not count.
 */
export function countsForFacets(session: Session): boolean {
  return promptCount(session) >= MIN_FACET_PROMPTS && !isSlashCommandOnly(session);
}

/** Builds the report from a scan plus whatever facets and narrative the model pass has saved. */
export async function buildFromScan(deps: PipelineDeps, result: ScanResult): Promise<{ report: Report; facetCount: number; hasNarrative: boolean }> {
  const keys = new Set(result.sessions.filter(countsForFacets).map((session) => sessionKey(session.harness, session.id)));
  const facets = await deps.store.listFacets(keys);
  const narrative = await deps.store.readNarrative();
  const report = deps.buildReport({
    sessions: result.sessions,
    facets,
    narrative,
    coverage: result.coverage,
    timeZone: deps.timeZone ?? localTimeZone(),
    now: deps.now?.() ?? new Date(),
  });
  return { report, facetCount: facets.length, hasNarrative: narrative !== null };
}

export interface RenderOutcome extends SavedReport {
  report: Report;
  url: string;
  facetCount: number;
  hasNarrative: boolean;
}

export async function renderFromScan(deps: PipelineDeps, result: ScanResult): Promise<RenderOutcome> {
  const built = await buildFromScan(deps, result);
  const html = deps.renderReport(built.report);
  const saved = await deps.store.saveReport(html, built.report, deps.now?.() ?? new Date());
  return { ...saved, ...built, url: pathToFileURL(saved.htmlPath).href };
}

export interface Headline {
  sessions: number;
  userPrompts: number;
  /** Summed over sessions, so parallel sessions add up. Not the person's time. */
  agentHours: number;
  toolCalls: number;
  toolErrors: number;
  modelRequests: number;
  tokens: number;
  firstSession: string | null;
  lastSession: string | null;
}

/** Numbers straight from the sessions, so a scan has something to say even before the analysis runs. */
export function headline(sessions: Session[]): Headline {
  let userPrompts = 0;
  let activeMinutes = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let modelRequests = 0;
  let tokens = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (const session of sessions) {
    userPrompts += session.userMessageCount || 0;
    activeMinutes += session.activeMinutes || 0;
    toolCalls += session.toolCalls.length;
    toolErrors += session.toolCalls.filter((call) => call.error).length;
    modelRequests += session.requests.length;
    for (const request of session.requests) {
      const usage = request.usage;
      tokens += (usage.input || 0) + (usage.cachedInput || 0) + (usage.cacheWrite || 0) + (usage.output || 0);
    }
    const start = Date.parse(session.startTime);
    const end = Date.parse(session.endTime);
    if (Number.isFinite(start)) first = first === null ? start : Math.min(first, start);
    if (Number.isFinite(end)) last = last === null ? end : Math.max(last, end);
  }
  return {
    sessions: sessions.length,
    userPrompts,
    agentHours: round1(activeMinutes / 60),
    toolCalls,
    toolErrors,
    modelRequests,
    tokens,
    firstSession: first === null ? null : new Date(first).toISOString(),
    lastSession: last === null ? null : new Date(last).toISOString(),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function hoursText(hours: number): string {
  return hours >= 10 ? Math.round(hours).toLocaleString("en-US") : String(round1(hours));
}

export function formatUsd(value: number): string {
  return value >= 100 ? `$${Math.round(value).toLocaleString("en-US")}` : `$${value.toFixed(2)}`;
}

export interface ReportHeadline {
  sessions: number;
  activeDays: number;
  /** Wall-clock hours with at least one session active; null when the analysis did not measure it. */
  activeHours: number | null;
  /** Summed session hours: parallel sessions add up. */
  agentHours: number;
  tokens: number;
  estimatedUsd: number | null;
  requests: number;
  unpricedRequests: number;
  /** 0..1 share of requests with no known price. */
  unpricedShare: number;
  /** Models behind most of the unpriced requests. */
  unpricedModels: string[];
  /** e.g. "about $1,633 for the requests we can price; 13% unpriced". Never a bare total when some usage is unpriced. */
  cost: string;
  /** e.g. "90 active hours (120 agent-hours across parallel sessions)". */
  time: string;
}

/**
 * The numbers people read first, phrased so they cannot mislead: time is
 * wall-clock when measured and summed time is called agent-hours; cost always
 * says how much could not be priced.
 */
export function describeHeadline(report: Report): ReportHeadline {
  const activity = report.activity;
  const usage = report.usage;
  const agentHours = round1(activity.totalActiveMinutes / 60);
  const wallClock = activity.wallClockActiveMinutes;
  const activeHours = typeof wallClock === "number" && Number.isFinite(wallClock) ? round1(wallClock / 60) : null;
  const requests = usage.requests || 0;
  const unpriced = Math.min(usage.unpriced || 0, requests);
  const unpricedShare = requests > 0 ? unpriced / requests : 0;
  const unpricedModels = [...usage.models]
    .filter((model) => model.unpriced > 0)
    .sort((a, b) => b.unpriced - a.unpriced)
    .slice(0, 3)
    .map((model) => model.model);

  let cost: string;
  if (usage.estimatedUsd === null) {
    cost = requests > 0 ? "cost unknown: none of the requests could be priced" : "no model requests to price";
  } else if (unpriced === 0) {
    cost = `about ${formatUsd(usage.estimatedUsd)} at API list prices`;
  } else {
    const percent = unpricedShare * 100;
    const share = percent < 1 ? "<1%" : `${Math.round(percent)}%`;
    cost = `about ${formatUsd(usage.estimatedUsd)} for the requests we can price; ${share} unpriced`;
  }

  const time =
    activeHours === null
      ? `${hoursText(agentHours)} agent-hours`
      : `${hoursText(activeHours)} active hours (${hoursText(agentHours)} agent-hours across parallel sessions)`;

  return {
    sessions: activity.sessions,
    activeDays: activity.activeDays,
    activeHours,
    agentHours,
    tokens: usage.tokens,
    estimatedUsd: usage.estimatedUsd,
    requests,
    unpricedRequests: unpriced,
    unpricedShare,
    unpricedModels,
    cost,
    time,
  };
}
