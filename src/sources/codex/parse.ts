import { isAbsolute, join } from "node:path";
import type { ModelRequest, Session, SessionFeatures, ToolCall, TranscriptTurn, UserPrompt } from "../../schema/types.js";
import { activeMinutes, clean, languageForPath, truncate } from "../shared.js";
import { normalise, readRecords, type RawRecord } from "./read.js";
import { contentText, hasImage, isQuestionReply, promptText } from "./prompts.js";
import {
  categoryForName,
  categoryForParsed,
  commandText,
  diffLines,
  exitCodeFromOutput,
  gitOperations,
  lineCount,
  mcpServerFromName,
  parseApplyPatch,
  shellError,
  skillFromCommand,
  type PatchStats,
} from "./tools.js";
import { UsageParser } from "./usage.js";

export const MAX_PROMPTS = 2_000;
export const MAX_TOOL_CALLS = 10_000;
export const MAX_FILES = 2_000;
export const MAX_TIMESTAMPS = 200_000;
export const MAX_TURNS_COLLECTED = 20_000;
const MAX_RESPONSE_GAP_SEC = 24 * 60 * 60;
const MAX_MODELS = 50;
const MAX_TURN_MODELS = 20_000;

/** What kind of thread a rollout holds. Guardian reviews and spawned subagents belong to a parent. */
export type ThreadKind = "main" | "guardian" | "subagent";

export interface RolloutMeta {
  id: string | null;
  parentId: string | null;
  kind: ThreadKind;
}

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

function validTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function msToIso(value: unknown, fallback: string): string {
  return typeof value === "number" && Number.isFinite(value) && value > 1e12 ? new Date(value).toISOString() : fallback;
}

export function metaFromPayload(payload: Record<string, unknown>): RolloutMeta {
  const source = obj(payload.source);
  const subagent = obj(source.subagent);
  const spawn = obj(subagent.thread_spawn);
  const parentId = str(payload.parent_thread_id) ?? str(spawn.parent_thread_id);
  let kind: ThreadKind = "main";
  if (payload.thread_source === "guardian_review" || subagent.other === "guardian") kind = "guardian";
  else if (payload.thread_source === "subagent" || Object.keys(subagent).length > 0) kind = "subagent";
  return { id: str(payload.id), parentId: kind === "main" ? null : parentId, kind };
}

interface CallEntry {
  call: ToolCall;
  patch?: PatchStats;
  git?: { commits: number; pushes: number };
  turn?: number;
}

interface TurnEntry extends TranscriptTurn {
  /** Which alternative record stream produced this turn; only one stream per role survives. */
  stream: "item" | "event" | "response";
}

/** Prompts from one record stream. Codex mirrors prompts in several streams; only one is used. */
class PromptTrack {
  prompts: UserPrompt[] = [];
  responseTimes: number[] = [];
  slashCommands: string[] = [];
  private sinceDone = false;
  private usedDone: number | null = null;
  private abortsSeen = 0;

  add(state: TurnState, timestamp: string, text: string, reply: boolean): UserPrompt | null {
    let interrupted = !reply && state.turnOpen && this.sinceDone;
    if (!reply && state.interruptions > this.abortsSeen) {
      interrupted = true;
      this.abortsSeen = state.interruptions;
    }
    const time = Date.parse(timestamp);
    if (!interrupted && !reply && state.lastDoneMs !== null && state.lastDoneMs !== this.usedDone && Number.isFinite(time)) {
      const gap = (time - state.lastDoneMs) / 1000;
      if (gap > 0 && gap <= MAX_RESPONSE_GAP_SEC && this.responseTimes.length < MAX_PROMPTS) this.responseTimes.push(Math.round(gap * 10) / 10);
      this.usedDone = state.lastDoneMs;
    }
    this.sinceDone = true;
    if (this.prompts.length >= MAX_PROMPTS) return null;
    const slash = /^\/([\w:.-]+)/.exec(text.trimStart());
    if (slash && this.slashCommands.length < 200) this.slashCommands.push(slash[1]!);
    const prompt: UserPrompt = { timestamp, text: clean(text, 2000) };
    if (interrupted) prompt.interrupted = true;
    this.prompts.push(prompt);
    return prompt;
  }

