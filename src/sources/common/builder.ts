import type {
  Harness,
  ModelRequest,
  Session,
  SessionFile,
  TokenUsage,
  ToolCall,
  ToolCategory,
  ToolErrorCategory,
  TranscriptTurn,
  UserPrompt,
} from "../../schema/types.js";
import { isAgentMessageText } from "../claude/classify.js";
import { gitOperations } from "../codex/tools.js";
import { activeMinutes, languageForPath, scrub } from "../shared.js";

/**
 * A harness-neutral accumulator for the sources added after Claude Code and Codex. Each source maps its own
 * records onto these calls; the builder owns the caps, the redaction and the derived numbers, so every
 * harness reports response times, lines changed and features the same way.
 */

export const CAPS = {
  prompts: 2_000,
  promptChars: 2_000,
  commandChars: 300,
  pathChars: 1_024,
  nameChars: 200,
  toolCalls: 20_000,
  requests: 50_000,
  responseTimes: 5_000,
  filesModified: 2_000,
  timestamps: 200_000,
  featureList: 200,
  turns: 20_000,
};

export type Obj = Record<string, unknown>;

export const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
export const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** A token counter: a finite, non-negative integer, else 0. */
export function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e12 ? Math.floor(value) : 0;
}

/** ISO string for an epoch-milliseconds number or a parseable date string, else null. */
export function isoFrom(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Seconds, not milliseconds: anything before 2001 in ms is really a seconds stamp.
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value === "string" && value.length <= 64) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  return null;
}

export interface ToolInput {
  name: string;
  category: ToolCategory;
  timestamp: string;
  error?: ToolErrorCategory;
  /** Raw shell command; redacted and capped here. Git commits and pushes are counted from it. */
  command?: string;
  filePath?: string;
  mcpServer?: string;
  skill?: string;
  /** Edit tools: the file this call changed and the lines it added and removed. */
  modified?: { path: string; added: number; removed: number };
}

export interface TurnInput {
  role: TranscriptTurn["role"];
  timestamp: string;
  text: string;
  toolName?: string;
  isError?: boolean;
}

export interface BuilderOptions {
  /** Collect transcript turns for an excerpt, each cut to this many characters before scrubbing. */
  turnChars?: number;
}

export class SessionBuilder {
  issues = 0;
  projectPath: string | null = null;
  gitBranch: string | null = null;
  permissionMode: string | null = null;
  planMode = false;
  compactions = 0;
  subagents = 0;
  agentMessageCount = 0;
  readonly turns: TranscriptTurn[] = [];

  private readonly models = new Set<string>();
  private readonly prompts: UserPrompt[] = [];
  private userMessageCount = 0;
  private assistantMessageCount = 0;
  private readonly requests: ModelRequest[] = [];
  private readonly requestIds = new Set<string>();
  private readonly toolCalls: ToolCall[] = [];
  private readonly edits = new Map<number, { path: string; added: number; removed: number }>();
  private readonly responseTimes: number[] = [];
  private readonly times: string[] = [];
  private readonly mcpServers = new Set<string>();
  private readonly skills = new Set<string>();
  private readonly slashCommands = new Set<string>();
  private readonly slashCounts = new Map<string, number>();
  private toolCallsDropped = 0;
  private start: number | null = null;
  private end: number | null = null;
  private lastAssistantTime: string | null = null;
  /** The agent spoke since the last prompt and had not finished its turn: a prompt now is an interruption. */
  private midTurn = false;
  private assistantSincePrompt = false;
  private gitCommits = 0;
  private gitPushes = 0;
  private thinking = { blocks: 0, totalMs: 0, longestMs: 0, timed: false };

  constructor(
    readonly harness: Harness,
    private readonly options: BuilderOptions = {},
  ) {}

  /** Any moment the session was active. */
  noteTime(timestamp: string | null): void {
    if (!timestamp) return;
    const ms = Date.parse(timestamp);
    if (!Number.isFinite(ms)) return;
    if (this.start === null || ms < this.start) this.start = ms;
    if (this.end === null || ms > this.end) this.end = ms;
    if (this.times.length < CAPS.timestamps) this.times.push(timestamp);
  }

  noteModel(model: string): void {
    const name = model.trim().slice(0, CAPS.nameChars);
    if (name && this.models.size < CAPS.featureList) this.models.add(name);
  }

  addSlashCommand(name: string): void {
    const clean = name.trim().slice(0, CAPS.nameChars);
    if (clean && this.slashCommands.size < CAPS.featureList) this.slashCommands.add(clean);
  }

