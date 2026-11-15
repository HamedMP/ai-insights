import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodError } from "zod";
import {
  FRICTION_TYPES,
  GOAL_CATEGORIES,
  HARNESSES,
  HELPFULNESS,
  OUTCOMES,
  SATISFACTION,
  SESSION_TYPES,
  SUCCESS_TYPES,
  SUGGESTION_TYPES,
  type Harness,
  type Report,
  type Session,
  type Source,
} from "../schema/types.js";
import { clean } from "../sources/shared.js";
import { buildFromScan, headline, renderFromScan, type BuildReportFn, type RenderReportFn } from "../store/pipeline.js";
import { scan, type ScanOptions, type ScanResult } from "../store/scan.js";
import { describeIssues, isSafeId } from "../store/schemas.js";
import { parseSince, SINCE_HELP } from "../store/since.js";
import { sessionKey, StoreError, type Store } from "../store/store.js";
import { fitJson } from "./bound.js";
import { packageVersion } from "./version.js";

export interface ServerDeps {
  sources: Source[];
  store: Store;
  buildReport: BuildReportFn;
  renderReport: RenderReportFn;
  now?: () => Date;
  timeZone?: string;
}

/** An error whose message is safe to show the agent as-is. */
class ToolError extends Error {}

const REPORT_SECTIONS = ["summary", "coverage", "activity", "usage", "findings", "facets", "narrative"] as const;
type ReportSection = (typeof REPORT_SECTIONS)[number];

const MAX_FACETS_PER_CALL = 50;

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: fitJson(value) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Turn any failure into a short message. Only our own errors and validation
 * issues pass their text through; anything else could carry paths or stacks.
 */
function safeMessage(error: unknown, action: string): string {
  if (error instanceof ToolError || error instanceof StoreError) return error.message;
  if (error instanceof ZodError) return `Invalid input: ${describeIssues(error)}`;
  return `Hindsight could not ${action}. Try again; if it keeps failing run \`hindsight doctor\` in a terminal.`;
}

function guarded<A>(action: string, handler: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await handler(args);
    } catch (error) {
      return fail(safeMessage(error, action));
    }
  };
}

function since(value: string | undefined, now: Date): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = parseSince(value, now);
  if (!parsed) throw new ToolError(`since must be ${SINCE_HELP}.`);
  return parsed;
}

/** Last two path segments: enough to recognise a project without dumping a home directory. */
function shortProject(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join("/") || null;
}

const taxonomy = [
  `goalCategories (1-5 of): ${GOAL_CATEGORIES.join(", ")}`,
  `sessionType: ${SESSION_TYPES.join(", ")}`,
  `outcome: ${OUTCOMES.join(", ")}`,
  `helpfulness: ${HELPFULNESS.join(", ")}`,
  `satisfaction: ${SATISFACTION.join(", ")}`,
  `primarySuccess: null or one of ${SUCCESS_TYPES.join(", ")}`,
  `frictions: object mapping any of ${FRICTION_TYPES.join(", ")} to a count (use {} when there was none)`,
].join("\n");

const harnessArg = z.enum(HARNESSES).optional().describe("Limit to one harness.");
const sinceArg = z.string().max(40).optional().describe(`Only history from this window: ${SINCE_HELP}.`);

class ServerState {
  last: ScanResult | null = null;
  private inflight: Promise<ScanResult> | null = null;

  constructor(private readonly deps: ServerDeps) {}

  now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async runScan(options: ScanOptions): Promise<ScanResult> {
    if (this.inflight) await this.inflight.catch(() => undefined);
    this.inflight = scan({ sources: this.deps.sources, store: this.deps.store }, options);
    try {
      this.last = await this.inflight;
      return this.last;
    } finally {
      this.inflight = null;
    }
  }

  /** The most recent scan, running a default one first if none has happened in this process. */
  async current(): Promise<ScanResult> {
    if (this.inflight) return this.inflight;
    return this.last ?? this.runScan({});
  }