  done(): void {
    this.sinceDone = false;
  }
}

interface TurnState {
  turnOpen: boolean;
  lastDoneMs: number | null;
  interruptions: number;
}

export interface BuilderOptions {
  /** Collect transcript turns for `excerpt`, each cut to roughly this many characters before redaction. */
  turnChars?: number;
}

export interface BuiltRollout {
  meta: RolloutMeta;
  session: Session | null;
  turns: TranscriptTurn[];
}

/** One pass over a rollout's records. Holds only bounded counters, metadata and the person's prompts. */
export class RolloutBuilder {
  meta: RolloutMeta = { id: null, parentId: null, kind: "main" };
  private sawMeta = false;
  private startOrdinal: number | null = null;
  private index = 0;
  issues = 0;

  private timestamps: string[] = [];
  private first: string | null = null;
  private last: string | null = null;
  private cwd: string | null = null;
  private branch: string | null = null;
  private model: string | null = null;
  private models = new Set<string>();
  private turnModels = new Map<string, string>();
  private permissionMode: string | null = null;
  private planMode = false;
  private sawTurnEvents = false;

  private state: TurnState = { turnOpen: false, lastDoneMs: null, interruptions: 0 };
  private tracks = { item: new PromptTrack(), event: new PromptTrack(), response: new PromptTrack() };

  private assistantResponses = 0;
  private assistantEvents = 0;

  private itemCalls: CallEntry[] = [];
  private classicCalls: CallEntry[] = [];
  private classicById = new Map<string, CallEntry>();
  private sawItems = false;

  private subagentSpawns = { item: 0, classic: 0 };
  private webSearch = false;
  private webFetch = false;
  private compacted = 0;
  private compactionEvents = 0;
  private reviewMode = false;

  private usage: UsageParser;
  private turns: TurnEntry[] = [];
  private turnChars: number | null;

  constructor(private readonly path: string, options: BuilderOptions = {}) {
    this.usage = new UsageParser(path);
    this.turnChars = options.turnChars ?? null;
  }

  push(raw: RawRecord): void {
    const record = normalise(raw, this.index === 0);
    this.index += 1;
    if (!record) return;
    const type = record.type;
    if (typeof type !== "string") {
      this.issues += 1;
      return;
    }
    const payload = obj(record.payload);
    if (type === "session_meta") {
      if (!this.sawMeta) this.readMeta(payload, record.timestamp);
      return;
    }
    // Forked subagent rollouts start with a copy of the parent's history; their own part starts later.
    if (this.startOrdinal !== null && typeof record.ordinal === "number" && record.ordinal < this.startOrdinal) return;

    const timestamp = validTime(record.timestamp);
    if (timestamp) this.seeTime(timestamp);
    const time = timestamp ?? this.last ?? "";

    switch (type) {
      case "turn_context":
        this.readTurnContext(payload);
        break;
      case "response_item":
        this.readResponseItem(payload, record, time);
        break;
      case "event_msg":
        this.readEvent(payload, record, time);
        break;
      case "token_usage_record":
        this.usage.push(record, this.modelFor(payload.turn_id));
        break;
      case "compacted":
        this.compacted += 1;
        break;
      default:
        // world_state, inter_agent_communication_metadata and future types carry nothing this needs.
        break;
    }
  }

  private seeTime(timestamp: string): void {
    if (this.timestamps.length < MAX_TIMESTAMPS) this.timestamps.push(timestamp);
    if (!this.first || Date.parse(timestamp) < Date.parse(this.first)) this.first = timestamp;
    if (!this.last || Date.parse(timestamp) > Date.parse(this.last)) this.last = timestamp;
  }