  addSkill(name: string): void {
    const clean = name.trim().slice(0, CAPS.nameChars);
    if (clean && this.skills.size < CAPS.featureList) this.skills.add(clean);
  }

  /**
   * Something typed into the session. Text another agent injected (an orchestrator relay) counts as an agent
   * message, never as the person's prompt. Returns the stored text, or null when nothing was kept.
   */
  prompt(timestamp: string | null, raw: string, options: { interrupted?: boolean } = {}): string | null {
    const text = raw.trim();
    if (!text) return null;
    if (!timestamp) {
      this.issues += 1;
      return null;
    }
    if (isAgentMessageText(text)) {
      this.agentMessageCount += 1;
      this.noteTime(timestamp);
      this.turn({ role: "agent", timestamp, text });
      return null;
    }
    const cleaned = scrub(text, CAPS.promptChars);
    if (!cleaned) return null;
    this.noteTime(timestamp);
    const slash = /^\/([A-Za-z][\w:.-]{0,60})(?:\s|$)/.exec(text);
    if (slash) {
      const name = `/${slash[1]}`;
      this.addSlashCommand(name);
      if (this.slashCounts.has(name) || this.slashCounts.size < CAPS.featureList) this.slashCounts.set(name, (this.slashCounts.get(name) ?? 0) + 1);
    }
    const interrupted = options.interrupted === true || (this.assistantSincePrompt && this.midTurn);
    if (!interrupted && this.assistantSincePrompt && this.lastAssistantTime) {
      const gap = (Date.parse(timestamp) - Date.parse(this.lastAssistantTime)) / 1000;
      if (gap >= 0 && this.responseTimes.length < CAPS.responseTimes) this.responseTimes.push(Math.round(gap * 10) / 10);
    }
    this.userMessageCount += 1;
    if (this.prompts.length < CAPS.prompts) {
      const prompt: UserPrompt = { timestamp, text: cleaned };
      if (interrupted) prompt.interrupted = true;
      this.prompts.push(prompt);
    }
    this.turn({ role: "user", timestamp, text });
    this.assistantSincePrompt = false;
    this.midTurn = false;
    return cleaned;
  }

  /** One assistant message. `finished` is false while the agent is still working (it asked for a tool). */
  assistant(timestamp: string | null, options: { model?: string; finished?: boolean; endedAt?: string | null } = {}): void {
    this.assistantMessageCount += 1;
    if (options.model) this.noteModel(options.model);
    if (!timestamp) return;
    this.noteTime(timestamp);
    this.noteTime(options.endedAt ?? null);
    this.lastAssistantTime = options.endedAt ?? timestamp;
    this.assistantSincePrompt = true;
    this.midTurn = options.finished === false;
  }

  /** The agent's turn ended (a final answer, an error, an abort). */
  turnEnded(): void {
    this.midTurn = false;
  }

  request(id: string, timestamp: string | null, model: string, usage: TokenUsage, costUsd?: number): void {
    if (!timestamp || !id || this.requestIds.has(id) || this.requests.length >= CAPS.requests) return;
    const total = usage.input + usage.cachedInput + usage.cacheWrite + usage.output;
    if (total <= 0 && !(costUsd && costUsd > 0)) return;
    this.requestIds.add(id);
    const request: ModelRequest = { id: id.slice(0, CAPS.nameChars), timestamp, model: model.slice(0, CAPS.nameChars) || "unknown", usage };
    if (typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd >= 0 && costUsd < 1e7) request.costUsd = costUsd;
    this.requests.push(request);
    this.noteModel(request.model);
  }

  tool(input: ToolInput): void {
    if (this.toolCalls.length >= CAPS.toolCalls) {
      this.issues += 1;
      this.toolCallsDropped += 1;
      return;
    }
    const call: ToolCall = { name: input.name.slice(0, CAPS.nameChars) || "unknown", category: input.category, timestamp: input.timestamp };
    if (input.error) call.error = input.error;
    if (input.command) {
      const command = scrub(input.command, CAPS.commandChars);
      if (command) call.command = command;
    }
    if (input.filePath) call.filePath = input.filePath.slice(0, CAPS.pathChars);
    if (input.mcpServer) {
      call.mcpServer = input.mcpServer.slice(0, CAPS.nameChars);
      if (this.mcpServers.size < CAPS.featureList) this.mcpServers.add(call.mcpServer);
    }
    if (input.skill) {
      call.skill = input.skill.slice(0, CAPS.nameChars);
      this.addSkill(call.skill);
    }
    if (input.category === "subagent") this.subagents += 1;
    this.noteTime(input.timestamp);
    const index = this.toolCalls.push(call) - 1;
    if (input.modified && !input.error) this.edits.set(index, { ...input.modified, path: input.modified.path.slice(0, CAPS.pathChars) });
    if (input.command && !input.error) {
      const git = gitOperations(input.command);
      this.gitCommits += git.commits;
      this.gitPushes += git.pushes;
    }
  }

