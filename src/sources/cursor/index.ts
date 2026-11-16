import { opendir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { DiscoverOptions, ExcerptOptions, Session, SessionFile, Source, ToolCategory, TranscriptTurn } from "../../schema/types.js";
import { readJsonl } from "../claude/jsonl.js";
import { parseApplyPatch } from "../codex/tools.js";
import { lineCount, lineDelta, obj, SessionBuilder, str, type Obj, type ToolInput } from "../common/builder.js";
import { excerptLimits, finishExcerpt } from "../common/excerpt.js";

/**
 * Cursor's agent (the editor's agent panel and the `cursor-agent` CLI) writes a transcript per conversation to
 * `~/.cursor/projects/<project-slug>/agent-transcripts/<id>/<id>.jsonl`, subagents under `<id>/subagents/`.
 * Lines are `{ role, message: { content } }` with the person's text and the agent's text and tool calls. There
 * are no tool results, no token counts and no per-line times: prompts carry a minute-precision `<timestamp>`
 * block, and the file's own times bound the session. Cursor's usage and cost live on cursor.com only.
 */

const MAX_FILES = 50_000;
const MAX_SUBAGENTS = 500;

export function cursorDefaultRoots(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string[] {
  const configured = env.CURSOR_CONFIG_DIR?.trim();
  return [join(configured ? resolve(configured) : join(home, ".cursor"), "projects")];
}

async function entries(dir: string) {
  return readdir(dir, { withFileTypes: true }).catch(() => []);
}

async function subagentFiles(transcript: string): Promise<string[]> {
  const dir = join(dirname(transcript), "subagents");
  return (await entries(dir))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .slice(0, MAX_SUBAGENTS)
    .map((entry) => join(dir, entry.name));
}

async function discover(options: DiscoverOptions = {}): Promise<SessionFile[]> {
  const files: SessionFile[] = [];
  for (const root of options.roots ?? cursorDefaultRoots()) {
    for (const project of await entries(resolve(root))) {
      if (!project.isDirectory() || files.length >= MAX_FILES) continue;
      const transcripts = join(resolve(root), project.name, "agent-transcripts");
      for (const conversation of await entries(transcripts)) {
        if (files.length >= MAX_FILES) break;
        const candidates = conversation.isDirectory()
          ? [join(transcripts, conversation.name, `${conversation.name}.jsonl`)]
          : conversation.isFile() && conversation.name.endsWith(".jsonl")
            ? [join(transcripts, conversation.name)]
            : [];
        for (const path of candidates) {
          const info = await stat(path).catch(() => null);
          if (!info?.isFile()) continue;
          let mtimeMs = info.mtimeMs;
          let sizeBytes = info.size;
          if (conversation.isDirectory()) {
            for (const child of await subagentFiles(path)) {
              const childInfo = await stat(child).catch(() => null);
              if (!childInfo) continue;
              mtimeMs = Math.max(mtimeMs, childInfo.mtimeMs);
              sizeBytes += childInfo.size;
            }
          }
          files.push({ harness: "cursor", path, mtimeMs, sizeBytes });
        }
      }
    }
  }
  const since = options.since?.getTime();
  const kept = since === undefined ? files : files.filter((file) => file.mtimeMs >= since);
  kept.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return options.maxFiles !== undefined ? kept.slice(0, Math.max(0, options.maxFiles)) : kept;
}

// ---------------------------------------------------------------------------
// Project folders: Cursor names them after the workspace path with every non-alphanumeric run turned into "-".
// ---------------------------------------------------------------------------

const slugOf = (name: string) => name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
const MAX_LISTED = 5_000;
const resolved = new Map<string, string | null>();

/** The folder a project slug was made from, found by walking the disk, or null when it is gone or ambiguous. */
export async function projectFromSlug(slug: string, root = "/"): Promise<string | null> {
  const key = `${root}\0${slug}`;
  if (resolved.has(key)) return resolved.get(key)!;
  let budget = 2_000;
  async function search(dir: string, rest: string): Promise<string | null> {
    if (!rest) return dir;
    if ((budget -= 1) < 0) return null;
    let names: string[] = [];
    try {
      const handle = await opendir(dir);
      for await (const entry of handle) {
        if (names.length >= MAX_LISTED) break;
        if (entry.isDirectory()) names.push(entry.name);
      }
    } catch {
      return null;
    }
    // Longest names first, so `my-app` wins over `my` when both exist.
    names = names.filter((name) => {
      const part = slugOf(name);
      return part && (rest === part || rest.startsWith(`${part}-`));
    });
    names.sort((a, b) => slugOf(b).length - slugOf(a).length);
    for (const name of names) {
      const part = slugOf(name);
      const found = await search(join(dir, name), rest.slice(part.length + 1));
      if (found) return found;
    }
    return null;
  }
  const found = /^[A-Za-z0-9-]+$/.test(slug) ? await search(root, slug) : null;
  if (resolved.size > 1_000) resolved.clear();
  resolved.set(key, found);
  return found;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** `Friday, May 29, 2026, 10:30 AM (UTC+2)` to an ISO instant. */
export function parseCursorTimestamp(text: string): string | null {
  const match = /([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([AP]M)?(?: \((?:UTC|GMT)(?:([+-])(\d{1,2})(?::?(\d{2}))?)?\))?/i.exec(text);
  if (!match) return null;
  const month = MONTHS[match[1]!.toLowerCase()];
  if (month === undefined) return null;
  let hour = Number(match[4]);
  const meridiem = match[7]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const offset = match[8] ? (match[8] === "-" ? -1 : 1) * (Number(match[9]) * 60 + Number(match[10] ?? 0)) : 0;
  const ms = Date.UTC(Number(match[3]), month, Number(match[2]), hour, Number(match[5]), Number(match[6] ?? 0)) - offset * 60_000;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const BLOCK = (tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");

/** What the person typed: the `<user_query>` blocks, else the text without the context Cursor wraps around it. */
export function typedText(raw: string): string {
  const queries = [...raw.matchAll(BLOCK("user_query"))].map((match) => match[1]!.trim()).filter(Boolean);
  if (queries.length) return queries.join("\n");
  return raw.replace(/<(timestamp|image_files|attached_files|open_and_recently_viewed_files|system_reminder|user_info|git_status)>[\s\S]*?<\/\1>/g, "").trim();
}

const CATEGORY: Record<string, ToolCategory> = {
  Shell: "shell",
  Await: "shell",
  AwaitShell: "shell",
  Read: "read",
  ReadFile: "read",
  ReadLints: "read",
  StrReplace: "edit",
  Write: "edit",
  ApplyPatch: "edit",
  Delete: "edit",
  EditNotebook: "edit",
  Glob: "search",
  Grep: "search",
  rg: "search",
  SemanticSearch: "search",
  ListDir: "search",
  WebSearch: "web",
  WebFetch: "web",
  Subagent: "subagent",
  Task: "subagent",
  TodoWrite: "plan",
  UpdateCurrentStep: "plan",
  CreatePlan: "plan",
  AskQuestion: "ask_user",
  CallMcpTool: "mcp",
};

function categoryOf(name: string): ToolCategory {
  if (CATEGORY[name]) return CATEGORY[name]!;
  if (name.startsWith("browser_")) return "web";
  if (name.startsWith("mcp_") || name.startsWith("mcp__")) return "mcp";
  return "other";
}

function toolInput(name: string, input: unknown, timestamp: string): ToolInput {
  const args = obj(input);
  const category = categoryOf(name);
  const call: ToolInput = { name, category, timestamp };
  if (category === "mcp") {
    if (str(args.toolName)) call.name = str(args.toolName);
    if (str(args.server)) call.mcpServer = str(args.server);
  }
  if (category === "shell" && str(args.command)) call.command = str(args.command);
  const path = str(args.path) || str(args.target_file) || str(args.file_path);
  if (path && (category === "read" || category === "edit")) call.filePath = path;
  if (name === "StrReplace" && path) call.modified = { path, ...lineDelta(str(args.old_string), str(args.new_string)) };
  else if (name === "Write" && path) call.modified = { path, added: lineCount(str(args.contents) || str(args.content)), removed: 0 };
  else if (name === "Delete" && path) call.modified = { path, added: 0, removed: 0 };
  else if (name === "ApplyPatch") {
    const stats = parseApplyPatch(typeof input === "string" ? input : str(args.patch) || str(args.input));
    const first = stats.files[0];
    if (first) {
      call.filePath = first;
      call.modified = { path: first, added: stats.added, removed: stats.removed };
    }
  }
  return call;
}

function textBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => (obj(block).type === "text" ? str(obj(block).text) : "")).join("\n");
}

class Reader {
  /** Lines carry no times: each one inherits the latest prompt's, starting from the file's creation. */
  private clock: string;
  private stamped = false;

  constructor(
    private readonly builder: SessionBuilder,
    start: string,
  ) {
    this.clock = start;
  }

  line(record: Obj, child: boolean): void {
    const content = obj(record.message).content;
    if (record.role === "user") {
      const raw = textBlocks(content);
      const stamp = /<timestamp>([\s\S]*?)<\/timestamp>/.exec(raw);
      const time = stamp ? parseCursorTimestamp(stamp[1]!) : null;
      // Minute precision: a stamp up to a minute behind the last one is the same moment, not time running back.
      if (time && (!this.stamped || Date.parse(time) >= Date.parse(this.clock) - 60_000)) {
        this.clock = time;
        this.stamped = true;
      }
      if (child) {
        this.builder.noteTime(this.clock);
        return;
      }
      const text = typedText(raw);
      if (text) this.builder.prompt(this.clock, text);
      else this.builder.noteTime(this.clock);
    } else if (record.role === "assistant") {
      // No per-message time exists, so no reply time can be measured from it.
      this.builder.assistant(null);
      if (!Array.isArray(content)) return;
      for (const block of content) {
        const part = obj(block);
        if (part.type === "text") this.builder.turn({ role: "assistant", timestamp: this.clock, text: str(part.text) });
        else if (part.type === "tool_use") {
          const call = toolInput(str(part.name) || "unknown", part.input, this.clock);
          this.builder.tool(call);
          if (this.builder.collectingTurns) {
            const what = call.command ? `$ ${call.command}` : [call.name, call.filePath ?? str(obj(part.input).pattern)].filter(Boolean).join(" ");
            this.builder.turn({ role: "tool", timestamp: this.clock, text: what, toolName: call.name });
          }
        }
      }
    } else {
      this.builder.issues += 1;
    }
  }
}

async function build(file: SessionFile, turnChars?: number): Promise<{ session: Session | null; builder: SessionBuilder }> {
  const builder = new SessionBuilder("cursor", turnChars === undefined ? {} : { turnChars });
  const info = await stat(file.path).catch(() => null);
  if (!info) return { session: null, builder };
  // Linux may report no birth time; the oldest prompt stamp then sets the start.
  const born = info.birthtimeMs > 0 && info.birthtimeMs <= info.mtimeMs ? info.birthtimeMs : info.mtimeMs;
  const reader = new Reader(builder, new Date(born).toISOString());
  for await (const row of readJsonl(file.path)) {
    if (row.kind === "issue") builder.issues += 1;
    else reader.line(row.value, false);
  }
  for (const child of await subagentFiles(file.path)) {
    for await (const row of readJsonl(child)) {
      if (row.kind === "issue") builder.issues += 1;
      else reader.line(row.value, true);
    }
  }
  builder.noteTime(new Date(file.mtimeMs).toISOString());
  const up = dirname(file.path);
  const slug = basename(up) === "agent-transcripts" ? basename(dirname(up)) : basename(dirname(dirname(up)));
  builder.projectPath = await projectFromSlug(slug);
  return { session: builder.build(file, basename(file.path, ".jsonl")), builder };
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

export const cursorSource: Source = {
  // Bump whenever a parser change would give a different Session from the same transcript.
  parserVersion: "1",
  harness: "cursor",
  label: "Cursor",
  defaultRoots: () => cursorDefaultRoots(),
  discover,
  parse,
  excerpt,
};
