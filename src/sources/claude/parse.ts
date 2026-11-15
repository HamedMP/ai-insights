import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ModelRequest, Session, SessionFile, ToolCall, UserPrompt } from "../../schema/types.js";
import { activeMinutes, clean, languageForPath, truncate } from "../shared.js";
import {
  EDIT_TOOLS,
  SUBAGENT_LAUNCH_TOOLS,
  classifyUserText,
  errorCategory,
  gitSubcommands,
  lineCount,
  lineDelta,
  mcpServer,
  toolCategory,
} from "./classify.js";
import { DEFAULT_LIMITS, readJsonl, type JsonlLimits } from "./jsonl.js";

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
  subagentFiles: 500,
  featureList: 200,
};

export type Obj = Record<string, unknown>;

export const obj = (value: unknown): Obj =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
export const str = (value: unknown): string => (typeof value === "string" ? value : "");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
export function isoTime(value: unknown): string | null {
  return typeof value === "string" && ISO.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

function counter(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e12 ? Math.floor(value) : 0;
}

/** Text of a user message: the string itself, or its text blocks joined. Images become a marker. */
export function userText(content: unknown): { text: string; hasToolResult: boolean } {
  if (typeof content === "string") return { text: content, hasToolResult: false };
  if (!Array.isArray(content)) return { text: "", hasToolResult: false };
  const parts: string[] = [];
  let hasToolResult = false;
  for (const block of content) {
    const b = obj(block);
    if (b.type === "tool_result") hasToolResult = true;
    else if (b.type === "text") parts.push(str(b.text));
    else if (b.type === "image") parts.push("[image]");
  }
  return { text: parts.join("\n"), hasToolResult };
}

/** Text of a tool_result's content, which may be a string or a list of blocks. */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => str(obj(block).text))
    .filter(Boolean)
    .join("\n");
}

/** Where Claude Code keeps a session's subagent transcripts. */
export function subagentDir(transcriptPath: string): string {
  return join(dirname(transcriptPath), basename(transcriptPath, ".jsonl"), "subagents");
}

export async function subagentFiles(transcriptPath: string): Promise<string[]> {
  try {
    const entries = await readdir(subagentDir(transcriptPath), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => join(subagentDir(transcriptPath), entry.name))
      .sort()
      .slice(0, CAPS.subagentFiles);
  } catch {
    return [];
  }
}

interface PendingEffect {
  added: number;
  removed: number;
  modifiedPath: string | null;
  commits: number;
  pushes: number;
}

class SessionBuilder {
  sessionId: string | null = null;
  projectPath: string | null = null;
  gitBranch: string | null = null;
  permissionMode: string | null = null;
  start: string | null = null;
  end: string | null = null;
  activityTimes: string[] = [];
  models = new Set<string>();
  requests = new Map<string, ModelRequest>();
  assistantMessages = new Set<string>();
  toolCalls: ToolCall[] = [];
  toolIndex = new Map<string, number>();
  effects = new Map<number, PendingEffect>();
  gitOps = new Map<number, { commits: number; pushes: number }>();
  prompts: UserPrompt[] = [];
  userMessageCount = 0;
  responseTimes: number[] = [];
  mcpServers = new Set<string>();
  skills = new Set<string>();
  slashCommands = new Set<string>();
  subagentLaunches = 0;
  subagentTranscripts = 0;
  planMode = false;
  webSearch = false;
  webFetch = false;
  compactBoundaries = 0;
  compactSummaries = 0;
  issues = 0;

  // Turn tracking for interruptions and response times.
  private lastAssistantTime: string | null = null;
  private lastAssistantStop: string | null = null;
  private assistantSincePrompt = false;
  private interruptPending = false;

  noteTime(time: string | null, mainThread: boolean): void {
    if (!time) return;
    if (this.activityTimes.length < CAPS.timestamps) this.activityTimes.push(time);
    if (!mainThread) return;
    if (!this.start || time < this.start) this.start = time;
    if (!this.end || time > this.end) this.end = time;
  }

