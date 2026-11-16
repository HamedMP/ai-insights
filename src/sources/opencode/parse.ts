import type { SessionFile, Session, ToolCategory, ToolErrorCategory } from "../../schema/types.js";
import { errorCategory } from "../claude/classify.js";
import { parseApplyPatch, shellError } from "../codex/tools.js";
import { count, isoFrom, lineCount, lineDelta, obj, SessionBuilder, str, type Obj, type ToolInput } from "../common/builder.js";
import { MAX_CHILDREN, type MessageRecord, type Reader } from "./store.js";

/** OpenCode's own tools. Anything else is an MCP tool, which OpenCode names `<server>_<tool>`. */
const CATEGORY: Record<string, ToolCategory> = {
  bash: "shell",
  read: "read",
  list: "search",
  glob: "search",
  grep: "search",
  codesearch: "search",
  lsp: "search",
  edit: "edit",
  multiedit: "edit",
  write: "edit",
  patch: "edit",
  apply_patch: "edit",
  webfetch: "web",
  websearch: "web",
  task: "subagent",
  todowrite: "plan",
  todoread: "plan",
  plan_enter: "plan",
  plan_exit: "plan",
  skill: "skill",
  question: "ask_user",
  batch: "other",
  invalid: "other",
};

export function toolCategory(name: string): { category: ToolCategory; mcpServer?: string } {
  const known = CATEGORY[name];
  if (known) return { category: known };
  if (name.startsWith("lsp_")) return { category: "search" };
  const cut = name.indexOf("_");
  if (cut > 0) return { category: "mcp", mcpServer: name.slice(0, cut) };
  return { category: "other" };
}

/** Tokens OpenCode recorded: `input` already excludes cache reads and writes; reasoning is billed as output. */
function usageOf(tokens: unknown) {
  const value = obj(tokens);
  const cache = obj(value.cache);
  return {
    input: count(value.input),
    cachedInput: count(cache.read),
    cacheWrite: count(cache.write),
    output: count(value.output) + count(value.reasoning),
  };
}

const costOf = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);

function modelName(provider: unknown, model: unknown): string {
  const id = str(model).trim();
  const vendor = str(provider).trim();
  if (!id) return "";
  return vendor ? `${vendor}/${id}` : id;
}

const ABORTED = "MessageAbortedError";

interface Options {
  /** A subagent session folded into its parent: its prompts are the parent agent's, not the person's. */
  child: boolean;
  /** A subagent session whose parent is gone: its briefing is still another agent talking. */
  orphan?: boolean;
}

class MessageWalker {
  private abortPending = false;
  readonly legacyIds = new Set<string>();

  constructor(
    private readonly builder: SessionBuilder,
    private readonly reader: Reader,
    private readonly sessionId: string,
  ) {}

  run(options: Options): void {
    for (const message of this.reader.messages(this.sessionId)) {
      this.legacyIds.add(message.id);
      if (!message.data) {
        this.builder.issues += 1;
        continue;
      }
      const role = message.data.role;
      if (role === "user") this.user(message, options);
      else if (role === "assistant") this.assistant(message);
      else this.builder.issues += 1;
    }
    this.v2();
  }

  private parts(message: MessageRecord): Obj[] {
    const out: Obj[] = [];
    for (const part of this.reader.parts(message.id, this.sessionId)) {
      if (part.data) out.push(part.data);
      else this.builder.issues += 1;
    }
    return out;
  }

  private user(message: MessageRecord, options: Options): void {
    const data = message.data!;
    const timestamp = isoFrom(obj(data.time).created) ?? isoFrom(message.createdMs);
    const parts = this.parts(message);
    const typed: string[] = [];
    for (const part of parts) {
      const type = part.type;
      // Synthetic text is what OpenCode adds itself: file contents, tool replays, editor context.
      if (type === "text" && part.synthetic !== true && part.ignored !== true) typed.push(str(part.text));
      else if (type === "compaction") this.builder.compactions += 1;
      else if (type === "subtask") this.builder.subagents += 1;
    }
    const text = typed.join("\n").trim();
    if (!text) {
      this.builder.noteTime(timestamp);
      return;
    }
    if (options.child) {
      // The parent agent briefing its subagent: activity, not the person.
      this.builder.noteTime(timestamp);
      if (options.orphan && timestamp) this.builder.agentMessageCount += 1;
      return;
    }
    this.builder.prompt(timestamp, text, { interrupted: this.abortPending });
    this.abortPending = false;
    const model = obj(data.model);
    const name = modelName(model.providerID, model.modelID);
    if (name) this.builder.noteModel(name);
  }

