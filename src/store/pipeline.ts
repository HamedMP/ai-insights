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

/** Builds the report from a scan plus whatever facets and narrative the model pass has saved. */
export async function buildFromScan(deps: PipelineDeps, result: ScanResult): Promise<{ report: Report; facetCount: number; hasNarrative: boolean }> {
  const keys = new Set(result.sessions.map((session) => sessionKey(session.harness, session.id)));
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
  activeHours: number;
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
    activeHours: Math.round((activeMinutes / 60) * 10) / 10,
    toolCalls,
    toolErrors,
    modelRequests,
    tokens,
    firstSession: first === null ? null : new Date(first).toISOString(),
    lastSession: last === null ? null : new Date(last).toISOString(),
  };
}