  private readMeta(payload: Record<string, unknown>, timestamp: unknown): void {
    this.sawMeta = true;
    this.meta = metaFromPayload(payload);
    if (this.meta.id) this.usage.setSession(this.meta.id);
    this.cwd = str(payload.cwd) ?? this.cwd;
    this.branch = str(obj(payload.git).branch) ?? this.branch;
    if (typeof payload.subagent_history_start_ordinal === "number") this.startOrdinal = payload.subagent_history_start_ordinal;
    const time = validTime(timestamp) ?? validTime(payload.timestamp);
    if (time) this.seeTime(time);
  }

  private modelFor(turnId: unknown): string {
    return (typeof turnId === "string" ? this.turnModels.get(turnId) : undefined) ?? this.model ?? "unknown";
  }

  private readTurnContext(payload: Record<string, unknown>): void {
    const model = str(payload.model);
    if (model) {
      this.model = model;
      if (this.models.size < MAX_MODELS) this.models.add(model);
      const turnId = str(payload.turn_id);
      if (turnId && this.turnModels.size < MAX_TURN_MODELS) this.turnModels.set(turnId, model);
    }
    this.cwd = str(payload.cwd) ?? this.cwd;
    const approval = payload.approval_policy;
    const approvalName = typeof approval === "string" ? approval : approval && typeof approval === "object" ? Object.keys(approval)[0] : undefined;
    const sandbox = str(obj(payload.sandbox_policy).type) ?? str(payload.sandbox_policy);
    if (approvalName || sandbox) this.permissionMode = [approvalName ?? "unknown", sandbox ?? "unknown"].join("/");
    if (obj(payload.collaboration_mode).mode === "plan") this.planMode = true;
  }

  private addTurn(turn: TurnEntry): number | undefined {
    if (this.turnChars === null || this.turns.length >= MAX_TURNS_COLLECTED) return undefined;
    // Cut generously before redaction so a secret straddling the cut is still whole when redacted.
    turn.text = truncate(turn.text, this.turnChars + 400);
    this.turns.push(turn);
    return this.turns.length - 1;
  }

  private appendTurn(index: number | undefined, text: string, isError: boolean): void {
    if (index === undefined) return;
    const turn = this.turns[index];
    if (!turn) return;
    if (text) turn.text = truncate(`${turn.text}\n${text}`, (this.turnChars ?? 0) + 400);
    if (isError) turn.isError = true;
  }

  private prompt(stream: "item" | "event" | "response", timestamp: string, text: string, reply = false): void {
    const prompt = this.tracks[stream].add(this.state, timestamp, text, reply);
    if (prompt) this.addTurn({ timestamp, role: "user", text, stream });
  }

  private readResponseItem(payload: Record<string, unknown>, record: RawRecord, time: string): void {
    const kind = payload.type;
    if (kind === "message") {
      if (payload.role === "user") {
        if (obj(record.metadata).inherited_user_message) return;
        const raw = contentText(payload.content);
        const text = promptText(raw, hasImage(payload.content));
        if (text) this.prompt("response", time, text, isQuestionReply(raw));
      } else if (payload.role === "assistant") {
        this.assistantResponses += 1;
        if (!this.sawTurnEvents) this.state.lastDoneMs = Date.parse(time) || this.state.lastDoneMs;
        this.addTurn({ timestamp: time, role: "assistant", text: contentText(payload.content), stream: "response" });
      }
      return;
    }
    if (kind === "function_call" || kind === "custom_tool_call" || kind === "local_shell_call" || kind === "web_search_call") {
      this.classicCall(payload, time);
      return;
    }
    if (kind === "function_call_output" || kind === "custom_tool_call_output") {
      const entry = this.classicById.get(String(payload.call_id));
      if (!entry) return;
      const { exitCode, text } = exitCodeFromOutput(payload.output);
      if (entry.call.category === "shell" || entry.call.category === "read" || entry.call.category === "search" || entry.call.category === "skill") {
        const error = shellError(exitCode, text);
        if (error && !entry.call.error) entry.call.error = error;
      } else if (entry.call.name === "apply_patch") {
        if (exitCode !== null ? exitCode !== 0 : /^(error|failed|apply_patch verification failed)/i.test(text.trim())) {
          entry.call.error ??= /no such file|not found/i.test(text) ? "file_not_found" : "edit_mismatch";
        }
      }
      this.appendTurn(entry.turn, text, !!entry.call.error);
      return;
    }
  }