  private assistant(message: MessageRecord): void {
    const data = message.data!;
    const times = obj(data.time);
    const created = isoFrom(times.created) ?? isoFrom(message.createdMs);
    const completed = isoFrom(times.completed);
    const model = modelName(data.providerID, data.modelID);
    const finish = str(data.finish);
    const error = obj(data.error);
    const finished = !!completed && finish !== "tool-calls" && finish !== "tool_calls";
    this.builder.assistant(created, { model, finished, endedAt: completed });
    if (data.mode === "plan" || data.agent === "plan") this.builder.planMode = true;
    if (data.summary === true || data.mode === "compaction" || data.agent === "compaction") this.builder.compactions += 1;
    if (error.name) {
      this.builder.turnEnded();
      if (error.name === ABORTED) this.abortPending = true;
    }

    const parts = this.parts(message);
    const at = completed ?? created;
    let stepped = false;
    let stepIndex = 0;
    for (const part of parts) {
      switch (part.type) {
        case "step-finish":
          if (part.tokens && typeof part.tokens === "object") {
            stepped = true;
            const id = str(part.id) || `${message.id}:step${stepIndex}`;
            this.builder.request(id, at, model, usageOf(part.tokens), costOf(part.cost));
          }
          stepIndex += 1;
          break;
        case "tool":
          this.tool(part, created);
          break;
        case "text":
          if (created && part.synthetic !== true) this.builder.turn({ role: "assistant", timestamp: created, text: str(part.text) });
          break;
        case "compaction":
          this.builder.compactions += 1;
          break;
        case "reasoning": {
          // Reasoning parts carry their own start and end in epoch ms.
          const time = obj(part.time);
          const ms = typeof time.start === "number" && typeof time.end === "number" && time.end >= time.start ? time.end - time.start : null;
          this.builder.thought(ms);
          break;
        }
        default:
          break;
      }
    }
    // Older versions put a whole turn in one message and kept only the message totals.
    if (!stepped && data.tokens && typeof data.tokens === "object") this.builder.request(message.id, at, model, usageOf(data.tokens), costOf(data.cost));
  }

  private tool(part: Obj, fallback: string | null): void {
    const name = str(part.tool) || "unknown";
    const state = obj(part.state);
    const input = obj(state.input);
    const metadata = obj(state.metadata);
    const timestamp = isoFrom(obj(state.time).start) ?? fallback;
    if (!timestamp) {
      this.builder.issues += 1;
      return;
    }
    const { category, mcpServer } = toolCategory(name);
    const status = str(state.status);
    const failed = status === "error";
    const errorText = str(state.error);
    const call: ToolInput = { name, category, timestamp };
    if (mcpServer) call.mcpServer = mcpServer;
    const filePath = str(input.filePath) || str(input.path);
    if (category === "shell") {
      const command = str(input.command);
      if (command) call.command = command;
      const exit = metadata.exit;
      const error: ToolErrorCategory | undefined = failed ? errorCategory(errorText, "shell") : shellError(exit, str(metadata.output));
      if (error) call.error = error;
    } else if (failed) {
      call.error = errorCategory(errorText, category);
    }
    if (filePath && (category === "read" || category === "edit")) call.filePath = filePath;
    if (category === "skill") {
      const skill = str(input.name) || str(input.skill);
      if (skill) call.skill = skill;
    }
    if (category === "edit" && !failed) {
      const modified = this.edit(name, input, metadata, filePath);
      if (modified) call.modified = modified;
    }
    this.builder.tool(call);
    if (this.builder.collectingTurns) {
      const what = call.command ? `$ ${call.command}` : [name, filePath || str(input.pattern) || str(input.url) || str(input.description)].filter(Boolean).join(" ");
      const detail = failed ? `\n${errorText.slice(0, 400)}` : typeof metadata.exit === "number" && metadata.exit !== 0 ? ` (exit ${metadata.exit})` : "";
      this.builder.turn({ role: "tool", timestamp, text: `${what}${detail}`, toolName: name, isError: failed || !!call.error });
    }
  }

