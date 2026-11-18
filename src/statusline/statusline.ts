import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dayKey, readDigest, type Digest } from "../nudge/digest.js";
import { resolveHome } from "../store/home.js";

// `ai-insights statusline`: one line for Claude Code's status bar (https://code.claude.com/docs/en/statusline).
// Claude Code runs it on every update, so it stays cheap: Node built-ins only, it never reads history, only the
// saved digest and the new bytes of this session's own transcript since the last call, and it never throws. The
// line is shown to the person, not added to the model's context.

/** What Claude Code sends on stdin, as far as this reads it. Every field may be missing. */
export interface StatusInput {
  session_id?: unknown;
  transcript_path?: unknown;
  model?: { display_name?: unknown; id?: unknown };
  cost?: { total_cost_usd?: unknown; total_duration_ms?: unknown };
  context_window?: { used_percentage?: unknown };
}

/** Counts kept per session between calls, so each call reads only what the transcript gained. */
export interface SessionCounts {
  path: string;
  offset: number;
  size: number;
  compactions: number;
  interrupts: number;
}

const MAX_STDIN_BYTES = 1024 * 1024;
/** One call reads at most this much new transcript; the rest waits for the next call. */
export const MAX_READ_BYTES = 32 * 1024 * 1024;
const STATE_DIR = "statusline";
const MAX_STATE_FILES = 200;
const STATE_TTL_MS = 14 * 86_400_000;

// Unescaped quotes only occur in JSON structure, never inside a string, so these mark real records, not text.
const COMPACTION = Buffer.from('"subtype":"compact_boundary"');
// Claude Code writes this text when the person stops a turn.
const INTERRUPT = Buffer.from("[Request interrupted by user");

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, max) : "");

function occurrences(buffer: Buffer, needle: Buffer): number {
  let count = 0;
  for (let at = buffer.indexOf(needle); at !== -1; at = buffer.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

function money(value: number): string {
  return value >= 100 ? `$${Math.round(value).toLocaleString("en-US")}` : `$${value.toFixed(2)}`;
}

/** The session's counts so far: the saved ones plus whatever the transcript gained since. */
export async function sessionCounts(home: string, sessionId: string, transcript: string): Promise<SessionCounts | null> {
  if (!transcript.endsWith(".jsonl")) return null;
  const file = join(home, STATE_DIR, `${createHash("sha256").update(sessionId || transcript).digest("hex").slice(0, 32)}.json`);
  let saved: SessionCounts | null = null;
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as SessionCounts;
    if (raw && raw.path === transcript && Number.isSafeInteger(raw.offset) && Number.isSafeInteger(raw.compactions) && Number.isSafeInteger(raw.interrupts)) saved = raw;
  } catch {
    saved = null;
  }
  const info = await stat(transcript).catch(() => null);
  if (!info?.isFile()) return saved;
  // A transcript that shrank was rewritten: count it again from the top.
  const counts: SessionCounts = saved && info.size >= saved.offset ? { ...saved } : { path: transcript, offset: 0, size: 0, compactions: 0, interrupts: 0 };
  if (info.size > counts.offset) {
    const handle = await open(transcript, "r");
    try {
      const length = Math.min(info.size - counts.offset, MAX_READ_BYTES);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, counts.offset);
      // Stop at the last newline so a line being written is counted once, when it is whole.
      const chunk = buffer.subarray(0, bytesRead);
      const end = chunk.lastIndexOf(0x0a) + 1;
      const whole = chunk.subarray(0, end);
      counts.compactions += occurrences(whole, COMPACTION);
      counts.interrupts += occurrences(whole, INTERRUPT);
      counts.offset += end;
    } finally {
      await handle.close();
    }
  }
  counts.size = info.size;
  await saveCounts(home, file, counts, saved === null);
  return counts;
}

async function saveCounts(home: string, file: string, counts: SessionCounts, created: boolean): Promise<void> {
  try {
    // Only into a store that exists: the status bar never creates one.
    if (!(await stat(home).catch(() => null))?.isDirectory()) return;
    await mkdir(join(home, STATE_DIR), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(counts), { mode: 0o600 });
    await rename(temp, file);
    if (created) await prune(join(home, STATE_DIR));
  } catch {
    // Without its saved counts the next call reads the transcript again: slower, never wrong.
  }
}

/** Keeps the folder small: sessions older than the TTL go, then the oldest beyond the cap. */
async function prune(dir: string): Promise<void> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).slice(0, MAX_STATE_FILES * 4);
  const entries = (await Promise.all(names.map(async (name) => ({ path: join(dir, name), info: await stat(join(dir, name)).catch(() => null) })))).filter((entry) => entry.info?.isFile());
  entries.sort((a, b) => b.info!.mtimeMs - a.info!.mtimeMs);
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [index, entry] of entries.entries()) if (index >= MAX_STATE_FILES || entry.info!.mtimeMs < cutoff) await rm(entry.path, { force: true });
}