  private pushCall(list: CallEntry[], entry: CallEntry): boolean {
    if (list.length >= MAX_TOOL_CALLS) return false;
    list.push(entry);
    return true;
  }

  private classicCall(payload: Record<string, unknown>, time: string): void {
    const kind = payload.type;
    let name = str(payload.name) ?? (kind === "local_shell_call" ? "local_shell" : kind === "web_search_call" ? "web_search" : "unknown");
    const namespace = payload.namespace;
    if (typeof namespace === "string" && namespace && !namespace.startsWith("mcp__") && namespace !== "collaboration") name = `${namespace}__${name}`;
    let args: Record<string, unknown> = {};
    if (typeof payload.arguments === "string") {
      try {
        args = obj(JSON.parse(payload.arguments));
      } catch {
        args = {};
      }
    } else args = obj(payload.arguments);
    const call: ToolCall = { name, category: categoryForName(name, namespace), timestamp: time };
    const entry: CallEntry = { call };
    let turnText = name;

    const server = mcpServerFromName(name, namespace);
    if (server) {
      call.mcpServer = server;
      if (typeof namespace === "string" && namespace.startsWith("mcp__")) call.name = `${namespace}__${name}`;
    }

    if (kind === "local_shell_call" || call.category === "shell") {
      const script = commandText(kind === "local_shell_call" ? obj(payload.action).command : (args.command ?? args.cmd ?? args.chars));
      if (script && name !== "write_stdin") {
        call.command = clean(script, 300);
        entry.git = gitOperations(script);
        const skill = skillFromCommand(script);
        if (skill) {
          call.category = "skill";
          call.skill = skill;
        }
        turnText = `$ ${script}`;
      }
    } else if (name === "apply_patch") {
      const patch = typeof payload.input === "string" ? payload.input : typeof args.input === "string" ? args.input : typeof args.patch === "string" ? args.patch : "";
      entry.patch = parseApplyPatch(patch);
      entry.patch.files = entry.patch.files.map((file) => this.absolute(file));
      if (entry.patch.files[0]) call.filePath = entry.patch.files[0];
      turnText = `apply_patch ${entry.patch.files.join(", ")}`;
    } else if (name === "view_image") {
      const path = str(args.path);
      if (path) call.filePath = this.absolute(path);
    } else if (kind === "web_search_call") {
      const action = obj(payload.action);
      if (action.type === "open_page" || action.type === "find_in_page") this.webFetch = true;
      else this.webSearch = true;
      turnText = `web_search ${str(action.query) ?? ""}`.trim();
    } else if (call.category === "web") {
      this.webSearch = true;
    }
    if (call.category === "subagent" && /spawn/.test(name)) this.subagentSpawns.classic += 1;
    if (kind === "custom_tool_call" && name === "exec") call.category = "other";

    if (!this.pushCall(this.classicCalls, entry)) return;
    entry.turn = this.addTurn({ timestamp: time, role: "tool", toolName: call.name, text: turnText, stream: "response" });
    const id = str(payload.call_id) ?? str(payload.id);
    if (id && this.classicById.size < MAX_TOOL_CALLS) this.classicById.set(id, entry);
  }

  private absolute(path: string): string {
    return isAbsolute(path) || !this.cwd ? path : join(this.cwd, path);
  }

