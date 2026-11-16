import { opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { DiscoverOptions, ExcerptOptions, Session, SessionFile, Source, ToolCategory, TranscriptTurn } from "../../schema/types.js";
import { errorCategory } from "../claude/classify.js";
import { readJsonl } from "../claude/jsonl.js";
import { count, diffLines, isoFrom, lineCount, lineDelta, obj, SessionBuilder, str, type Obj, type ToolInput } from "../common/builder.js";
import { excerptLimits, finishExcerpt } from "../common/excerpt.js";

/**
 * Pi (pi.dev) and its fork OMP write one JSONL file per session under `<agent dir>/sessions/<--escaped-cwd-->/`:
 * a `session` header (id, cwd), then `message` entries holding user, assistant and tool-result messages,
 * with per-response `usage` including Pi's own `cost`. The roots and environment variables follow CodexBar's
 * Pi notes (docs/pi.md and PiFamilySessionRootResolver.swift, MIT).
 */

const MAX_FILES = 50_000;
const MAX_DEPTH = 4;

function absolute(value: string | undefined, home: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed === "~" || trimmed.startsWith("~/")) return join(home, trimmed.slice(1));
  return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
}

export function piDefaultRoots(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string[] {
  const roots: string[] = [];
  const sessionDir = absolute(env.PI_CODING_AGENT_SESSION_DIR, home);
  const agentDir = absolute(env.PI_CODING_AGENT_DIR, home);
  if (sessionDir) roots.push(sessionDir);
  else roots.push(join(agentDir ?? join(home, ".pi", "agent"), "sessions"));
  // OMP: `~/.omp` (or the home-relative PI_CONFIG_DIR), its profiles, and its XDG data folder.
  const configName = env.PI_CONFIG_DIR?.trim();
  const omp = configName && !isAbsolute(configName) ? join(home, configName) : join(home, ".omp");
  const xdg = env.XDG_DATA_HOME?.trim() && isAbsolute(env.XDG_DATA_HOME.trim()) ? env.XDG_DATA_HOME.trim() : join(home, ".local", "share");
  roots.push(join(omp, "agent", "sessions"), join(omp, "profiles"), join(xdg, "omp", "sessions"), join(xdg, "omp", "profiles"));
  return [...new Set(roots)];
}

async function walk(dir: string, depth: number, out: SessionFile[], seen: Set<string>): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let handle;
  try {
    handle = await opendir(dir);
  } catch {
    return;
  }
  try {
    for await (const entry of handle) {
      if (out.length >= MAX_FILES) return;
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1, out, seen);
      else if (entry.isFile() && entry.name.endsWith(".jsonl") && !seen.has(path)) {
        const info = await stat(path).catch(() => null);
        if (!info) continue;
        seen.add(path);
        out.push({ harness: "pi", path, mtimeMs: info.mtimeMs, sizeBytes: info.size });
      }
    }
  } catch {
    // An unreadable folder holds nothing we can use.
  }
}

async function discover(options: DiscoverOptions = {}): Promise<SessionFile[]> {
  const files: SessionFile[] = [];
  const seen = new Set<string>();
  for (const root of options.roots ?? piDefaultRoots()) await walk(resolve(root), 0, files, seen);
  const since = options.since?.getTime();
  const kept = since === undefined ? files : files.filter((file) => file.mtimeMs >= since);
  kept.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return options.maxFiles !== undefined ? kept.slice(0, Math.max(0, options.maxFiles)) : kept;
}

const CATEGORY: Record<string, ToolCategory> = {
  bash: "shell",
  read: "read",
  ls: "search",
  find: "search",
  grep: "search",
  edit: "edit",
  write: "edit",
  subagent: "subagent",
  task: "subagent",
  web_search: "web",
  web_fetch: "web",
  fetch: "web",
  todo: "plan",
  todo_write: "plan",
  ask: "ask_user",
  ask_user: "ask_user",
};