/** Short hints, by finding kind, for the status bar when this session gives no hint of its own. */
const SHORT_TIPS: Record<string, string> = {
  repeated_failed_command: "a command keeps failing: say how to run it",
  repeated_instruction: "repeated instructions: write them down once",
  slow_correction: "agree the plan before long runs",
  frequent_interruptions: "front-load the request",
  context_resets: "/clear between unrelated tasks",
  long_sessions: "split long work at checkpoints",
  cache_miss_cost: "keep sessions on one model",
  expensive_model_for_simple_work: "smaller model for quick questions",
  no_tests_before_done: "run the checks before done",
  permission_prompt_load: "allow the commands you keep approving",
  tool_error_hotspot: "one tool keeps failing: see the report",
};

/** Hints for this session, most pressing first; the line shows one, rotating each minute when there are several. */
export function hints(input: StatusInput, counts: SessionCounts | null, digest: Digest | null, now: Date): string[] {
  const out: string[] = [];
  const context = num(input.context_window?.used_percentage);
  if (context !== null && context >= 80) out.push(`context ${Math.round(context)}%: /clear or hand off soon`);
  if (counts && counts.compactions >= 2) out.push(`${counts.compactions} compactions: /clear between tasks`);
  if (counts && counts.interrupts >= 3) out.push(`${counts.interrupts} interrupts: front-load the request`);
  const duration = num(input.cost?.total_duration_ms);
  if (duration !== null && duration >= 3 * 3_600_000) out.push(`${Math.floor(duration / 3_600_000)} h in: split at a checkpoint`);
  if (out.length === 0 && digest) {
    const week = digest.periods.week;
    const tip = week.tip?.id && Object.hasOwn(SHORT_TIPS, week.tip.id) ? SHORT_TIPS[week.tip.id] : undefined;
    if (tip && Date.parse(digest.writtenAt) > now.getTime() - 8 * 86_400_000) out.push(`this week: ${tip}`);
  }
  return out;
}

export interface StatusOptions {
  noCost: boolean;
  now: Date;
}

/** The line, from what Claude Code sent, the saved digest and this session's counts. */
export function statusLine(input: StatusInput, counts: SessionCounts | null, digest: Digest | null, options: StatusOptions): string {
  const parts: string[] = [];
  const model = text(input.model?.display_name, 40) || text(input.model?.id, 40);
  if (model) parts.push(model);
  if (!options.noCost) {
    // Claude Code's own figure for this session; AI Insights does not estimate it again.
    const session = num(input.cost?.total_cost_usd);
    if (session !== null && session >= 0) parts.push(`${money(session)} session`);
    const today = digest?.periods.today;
    if (today && today.costUsd !== null && today.from.slice(0, 10) === dayKey(options.now)) {
      // The digest is as of the last AI Insights run; say so when that was a while ago.
      const asOf = Date.parse(digest!.writtenAt);
      const stale = options.now.getTime() - asOf > 30 * 60_000;
      parts.push(`${money(today.costUsd)} today${stale ? ` by ${today.to.slice(11, 16)}` : ""}`);
    }
  }
  const context = num(input.context_window?.used_percentage);
  if (context !== null) parts.push(`ctx ${Math.round(context)}%`);
  const list = hints(input, counts, digest, options.now);
  if (list.length) parts.push(list[Math.floor(options.now.getTime() / 60_000) % list.length]!);
  return parts.length ? parts.join(" · ") : "AI Insights";
}

async function readStdin(stream: NodeJS.ReadableStream, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    // Claude Code closes stdin after the JSON; a caller that never does gets the line anyway.
    const timer = setTimeout(done, timeoutMs);
    timer.unref?.();
    stream.on("data", (chunk: unknown) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += bytes.length;
      if (size <= MAX_STDIN_BYTES) chunks.push(bytes);
    });
    stream.on("end", done);
    stream.on("error", done);
  });
}

export const PRINT_CONFIG = `Add this to ~/.claude/settings.json (or a project's .claude/settings.json), inside the top-level object:

  "statusLine": {
    "type": "command",
    "command": "ai-insights statusline"
  }

Add " --no-cost" to the command to leave cost out. It needs a global install, so the status bar does not run npx
(which asks the npm registry for the latest version on every refresh):

  npm install -g ai-insights

AI Insights does not edit Claude Code's settings itself. To remove it, delete the "statusLine" entry.
`;

export interface StatuslineDeps {
  stdin: NodeJS.ReadableStream;
  stdout: (text: string) => void;
  env: NodeJS.ProcessEnv;
  now: () => Date;
}

/** Always exits 0 and prints one line: a failure anywhere still gives a minimal line, never an error. */
export async function runStatusline(argv: string[], deps: StatuslineDeps): Promise<number> {
  if (argv.includes("--print-config")) {
    deps.stdout(PRINT_CONFIG);
    return 0;
  }
  let input: StatusInput = {};
  try {
    const raw = await readStdin(deps.stdin, 500);
    const parsed: unknown = raw.trim() ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as StatusInput;
  } catch {
    input = {};
  }
  let line = text(input.model?.display_name, 40) || "AI Insights";
  try {
    const home = resolveHome(deps.env);
    const now = deps.now();
    const session = text(input.session_id, 200);
    const transcript = text(input.transcript_path, 4096);
    const [digest, counts] = await Promise.all([readDigest(home), transcript ? sessionCounts(home, session, transcript).catch(() => null) : Promise.resolve(null)]);
    line = statusLine(input, counts, digest, { noCost: argv.includes("--no-cost"), now });
  } catch {
    // Keep the minimal line.
  }
  deps.stdout(`${line}\n`);
  return 0;
}