  private turnDone(time: string, interrupted: boolean): void {
    this.state.turnOpen = false;
    const ms = Date.parse(time);
    if (Number.isFinite(ms)) this.state.lastDoneMs = ms;
    if (interrupted) this.state.interruptions += 1;
    for (const track of Object.values(this.tracks)) track.done();
  }

  private readEvent(payload: Record<string, unknown>, record: RawRecord, time: string): void {
    switch (payload.type) {
      case "item_completed":
        this.sawItems = true;
        this.readItem(obj(payload.item), payload, time);
        return;
      case "token_count":
        this.usage.push(record, this.modelFor(payload.turn_id));
        return;
      case "task_started":
        this.sawTurnEvents = true;
        this.state.turnOpen = true;
        if (payload.collaboration_mode_kind === "plan") this.planMode = true;
        return;
      case "task_complete":
        this.sawTurnEvents = true;
        this.turnDone(msToIso(typeof payload.completed_at === "number" ? payload.completed_at * 1000 : undefined, time), false);
        return;
      case "turn_aborted":
        this.sawTurnEvents = true;
        this.turnDone(time, payload.reason === "interrupted");
        return;
      case "user_message": {
        if (payload.kind !== undefined && payload.kind !== "plain") return;
        const raw = typeof payload.message === "string" ? payload.message : "";
        const images = Array.isArray(payload.images) && payload.images.length > 0;
        const text = promptText(raw, images);
        if (text) this.prompt("event", time, text, isQuestionReply(raw));
        return;
      }
      case "agent_message":
        this.assistantEvents += 1;
        if (!this.sawTurnEvents) this.state.lastDoneMs = Date.parse(time) || this.state.lastDoneMs;
        this.addTurn({ timestamp: time, role: "assistant", text: typeof payload.message === "string" ? payload.message : "", stream: "event" });
        return;
      case "exec_command_end": {
        const entry = this.classicById.get(String(payload.call_id));
        if (!entry) return;
        const output = [payload.stderr, payload.aggregated_output, payload.stdout].find((value) => typeof value === "string" && value) as string | undefined;
        const error = shellError(payload.exit_code, output ?? "");
        if (error) entry.call.error = error;
        else if (typeof payload.exit_code === "number") delete entry.call.error;
        return;
      }
      case "patch_apply_end": {
        const entry = this.classicById.get(String(payload.call_id));
        if (!entry) return;
        if (payload.success === false) {
          const stderr = typeof payload.stderr === "string" ? payload.stderr : "";
          entry.call.error = /no such file|not found/i.test(stderr) ? "file_not_found" : "edit_mismatch";
        } else if (payload.success === true) delete entry.call.error;
        return;
      }
      case "mcp_tool_call_end": {
        const entry = this.classicById.get(String(payload.call_id));
        if (!entry) return;
        const invocation = obj(payload.invocation);
        const server = str(invocation.server);
        const tool = str(invocation.tool);
        if (server) {
          entry.call.category = "mcp";
          entry.call.mcpServer = server;
          if (tool) entry.call.name = `mcp__${server}__${tool}`;
        }
        const result = obj(payload.result);
        if ("Err" in result || obj(result.Ok).isError === true || obj(result.Ok).is_error === true) entry.call.error = "other";
        return;
      }
      case "web_search_end":
        this.webSearch = true;
        return;
      case "context_compacted":
        this.compactionEvents += 1;
        return;
      case "entered_review_mode":
        this.reviewMode = true;
        return;
      default:
        return;
    }
  }

  private itemCall(entry: CallEntry, text: string, isError = false): void {
    if (!this.pushCall(this.itemCalls, entry)) return;
    const turn = this.addTurn({ timestamp: entry.call.timestamp, role: "tool", toolName: entry.call.name, text, stream: "item" });
    if (isError && turn !== undefined) this.turns[turn]!.isError = true;
  }

