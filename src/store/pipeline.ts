import { pathToFileURL } from "node:url";
import { isChatHarness, type AnalysisStep, type BuildReportInput, type RenderExtras, type Report, type RunSnapshot, type Session } from "../schema/types.js";
import { notify, type ScanResult } from "./scan.js";
import { compareRuns, loadRuns, makeSnapshot, saveSnapshot } from "./snapshots.js";
import { sessionKey, type SavedReport, type Store } from "./store.js";

export type BuildReportFn = (input: BuildReportInput) => Report;
/** A renderer may ignore `extras`; it holds the saved runs for showing change over time. */
export type RenderReportFn = (report: Report, extras?: RenderExtras) => string;

export interface PipelineDeps {
  store: Store;
  buildReport: BuildReportFn;
  renderReport: RenderReportFn;
  now?: () => Date;
  timeZone?: string;
  /** Told when the analysis and the report writing start, for a progress display. A callback that throws is ignored. */
  onProgress?: (event: PipelineProgress) => void;
}

export type PipelineProgress = { stage: "analyse"; sessions: number; step?: AnalysisStep } | { stage: "write" };

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
  notify(deps.onProgress, { stage: "analyse", sessions: result.sessions.length });
  const keys = new Set(result.sessions.filter(countsForFacets).map((session) => sessionKey(session.harness, session.id)));
  const facets = await deps.store.listFacets(keys);
  const narrative = await deps.store.readNarrative();
  const onStep = deps.onProgress ? (step: AnalysisStep) => notify(deps.onProgress, { stage: "analyse", sessions: result.sessions.length, step }) : undefined;
  const report = deps.buildReport({
    ...(onStep ? { onStep } : {}),
    sessions: result.sessions,
    facets,
    narrative,
    coverage: result.coverage,
    timeZone: deps.timeZone ?? localTimeZone(),
    now: deps.now?.() ?? new Date(),
    ...(result.retention ? { retention: result.retention } : {}),
  });
  return { report, facetCount: facets.length, hasNarrative: narrative !== null };
}

export interface RenderOutcome extends SavedReport {
  report: Report;
  url: string;
  facetCount: number;
  hasNarrative: boolean;
  /** Saved runs, oldest first, this one last. */
  runs: RunSnapshot[];
}

/**
 * Saves this run's snapshot and returns every run up to it, this one last. A failure to save or read history
 * costs only the comparison, never the report.
 */
export async function recordRun(store: Store, report: Report, now: Date): Promise<RenderExtras> {
  const snapshot = makeSnapshot(report);
  let saved: RunSnapshot[] = [];
  try {
    await saveSnapshot(store.home, snapshot, now);
    saved = await loadRuns(store.home);
  } catch {
    // An unwritable or unreadable snapshots folder loses the comparison, not the report; this run still shows alone.
    saved = [];
  }
  const at = Date.parse(snapshot.generatedAt);
  const runs = [...saved.filter((run) => run.id !== snapshot.id && Date.parse(run.generatedAt) < at), snapshot];
  const previous = runs.at(-2);
  return previous ? { runs, comparison: compareRuns(previous, snapshot) } : { runs };
}

export async function renderFromScan(deps: PipelineDeps, result: ScanResult): Promise<RenderOutcome> {
  const built = await buildFromScan(deps, result);
  const now = deps.now?.() ?? new Date();
  const extras = await recordRun(deps.store, built.report, now);
  try {
    extras.deviceId = await deps.store.deviceId();
  } catch (error) {
    // An unwritable store loses only the device id: the share link then publishes without one, as before 0.5.
    if (!(error instanceof Error)) throw error;
  }
  notify(deps.onProgress, { stage: "write" });
  const html = deps.renderReport(built.report, extras);
  const saved = await deps.store.saveReport(html, built.report, now);
  return { ...saved, ...built, runs: extras.runs ?? [], url: pathToFileURL(saved.htmlPath).href };
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
  /** Sessions from chat exports, which record no tokens: their usage is not measured, not zero. */
  unmeasuredSessions: number;
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
  let unmeasuredSessions = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (const session of sessions) {
    userPrompts += session.userMessageCount || 0;
    if (isChatHarness(session.harness)) unmeasuredSessions += 1;
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
    unmeasuredSessions,
    firstSession: first === null ? null : new Date(first).toISOString(),
    lastSession: last === null ? null : new Date(last).toISOString(),
  };
}

/**
 * "12.3M tokens", said honestly when chat exports are in the history: they record no tokens, so a history of only
 * chats has tokens "not measured", never 0, and a mixed one says the count covers the coding agents only.
 */
export function tokensPhrase(tokens: number, unmeasuredSessions: number, sessions: number, compact: (value: number) => string): string {
  if (unmeasuredSessions > 0 && unmeasuredSessions >= sessions) return "tokens not measured (chat exports record none)";
  const count = `${compact(tokens)} tokens`;
  return unmeasuredSessions > 0 ? `${count} (coding agents; chat not measured)` : count;
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
  /** Sessions from chat exports: no tokens or cost recorded, so not measured. */
  unmeasuredSessions: number;
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

  const unmeasuredSessions = activity.byHarness.filter((row) => isChatHarness(row.harness)).reduce((sum, row) => sum + row.sessions, 0);
  const chatOnly = unmeasuredSessions > 0 && unmeasuredSessions >= activity.sessions;
  let cost: string;
  if (chatOnly && requests === 0) {
    cost = "cost not measured";
  } else if (usage.estimatedUsd === null) {
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
    unmeasuredSessions,
  };
}