  noteEnvelope(record: Obj): void {
    if (!this.sessionId) {
      const id = str(record.sessionId);
      if (id) this.sessionId = truncate(id, 200);
    }
    if (!this.projectPath) {
      const cwd = str(record.cwd);
      if (cwd) this.projectPath = truncate(cwd, CAPS.pathChars);
    }
    if (!this.gitBranch) {
      const branch = str(record.gitBranch);
      if (branch && branch !== "HEAD") this.gitBranch = truncate(branch, 200);
    }
    this.notePermissionMode(record.permissionMode);
  }

  notePermissionMode(value: unknown): void {
    const mode = str(value);
    if (!mode) return;
    this.permissionMode = truncate(mode, 64);
    if (mode === "plan") this.planMode = true;
  }

  addSkill(value: unknown): void {
    const name = str(value).trim();
    if (name && this.skills.size < CAPS.featureList) this.skills.add(truncate(name, CAPS.nameChars));
  }

  addSlashCommand(name: string): void {
    if (this.slashCommands.size < CAPS.featureList) this.slashCommands.add(truncate(name, CAPS.nameChars));
  }

  assistant(record: Obj, time: string | null, mainThread: boolean): void {
    const message = record.message;
    if (!message || typeof message !== "object") {
      this.issues += 1;
      return;
    }
    const m = obj(message);
    const model = str(m.model);
    const synthetic = model === "<synthetic>";
    if (model && !synthetic && this.models.size < CAPS.featureList) this.models.add(truncate(model, 200));

    if (m.usage && !synthetic) this.addRequest(record, m, time);

    if (mainThread) {
      const key = str(m.id) || str(record.uuid);
      if (key && !synthetic) this.assistantMessages.add(key);
      if (time) this.lastAssistantTime = time;
      const stop = m.stop_reason;
      if (typeof stop === "string") this.lastAssistantStop = stop;
      this.assistantSincePrompt = true;
    }

    if (!Array.isArray(m.content)) return;
    for (const block of m.content) {
      const b = obj(block);
      if (b.type === "tool_use") this.toolUse(b, time ?? this.end ?? "", mainThread);
    }
  }

  private addRequest(record: Obj, m: Obj, time: string | null): void {
    const u = obj(m.usage);
    const messageId = str(m.id);
    const requestId = str(record.requestId);
    if (!messageId && !requestId) {
      this.issues += 1;
      return;
    }
    if (typeof u.input_tokens !== "number" || typeof u.output_tokens !== "number") {
      this.issues += 1;
      return;
    }
    const id = messageId ? `claude:${messageId}` : `claude:${this.sessionId ?? "unknown"}:${requestId}`;
    const usage: ModelRequest["usage"] = {
      input: counter(u.input_tokens),
      cachedInput: counter(u.cache_read_input_tokens),
      cacheWrite: counter(u.cache_creation_input_tokens),
      output: counter(u.output_tokens),
    };
    if (u.cache_creation && typeof u.cache_creation === "object") {
      const cache = obj(u.cache_creation);
      usage.cacheWrite5m = counter(cache.ephemeral_5m_input_tokens);
      usage.cacheWrite1h = counter(cache.ephemeral_1h_input_tokens);
    }
    const existing = this.requests.get(id);
    if (existing) {
      // Streamed copies of one response repeat or grow the counters; the largest is the final one.
      const old = existing.usage;
      old.input = Math.max(old.input, usage.input);
      old.cachedInput = Math.max(old.cachedInput, usage.cachedInput);
      old.cacheWrite = Math.max(old.cacheWrite, usage.cacheWrite);
      old.output = Math.max(old.output, usage.output);
      if (usage.cacheWrite5m !== undefined) old.cacheWrite5m = Math.max(old.cacheWrite5m ?? 0, usage.cacheWrite5m);
      if (usage.cacheWrite1h !== undefined) old.cacheWrite1h = Math.max(old.cacheWrite1h ?? 0, usage.cacheWrite1h);
      return;
    }
    if (usage.input + usage.cachedInput + usage.cacheWrite + usage.output === 0) return;
    if (!time) {
      this.issues += 1;
      return;
    }
    if (this.requests.size >= CAPS.requests) {
      this.issues += 1;
      return;
    }
    this.requests.set(id, { id, timestamp: time, model: truncate(str(m.model) || "unknown", 200), usage });
  }