function categoryOf(name: string): ToolCategory {
  return CATEGORY[name] ?? (name.startsWith("mcp__") || name.startsWith("mcp_") ? "mcp" : "other");
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const part = obj(block);
      if (part.type === "text") return str(part.text);
      if (part.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Pi's `input` excludes cache reads and writes, and `output` already includes reasoning (`totalTokens` is their sum). */
function usageOf(value: unknown) {
  const usage = obj(value);
  return { input: count(usage.input), cachedInput: count(usage.cacheRead), cacheWrite: count(usage.cacheWrite), output: count(usage.output) };
}

function costOf(value: unknown): number | undefined {
  const cost = obj(obj(value).cost);
  return typeof cost.total === "number" && Number.isFinite(cost.total) && cost.total >= 0 ? cost.total : undefined;
}

interface Pending {
  index: ToolInput;
  args: Obj;
}

async function build(file: SessionFile, turnChars?: number): Promise<{ session: Session | null; builder: SessionBuilder }> {
  const builder = new SessionBuilder("pi", turnChars === undefined ? {} : { turnChars });
  let id: string | null = null;
  let model = "";
  let aborted = false;
  const pending = new Map<string, Pending>();
  const flushTool = (key: string, result?: Obj) => {
    const call = pending.get(key);
    if (!call) return;
    pending.delete(key);
    const input = call.index;
    const isError = result?.isError === true;
    const text = result ? textOf(result.content) : "";
    if (isError) input.error = errorCategory(text, input.category);
    if (input.category === "edit" && !isError) {
      const path = str(call.args.path) || str(call.args.file_path);
      const diff = str(obj(result?.details).diff);
      if (path) {
        if (diff) input.modified = { path, ...diffLines(diff) };
        else if (input.name === "write") input.modified = { path, added: lineCount(str(call.args.content)), removed: 0 };
        else if (Array.isArray(call.args.edits)) {
          let added = 0;
          let removed = 0;
          for (const edit of call.args.edits.slice(0, 500)) {
            const delta = lineDelta(str(obj(edit).oldText), str(obj(edit).newText));
            added += delta.added;
            removed += delta.removed;
          }
          input.modified = { path, added, removed };
        } else input.modified = { path, ...lineDelta(str(call.args.oldText), str(call.args.newText)) };
      }
    }
    builder.tool(input);
    if (builder.collectingTurns) {
      const what = input.command ? `$ ${input.command}` : [input.name, input.filePath ?? str(call.args.pattern)].filter(Boolean).join(" ");
      builder.turn({ role: "tool", timestamp: input.timestamp, text: isError ? `${what}\n${text.slice(0, 400)}` : what, toolName: input.name, isError });
    }
  };

  for await (const row of readJsonl(file.path)) {
    if (row.kind === "issue") {
      builder.issues += 1;
      continue;
    }
    const entry = row.value;
    const entryTime = isoFrom(entry.timestamp);
    switch (entry.type) {
      case "session":
        id ??= typeof entry.id === "string" ? entry.id : null;
        if (typeof entry.cwd === "string" && !builder.projectPath) builder.projectPath = entry.cwd;
        break;
      case "model_change":
        model = [str(entry.provider), str(entry.modelId)].filter(Boolean).join("/");
        break;
      case "compaction":
        builder.compactions += 1;
        builder.noteTime(entryTime);
        if (entry.usage) builder.request(`${id ?? basename(file.path)}:${str(entry.id)}`, entryTime, model, usageOf(entry.usage), costOf(entry.usage));
        break;
      case "message": {
        const message = obj(entry.message);
        const timestamp = isoFrom(message.timestamp) ?? entryTime;
        if (message.role === "user") {
          builder.prompt(timestamp, textOf(message.content), { interrupted: aborted });
          aborted = false;
        } else if (message.role === "assistant") {
          const name = [str(message.provider), str(message.model)].filter(Boolean).join("/");
          if (name) model = name;
          const stop = str(message.stopReason);
          builder.assistant(timestamp, { model: name, finished: stop !== "toolUse" });
          if (stop === "aborted") aborted = true;
          if (stop === "error" || stop === "aborted") builder.turnEnded();
          // The provider's response id is the same in every copy of a forked session, so a fork is not billed twice.
          const requestId = str(message.responseId) || `${id ?? basename(file.path)}:${str(entry.id)}`;
          if (message.usage) builder.request(requestId, timestamp, name, usageOf(message.usage), costOf(message.usage));
          for (const block of Array.isArray(message.content) ? message.content : []) {
            const part = obj(block);
            if (part.type === "text" && timestamp) builder.turn({ role: "assistant", timestamp, text: str(part.text) });
            if (part.type !== "toolCall" || !timestamp) continue;
            const toolName = str(part.name) || "unknown";
            const args = obj(part.arguments);
            const category = categoryOf(toolName);
            const input: ToolInput = { name: toolName, category, timestamp };
            if (category === "shell" && str(args.command)) input.command = str(args.command);
            const path = str(args.path) || str(args.file_path);
            if (path && (category === "read" || category === "edit")) input.filePath = path;
            const key = str(part.id) || `${entry.id}:${toolName}`;
            flushTool(key);
            pending.set(key, { index: input, args });
          }
        } else if (message.role === "toolResult") {
          flushTool(str(message.toolCallId), message);
        } else if (message.role === "bashExecution") {
          // The person ran `!command` themselves.
          builder.prompt(timestamp, `! ${str(message.command)}`);
        }
        break;
      }
      default:
        // thinking_level_change, label, branch_summary, custom entries: not needed for a session.
        break;
    }
  }
  for (const key of [...pending.keys()]) flushTool(key);
  const sessionId = id ?? basename(file.path, ".jsonl").split("_").pop() ?? basename(file.path, ".jsonl");
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

export const piSource: Source = {
  // Bump whenever a parser change would give a different Session from the same transcript.
  parserVersion: "2",
  harness: "pi",
  label: "Pi",
  defaultRoots: () => piDefaultRoots(),
  discover,
  parse,
  excerpt,
};