  async report(result: ScanResult): Promise<{ report: Report; facetCount: number; hasNarrative: boolean }> {
    try {
      return await buildFromScan(this.deps, result);
    } catch {
      throw new ToolError("The analysis step failed while building the report. The scan data is still available through hindsight_sessions.");
    }
  }

  findSession(result: ScanResult, id: string, harness?: Harness): Session {
    if (!isSafeId(id)) throw new ToolError("sessionId is not a valid session id. Use an id from hindsight_sessions.");
    const matches = result.sessions.filter((session) => session.id === id && (!harness || session.harness === harness));
    if (matches.length === 0) {
      throw new ToolError("No session with that id in the current scan. Call hindsight_sessions to list ids, or hindsight_scan with a wider window.");
    }
    if (matches.length > 1) throw new ToolError("That id exists in more than one harness; pass harness as well.");
    return matches[0]!;
  }
}

function summarySection(report: Report, facetCount: number, hasNarrative: boolean) {
  return {
    generatedAt: report.generatedAt,
    timeZone: report.timeZone,
    range: report.range,
    sessions: report.activity.sessions,
    activeDays: report.activity.activeDays,
    longestStreakDays: report.activity.longestStreakDays,
    activeHours: Math.round((report.activity.totalActiveMinutes / 60) * 10) / 10,
    userMessages: report.activity.userMessages,
    tokens: report.usage.tokens,
    estimatedUsd: report.usage.estimatedUsd,
    cacheHitRate: report.usage.cacheHitRate,
    findings: report.findings.length,
    findingsBySeverity: countBy(report.findings.map((finding) => finding.severity)),
    sessionsWithFacets: facetCount,
    hasNarrative,
  };
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

export function createServer(deps: ServerDeps): McpServer {
  const state = new ServerState(deps);
  const server = new McpServer(
    { name: "hindsight", version: packageVersion() },
    {
      instructions:
        "Hindsight reads this person's local coding-agent history. Everything stays on this machine. " +
        "Typical flow: hindsight_scan, hindsight_report (findings), hindsight_sessions with missingFacets, " +
        "hindsight_excerpt + hindsight_save_facets per session, hindsight_save_narrative, then hindsight_render.",
    },
  );

  server.registerTool(
    "hindsight_scan",
    {
      title: "Scan agent history",
      description:
        "Start here. Finds and parses local Claude Code, Codex and other agent transcripts (cached, so repeat calls are fast), " +
        "then returns which harnesses were found, how far back history goes, and headline numbers. " +
        "Later tools use the most recent scan, so call this again to change the time window or harness filter.",
      inputSchema: {
        since: sinceArg,
        harness: harnessArg,
        maxSessions: z.number().int().min(1).max(50_000).optional().describe("Read at most this many transcripts, newest first. Default 5000."),
        refresh: z.boolean().optional().describe("Re-parse every transcript, ignoring the cache."),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    guarded("scan the history", async (args) => {
      const now = state.now();
      const result = await state.runScan({
        ...(args.since !== undefined ? { since: since(args.since, now) } : {}),
        ...(args.harness ? { harness: args.harness } : {}),
        ...(args.maxSessions ? { maxSessions: args.maxSessions } : {}),
        ...(args.refresh ? { refresh: true } : {}),
      });
      const facetIds = await deps.store.facetIds();
      const withFacets = result.sessions.filter((session) => facetIds.get(session.harness)?.has(session.id)).length;
      let analysis: Record<string, unknown> | null = null;
      try {
        const { report } = await buildFromScan(deps, result);
        analysis = {
          findings: report.findings.length,
          estimatedUsd: report.usage.estimatedUsd,
          cacheHitRate: report.usage.cacheHitRate,
          activeDays: report.activity.activeDays,
        };
      } catch {
        analysis = null;
      }
      return ok({
        coverage: result.coverage.map((entry) => ({
          harness: entry.harness,
          label: entry.label,
          found: entry.found,
          sessions: entry.sessions,
          files: entry.files,
          issues: entry.issues,
          oldest: entry.oldest,
          newest: entry.newest,
        })),
        headline: headline(result.sessions),
        analysis,
        facets: { saved: withFacets, missing: result.sessions.length - withFacets },
        scan: { ...result.stats, options: result.options },
        next:
          result.sessions.length === 0
            ? "No sessions found. Run hindsight_scan with a wider since window, or check `hindsight doctor`."
            : "Call hindsight_report for findings, then hindsight_sessions with missingFacets: true to start the qualitative pass.",
      });
    }),
  );

  server.registerTool(
    "hindsight_report",
    {
      title: "Get the deterministic report",
      description:
        "The computed report for the current scan as JSON: no model involved. Ask only for the sections you need " +
        `(${REPORT_SECTIONS.join(", ")}); the default is summary and findings. Findings carry evidence with session ids you can pass to hindsight_excerpt.`,
      inputSchema: {
        sections: z.array(z.enum(REPORT_SECTIONS)).min(1).max(REPORT_SECTIONS.length).optional().describe("Sections to return. Default [\"summary\", \"findings\"]."),
        findingsLimit: z.number().int().min(1).max(100).optional().describe("Most findings to return, highest severity first. Default 20."),
        evidenceLimit: z.number().int().min(0).max(20).optional().describe("Evidence items per finding. Default 5."),
        days: z.number().int().min(1).max(400).optional().describe("Most recent days kept in daily series. Default 60."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded("build the report", async (args) => {
      const result = await state.current();
      const { report, facetCount, hasNarrative } = await state.report(result);
      const sections = new Set<ReportSection>(args.sections ?? ["summary", "findings"]);
      const days = args.days ?? 60;
      const out: Record<string, unknown> = {};
      if (sections.has("summary")) out.summary = summarySection(report, facetCount, hasNarrative);
      if (sections.has("coverage")) out.coverage = report.coverage;
      if (sections.has("activity")) {
        out.activity = { ...report.activity, daily: report.activity.daily.slice(-days), projects: report.activity.projects.slice(0, 25) };
      }
      if (sections.has("usage")) out.usage = { ...report.usage, daily: report.usage.daily.slice(-days) };
      if (sections.has("findings")) {
        const rank = { high: 0, medium: 1, low: 2, info: 3 } as const;
        const findings = [...report.findings].sort((a, b) => rank[a.severity] - rank[b.severity]);
        const limit = args.findingsLimit ?? 20;
        const evidenceLimit = args.evidenceLimit ?? 5;
        out.findings = findings.slice(0, limit).map((finding) => ({
          ...finding,
          evidence: finding.evidence.slice(0, evidenceLimit),
          ...(finding.evidence.length > evidenceLimit ? { evidenceTruncated: finding.evidence.length - evidenceLimit } : {}),
        }));
        if (findings.length > limit) out.findingsTruncated = findings.length - limit;
      }
      if (sections.has("facets")) out.facets = report.facets;
      if (sections.has("narrative")) out.narrative = report.narrative;
      return ok(out);
    }),
  );

  server.registerTool(
    "hindsight_sessions",
    {
      title: "List sessions",
      description:
        "Sessions from the current scan, newest first, with counts and whether a facet has been saved. " +
        "Use missingFacets: true to get the next batch to analyse with hindsight_excerpt and hindsight_save_facets. Paginate with offset.",
      inputSchema: {
        harness: harnessArg,
        missingFacets: z.boolean().optional().describe("Only sessions with no saved facet yet."),
        minUserMessages: z.number().int().min(0).max(10_000).optional().describe("Skip sessions with fewer user prompts than this."),
        limit: z.number().int().min(1).max(100).optional().describe("Page size. Default 20."),
        offset: z.number().int().min(0).optional().describe("Skip this many matching sessions."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded("list sessions", async (args) => {
      const result = await state.current();
      const facetIds = await deps.store.facetIds();
      const hasFacet = (session: Session) => facetIds.get(session.harness)?.has(session.id) ?? false;
      const matching = result.sessions.filter(
        (session) =>
          (!args.harness || session.harness === args.harness) &&
          (!args.missingFacets || !hasFacet(session)) &&
          (args.minUserMessages === undefined || session.userMessageCount >= args.minUserMessages),
      );
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 20;
      const page = matching.slice(offset, offset + limit);
      return ok({
        total: matching.length,
        offset,
        nextOffset: offset + page.length < matching.length ? offset + page.length : null,
        sessions: page.map((session) => ({
          id: session.id,
          harness: session.harness,
          project: shortProject(session.projectPath),
          start: session.startTime,
          durationMinutes: session.durationMinutes,
          activeMinutes: session.activeMinutes,
          userMessages: session.userMessageCount,
          toolCalls: session.toolCalls.length,
          toolErrors: session.toolCalls.filter((call) => call.error).length,
          hasFacet: hasFacet(session),
          firstPrompt: session.prompts[0] ? clean(session.prompts[0].text, 160) : null,
        })),
      });
    }),
  );

  server.registerTool(
    "hindsight_excerpt",
    {
      title: "Read a session excerpt",
      description:
        "A redacted, truncated slice of one session's transcript (user, assistant and tool turns) plus its numbers. " +
        "Read it to judge the session, then save one facet with hindsight_save_facets. Secrets are redacted; do not try to recover them.",
      inputSchema: {
        sessionId: z.string().min(1).max(200).describe("Session id from hindsight_sessions or a finding's evidence."),
        harness: harnessArg,
        maxTurns: z.number().int().min(1).max(80).optional().describe("Default 40."),
        maxCharsPerTurn: z.number().int().min(100).max(4000).optional().describe("Default 1200."),
        around: z.string().max(40).optional().describe("ISO timestamp: keep the turns closest to it, e.g. a finding's evidence timestamp."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded("read that session", async (args) => {
      const result = await state.current();
      const session = state.findSession(result, args.sessionId, args.harness);
      const file = result.files.get(sessionKey(session.harness, session.id));
      const source = deps.sources.find((candidate) => candidate.harness === session.harness);
      if (!file || !source) throw new ToolError("The transcript for that session is no longer available. Run hindsight_scan again.");
      const maxTurns = args.maxTurns ?? 40;
      const maxChars = args.maxCharsPerTurn ?? 1200;
      let turns;
      try {
        turns = await source.excerpt(file, { maxTurns, maxCharsPerTurn: maxChars, ...(args.around ? { around: args.around } : {}) });
      } catch {
        throw new ToolError("Could not read that transcript. It may have been moved or deleted; run hindsight_scan again.");
      }
      const hasFacet = (await deps.store.facetIds()).get(session.harness)?.has(session.id) ?? false;
      return ok({
        session: {
          id: session.id,
          harness: session.harness,
          project: shortProject(session.projectPath),
          start: session.startTime,
          end: session.endTime,
          durationMinutes: session.durationMinutes,
          activeMinutes: session.activeMinutes,
          models: session.models.slice(0, 10),
          userMessages: session.userMessageCount,
          toolCalls: session.toolCalls.length,
          toolErrors: session.toolCalls.filter((call) => call.error).length,
          linesAdded: session.linesAdded,
          linesRemoved: session.linesRemoved,
          gitCommits: session.gitCommits,
          compactions: session.features.compactions,
          hasFacet,
        },
        turns: (Array.isArray(turns) ? turns : []).slice(0, maxTurns).map((turn) => ({
          timestamp: turn.timestamp,
          role: turn.role,
          ...(turn.toolName ? { toolName: clean(turn.toolName, 80) } : {}),
          ...(turn.isError ? { isError: true } : {}),
          // Sources redact already; doing it again here costs little and guards against a source bug.
          text: clean(String(turn.text ?? ""), maxChars),
        })),
      });
    }),
  );

  server.registerTool(
    "hindsight_save_facets",
    {
      title: "Save session facets",
      description:
        "Save your judgement of one or more sessions (up to 50 per call), one facet per session, using only the fixed taxonomy below. " +
        "Valid facets are saved even if others in the batch are rejected; each rejection says what to fix. Saving again overwrites.\n" +
        "Fields: sessionId, harness, underlyingGoal (what the person wanted, one sentence), goalCategories, sessionType, outcome, helpfulness, " +
        "satisfaction, primarySuccess, frictions, frictionDetail (one or two sentences, may be empty), summary (one or two sentences).\n" +
        taxonomy,
      inputSchema: {
        facets: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .max(MAX_FACETS_PER_CALL)
          .describe("Facet objects with the fields listed in the tool description."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded("save the facets", async (args) => {
      const result = await state.current();
      const known = new Set(result.sessions.map((session) => sessionKey(session.harness, session.id)));
      const saved: string[] = [];
      const rejected: Array<{ index: number; sessionId: string | null; error: string }> = [];
      for (const [index, input] of args.facets.entries()) {
        const sessionId = typeof input.sessionId === "string" && isSafeId(input.sessionId) ? input.sessionId : null;
        try {
          if (typeof input.harness === "string" && sessionId && !known.has(`${input.harness}:${sessionId}`)) {
            throw new ToolError("no session with this sessionId and harness in the current scan; check hindsight_sessions");
          }
          const facet = await deps.store.saveFacet(input);
          saved.push(facet.sessionId);
        } catch (error) {
          const message = error instanceof ZodError ? describeIssues(error) : safeMessage(error, "save this facet");
          rejected.push({ index, sessionId, error: message });
        }
      }
      const facetIds = await deps.store.facetIds();
      const remaining = result.sessions.filter((session) => !facetIds.get(session.harness)?.has(session.id)).length;
      return {
        ...ok({ saved, rejected, sessionsStillMissingFacets: remaining }),
        ...(saved.length === 0 ? { isError: true } : {}),
      };
    }),
  );

  server.registerTool(
    "hindsight_save_narrative",
    {
      title: "Save the report narrative",
      description:
        "Save the written narrative shown at the top of the report, after facets are saved. Base it on hindsight_report " +
        "(summary, findings, facets sections). Saving again replaces it. Shape: headline (2-3 sentences); workAreas [{name, sessions, description}] (max 12); " +
        "interactionStyle (a short paragraph); wins [{title, description}]; frictions [{title, description, examples: string[]}]; " +
        `suggestions [{type: ${SUGGESTION_TYPES.join("|")}, title, action, instructionText?, url? (http/https only)}] (max 15); ` +
        "horizon [{title, description, starterPrompt?}] (max 8).",
      inputSchema: {
        narrative: z.record(z.string(), z.unknown()).describe("The narrative object described in the tool description."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded("save the narrative", async (args) => {
      await deps.store.saveNarrative(args.narrative);
      return ok({ saved: true, next: "Call hindsight_render to write the HTML report." });
    }),
  );

  server.registerTool(
    "hindsight_render",
    {
      title: "Render the HTML report",
      description:
        "Build the report from the current scan plus saved facets and narrative, write one self-contained HTML file locally, " +
        "and return its path and file:// URL to give the person. Works before the qualitative pass too (deterministic sections only).",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded("render the report", async () => {
      const result = await state.current();
      let outcome;
      try {
        outcome = await renderFromScan(deps, result);
      } catch {
        throw new ToolError("Could not build or write the report. Run `hindsight doctor` in a terminal to check the setup.");
      }
      const rank = { high: 0, medium: 1, low: 2, info: 3 } as const;
      return ok({
        path: outcome.htmlPath,
        url: outcome.url,
        sessions: outcome.report.activity.sessions,
        sessionsWithFacets: outcome.facetCount,
        hasNarrative: outcome.hasNarrative,
        topFindings: [...outcome.report.findings]
          .sort((a, b) => rank[a.severity] - rank[b.severity])
          .slice(0, 3)
          .map((finding) => ({ title: finding.title, severity: finding.severity, suggestion: finding.suggestion?.action ?? null })),
      });
    }),
  );

  return server;
}

/** Serve over stdio. Writes nothing to stdout except protocol frames. */
export async function startStdioServer(deps: ServerDeps): Promise<McpServer> {
  const server = createServer(deps);
  await server.connect(new StdioServerTransport());
  return server;
}