  private toolUse(block: Obj, time: string, mainThread: boolean): void {
    const id = str(block.id);
    if (id && this.toolIndex.has(id)) return;
    const name = truncate(str(block.name) || "unknown", CAPS.nameChars);
    if (this.toolCalls.length >= CAPS.toolCalls) {
      this.issues += 1;
      return;
    }
    const category = toolCategory(name);
    const input = obj(block.input);
    const call: ToolCall = { name, category, timestamp: time };
    const effect: PendingEffect = { added: 0, removed: 0, modifiedPath: null, commits: 0, pushes: 0 };

    if (category === "shell") {
      const command = str(input.command);
      if (command) {
        call.command = clean(command, CAPS.commandChars);
        for (const sub of gitSubcommands(command)) {
          if (sub === "commit") effect.commits += 1;
          else if (sub === "push") effect.pushes += 1;
        }
      }
    }
    const filePath = str(input.file_path) || str(input.notebook_path);
    if (filePath && (category === "read" || category === "edit")) call.filePath = truncate(filePath, CAPS.pathChars);

    const server = mcpServer(name);
    if (server) {
      call.mcpServer = truncate(server, CAPS.nameChars);
      if (this.mcpServers.size < CAPS.featureList) this.mcpServers.add(call.mcpServer);
    }
    if (name === "Skill") {
      const skill = str(input.skill) || str(input.command);
      if (skill) {
        call.skill = truncate(skill, CAPS.nameChars);
        this.addSkill(skill);
      }
    } else if (name === "SlashCommand") {
      const command = str(input.command).trim().split(/\s+/)[0] ?? "";
      if (command) {
        call.skill = truncate(command, CAPS.nameChars);
        this.addSlashCommand(command.startsWith("/") ? command : `/${command}`);
      }
    }

    if (EDIT_TOOLS.has(name)) {
      if (filePath) effect.modifiedPath = truncate(filePath, CAPS.pathChars);
      if (name === "Edit") {
        const delta = lineDelta(str(input.old_string), str(input.new_string));
        effect.added = delta.added;
        effect.removed = delta.removed;
      } else if (name === "MultiEdit" && Array.isArray(input.edits)) {
        for (const edit of input.edits.slice(0, 1000)) {
          const e = obj(edit);
          const delta = lineDelta(str(e.old_string), str(e.new_string));
          effect.added += delta.added;
          effect.removed += delta.removed;
        }
      } else if (name === "Write") {
        effect.added = lineCount(str(input.content));
      } else if (name === "NotebookEdit") {
        if (input.edit_mode !== "delete") effect.added = lineCount(str(input.new_source));
      }
    }

    if (name === "EnterPlanMode" || name === "ExitPlanMode") this.planMode = true;
    if (name === "WebSearch") this.webSearch = true;
    if (name === "WebFetch") this.webFetch = true;
    if (mainThread && SUBAGENT_LAUNCH_TOOLS.has(name)) this.subagentLaunches += 1;

    const index = this.toolCalls.length;
    this.toolCalls.push(call);
    if (id) this.toolIndex.set(id, index);
    this.effects.set(index, effect);
  }