  /** Codex Desktop and app-server builds: one `item_completed` event per finished action. */
  private readItem(item: Record<string, unknown>, event: Record<string, unknown>, time: string): void {
    const at = msToIso(event.started_at_ms, time);
    switch (item.type) {
      case "UserMessage": {
        const raw = contentText(item.content, "text");
        const text = promptText(raw, hasImage(item.content));
        if (text) this.prompt("item", time, text, isQuestionReply(raw));
        return;
      }
      case "CommandExecution": {
        const script = commandText(item.command);
        const parsed = categoryForParsed(item.parsed_cmd);
        const call: ToolCall = { name: "exec_command", category: parsed.category, timestamp: at };
        if (script) call.command = clean(script, 300);
        if (parsed.path) call.filePath = this.absolute(parsed.path);
        const output = [item.stderr, item.aggregated_output, item.stdout].find((value) => typeof value === "string" && value) as string | undefined;
        const error = shellError(item.exit_code, output ?? "", item.status);
        if (error) call.error = error;
        const skill = skillFromCommand(script);
        if (skill) {
          call.category = "skill";
          call.skill = skill;
        }
        const body = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
        this.itemCall({ call, git: gitOperations(script) }, `$ ${script}\n${body.slice(0, (this.turnChars ?? 0) + 400)}`, !!error);
        return;
      }
      case "FileChange": {
        const changes = obj(item.changes);
        const stats: PatchStats = { files: [], added: 0, removed: 0 };
        for (const [path, value] of Object.entries(changes)) {
          if (stats.files.length >= MAX_FILES) break;
          const change = obj(value);
          const kind = str(change.type) ?? ["add", "update", "delete"].find((key) => key in change) ?? "update";
          const body = kind in change ? obj(change[kind]) : change;
          const target = str(body.move_path) ?? path;
          stats.files.push(this.absolute(target));
          if (kind === "add") stats.added += lineCount(String(body.content ?? ""));
          else if (kind === "delete") stats.removed += lineCount(String(body.content ?? ""));
          else {
            const lines = diffLines(String(body.unified_diff ?? ""));
            stats.added += lines.added;
            stats.removed += lines.removed;
          }
        }
        const call: ToolCall = { name: "apply_patch", category: "edit", timestamp: at };
        if (stats.files[0]) call.filePath = stats.files[0];
        if (item.status === "failed") call.error = "edit_mismatch";
        else if (item.status === "declined" || item.status === "rejected") call.error = "user_rejected";
        this.itemCall({ call, patch: stats }, `apply_patch ${stats.files.join(", ")}`, !!call.error);
        return;
      }
      case "McpToolCall": {
        const server = str(item.server) ?? "unknown";
        const tool = str(item.tool) ?? "unknown";
        const call: ToolCall = { name: `mcp__${server}__${tool}`, category: "mcp", timestamp: at, mcpServer: server };
        const errorText = JSON.stringify(item.error ?? "");
        if (item.status === "failed" || item.error) call.error = /timed? ?out/i.test(errorText) ? "timeout" : "other";
        else if (item.status === "declined" || item.status === "rejected") call.error = "user_rejected";
        const result = item.result === undefined ? "" : JSON.stringify(item.result).slice(0, (this.turnChars ?? 0) + 400);
        this.itemCall({ call }, `${server}.${tool}\n${result}`, !!call.error);
        return;
      }
      case "DynamicToolCall": {
        const name = [str(item.namespace), str(item.tool)].filter(Boolean).join("__") || "dynamic_tool";
        const call: ToolCall = { name, category: "other", timestamp: at };
        if (item.success === false || item.status === "failed") call.error = "other";
        this.itemCall({ call }, name, !!call.error);
        return;
      }
      case "Extension": {
        const kind = str(item.kind) ?? "extension";
        const call: ToolCall = { name: kind, category: kind.startsWith("web.") ? "web" : "other", timestamp: at };
        if (kind.startsWith("web.")) {
          const action = obj(item.action);
          if (action.type === "openPage" || action.type === "findInPage" || action.type === "open_page") this.webFetch = true;
          else this.webSearch = true;
        }
        const query = str(obj(item.action).query) ?? (Array.isArray(obj(item.action).queries) ? (obj(item.action).queries as unknown[]).filter((q) => typeof q === "string").join(" | ") : "");
        this.itemCall({ call }, `${kind} ${query ?? ""}`.trim());
        return;
      }
      case "SubAgentActivity": {
        if (item.kind === "completed") return;
        const started = item.kind === "started";
        if (started) this.subagentSpawns.item += 1;
        this.itemCall({ call: { name: started ? "spawn_agent" : "message_agent", category: "subagent", timestamp: at } }, started ? "spawn_agent" : "message_agent");
        return;
      }
      case "CollabAgentToolCall": {
        const name = str(item.tool) ?? "collab_agent";
        const call: ToolCall = { name, category: "subagent", timestamp: at };
        if (item.status === "failed") call.error = "other";
        this.itemCall({ call }, name, !!call.error);
        return;
      }
      case "ImageView": {
        const call: ToolCall = { name: "view_image", category: "read", timestamp: at };
        const path = str(item.path);
        if (path) call.filePath = this.absolute(path);
        this.itemCall({ call }, "view_image");
        return;
      }
      case "AgentMessage":
        if (Array.isArray(item.questions) && item.questions.length) {
          this.itemCall({ call: { name: "request_user_input", category: "ask_user", timestamp: at } }, "request_user_input");
        }
        return;
      case "ContextCompaction":
        this.compactionEvents += 1;
        return;
      default:
        return;
    }
  }