  /** Keep a turn for excerpts. Text is cut before scrubbing so a 5 MB tool output costs nothing. */
  turn(input: TurnInput): void {
    const max = this.options.turnChars;
    if (max === undefined || this.turns.length >= CAPS.turns) return;
    const text = input.text.length > max * 4 ? input.text.slice(0, max * 4) : input.text;
    const turn: TranscriptTurn = { timestamp: input.timestamp, role: input.role, text };
    if (input.toolName) turn.toolName = input.toolName.slice(0, CAPS.nameChars);
    if (input.isError) turn.isError = true;
    this.turns.push(turn);
  }

  get collectingTurns(): boolean {
    return this.options.turnChars !== undefined;
  }

  /**
   * One stretch of model thinking: an assistant message holding a thinking block (Pi) or one reasoning part
   * (OpenCode, Gemini thoughts). `ms` is its duration when the harness recorded one.
   */
  thought(ms: number | null = null): void {
    this.thinking.blocks += 1;
    if (ms !== null && Number.isFinite(ms) && ms >= 0 && ms < 86_400_000) {
      this.thinking.timed = true;
      this.thinking.totalMs += ms;
      this.thinking.longestMs = Math.max(this.thinking.longestMs, ms);
    }
  }

  /** Null when the transcript held nothing a person or model said. */
  build(file: SessionFile, id: string): Session | null {
    if (this.start === null || this.end === null) return null;
    if (this.userMessageCount === 0 && this.assistantMessageCount === 0 && this.requests.length === 0) return null;
    let linesAdded = 0;
    let linesRemoved = 0;
    const filesModified = new Set<string>();
    const languages: Record<string, number> = {};
    this.toolCalls.forEach((call, index) => {
      if (call.filePath) {
        const language = languageForPath(call.filePath);
        if (language) languages[language] = (languages[language] ?? 0) + 1;
      }
      const edit = this.edits.get(index);
      if (!edit) return;
      linesAdded += edit.added;
      linesRemoved += edit.removed;
      if (filesModified.size < CAPS.filesModified) filesModified.add(edit.path);
    });
    const webTools = this.toolCalls.filter((call) => call.category === "web");
    this.requests.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return {
      id,
      harness: this.harness,
      sourcePath: file.path,
      sourceMtimeMs: file.mtimeMs,
      projectPath: this.projectPath,
      gitBranch: this.gitBranch,
      startTime: new Date(this.start).toISOString(),
      endTime: new Date(this.end).toISOString(),
      durationMinutes: Math.round((this.end - this.start) / 60_000),
      activeMinutes: activeMinutes(this.times),
      models: [...this.models],
      permissionMode: this.permissionMode,
      userMessageCount: this.userMessageCount,
      assistantMessageCount: this.assistantMessageCount,
      prompts: this.prompts,
      ...(this.agentMessageCount > 0 ? { agentMessageCount: this.agentMessageCount } : {}),
      userResponseTimesSec: this.responseTimes,
      requests: this.requests,
      toolCalls: this.toolCalls,
      features: {
        mcpServers: [...this.mcpServers],
        skills: [...this.skills],
        slashCommands: [...this.slashCommands],
        subagents: this.subagents,
        planMode: this.planMode,
        webSearch: webTools.some((call) => /search/i.test(call.name)),
        webFetch: webTools.some((call) => !/search/i.test(call.name)),
        compactions: this.compactions,
        ...(this.slashCounts.size ? { slashCommandCounts: Object.fromEntries(this.slashCounts) } : {}),
      },
      linesAdded,
      linesRemoved,
      filesModified: [...filesModified],
      languages,
      gitCommits: this.gitCommits,
      gitPushes: this.gitPushes,
      issues: this.issues,
      ...(this.toolCallsDropped ? { toolCallsDropped: this.toolCallsDropped } : {}),
      ...(this.thinking.blocks
        ? {
            thinking: {
              blocks: this.thinking.blocks,
              totalMs: this.thinking.timed ? Math.round(this.thinking.totalMs) : null,
              longestMs: this.thinking.timed ? Math.round(this.thinking.longestMs) : null,
            },
          }
        : {}),
    };
  }
}

export { lineCount, lineDelta } from "../claude/classify.js";
export { diffLines } from "../codex/tools.js";