  /** Tool results, plus the prompt when the line is something the person typed. */
  user(record: Obj, time: string | null, mainThread: boolean): void {
    const message = record.message;
    if (!message || typeof message !== "object") {
      this.issues += 1;
      return;
    }
    const m = obj(message);
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        const b = obj(block);
        if (b.type === "tool_result") this.toolResult(b, record.toolUseResult);
      }
    }
    if (!mainThread) return;
    if (record.isCompactSummary === true) {
      this.compactSummaries += 1;
      return;
    }
    if (record.isMeta === true || record.isVisibleInTranscriptOnly === true) return;
    const origin = obj(record.origin);
    if (typeof origin.kind === "string" && origin.kind !== "human") return;

    const { text, hasToolResult } = userText(m.content);
    if (hasToolResult) {
      // Rejecting a tool call writes this marker next to the tool result.
      if (/\[Request interrupted by user/.test(text)) this.interruptPending = true;
      return;
    }
    this.typed(text, time, false);
  }

  /** A prompt the person queued while the agent was still working. */
  queuedCommand(attachment: Obj, time: string | null): void {
    if (attachment.commandMode !== "prompt" || attachment.isMeta === true) return;
    const origin = obj(attachment.origin);
    if (typeof origin.kind === "string" && origin.kind !== "human") return;
    const prompt = attachment.prompt;
    const text = typeof prompt === "string" ? prompt : userText(prompt).text;
    this.typed(text, isoTime(attachment.timestamp) ?? time, true);
  }

  private typed(raw: string, time: string | null, queued: boolean): void {
    const kind = classifyUserText(raw);
    if (kind.kind === "injected") return;
    if (kind.kind === "interrupt") {
      this.interruptPending = true;
      return;
    }
    let text: string;
    if (kind.kind === "slash") {
      this.addSlashCommand(kind.name);
      text = kind.args ? `${kind.name} ${kind.args}` : kind.name;
    } else if (kind.kind === "bash") {
      text = `! ${kind.command}`;
    } else {
      text = kind.text;
    }
    const cleaned = clean(text, CAPS.promptChars);
    if (!cleaned) return;
    if (!time) {
      this.issues += 1;
      return;
    }

    const midTurn = this.assistantSincePrompt && this.lastAssistantStop === "tool_use";
    const interrupted = queued || this.interruptPending || midTurn;
    if (!interrupted && this.assistantSincePrompt && this.lastAssistantTime) {
      const gap = (Date.parse(time) - Date.parse(this.lastAssistantTime)) / 1000;
      if (gap >= 0 && this.responseTimes.length < CAPS.responseTimes) this.responseTimes.push(Math.round(gap * 10) / 10);
    }

    this.userMessageCount += 1;
    if (this.prompts.length < CAPS.prompts) {
      const prompt: UserPrompt = { timestamp: time, text: cleaned };
      if (interrupted) prompt.interrupted = true;
      this.prompts.push(prompt);
    }
    this.interruptPending = false;
    if (!queued) {
      this.assistantSincePrompt = false;
      this.lastAssistantStop = null;
    }
  }

  /** The agent finished its turn (Claude Code writes this after the final response). */
  turnEnded(): void {
    if (this.assistantSincePrompt) this.lastAssistantStop = "end_turn";
  }

  private toolResult(block: Obj, toolUseResult: unknown): void {
    const index = this.toolIndex.get(str(block.tool_use_id));
    if (index === undefined) return;
    const call = this.toolCalls[index];
    if (!call) return;
    const result = obj(toolUseResult);
    const effect = this.effects.get(index);
    if (block.is_error === true) {
      call.error = errorCategory(toolResultText(block.content), call.category);
      return;
    }
    if (!effect) return;
    // An overwrite reports the file it replaced, which gives a real diff instead of "every line is new".
    if (call.name === "Write" && result.type === "update" && typeof result.originalFile === "string") {
      const delta = lineDelta(result.originalFile, typeof result.content === "string" ? result.content : "");
      effect.added = delta.added;
      effect.removed = delta.removed;
    }
    const git = obj(result.gitOperation);
    if (git.commit || git.push) {
      this.gitOps.set(index, { commits: git.commit ? 1 : 0, pushes: git.push ? 1 : 0 });
    }
  }

  build(file: SessionFile): Session | null {
    if (!this.start || !this.end) return null;
    if (this.userMessageCount === 0 && this.assistantMessages.size === 0) return null;

    let linesAdded = 0;
    let linesRemoved = 0;
    let gitCommits = 0;
    let gitPushes = 0;
    const filesModified = new Set<string>();
    const languages: Record<string, number> = {};
    this.toolCalls.forEach((call, index) => {
      if (call.filePath) {
        const language = languageForPath(call.filePath);
        if (language) languages[language] = (languages[language] ?? 0) + 1;
      }
      if (call.error) return;
      const effect = this.effects.get(index);
      if (!effect) return;
      linesAdded += effect.added;
      linesRemoved += effect.removed;
      if (effect.modifiedPath && filesModified.size < CAPS.filesModified) filesModified.add(effect.modifiedPath);
      const git = this.gitOps.get(index);
      gitCommits += Math.max(effect.commits, git?.commits ?? 0);
      gitPushes += Math.max(effect.pushes, git?.pushes ?? 0);
    });

    const startMs = Date.parse(this.start);
    const endMs = Date.parse(this.end);
    return {
      id: this.sessionId ?? basename(file.path, ".jsonl"),
      harness: "claude-code",
      sourcePath: file.path,
      sourceMtimeMs: file.mtimeMs,
      projectPath: this.projectPath,
      gitBranch: this.gitBranch,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      durationMinutes: Math.round((endMs - startMs) / 60_000),
      activeMinutes: activeMinutes(this.activityTimes),
      models: [...this.models],
      permissionMode: this.permissionMode,
      userMessageCount: this.userMessageCount,
      assistantMessageCount: this.assistantMessages.size,
      prompts: this.prompts,
      userResponseTimesSec: this.responseTimes,
      requests: [...this.requests.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      toolCalls: this.toolCalls,
      features: {
        mcpServers: [...this.mcpServers].sort(),
        skills: [...this.skills].sort(),
        slashCommands: [...this.slashCommands].sort(),
        subagents: Math.max(this.subagentLaunches, this.subagentTranscripts),
        planMode: this.planMode,
        webSearch: this.webSearch,
        webFetch: this.webFetch,
        compactions: this.compactBoundaries > 0 ? this.compactBoundaries : this.compactSummaries,
      },
      linesAdded,
      linesRemoved,
      filesModified: [...filesModified],
      languages,
      gitCommits,
      gitPushes,
      issues: this.issues,
    };
  }

  record(record: Obj, mainFile: boolean): void {
    const type = record.type;
    const time = isoTime(record.timestamp);
    // Older Claude Code versions wrote subagent turns into the parent file, flagged as sidechain.
    const mainThread = mainFile && record.isSidechain !== true;
    switch (type) {
      case "user":
        this.noteEnvelope(record);
        this.noteTime(time, mainFile);
        this.user(record, time, mainThread);
        break;
      case "assistant":
        this.noteEnvelope(record);
        this.noteTime(time, mainFile);
        this.assistant(record, time, mainThread);
        break;
      case "system": {
        this.noteEnvelope(record);
        this.noteTime(time, mainFile);
        if (!mainThread) break;
        const subtype = record.subtype;
        if (subtype === "compact_boundary") this.compactBoundaries += 1;
        else if (subtype === "turn_duration") this.turnEnded();
        else if (subtype === "local_command") {
          const kind = classifyUserText(str(record.content));
          if (kind.kind === "slash") this.addSlashCommand(kind.name);
        }
        break;
      }
      case "attachment": {
        this.noteTime(time, mainFile);
        if (!mainThread) break;
        const attachment = obj(record.attachment);
        if (attachment.type === "queued_command") this.queuedCommand(attachment, time);
        else if (attachment.type === "invoked_skills" && Array.isArray(attachment.skills)) {
          for (const skill of attachment.skills.slice(0, CAPS.featureList)) {
            this.addSkill(typeof skill === "string" ? skill : obj(skill).name);
          }
        } else if (attachment.type === "skill_mention") this.addSkill(attachment.skillName);
        break;
      }
      case "permission-mode":
        if (mainFile) this.notePermissionMode(record.permissionMode);
        break;
      case "mode":
        if (mainFile && record.mode === "plan") this.planMode = true;
        break;
      default:
        // Many internal record types exist and new ones appear between versions.
        break;
    }
  }
}