  /** Pick one prompt stream: item events (Desktop), then user_message events (CLI), then raw messages. */
  private promptTrack(): { track: PromptTrack; stream: "item" | "event" | "response" } {
    if (this.tracks.item.prompts.length) return { track: this.tracks.item, stream: "item" };
    if (this.tracks.event.prompts.length) return { track: this.tracks.event, stream: "event" };
    return { track: this.tracks.response, stream: "response" };
  }

  finish(sourceMtimeMs: number): BuiltRollout {
    const { track, stream } = this.promptTrack();
    const calls = this.sawItems && this.itemCalls.length ? this.itemCalls : this.classicCalls;
    const callStream = calls === this.itemCalls ? "item" : "response";
    const assistantStream = this.assistantResponses > 0 ? "response" : "event";
    const turns: TranscriptTurn[] = this.turns
      .filter((turn) => (turn.role === "user" ? turn.stream === stream : turn.role === "tool" ? turn.stream === callStream : turn.stream === assistantStream))
      .map(({ stream: _stream, ...turn }) => turn);

    const requests: ModelRequest[] = this.usage.finish();
    this.issues += this.usage.issues;
    if (!this.first || !this.last || (track.prompts.length === 0 && requests.length === 0 && calls.length === 0)) {
      return { meta: this.meta, session: null, turns };
    }

    const files = new Set<string>();
    const languages: Record<string, number> = {};
    const mcpServers = new Set<string>();
    const skills = new Set<string>();
    let linesAdded = 0;
    let linesRemoved = 0;
    let gitCommits = 0;
    let gitPushes = 0;
    for (const { call, patch, git } of calls) {
      if (call.mcpServer) mcpServers.add(call.mcpServer);
      if (call.skill) skills.add(call.skill);
      const touched = patch ? patch.files : call.filePath ? [call.filePath] : [];
      for (const path of new Set(touched)) {
        const language = languageForPath(path);
        if (language) languages[language] = (languages[language] ?? 0) + 1;
      }
      if (call.error) continue;
      if (patch) {
        linesAdded += patch.added;
        linesRemoved += patch.removed;
        for (const path of patch.files) if (files.size < MAX_FILES) files.add(path);
      }
      if (git) {
        gitCommits += git.commits;
        gitPushes += git.pushes;
      }
    }
    for (const request of requests) if (this.models.size < MAX_MODELS && request.model !== "unknown") this.models.add(request.model);

    const slashCommands = [...new Set(track.slashCommands)];
    if (this.reviewMode && !slashCommands.includes("review")) slashCommands.push("review");
    const features: SessionFeatures = {
      mcpServers: [...mcpServers].sort(),
      skills: [...skills].sort(),
      slashCommands,
      subagents: calls === this.itemCalls ? this.subagentSpawns.item : this.subagentSpawns.classic,
      planMode: this.planMode,
      webSearch: this.webSearch,
      webFetch: this.webFetch,
      compactions: Math.max(this.compacted, this.compactionEvents),
    };

    const start = Date.parse(this.first);
    const end = Date.parse(this.last);
    const session: Session = {
      id: this.meta.id ?? idFromPath(this.path),
      harness: "codex",
      sourcePath: this.path,
      sourceMtimeMs,
      projectPath: this.cwd,
      gitBranch: this.branch,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      durationMinutes: Math.round(((end - start) / 60_000) * 10) / 10,
      activeMinutes: activeMinutes(this.timestamps),
      models: [...this.models],
      permissionMode: this.permissionMode,
      userMessageCount: track.prompts.length,
      assistantMessageCount: assistantStream === "response" ? this.assistantResponses : this.assistantEvents,
      prompts: track.prompts,
      userResponseTimesSec: track.responseTimes,
      requests,
      toolCalls: calls.map((entry) => entry.call),
      features,
      linesAdded,
      linesRemoved,
      filesModified: [...files],
      languages,
      gitCommits,
      gitPushes,
      issues: this.issues,
    };
    return { meta: this.meta, session, turns };
  }
}