  private edit(name: string, input: Obj, metadata: Obj, filePath: string): ToolInput["modified"] | undefined {
    const diff = obj(metadata.filediff);
    if (typeof diff.additions === "number" || typeof diff.deletions === "number") {
      const path = str(diff.file) || filePath;
      return path ? { path, added: count(diff.additions), removed: count(diff.deletions) } : undefined;
    }
    if (name === "patch" || name === "apply_patch") {
      const stats = parseApplyPatch(str(input.patchText) || str(input.patch));
      const path = stats.files[0];
      return path ? { path, added: stats.added, removed: stats.removed } : undefined;
    }
    if (!filePath) return undefined;
    if (name === "write") return { path: filePath, added: lineCount(str(input.content)), removed: 0 };
    if (name === "multiedit" && Array.isArray(input.edits)) {
      let added = 0;
      let removed = 0;
      for (const edit of input.edits.slice(0, 500)) {
        const delta = lineDelta(str(obj(edit).oldString), str(obj(edit).newString));
        added += delta.added;
        removed += delta.removed;
      }
      return { path: filePath, added, removed };
    }
    const delta = lineDelta(str(input.oldString), str(input.newString));
    return { path: filePath, ...delta };
  }

  /** The newer `session_message` table: usage only, and never twice for a message the old tables still hold. */
  private v2(): void {
    for (const record of this.reader.v2(this.sessionId)) {
      if (record.type !== "assistant" && record.type !== "compaction") continue;
      if (this.legacyIds.has(record.id)) continue;
      if (!record.data) {
        this.builder.issues += 1;
        continue;
      }
      const data = record.data;
      const timestamp = isoFrom(obj(data.time).created) ?? isoFrom(record.createdMs);
      const model = obj(data.model);
      const name = modelName(model.providerID, model.id ?? model.modelID);
      if (record.type === "compaction") this.builder.compactions += 1;
      else this.builder.assistant(timestamp, { model: name });
      this.builder.noteTime(timestamp);
      if (data.tokens && typeof data.tokens === "object") this.builder.request(record.id, timestamp, name, usageOf(data.tokens), costOf(data.cost));
    }
  }
}

/** Subagent sessions OpenCode spawned from this one, children of children included. */
export function descendants(reader: Reader, id: string): string[] {
  const out: string[] = [];
  const queue = [id];
  const seen = new Set([id]);
  for (let depth = 0; queue.length > 0 && depth < 2_000 && out.length < MAX_CHILDREN; depth += 1) {
    const next = queue.shift()!;
    for (const child of reader.children(next)) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

export interface BuildOptions {
  turnChars?: number;
  /** Legacy storage needs each session's files loaded first. */
  load?: (id: string) => Promise<void>;
}

export async function buildSession(reader: Reader, file: SessionFile, sessionId: string, options: BuildOptions = {}): Promise<{ session: Session | null; builder: SessionBuilder }> {
  const builder = new SessionBuilder("opencode", options.turnChars === undefined ? {} : { turnChars: options.turnChars });
  const row = reader.session(sessionId);
  if (!row) return { session: null, builder };
  builder.projectPath = row.directory;
  await options.load?.(sessionId);
  // A session whose parent is gone is still history; its briefing then counts as another agent's message.
  const orphanChild = row.parentId !== null && reader.session(row.parentId) === null;
  new MessageWalker(builder, reader, sessionId).run(orphanChild ? { child: true, orphan: true } : { child: false });
  if (!row.parentId || orphanChild) {
    for (const child of descendants(reader, sessionId)) {
      await options.load?.(child);
      new MessageWalker(builder, reader, child).run({ child: true });
    }
  }
  return { session: builder.build(file, sessionId), builder };
}