export async function parseClaudeTranscript(file: SessionFile, limits: JsonlLimits = DEFAULT_LIMITS): Promise<Session | null> {
  const builder = new SessionBuilder();
  // Claude Code names the file after the session. Lines stamped with another
  // session id are history copied in on resume; the original file counts them.
  const stem = basename(file.path, ".jsonl");
  const fileSession = UUID.test(stem) ? stem : null;
  if (fileSession) builder.sessionId = fileSession;
  for await (const row of readJsonl(file.path, limits)) {
    if (row.kind === "issue") builder.issues += 1;
    else if (fileSession && typeof row.value.sessionId === "string" && row.value.sessionId !== fileSession) continue;
    else builder.record(row.value, true);
  }
  // Subagent work is spend and edits made on this session's behalf, so its
  // requests and tool calls fold into the parent; its prompts are the parent
  // agent talking, not the person, so they are not counted.
  const subagents = await subagentFiles(file.path);
  for (const path of subagents) {
    let sawRecord = false;
    for await (const row of readJsonl(path, limits)) {
      if (row.kind === "issue") builder.issues += 1;
      else {
        sawRecord = true;
        builder.record(row.value, false);
      }
    }
    if (sawRecord) builder.subagentTranscripts += 1;
  }
  return builder.build(file);
}