/** Rollout names end in the thread uuid: `rollout-2025-01-01T10-00-00-<uuid>.jsonl[.zst]`. */
export function idFromPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(base);
  return match?.[1] ?? base.replace(/\.(jsonl(\.zst)?|json)$/, "");
}

export async function buildRollout(path: string, mtimeMs: number, options: BuilderOptions = {}): Promise<BuiltRollout> {
  const builder = new RolloutBuilder(path, options);
  const read = { issues: 0 };
  for await (const record of readRecords(path, read)) builder.push(record);
  builder.issues += read.issues;
  return builder.finish(mtimeMs);
}

/** Merge a guardian review or spawned subagent into the session that started it. */
export function foldChild(parent: Session, child: BuiltRollout): void {
  const session = child.session;
  if (!session) return;
  parent.requests.push(...session.requests.slice(0, Math.max(0, 50_000 - parent.requests.length)));
  for (const model of session.models) if (!parent.models.includes(model) && parent.models.length < MAX_MODELS) parent.models.push(model);
  parent.issues += session.issues;
  // A guardian only reviews the parent's planned actions; its reads are not the person's work.
  if (child.meta.kind === "guardian") return;
  const room = Math.max(0, MAX_TOOL_CALLS - parent.toolCalls.length);
  parent.toolCalls.push(...session.toolCalls.slice(0, room));
  parent.linesAdded += session.linesAdded;
  parent.linesRemoved += session.linesRemoved;
  for (const file of session.filesModified) if (parent.filesModified.length < MAX_FILES && !parent.filesModified.includes(file)) parent.filesModified.push(file);
  for (const [language, count] of Object.entries(session.languages)) parent.languages[language] = (parent.languages[language] ?? 0) + count;
  parent.gitCommits += session.gitCommits;
  parent.gitPushes += session.gitPushes;
  const features = parent.features;
  const merge = (into: string[], from: string[]) => {
    for (const value of from) if (!into.includes(value)) into.push(value);
    into.sort();
  };
  merge(features.mcpServers, session.features.mcpServers);
  merge(features.skills, session.features.skills);
  features.subagents += session.features.subagents;
  features.planMode ||= session.features.planMode;
  features.webSearch ||= session.features.webSearch;
  features.webFetch ||= session.features.webFetch;
  features.compactions += session.features.compactions;
}

