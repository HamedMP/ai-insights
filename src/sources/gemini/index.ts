import { opendir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { DiscoverOptions, ExcerptOptions, Session, SessionFile, Source, ToolCategory, TranscriptTurn } from "../../schema/types.js";
import { errorCategory } from "../claude/classify.js";
import { readJsonl } from "../claude/jsonl.js";
import { count, isoFrom, lineCount, lineDelta, obj, SessionBuilder, str, type Obj, type ToolInput } from "../common/builder.js";
import { excerptLimits, finishExcerpt } from "../common/excerpt.js";

/**
 * Gemini CLI records each chat under `~/.gemini/tmp/<project>/chats/` (`GEMINI_CLI_HOME` moves `~`). Current
 * versions append JSONL: a metadata line (`sessionId`, `projectHash`, `startTime`, `directories`), one line per
 * message (`type` user / gemini / info / error / warning, `timestamp`, `content`; gemini lines add `model`,
 * `tokens` and `toolCalls`), plus `$set`, `$patch` and `$rewindTo` lines. Older versions wrote the same
 * record as one `session-*.json` document. Subagent chats sit in a folder named after their parent session.
 * The format was read from gemini-cli's `chatRecordingTypes.ts` and `chatRecordingService.ts` (Apache-2.0), last
 * re-checked at google-gemini/gemini-cli@4fa64e71 (2026-11-16): gemini lines also carry `thoughts`
 * (subject, description, timestamp; no duration). No Gemini CLI history was available to check it against.
 */

const MAX_FILES = 50_000;
const MAX_LEGACY_BYTES = 64 * 1024 * 1024;
const MAX_MESSAGES = 50_000;

export function geminiDefaultRoots(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string[] {
  const configured = env.GEMINI_CLI_HOME?.trim();
  const base = configured ? (isAbsolute(configured) ? configured : resolve(configured)) : home;
  return [join(base, ".gemini", "tmp")];
}

const CHAT_FILE = /\.(jsonl|json)$/;

async function listChats(dir: string, out: SessionFile[]): Promise<void> {
  let handle;
  try {
    handle = await opendir(dir);
  } catch {
    return;
  }
  try {
    for await (const entry of handle) {
      if (out.length >= MAX_FILES) return;
      const path = join(dir, entry.name);
      if (!entry.isFile() || !entry.name.startsWith("session-") || !CHAT_FILE.test(entry.name)) continue;
      const info = await stat(path).catch(() => null);
      if (!info) continue;
      let mtimeMs = info.mtimeMs;
      let sizeBytes = info.size;
      // Subagent chats live in `chats/<parent session id>/`; they are read with the parent.
      for (const child of await subagentFiles(path)) {
        const childInfo = await stat(child).catch(() => null);
        if (!childInfo) continue;
        mtimeMs = Math.max(mtimeMs, childInfo.mtimeMs);
        sizeBytes += childInfo.size;
      }
      out.push({ harness: "gemini", path, mtimeMs, sizeBytes });
    }
  } catch {
    // An unreadable folder holds nothing we can use.
  }
}

async function sessionIdOf(path: string): Promise<string | null> {
  if (path.endsWith(".jsonl")) {
    for await (const row of readJsonl(path, { maxBytes: 4 * 1024 * 1024, maxLineBytes: 4 * 1024 * 1024, maxLines: 1 })) {
      return row.kind === "record" && typeof row.value.sessionId === "string" ? row.value.sessionId : null;
    }
    return null;
  }
  return null;
}

async function subagentFiles(path: string): Promise<string[]> {
  const id = await sessionIdOf(path);
  if (!id || !/^[\w.-]{1,200}$/.test(id)) return [];
  const dir = join(path, "..", id);
  const out: string[] = [];
  try {
    const handle = await opendir(dir);
    for await (const entry of handle) {
      if (out.length >= 500) break;
      if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(join(dir, entry.name));
    }
  } catch {
    // No subagents.
  }
  return out;
}

async function discover(options: DiscoverOptions = {}): Promise<SessionFile[]> {
  const files: SessionFile[] = [];
  for (const root of options.roots ?? geminiDefaultRoots()) {
    let handle;
    try {
      handle = await opendir(resolve(root));
    } catch {
      continue;
    }
    for await (const project of handle) {
      if (project.isDirectory()) await listChats(join(resolve(root), project.name, "chats"), files);
    }
  }
  const since = options.since?.getTime();
  const kept = since === undefined ? files : files.filter((file) => file.mtimeMs >= since);
  kept.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return options.maxFiles !== undefined ? kept.slice(0, Math.max(0, options.maxFiles)) : kept;
}

// ---------------------------------------------------------------------------
// Reading: fold the append-only records into the conversation they describe.
// ---------------------------------------------------------------------------

interface Conversation {
  meta: Obj;
  /** In order of first appearance; patches update in place. */
  messages: Map<string, Obj>;
  issues: number;
}

function patch(conversation: Conversation, value: Obj): void {
  const changes = obj(value.$patch);
  const updates = Array.isArray(changes.updates) ? changes.updates : [changes];
  for (const update of updates.slice(0, 1_000)) {
    const change = obj(update);
    const target = conversation.messages.get(str(change.id));
    if (!target) continue;
    if (change.content !== undefined) target.content = change.content;
    if (Array.isArray(change.toolCalls)) {
      const calls = Array.isArray(target.toolCalls) ? [...(target.toolCalls as unknown[])] : [];
      for (const raw of change.toolCalls.slice(0, 1_000)) {
        const call = obj(raw);
        const index = calls.findIndex((existing) => str(obj(existing).id) === str(call.id));
        if (index >= 0) calls[index] = { ...obj(calls[index]), ...call };
        else calls.push(call);
      }
      target.toolCalls = calls;
    }
  }
}

function add(conversation: Conversation, message: Obj): void {
  const id = str(message.id) || `line${conversation.messages.size}`;
  if (conversation.messages.size >= MAX_MESSAGES && !conversation.messages.has(id)) {
    conversation.issues += 1;
    return;
  }
  conversation.messages.set(id, { ...message });
}

async function readConversation(path: string): Promise<Conversation> {
  const conversation: Conversation = { meta: {}, messages: new Map(), issues: 0 };
  if (path.endsWith(".json")) {
    try {
      const info = await stat(path);
      if (info.size > MAX_LEGACY_BYTES) {
        conversation.issues += 1;
        return conversation;
      }
      const doc = obj(JSON.parse(await readFile(path, "utf8")));
      conversation.meta = doc;
      for (const message of Array.isArray(doc.messages) ? doc.messages : []) add(conversation, obj(message));
    } catch {
      conversation.issues += 1;
    }
    return conversation;
  }
  for await (const row of readJsonl(path)) {
    if (row.kind === "issue") {
      conversation.issues += 1;
      continue;
    }
    const value = row.value;
    if (value.$set && typeof value.$set === "object") {
      const set = obj(value.$set);
      const { messages, ...rest } = set;
      conversation.meta = { ...conversation.meta, ...rest };
      // A legacy checkpoint carries the whole history; later lines append to it.
      if (Array.isArray(messages)) for (const message of messages) add(conversation, obj(message));
    } else if (value.$patch) patch(conversation, value);
    else if (typeof value.$rewindTo === "string") {
      // The person rewound; what was typed and spent before the rewind still happened, so it is kept.
    } else if (typeof value.type === "string" && "timestamp" in value) add(conversation, value);
    else if (typeof value.sessionId === "string") conversation.meta = { ...conversation.meta, ...value };
    else conversation.issues += 1;
  }
  return conversation;
}

/** Text of a `PartListUnion`: a string, a part, or a list of parts. */
function partText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.slice(0, 200).map(partText).filter(Boolean).join("\n");
  const part = obj(content);
  if (typeof part.text === "string") return part.text;
  if (part.inlineData || part.fileData) return "[attachment]";
  const response = obj(obj(part.functionResponse).response);
  if (typeof response.error === "string") return response.error;
  if (typeof response.output === "string") return response.output;
  return "";
}

const CATEGORY: Record<string, ToolCategory> = {
  run_shell_command: "shell",
  read_file: "read",
  read_many_files: "read",
  write_file: "edit",
  replace: "edit",
  edit: "edit",
  glob: "search",
  search_file_content: "search",
  grep_search: "search",
  list_directory: "search",
  web_fetch: "web",
  google_web_search: "web",
  write_todos: "plan",
  enter_plan_mode: "plan",
  exit_plan_mode: "plan",
  ask_user: "ask_user",
  activate_skill: "skill",
  codebase_investigator: "subagent",
  delegate_to_agent: "subagent",
};

function categoryOf(name: string): { category: ToolCategory; mcpServer?: string } {
  const known = CATEGORY[name];
  if (known) return { category: known };
  const cut = name.indexOf("__");
  if (cut > 0) return { category: "mcp", mcpServer: name.slice(0, cut).replace(/^mcp_/, "") };
  return { category: "other" };
}

/** `promptTokenCount` includes cached content; thoughts are billed as output; tool-use prompts are input. */
function usageOf(tokens: unknown) {
  const value = obj(tokens);
  const cached = count(value.cached);
  return { input: Math.max(0, count(value.input) - cached) + count(value.tool), cachedInput: cached, cacheWrite: 0, output: count(value.output) + count(value.thoughts) };
}

function addMessages(builder: SessionBuilder, sessionId: string, conversation: Conversation, child: boolean): void {
  builder.issues += conversation.issues;
  for (const [id, message] of conversation.messages) {
    const timestamp = isoFrom(message.timestamp);
    const type = message.type;
    if (type === "user") {
      if (child) builder.noteTime(timestamp);
      else builder.prompt(timestamp, partText(message.displayContent ?? message.content));
    } else if (type === "gemini") {
      const model = str(message.model);
      const calls = Array.isArray(message.toolCalls) ? message.toolCalls.slice(0, 2_000).map(obj) : [];
      builder.assistant(timestamp, { model, finished: calls.length === 0 });
      // `thoughts` holds subject, description and timestamp per thought, never a duration.
      if (Array.isArray(message.thoughts) && message.thoughts.length > 0) builder.thought();
      if (message.tokens && typeof message.tokens === "object") builder.request(`${sessionId}:${id}`, timestamp, model, usageOf(message.tokens));
      const text = partText(message.content);
      if (text && timestamp) builder.turn({ role: "assistant", timestamp, text });
      for (const call of calls) tool(builder, call, timestamp);
    } else if (type === "error" || type === "info" || type === "warning") {
      builder.noteTime(timestamp);
      if (type === "error") builder.turnEnded();
    } else builder.issues += 1;
  }
}

function tool(builder: SessionBuilder, call: Obj, fallback: string | null): void {
  const name = str(call.name) || "unknown";
  const timestamp = isoFrom(call.timestamp) ?? fallback;
  if (!timestamp) {
    builder.issues += 1;
    return;
  }
  const args = obj(call.args);
  const { category, mcpServer } = categoryOf(name);
  const input: ToolInput = { name, category, timestamp };
  if (mcpServer) input.mcpServer = mcpServer;
  const status = str(call.status);
  const resultText = partText(call.result);
  if (status === "cancelled") input.error = "user_rejected";
  else if (status === "error") input.error = errorCategory(resultText, category);
  if (category === "shell" && str(args.command)) input.command = str(args.command);
  const path = str(args.file_path) || str(args.absolute_path) || str(args.path);
  if (path && (category === "read" || category === "edit")) input.filePath = path;
  if (category === "skill" && str(args.name)) input.skill = str(args.name);
  if (path && name === "write_file") input.modified = { path, added: lineCount(str(args.content)), removed: 0 };
  else if (path && (name === "replace" || name === "edit")) input.modified = { path, ...lineDelta(str(args.old_string), str(args.new_string)) };
  builder.tool(input);
  if (builder.collectingTurns) {
    const what = input.command ? `$ ${input.command}` : [name, path || str(args.pattern) || str(args.url)].filter(Boolean).join(" ");
    builder.turn({ role: "tool", timestamp, text: input.error ? `${what}\n${resultText.slice(0, 400)}` : what, toolName: name, isError: !!input.error });
  }
}

async function build(file: SessionFile, turnChars?: number): Promise<{ session: Session | null; builder: SessionBuilder }> {
  const builder = new SessionBuilder("gemini", turnChars === undefined ? {} : { turnChars });
  const conversation = await readConversation(file.path);
  const meta = conversation.meta;
  const sessionId = str(meta.sessionId) || basename(file.path).replace(CHAT_FILE, "");
  const directories = Array.isArray(meta.directories) ? meta.directories.filter((dir): dir is string => typeof dir === "string" && isAbsolute(dir)) : [];
  builder.projectPath = directories[0] ?? null;
  builder.noteTime(isoFrom(meta.startTime));
  addMessages(builder, sessionId, conversation, false);
  for (const child of await subagentFiles(file.path)) {
    const folded = await readConversation(child);
    addMessages(builder, str(folded.meta.sessionId) || basename(child, ".jsonl"), folded, true);
  }
  return { session: builder.build(file, sessionId), builder };
}

async function parse(file: SessionFile): Promise<Session | null> {
  try {
    return (await build(file)).session;
  } catch {
    return null;
  }
}

async function excerpt(file: SessionFile, options: ExcerptOptions = {}): Promise<TranscriptTurn[]> {
  try {
    const { builder } = await build(file, excerptLimits(options).maxChars);
    return finishExcerpt(builder.turns, options);
  } catch {
    return [];
  }
}

export const geminiSource: Source = {
  // Bump whenever a parser change would give a different Session from the same chat.
  parserVersion: "3",
  harness: "gemini",
  label: "Gemini CLI",
  defaultRoots: () => geminiDefaultRoots(),
  discover,
  parse,
  excerpt,
};
